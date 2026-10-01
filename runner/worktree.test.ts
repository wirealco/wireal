import assert from "node:assert/strict";
import test from "node:test";
import { basename, dirname, join } from "node:path";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  catchUpBase,
  commitWorktree,
  ensureBase,
  openWorktree,
  removeWorktree,
  repositoryUrl,
  worktreePath,
  type Run,
} from "./worktree.ts";

type Call = { args: string[]; cwd: string };

function fakeGit(answers: Record<string, { code?: number; stdout?: string }>) {
  const calls: Call[] = [];
  const run: Run = async (args, cwd) => {
    calls.push({ args, cwd });
    const answer = answers[args.join(" ")] ?? {};
    return { code: answer.code ?? 0, stdout: answer.stdout ?? "", stderr: "" };
  };
  return { calls, run };
}

test("opens a worktree on a new branch cut from the default branch", async () => {
  const git = fakeGit({
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": {
      stdout: "origin/main\n",
    },
    "rev-parse --verify --quiet refs/heads/wireal/7": { code: 1 },
    "rev-parse --verify --quiet refs/remotes/origin/wireal/7": { code: 1 },
  });
  const path = worktreePath("/repo", "7", "/tmp/wireal-config");
  const worktree = await openWorktree(
    "/repo",
    "7",
    "",
    git.run,
    "/tmp/wireal-config",
  );
  assert.deepEqual(worktree, {
    path,
    branch: "wireal/7",
    base: "main",
  });
  assert.deepEqual(
    git.calls.map((call) => call.args.join(" ")),
    [
      "symbolic-ref --quiet --short refs/remotes/origin/HEAD",
      "worktree prune",
      "rev-parse --verify --quiet refs/heads/wireal/7",
      "rev-parse --verify --quiet refs/remotes/origin/wireal/7",
      `worktree add ${path} -b wireal/7 main`,
    ],
  );
  assert.ok(git.calls.every((call) => call.cwd === "/repo"));
});

test("an agent branch strictly behind the default branch is fast-forwarded", async () => {
  const git = fakeGit({
    remote: { stdout: "origin\n" },
    "rev-parse --verify --quiet refs/remotes/origin/agents": {
      stdout: "aaa111\n",
    },
    "rev-parse --verify --quiet refs/remotes/origin/main": {
      stdout: "bbb222\n",
    },
    "merge-base --is-ancestor bbb222 aaa111": { code: 1 },
    "merge-base --is-ancestor aaa111 bbb222": { code: 0 },
  });
  assert.equal(await catchUpBase("/repo", "agents", "main", git.run), "bbb222");
  const said = git.calls.map((call) => call.args.join(" "));
  assert.ok(said.includes("fetch origin agents main"));
  assert.ok(said.includes("push origin bbb222:refs/heads/agents"));
  assert.ok(said.includes("branch --force agents bbb222"));
  assert.ok(!said.some((line) => line.startsWith("merge-tree")));
});

test("an agent branch that has moved as well takes a merge commit", async () => {
  const git = fakeGit({
    remote: { stdout: "origin\n" },
    "rev-parse --verify --quiet refs/remotes/origin/agents": {
      stdout: "aaa111\n",
    },
    "rev-parse --verify --quiet refs/remotes/origin/main": {
      stdout: "bbb222\n",
    },
    "merge-base --is-ancestor bbb222 aaa111": { code: 1 },
    "merge-base --is-ancestor aaa111 bbb222": { code: 1 },
    "merge-tree --write-tree aaa111 bbb222": { stdout: "tree777\n" },
    "commit-tree tree777 -p aaa111 -p bbb222 -m Merge main into agents": {
      stdout: "ccc333\n",
    },
  });
  assert.equal(await catchUpBase("/repo", "agents", "main", git.run), "ccc333");
  assert.ok(
    git.calls
      .map((call) => call.args.join(" "))
      .includes("push origin ccc333:refs/heads/agents"),
  );
});

test("a branch that already carries the default branch is left alone", async () => {
  const git = fakeGit({
    remote: { stdout: "origin\n" },
    "rev-parse --verify --quiet refs/remotes/origin/agents": {
      stdout: "aaa111\n",
    },
    "rev-parse --verify --quiet refs/remotes/origin/main": {
      stdout: "bbb222\n",
    },
    "merge-base --is-ancestor bbb222 aaa111": { code: 0 },
  });
  assert.equal(await catchUpBase("/repo", "agents", "main", git.run), "");
  assert.ok(!git.calls.some((call) => call.args[0] === "push"));
});

test("a conflicting catch up leaves the branch where it was", async () => {
  const git = fakeGit({
    remote: { stdout: "origin\n" },
    "rev-parse --verify --quiet refs/remotes/origin/agents": {
      stdout: "aaa111\n",
    },
    "rev-parse --verify --quiet refs/remotes/origin/main": {
      stdout: "bbb222\n",
    },
    "merge-base --is-ancestor bbb222 aaa111": { code: 1 },
    "merge-base --is-ancestor aaa111 bbb222": { code: 1 },
    "merge-tree --write-tree aaa111 bbb222": { code: 1 },
  });
  assert.equal(await catchUpBase("/repo", "agents", "main", git.run), "");
  assert.ok(!git.calls.some((call) => call.args[0] === "push"));
});

test("the default branch named as the agent branch catches nothing up", async () => {
  const git = fakeGit({ remote: { stdout: "origin\n" } });
  assert.equal(await catchUpBase("/repo", "main", "main", git.run), "");
  assert.equal(await catchUpBase("/repo", "  ", "main", git.run), "");
  assert.equal(git.calls.length, 0);
});

test("an agent branch the remote already has is used as it is", async () => {
  const git = fakeGit({
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": {
      stdout: "origin/main\n",
    },
    remote: { stdout: "origin\n" },
    "rev-parse --verify --quiet refs/heads/agents": { code: 1 },
    "rev-parse --verify --quiet refs/remotes/origin/agents": {
      stdout: "abc123\n",
    },
  });
  assert.equal(await ensureBase("/repo", "agents", git.run), "agents");
  const said = git.calls.map((call) => call.args.join(" "));
  assert.ok(said.includes("fetch origin agents"));
  assert.ok(said.includes("branch agents origin/agents"));
});

test("an agent branch nobody has yet is cut from the default branch", async () => {
  const git = fakeGit({
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": {
      stdout: "origin/main\n",
    },
    remote: { stdout: "origin\n" },
    "rev-parse --verify --quiet refs/heads/agents": { code: 1 },
    "rev-parse --verify --quiet refs/remotes/origin/agents": { code: 1 },
    "rev-parse --verify --quiet refs/remotes/origin/main": {
      stdout: "def456\n",
    },
  });
  assert.equal(await ensureBase("/repo", "agents", git.run), "agents");
  assert.ok(
    git.calls
      .map((call) => call.args.join(" "))
      .includes("branch agents origin/main"),
  );
});

test("no agent branch, or the default branch named again, is the default branch", async () => {
  const git = fakeGit({
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": {
      stdout: "origin/main\n",
    },
  });
  assert.equal(await ensureBase("/repo", "", git.run), "main");
  assert.equal(await ensureBase("/repo", "  ", git.run), "main");
  assert.equal(await ensureBase("/repo", "main", git.run), "main");
  assert.ok(!git.calls.some((call) => call.args[0] === "branch"));
});

test("a branch git refuses to make leaves the base where it was", async () => {
  const git = fakeGit({
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": {
      stdout: "origin/main\n",
    },
    remote: { stdout: "origin\n" },
    "rev-parse --verify --quiet refs/heads/agents": { code: 1 },
    "rev-parse --verify --quiet refs/remotes/origin/agents": { code: 1 },
    "rev-parse --verify --quiet refs/remotes/origin/main": {
      stdout: "def456\n",
    },
    "branch agents origin/main": { code: 1 },
  });
  assert.equal(await ensureBase("/repo", "agents", git.run), "main");
});

test("a worktree opens on the agent branch when the workspace names one", async () => {
  const git = fakeGit({
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": {
      stdout: "origin/main\n",
    },
    remote: { stdout: "origin\n" },
    "rev-parse --verify --quiet refs/heads/agents": { stdout: "abc123\n" },
    "rev-parse --verify --quiet refs/heads/wireal/9": { code: 1 },
    "rev-parse --verify --quiet refs/remotes/origin/wireal/9": { code: 1 },
  });
  const path = worktreePath("/repo", "9", "/tmp/wireal-config");
  const worktree = await openWorktree(
    "/repo",
    "9",
    "agents",
    git.run,
    "/tmp/wireal-config",
  );
  assert.equal(worktree.base, "agents");
  assert.equal(
    git.calls.at(-1)?.args.join(" "),
    `worktree add ${path} -b wireal/9 agents`,
  );
});

test("reuses a branch that a previous run left behind", async () => {
  const git = fakeGit({
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": { code: 1 },
    "rev-parse --abbrev-ref HEAD": { stdout: "trunk\n" },
    "rev-parse --verify --quiet refs/heads/wireal/12": { stdout: "abc123\n" },
  });
  const path = worktreePath("/repo", "12", "/tmp/wireal-config");
  const worktree = await openWorktree(
    "/repo",
    "12",
    "",
    git.run,
    "/tmp/wireal-config",
  );
  assert.equal(worktree.base, "trunk");
  assert.equal(
    git.calls.at(-1)?.args.join(" "),
    `worktree add ${path} wireal/12`,
  );
});

test("composes worktree paths outside the repository from its path hash", () => {
  const first = worktreePath("/projects/wireal", "42", "/config/wireal");
  assert.ok(first.startsWith(join("/config/wireal", "worktrees", "wireal-")));
  assert.equal(basename(first), "42");
  assert.match(basename(dirname(first)), /^wireal-[0-9a-f]{8}$/);
  assert.equal(
    first,
    worktreePath("/projects/wireal/.", "42", "/config/wireal"),
  );
  assert.notEqual(first, worktreePath("/other/wireal", "42", "/config/wireal"));
});

test("commits what the agent left and pushes it, keeping the worktree", async () => {
  const git = fakeGit({
    "status --porcelain": { stdout: " M runner/ui.ts\n" },
    "rev-parse HEAD": { stdout: "8f1c0de9c0ffee\n" },
    remote: { stdout: "origin\n" },
  });
  const worktree = {
    path: "/repo/.wirealruns/7",
    branch: "wireal/7",
    base: "main",
  };
  const closed = await commitWorktree(
    "/repo",
    worktree,
    "Task 7: Runner CLI",
    git.run,
  );
  assert.deepEqual(closed, { commit: "8f1c0de9c0ffee", pushed: true });
  assert.deepEqual(
    git.calls.map((call) => call.args.join(" ")),
    [
      "add -A",
      "status --porcelain",
      "commit -m Task 7: Runner CLI",
      "rev-parse HEAD",
      "remote",
      "push --set-upstream origin wireal/7",
    ],
  );
  await removeWorktree("/repo", worktree, git.run);
  assert.equal(
    git.calls.at(-1)?.args.join(" "),
    "worktree remove --force /repo/.wirealruns/7",
  );
  assert.equal(git.calls.at(-1)?.cwd, "/repo");
});

test("skips the commit and the push when nothing changed and no remote exists", async () => {
  const git = fakeGit({
    "status --porcelain": { stdout: "" },
    "rev-parse HEAD": { stdout: "deadbeef\n" },
    remote: { stdout: "" },
  });
  const closed = await commitWorktree(
    "/repo",
    { path: "/repo/.wirealruns/9", branch: "wireal/9", base: "main" },
    "Task 9: Nothing",
    git.run,
  );
  assert.deepEqual(closed, { commit: "deadbeef", pushed: false });
  assert.deepEqual(
    git.calls.map((call) => call.args[0]),
    ["add", "status", "rev-parse", "remote"],
  );
});

test("the repository a runner works in comes from origin, however it is written", async () => {
  const https = fakeGit({
    "remote get-url origin": {
      stdout: "https://github.com/wireal/wireal.git\n",
    },
  });
  assert.equal(
    await repositoryUrl("/repo", https.run),
    "https://github.com/wireal/wireal",
  );
  assert.equal(
    await repositoryUrl(
      "/repo",
      fakeGit({
        "remote get-url origin": {
          stdout: "git@github.com:wireal/wireal.git\n",
        },
      }).run,
    ),
    "https://github.com/wireal/wireal",
  );
  assert.equal(
    await repositoryUrl(
      "/repo",
      fakeGit({
        "remote get-url origin": {
          stdout: "https://gitlab.com/wireal/wireal\n",
        },
      }).run,
    ),
    "",
  );
  assert.equal(
    await repositoryUrl(
      "/repo",
      fakeGit({ "remote get-url origin": { code: 1 } }).run,
    ),
    "",
  );
});

test("a task reference that is not a board number never becomes a path or a branch", async () => {
  const { run, calls } = fakeGit({});
  await assert.rejects(
    () => openWorktree("/repo", "../../escape", "", run, "/config"),
    /not a task number/,
  );
  await assert.rejects(
    () => openWorktree("/repo", "main --force", "", run, "/config"),
    /not a task number/,
  );
  assert.deepEqual(calls, []);
});

test("a folder git no longer knows as a worktree is cleared before opening", async () => {
  const config = mkdtempSync(join(tmpdir(), "wireal-stale-"));
  const path = worktreePath("/repo", "8", config);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "left.txt"), "from a runner that was killed");
  const git = fakeGit({
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": {
      stdout: "origin/main\n",
    },
    "rev-parse --verify --quiet refs/heads/wireal/8": { code: 1 },
    "rev-parse --verify --quiet refs/remotes/origin/wireal/8": { code: 1 },
  });
  await openWorktree("/repo", "8", "", git.run, config);
  assert.equal(existsSync(path), false);
  assert.ok(git.calls.some((call) => call.args.join(" ") === "worktree prune"));
  rmSync(config, { recursive: true, force: true });
});
