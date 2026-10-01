import assert from "node:assert/strict";
import test from "node:test";
import { join, sep } from "node:path";
import {
  keepStoresFor,
  linkDependencies,
  linkType,
  lockKey,
  storeRoot,
  type DepsFs,
} from "./deps.ts";

function fakeFs(
  files: Record<string, string>,
  ages: Record<string, number> = {},
) {
  const links: { target: string; path: string }[] = [];
  const removed: string[] = [];
  const under = (path: string) =>
    Object.keys(files).filter(
      (one) => one === path || one.startsWith(path + sep),
    );
  const fs: DepsFs = {
    exists: (path) => under(path).length > 0,
    read: (path) => files[path] ?? "",
    write: (path, text) => {
      files[path] = text;
    },
    mkdir: (path) => {
      files[path] = "";
    },
    remove: (path) => {
      removed.push(path);
      for (const one of under(path)) delete files[one];
    },
    link: (target, path) => {
      links.push({ target, path });
      files[path] = "";
    },
    move: (from, to) => {
      if (under(to).length > 0) return false;
      for (const one of under(from)) {
        files[to + one.slice(from.length)] = files[one];
        delete files[one];
      }
      return true;
    },
    list: (path) => [
      ...new Set(
        Object.keys(files)
          .filter((one) => one.startsWith(path + sep))
          .map((one) => one.slice(path.length + 1).split(sep)[0]),
      ),
    ],
    age: (path) => ages[path] ?? 0,
  };
  return { fs, files, links, removed };
}

const store = join("/store");
const worktree = join("/wt/7");
const lock = '{"lockfileVersion":3}';
const present = (where = worktree, contents = lock) => ({
  [join(where, "package.json")]: '{"name":"app"}',
  [join(where, "package-lock.json")]: contents,
});

function installer(world: ReturnType<typeof fakeFs>, log: string[] = []) {
  return async (command: string, cwd: string) => {
    log.push(cwd);
    world.files[join(cwd, "node_modules", "vite", "index.js")] = "";
    return { code: 0, output: "added 181 packages" };
  };
}

test("builds a store for the lockfile once, then links later worktrees in no time", async () => {
  const world = fakeFs(present());
  const log: string[] = [];
  const first = await linkDependencies("/repo", worktree, {
    fs: world.fs,
    shell: installer(world, log),
    store,
    name: () => "one",
  });
  assert.deepEqual(first, { linked: true, built: true, reason: "" });
  assert.deepEqual(log, [join(store, ".building-one")]);
  assert.deepEqual(world.links.at(-1), {
    target: join(store, lockKey(lock), "node_modules"),
    path: join(worktree, "node_modules"),
  });

  Object.assign(world.files, present(join("/wt/8")));
  const second = await linkDependencies("/repo", join("/wt/8"), {
    fs: world.fs,
    shell: installer(world, log),
    store,
    name: () => "two",
  });
  assert.deepEqual(second, { linked: true, built: false, reason: "" });
  assert.equal(log.length, 1);
});

test("a branch with its own lockfile gets its own store, never deleting the one in use", async () => {
  const world = fakeFs({
    ...present(),
    ...present(join("/wt/8"), '{"lockfileVersion":4}'),
  });
  const log: string[] = [];
  await linkDependencies("/repo", worktree, {
    fs: world.fs,
    shell: installer(world, log),
    store,
    name: () => "one",
  });
  await linkDependencies("/repo", join("/wt/8"), {
    fs: world.fs,
    shell: installer(world, log),
    store,
    name: () => "two",
  });
  assert.equal(log.length, 2);
  assert.notEqual(lockKey(lock), lockKey('{"lockfileVersion":4}'));
  assert.ok(world.fs.exists(join(store, lockKey(lock), "ready")));
  assert.ok(
    world.fs.exists(join(store, lockKey('{"lockfileVersion":4}'), "ready")),
  );
  assert.ok(
    world.fs.exists(
      join(store, lockKey(lock), "node_modules", "vite", "index.js"),
    ),
    "the first store still holds its packages",
  );
});

test("a worker that loses the race to build uses the store that won", async () => {
  const world = fakeFs(present());
  const rival = installer(world);
  const shell = async (command: string, cwd: string) => {
    const result = await rival(command, cwd);
    world.files[join(store, lockKey(lock), "ready")] = lockKey(lock);
    world.files[
      join(store, lockKey(lock), "node_modules", "vite", "index.js")
    ] = "";
    return result;
  };
  const report = await linkDependencies("/repo", worktree, {
    fs: world.fs,
    shell,
    store,
    name: () => "late",
  });
  assert.equal(report.linked, true);
  assert.equal(report.built, false);
  assert.ok(world.removed.includes(join(store, ".building-late")));
  assert.deepEqual(world.links.at(-1), {
    target: join(store, lockKey(lock), "node_modules"),
    path: join(worktree, "node_modules"),
  });
});

test("sweeps stores nothing has wanted for a week, and spares the fresh ones", async () => {
  const stale = join(store, "0000stale000");
  const young = join(store, "1111young11");
  const world = fakeFs(
    {
      ...present(),
      [join(stale, "ready")]: "x",
      [join(young, "ready")]: "x",
    },
    { [stale]: keepStoresFor + 1000, [young]: 60_000 },
  );
  await linkDependencies("/repo", worktree, {
    fs: world.fs,
    shell: installer(world),
    store,
    name: () => "one",
  });
  assert.ok(world.removed.includes(stale));
  assert.ok(!world.removed.includes(young));
});

test("clears a stale link before pointing it at the store", async () => {
  const world = fakeFs({
    ...present(),
    [join(worktree, "node_modules")]: "",
    [join(store, lockKey(lock), "ready")]: lockKey(lock),
    [join(store, lockKey(lock), "node_modules", "vite", "index.js")]: "",
  });
  await linkDependencies("/repo", worktree, {
    fs: world.fs,
    shell: async () => ({ code: 1, output: "should not run" }),
    store,
  });
  assert.ok(world.removed.includes(join(worktree, "node_modules")));
  assert.deepEqual(world.links.at(-1), {
    target: join(store, lockKey(lock), "node_modules"),
    path: join(worktree, "node_modules"),
  });
});

test("leaves a repository that is not a node package alone", async () => {
  const world = fakeFs({});
  const report = await linkDependencies("/repo", worktree, {
    fs: world.fs,
    shell: async () => ({ code: 1, output: "should not run" }),
    store,
  });
  assert.deepEqual(report, { linked: false, built: false, reason: "" });
  assert.equal(world.links.length, 0);
});

test("throws a failed install away, so nothing links to half a store", async () => {
  const world = fakeFs(present());
  const report = await linkDependencies("/repo", worktree, {
    fs: world.fs,
    shell: async () => ({
      code: 1,
      output: "npm error code EUSAGE\nnpm error lock file out of sync",
    }),
    store,
    name: () => "one",
  });
  assert.equal(report.linked, false);
  assert.match(report.reason, /lock file out of sync/);
  assert.equal(world.links.length, 0);
  assert.ok(world.removed.includes(join(store, ".building-one")));
  assert.ok(!world.fs.exists(join(store, lockKey(lock), "ready")));
});

test("names one store root per repository path", () => {
  const one = storeRoot("/repo/a", "/config");
  const prefix = join("/config", "deps", "a-");
  assert.notEqual(one, storeRoot("/repo/b", "/config"));
  assert.ok(one.startsWith(prefix));
  assert.match(one.slice(prefix.length), /^[0-9a-f]{8}$/);
  assert.equal(storeRoot("/repo/a", "/config"), one);
});

test("links as a junction on Windows, where a directory symlink needs rights a runner has not got", () => {
  assert.equal(linkType("win32"), "junction");
  assert.equal(linkType("darwin"), "dir");
  assert.equal(linkType("linux"), "dir");
});
