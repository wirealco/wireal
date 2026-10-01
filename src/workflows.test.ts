import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorkspace, removeTask, type Workspace } from "./domain";
import { testWorkspace } from "./test-workspace";
import {
  connectedTasks,
  createWorkflow,
  deleteWorkflow,
  freeWorkflowName,
  nextWorkflowColor,
  saveWorkflow,
  setWorkflowMembers,
  taskWorkflows,
  workflowGlow,
  workflowPalette,
  workflowProgress,
} from "./workflows";

const board = (): Workspace => structuredClone(testWorkspace);

test("a workflow is made from the chosen tasks and nothing else", () => {
  const { state, workflow } = createWorkflow(board(), {
    name: "  Checkout  ",
    taskIds: ["fixture-task-1", "fixture-task-2"],
  });
  assert.equal(workflow.name, "Checkout");
  assert.equal(workflow.color, workflowPalette[0]);
  assert.deepEqual(state.workflows, [workflow]);
  assert.deepEqual(
    state.tasks
      .filter((task) => task.workflowIds?.includes(workflow.id))
      .map((task) => task.id),
    ["fixture-task-1", "fixture-task-2"],
  );
  assert.equal(state.tasks[2].workflowIds, undefined);
});

test("workflow names are required and unique", () => {
  const first = createWorkflow(board(), { name: "Search", taskIds: [] }).state;
  assert.throws(() => createWorkflow(first, { name: " ", taskIds: [] }));
  assert.throws(() => createWorkflow(first, { name: "search", taskIds: [] }));
});

test("each new workflow takes the next unused colour", () => {
  const first = createWorkflow(board(), { name: "A", taskIds: [] }).state;
  assert.equal(nextWorkflowColor(first), workflowPalette[1]);
});

test("a task can belong to several workflows and leave one", () => {
  const one = createWorkflow(board(), {
    name: "A",
    taskIds: ["fixture-task-3"],
  });
  const two = createWorkflow(one.state, {
    name: "B",
    taskIds: ["fixture-task-3"],
  });
  const task = two.state.tasks.find((item) => item.id === "fixture-task-3")!;
  assert.deepEqual(
    taskWorkflows(two.state, task).map((workflow) => workflow.name),
    ["A", "B"],
  );
  const left = setWorkflowMembers(
    two.state,
    one.workflow.id,
    ["fixture-task-3"],
    false,
  );
  assert.deepEqual(
    left.tasks.find((item) => item.id === "fixture-task-3")!.workflowIds,
    [two.workflow.id],
  );
});

test("deleting a workflow clears it from its tasks", () => {
  const { state, workflow } = createWorkflow(board(), {
    name: "A",
    taskIds: ["fixture-task-1"],
  });
  const gone = deleteWorkflow(state, workflow.id);
  assert.equal(gone.workflows, undefined);
  assert.equal(gone.tasks[0].workflowIds, undefined);
});

test("a workflow is renamed and recoloured", () => {
  const { state, workflow } = createWorkflow(board(), {
    name: "A",
    taskIds: [],
  });
  const saved = saveWorkflow(state, workflow.id, {
    name: "Payments",
    color: "#123456",
  });
  assert.deepEqual(saved.workflows![0], {
    id: workflow.id,
    name: "Payments",
    color: "#123456",
  });
  assert.throws(() => saveWorkflow(saved, workflow.id, { color: "red" }));
});

test("progress counts the done tasks in a workflow", () => {
  const { state, workflow } = createWorkflow(board(), {
    name: "A",
    taskIds: ["fixture-task-1", "fixture-task-2", "fixture-task-4"],
  });
  assert.deepEqual(workflowProgress(state, workflow.id), {
    done: 1,
    total: 3,
  });
});

test("connected tasks follow dependencies and subtasks both ways", () => {
  const split = board();
  split.links = split.links.filter((link) => link.id !== "flow-6");
  assert.deepEqual(connectedTasks(split, "fixture-task-4"), [
    "fixture-task-1",
    "fixture-task-2",
    "fixture-task-3",
    "fixture-task-4",
    "fixture-task-5",
    "fixture-task-6",
  ]);
  assert.deepEqual(connectedTasks(split, "fixture-task-8"), [
    "fixture-task-7",
    "fixture-task-8",
  ]);
  assert.deepEqual(connectedTasks(split, "missing"), []);
});

test("workflows survive a round trip and stale ids are dropped", () => {
  const { state, workflow } = createWorkflow(board(), {
    name: "A",
    taskIds: ["fixture-task-1"],
  });
  const raw = structuredClone(state) as Workspace;
  raw.tasks[1].workflowIds = ["gone", workflow.id, workflow.id];
  raw.workflows!.push({ id: "", name: "broken", color: "#000000" });
  const parsed = parseWorkspace(JSON.stringify(raw));
  assert.deepEqual(parsed.workflows, [workflow]);
  assert.deepEqual(parsed.tasks[0].workflowIds, [workflow.id]);
  assert.deepEqual(parsed.tasks[1].workflowIds, [workflow.id]);
  assert.equal("workflows" in parseWorkspace(JSON.stringify(board())), false);
});

test("removing a task takes it out of its workflows", () => {
  const { state, workflow } = createWorkflow(board(), {
    name: "A",
    taskIds: ["fixture-task-6"],
  });
  const next = removeTask(state, "fixture-task-6");
  assert.deepEqual(workflowProgress(next, workflow.id), { done: 0, total: 0 });
});

test("the glow stacks one ring per workflow", () => {
  assert.equal(workflowGlow([]), undefined);
  const glow = workflowGlow(["#111111", "#222222"])!;
  assert.match(glow, /^0 0 0 2px #111111, 0 0 0 5px #222222, 0 0 22px/);
});

test("a taken name gets the first free number", () => {
  const first = createWorkflow(board(), { name: "Login", taskIds: [] }).state;
  assert.equal(freeWorkflowName(board(), "Login"), "Login");
  assert.equal(freeWorkflowName(first, "login"), "login 2");
  assert.equal(freeWorkflowName(first, "  "), "Workflow");
});
