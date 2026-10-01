import { test } from "node:test";
import assert from "node:assert/strict";
import type { Activity, Task, Workspace } from "./domain";
import { testWorkspace } from "./test-workspace";
import { awayItems, isBlocked } from "./task-report";

const note = (
  id: string,
  at: string,
  text: string,
  extra: Partial<Activity> = {},
): Activity => ({
  id,
  text,
  at,
  author: "Claude",
  authorType: "ai",
  ...extra,
});

test("the digest lists what agents did since the last visit, newest first", () => {
  const state: Workspace = structuredClone(testWorkspace);
  state.tasks[1].status = "done";
  state.tasks[1].activity = [
    note("r1", "2026-09-02T10:00:00Z", "Done: Built it\nNext: none", {
      kind: "report",
    }),
  ];
  state.tasks[2].activity = [
    note("r2", "2026-09-03T10:00:00Z", "Done: Half\nBlocked: needs a key", {
      kind: "report",
    }),
  ];
  state.tasks[3].activity = [
    note("old", "2026-08-01T10:00:00Z", "Done: long ago", { kind: "report" }),
  ];
  state.tasks[4].activity = [
    note("mine", "2026-09-04T10:00:00Z", "my own note", {
      authorType: "user",
    }),
  ];
  const items = awayItems(state, Date.parse("2026-09-01T00:00:00Z"));
  assert.deepEqual(
    items.map((item) => [item.task.id, item.kind]),
    [
      ["fixture-task-3", "blocked"],
      ["fixture-task-2", "done"],
    ],
  );
});

test("a blocker counts until a later report answers it", () => {
  const task = {
    activity: [
      note("b", "2026-09-02T00:00:00Z", "stuck", { kind: "blocker" }),
      note("r", "2026-09-01T00:00:00Z", "Done: x", { kind: "report" }),
    ],
  } as Task;
  assert.equal(isBlocked(task, {}), true);
  assert.equal(isBlocked(task, { blocked: "none" }), true);
  task.activity.reverse();
  task.activity[0].at = "2026-09-03T00:00:00Z";
  assert.equal(isBlocked(task, { blocked: "None." }), false);
});
