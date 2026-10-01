import assert from "node:assert/strict";
import test from "node:test";
import { testWorkspace as seed } from "../src/test-workspace.ts";
import { taskDetail, taskRow } from "./views.ts";

test("a task row names blockers by number and leaves repository detail to projects", () => {
  const state = structuredClone(seed);
  state.projects[0].paths = ["apps/web"];
  state.projects[0].repositoryUrl = "https://github.com/example/wireal";
  const task = state.tasks.find(
    (candidate) => candidate.id === "fixture-task-3",
  )!;
  task.objective = "word ".repeat(60);

  const row = taskRow(state, task, "Grace · Claude Code");
  assert.deepEqual(row.blockedBy, ["2", "7"]);
  assert.deepEqual(row.projects, ["Launchpad"]);
  assert.equal(row.busy, "Grace · Claude Code");
  assert.ok(row.objective!.length <= 101);
  assert.doesNotMatch(JSON.stringify(row), /github|apps\/web|launchOrder/);

  const free = taskRow(
    state,
    state.tasks.find((candidate) => candidate.id === "fixture-task-7")!,
  );
  assert.equal("blockedBy" in free, false);
  assert.equal("busy" in free, false);
  assert.equal("objective" in free, false);
});

test("task detail carries the latest report and activity only when asked", () => {
  const state = structuredClone(seed);
  const task = state.tasks[2];
  task.activity = [
    {
      id: "runner",
      text: "Merged into main at 1234567",
      at: "2026-09-13T07:00:00.000Z",
      author: "Wireal runner",
      authorType: "ai",
    },
    {
      id: "report",
      text: "Done: Built it\nNext: Wire the API",
      at: "2026-09-13T06:00:12.000Z",
      author: "Claude · a1",
      authorType: "ai",
      kind: "report",
      commit: "68af5a14311fbd9d411d7b0e7df3c989ce6f7b96",
    },
  ];

  const plain = taskDetail(state, task);
  assert.equal(plain.latest, "Done: Built it\nNext: Wire the API");
  assert.equal("activity" in plain, false);
  assert.deepEqual(plain.dependsOn, ["2", "7"]);
  assert.deepEqual(plain.unblocks, ["5"]);

  const withLog = taskDetail(state, task, { activity: 5 });
  assert.deepEqual(withLog.activity, [
    "report · Claude · a1 · 2026-09-13T06:00Z · 68af5a1: Done: Built it\nNext: Wire the API",
  ]);
});
