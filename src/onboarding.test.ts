import assert from "node:assert/strict";
import test from "node:test";
import {
  firstRunPath,
  firstRunStart,
  firstRunStepAvailable,
  nextFirstRunStep,
} from "./first-run";

test("the first-run walkthrough follows the product setup order", () => {
  const full = { hasWorkspace: true, hasProject: true, onBoard: true };
  assert.equal(firstRunStart(full), "workspace");
  assert.equal(nextFirstRunStep("workspace", full), "project");
  assert.equal(nextFirstRunStep("project", full), "task");
  assert.equal(nextFirstRunStep("task", full), "wire");
  assert.equal(nextFirstRunStep("wire", full), "views");
  assert.equal(nextFirstRunStep("views", full), null);
});

test("steps whose control is not on screen are skipped, not anchored to nothing", () => {
  assert.equal(
    nextFirstRunStep("project", {
      hasWorkspace: true,
      hasProject: false,
      onBoard: true,
    }),
    "wire",
  );
  assert.equal(
    nextFirstRunStep("task", {
      hasWorkspace: true,
      hasProject: true,
      onBoard: false,
    }),
    "views",
  );
  assert.deepEqual(
    firstRunPath({ hasWorkspace: true, hasProject: false, onBoard: false }),
    ["workspace", "project", "views"],
  );
  assert.equal(
    firstRunStepAvailable("task", {
      hasWorkspace: true,
      hasProject: false,
      onBoard: true,
    }),
    false,
  );
  assert.equal(
    firstRunStepAvailable("wire", {
      hasWorkspace: true,
      hasProject: true,
      onBoard: true,
    }),
    true,
  );
});

test("an account with no workspace has no step to walk, so the tour waits", () => {
  const none = { hasWorkspace: false, hasProject: false, onBoard: true };
  assert.deepEqual(firstRunPath(none), []);
  assert.equal(firstRunStart(none), null);
  assert.equal(firstRunStepAvailable("workspace", none), false);
  assert.equal(nextFirstRunStep("workspace", none), null);
});
