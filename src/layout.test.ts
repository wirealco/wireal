import assert from "node:assert/strict";
import test from "node:test";
import type { Workspace } from "./domain";
import { arrangeWorkspace } from "./layout";

// A seeded board with long links and cycles, the shape that used to send
// connected groups drifting apart further on every arrange.
function board(seed: number): {
  state: Workspace;
  heights: Map<string, number>;
} {
  let value = seed * 7919 + 13;
  const random = () => (value = (value * 16807) % 2147483647) / 2147483647;
  random();
  const count = 60;
  const tasks = Array.from({ length: count }, (_, index) => ({
    id: `t${index}`,
    referenceId: String(index + 1),
    name: `Task ${index}`,
    status: "todo",
    projectIds: [],
    labels: [],
    position: { x: random() * 2000, y: random() * 2000 },
    activity: [],
    commitUrls: [],
  }));
  const links = Array.from({ length: 80 }, (_, index) => ({
    id: `l${index}`,
    source: `t${Math.floor(random() * count)}`,
    target: `t${Math.floor(random() * count)}`,
  })).filter((link) => link.source !== link.target);
  const heights = new Map(
    tasks.map((task) => [task.id, 108 + Math.floor(random() * 120)]),
  );
  return {
    state: { tasks, links, projects: [], map: {} } as unknown as Workspace,
    heights,
  };
}

test("arranging again and again never spreads the board without bound", () => {
  for (const seed of [96, 337, 417, 576]) {
    let { state } = board(seed);
    const { heights } = board(seed);
    for (let round = 0; round < 6; round++) {
      state = arrangeWorkspace(state, heights);
      const ys = state.tasks.map((task) => task.position.y);
      const spread = Math.max(...ys) - Math.min(...ys);
      assert.ok(Number.isFinite(spread));
      // Every card on top of every other, gaps and all, is far less than this.
      assert.ok(spread < 60 * 400, `seed ${seed} round ${round}: ${spread}px`);
    }
  }
});

function task(id: string, index: number, over: Record<string, unknown> = {}) {
  return {
    id,
    referenceId: String(index + 1),
    name: id,
    status: "todo",
    projectIds: [],
    labels: [],
    position: { x: index * 10, y: 0 },
    activity: [],
    commitUrls: [],
    ...over,
  };
}

test("dependencies run left to right, each flow in its own band, first flow on top", () => {
  const tasks = [
    task("a", 0),
    task("b", 1),
    task("c", 2),
    task("x", 3),
    task("y", 4),
    task("lone", 5),
    task("w1", 6, { workflowIds: ["wf"] }),
    task("w2", 7, { workflowIds: ["wf"] }),
  ];
  const links = [
    { id: "1", source: "a", target: "b" },
    { id: "2", source: "b", target: "c" },
    { id: "3", source: "x", target: "y" },
  ];
  const arranged = arrangeWorkspace({
    tasks,
    links,
    projects: [],
    map: {},
  } as unknown as Workspace);
  const at = new Map(arranged.tasks.map((item) => [item.id, item.position]));
  // a → b → c across, on one line.
  assert.ok(at.get("a")!.x < at.get("b")!.x && at.get("b")!.x < at.get("c")!.x);
  assert.equal(at.get("a")!.y, at.get("c")!.y);
  // The second flow sits below the whole first one, the workflow below that,
  // and a task joined to nothing comes last.
  assert.ok(at.get("x")!.y > at.get("a")!.y);
  assert.equal(at.get("x")!.x, at.get("a")!.x);
  assert.ok(at.get("w1")!.y > at.get("x")!.y);
  assert.equal(at.get("w1")!.x, at.get("w2")!.x);
  assert.ok(at.get("w2")!.y > at.get("w1")!.y);
  assert.ok(at.get("lone")!.y > at.get("w1")!.y);
});
