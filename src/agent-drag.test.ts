import assert from "node:assert/strict";
import test from "node:test";
import { dropTarget } from "./agent-drag";

test("a drop names a task or a workflow and nothing else", () => {
  assert.deepEqual(dropTarget("task:abc"), { kind: "task", id: "abc" });
  assert.deepEqual(dropTarget("workflow:w:1"), { kind: "workflow", id: "w:1" });
  assert.equal(dropTarget("task:"), null);
  assert.equal(dropTarget("project:x"), null);
});
