import assert from "node:assert/strict";
import test from "node:test";
import type { RunnerRow } from "./api.ts";
import {
  bootedAt,
  clockTime,
  holdPath,
  holdRunner,
  holderOf,
  liveElsewhere,
  running,
  samePath,
  takenMessage,
  type HoldParts,
} from "./single.ts";

const runner = { id: "runner-one", name: "MacOS", repo: "/repo" };

function folder(pid = 400, host = "studio") {
  const files: Record<string, string> = {};
  const parts: HoldParts = {
    directory: "/state",
    host,
    pid,
    now: () => new Date("2026-09-17T14:13:57.000Z"),
    read: (path) => {
      const body = files[path];
      if (body === undefined) throw new Error(`no ${path}`);
      return body;
    },
    write: (path, body) => {
      files[path] = body;
    },
    remove: (path) => {
      delete files[path];
    },
    list: () =>
      Object.keys(files).map((path) => path.split(/[\\/]/).at(-1) ?? ""),
    alive: () => true,
    booted: () => Date.parse("2026-09-17T09:00:00.000Z"),
  };
  return { files, parts };
}

test("a held folder is taken back when the process holding it is gone", () => {
  const { files, parts } = folder();
  const release = holdRunner(runner, parts);
  const path = holdPath(runner.id, "/state");
  assert.deepEqual(JSON.parse(files[path]), {
    runnerId: "runner-one",
    pid: 400,
    host: "studio",
    name: "MacOS",
    repo: "/repo",
    startedAt: "2026-09-17T14:13:57.000Z",
  });

  const second = { ...parts, pid: 401 };
  const shown = clockTime("2026-09-17T14:13:57.000Z");
  assert.throws(
    () => holdRunner(runner, second),
    new RegExp(
      `MacOS is already running here as pid 400 since ${shown} on /repo`,
    ),
  );
  assert.equal(holderOf(runner, { ...second, alive: () => false }), undefined);

  release();
  assert.equal(files[path], undefined);
  assert.doesNotThrow(() => holdRunner(runner, second));
});

test("another folder's runner is no reason to refuse, the same folder is", () => {
  const { parts } = folder();
  holdRunner(runner, parts);
  const other = { ...parts, pid: 401 };
  assert.equal(
    holderOf({ id: "runner-two", repo: "/elsewhere" }, other),
    undefined,
  );
  assert.equal(holderOf({ id: "runner-two", repo: "/repo" }, other)?.pid, 400);
  assert.equal(
    holderOf({ id: "runner-one", repo: "/elsewhere" }, other)?.pid,
    400,
  );
});

test("a hold from another machine is left to that machine", () => {
  const { parts } = folder();
  holdRunner(runner, parts);
  assert.equal(
    holderOf(runner, { ...parts, pid: 401, host: "laptop" }),
    undefined,
  );
});

test("force takes the hold, and releasing it only drops one's own", () => {
  const { files, parts } = folder();
  holdRunner(runner, parts);
  const path = holdPath(runner.id, "/state");
  const taken = holdRunner(runner, { ...parts, pid: 401, force: true });
  assert.equal(JSON.parse(files[path]).pid, 401);
  const stale = holdRunner(runner, { ...parts, pid: 402, force: true });
  taken();
  assert.equal(JSON.parse(files[path]).pid, 402);
  stale();
  assert.equal(files[path], undefined);
});

test("a hold written before this machine booted is no hold at all", () => {
  const { parts } = folder();
  holdRunner(runner, parts);
  const after = { ...parts, pid: 401 };
  assert.equal(holderOf(runner, after)?.pid, 400);
  assert.equal(
    holderOf(runner, {
      ...after,
      booted: () => Date.parse("2026-09-17T14:20:00.000Z"),
    }),
    undefined,
  );
  const now = Date.parse("2026-09-17T14:00:00.000Z");
  assert.equal(bootedAt(3600, now), Date.parse("2026-09-17T13:00:00.000Z"));
});

test("Windows folders match whatever their case and slashes", () => {
  assert.equal(samePath("C:\\Repo\\wireal", "c:/repo/wireal", "win32"), true);
  assert.equal(samePath("C:\\Repo\\wireal\\", "c:/repo/wireal", "win32"), true);
  assert.equal(samePath("/repo/Wireal", "/repo/wireal", "darwin"), false);
  assert.equal(samePath("/repo/wireal/", "/repo/wireal", "darwin"), true);
  const { parts } = folder();
  holdRunner({ ...runner, repo: "C:\\Repo\\wireal" }, parts);
  assert.equal(
    holderOf(
      { id: "runner-two", repo: "c:/repo/wireal" },
      { ...parts, pid: 401, platform: "win32" },
    )?.pid,
    400,
  );
  assert.equal(
    holderOf(
      { id: "runner-two", repo: "c:/repo/wireal" },
      { ...parts, pid: 401, platform: "linux" },
    ),
    undefined,
  );
});

test("a runner reporting in from another machine is named, a stale one is not", () => {
  const row = (over: Partial<RunnerRow> = {}): RunnerRow => ({
    runner_id: "runner-one",
    name: "MacOS",
    host: "laptop",
    last_seen: new Date("2026-09-17T14:13:50.000Z").toISOString(),
    ...over,
  });
  const now = Date.parse("2026-09-17T14:13:58.000Z");
  const found = liveElsewhere([row()], "runner-one", "studio", now);
  assert.equal(found?.seconds, 8);
  assert.match(
    takenMessage({
      runnerId: "runner-one",
      pid: 7,
      host: "studio",
      name: "MacOS",
      repo: "/repo",
      startedAt: "",
    }),
    /pid 7 on \/repo/,
  );
  assert.equal(
    liveElsewhere([row({ host: "studio" })], "runner-one", "studio", now),
    undefined,
  );
  assert.equal(
    liveElsewhere([row()], "runner-one", "studio", now + 120_000),
    undefined,
  );
  assert.equal(liveElsewhere([row()], "runner-two", "studio", now), undefined);
  assert.equal(
    liveElsewhere([row({ last_seen: "" })], "runner-one", "studio", now),
    undefined,
  );
});

test("this very process counts as running, and nonsense pids do not", () => {
  assert.equal(running(process.pid), true);
  assert.equal(running(0), false);
  assert.equal(running(-1), false);
});
