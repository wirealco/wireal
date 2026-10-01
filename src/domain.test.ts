import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canConnect,
  connectionKind,
  setConnectionKind,
  event,
  launchOrder,
  parseWorkspace,
  removeTask,
  reorderProjects,
  updateTask,
  projectScope,
  projectRepository,
  removeProject,
  normalizeCommitUrl,
  normalizeProjectPath,
  normalizeRepositoryUrl,
  projectPaths,
  repositoryLayout,
  taskReferenceId,
  agentBranchOf,
  agentSettings,
  mergePolicyOf,
  type MergePolicy,
  openReview,
  sendBack,
  type Task,
  type Workspace,
  latestReport,
  formatReport,
  parseReport,
  type Activity,
} from "./domain";
import { defaultStatusOrbs } from "./orb-settings";
import { arrangeWorkspace, cardWidth, nominalCardHeight } from "./layout";
import { testWorkspace as seed } from "./test-workspace";
import { emptyWorkspace, removeLegacyDemoContent } from "./workspace-default";

test("new cloud accounts start with an empty valid workspace", () => {
  const workspace = emptyWorkspace();
  assert.deepEqual(workspace.projects, []);
  assert.deepEqual(workspace.tasks, []);
  assert.deepEqual(workspace.labels, []);
  assert.deepEqual(workspace.map.orb.colors, ["#000000", "#ffffff", "#ffffff"]);
  assert.deepEqual(parseWorkspace(JSON.stringify(workspace)), workspace);
});

test("the internal graph fixture does not add labels automatically", () => {
  assert.deepEqual(seed.labels, []);
  assert.equal(
    seed.tasks.every((task) => task.labels.length === 0),
    true,
  );
});

test("legacy demo cards are removed without deleting user-created tasks", () => {
  const workspace = emptyWorkspace();
  workspace.projects.push(structuredClone(seed.projects[0]));
  workspace.tasks.push(
    {
      ...seed.tasks[0],
      id: "task-1",
    },
    {
      ...seed.tasks[0],
      id: "user-task",
      referenceId: taskReferenceId(),
      name: "Keep me",
      parentId: "task-1",
    },
  );
  const cleaned = removeLegacyDemoContent(workspace);
  assert.deepEqual(
    cleaned.tasks.map((task) => task.id),
    ["user-task"],
  );
  assert.equal(cleaned.tasks[0].parentId, null);
  assert.deepEqual(
    cleaned.projects.map((project) => project.id),
    ["launchpad"],
  );
  assert.deepEqual(cleaned.links, []);
});

test("connections allow cross-project links while rejecting loops and duplicates", () => {
  assert.equal(canConnect(seed, "fixture-task-6", "fixture-task-1"), false);
  assert.equal(canConnect(seed, "fixture-task-1", "fixture-task-2"), false);
  assert.equal(canConnect(seed, "fixture-task-1", "fixture-task-7"), true);
  assert.equal(canConnect(seed, "fixture-task-4", "fixture-task-3"), false);
  assert.equal(canConnect(seed, "fixture-task-4", "fixture-task-5"), true);
});

test("project views retain dependencies and shared tasks without duplicates", () => {
  const own = projectScope(seed, "core-api", false);
  assert.deepEqual(
    own.map((t) => t.id),
    ["fixture-task-7"],
  );
  assert.equal(projectScope(seed, "sidequest", false).length, 2);
  assert.equal(projectScope(seed, "core-api", true).length, 8);
  assert.equal(new Set(projectScope(seed, "all").map((t) => t.id)).size, 8);
  assert.deepEqual(
    projectScope(seed, "core-api")[0].position,
    seed.tasks[0].position,
  );
});
test("removing a project preserves shared tasks and valid connections", () => {
  const next = removeProject(seed, "core-api");
  assert.deepEqual(
    next.tasks.find((t) => t.id === "fixture-task-7")?.projectIds,
    ["sidequest"],
  );
  assert.equal(next.links.length, seed.links.length);
  assert.doesNotThrow(() => parseWorkspace(JSON.stringify(next)));
});
test("repository and exact commit links reject unsafe or ambiguous URLs", () => {
  const url = "https://github.com/acme/api/commit/" + "a".repeat(40);
  assert.equal(normalizeCommitUrl(url), url);
  assert.equal(
    normalizeRepositoryUrl("https://github.com/acme/api.git"),
    "https://github.com/acme/api",
  );
  for (const invalid of [
    "https://github.com/acme/api/commit/main",
    "https://github.com/acme/api/commit/abcd123",
    "javascript:alert(1)",
    "https://github.com.evil.test/acme/api/commit/" + "a".repeat(40),
  ])
    assert.throws(() => normalizeCommitUrl(invalid));
  assert.throws(() =>
    normalizeRepositoryUrl("https://github.com/acme/api/issues"),
  );
});

test("project paths normalize and deduplicate in declaration order", () => {
  assert.equal(normalizeProjectPath(" ./packages//web/ "), "packages/web");
  assert.equal(normalizeProjectPath("/src/"), "src");
  assert.equal(normalizeProjectPath("/./src//nested/"), "src/nested");
  assert.equal(normalizeProjectPath("///"), "");
  assert.deepEqual(
    projectPaths({
      paths: [" ./src/", "src", "packages//web/", " / "],
    }),
    ["src", "packages/web"],
  );
});

test("backup parser validates project paths", () => {
  const valid = structuredClone(seed);
  valid.projects[0].paths = [" ./src/ ", "packages//web"];
  assert.deepEqual(
    parseWorkspace(JSON.stringify(valid)).projects[0].paths,
    valid.projects[0].paths,
  );

  const invalidPaths: unknown[] = [
    "not-an-array",
    Array.from({ length: 51 }, (_, index) => `folder-${index}`),
    ["   "],
    ["a".repeat(201)],
    ["src/../secret"],
    [12],
  ];
  for (const paths of invalidPaths) {
    const invalid = structuredClone(seed);
    (invalid.projects[0] as unknown as { paths: unknown }).paths = paths;
    assert.throws(
      () => parseWorkspace(JSON.stringify(invalid)),
      /Invalid project data\./,
    );
  }
});

test("workspace repository overrides project repositories for a monorepo", () => {
  const state = structuredClone(seed);
  state.projects[0].repositoryUrl = "https://github.com/acme/project";
  assert.equal(
    projectRepository(state, state.projects[0]),
    "https://github.com/acme/project",
  );
  state.map.repositoryUrl = "https://github.com/acme/mono";
  assert.equal(
    projectRepository(state, state.projects[0]),
    "https://github.com/acme/mono",
  );
});
test("v1 backups migrate without losing task activity or positions", () => {
  const legacy = {
    ...seed,
    version: 1,
    projects: seed.projects.map(({ repositoryUrl, ...p }) => p),
    tasks: seed.tasks.map(({ projectIds, commitUrls, ...t }) => ({
      ...t,
      projectId: projectIds[0],
    })),
  };
  const result = parseWorkspace(JSON.stringify(legacy));
  assert.equal(result.version, 9);
  assert.deepEqual(result.tasks[0].activity, seed.tasks[0].activity);
  assert.deepEqual(result.tasks[0].position, seed.tasks[0].position);
  assert.deepEqual(result.tasks[0].projectIds, ["launchpad"]);
  // Every task carries a plain number, and the set is exactly 1..n with no
  // gaps and no repeats — the property that makes them usable as names.
  assert.deepEqual(
    result.tasks
      .map((t) => t.referenceId)
      .sort((a, b) => Number(a) - Number(b)),
    result.tasks.map((_, index) => String(index + 1)),
  );
});
test("v5 workspaces gain objectives and structured AI authors", () => {
  const legacy = structuredClone(seed) as unknown as {
    version: number;
    tasks: Array<Record<string, unknown>>;
  };
  legacy.version = 5;
  legacy.tasks = legacy.tasks.map(
    ({ objective: _objective, ...task }, index) => ({
      ...task,
      activity: index
        ? []
        : [
            {
              id: "legacy-activity",
              text: "AI update",
              at: new Date().toISOString(),
              author: "Codex",
            },
          ],
    }),
  );
  const result = parseWorkspace(JSON.stringify(legacy));
  assert.equal(result.version, 9);
  assert.equal(result.tasks[0].objective, "");
  assert.deepEqual(result.tasks[0].activity[0].authorType, "ai");
});
test("activity records distinguish users and AI agents", () => {
  assert.equal(
    event("Human update", {
      author: "Ada",
      authorType: "user",
      authorId: "user-1",
    }).authorType,
    "user",
  );
  assert.equal(
    event("Agent update", { author: "Codex", authorType: "ai" }).author,
    "Codex",
  );
});
test("a report keeps its kind and commit while legacy paths and malformed fields are dropped", () => {
  const workspace = structuredClone(seed);
  workspace.tasks[0].activity = [
    {
      id: "report",
      text: "Rationed the verification emails",
      at: "2026-09-13T06:00:00.000Z",
      author: "Claude",
      authorType: "ai",
      kind: "change",
      paths: ["  src/App.tsx  ", "src/App.tsx", "docs/deployment.md"],
      commit: "8bc0d8d",
    } as never,
    {
      id: "junk",
      text: "Reported nothing usable",
      at: "2026-09-13T06:00:00.000Z",
      author: "Claude",
      authorType: "ai",
      kind: "invented" as never,
      paths: ["   ", "a".repeat(201)],
      commit: "not-a-sha",
      reportId: "gone",
    } as never,
  ];
  const [report, junk] = parseWorkspace(JSON.stringify(workspace)).tasks[0]
    .activity;
  assert.equal(report.kind, "change");
  assert.equal("paths" in report, false);
  assert.equal(report.commit, "8bc0d8d");
  assert.equal(junk.kind, undefined);
  assert.equal("paths" in junk, false);
  assert.equal(junk.commit, undefined);
  assert.equal("reportId" in junk, false);
});
test("launch order follows arrows before left-to-right position", () => {
  const order = launchOrder(seed);
  assert.equal(order.get("fixture-task-1"), 1);
  assert.ok(order.get("fixture-task-6")! > order.get("fixture-task-5")!);
  assert.ok(order.get("fixture-task-3")! > order.get("fixture-task-2")!);
  assert.ok(order.get("fixture-task-4")! > order.get("fixture-task-3")!);
});
test("automatic layout produces a single graph with distinct task positions", () => {
  const arranged = arrangeWorkspace(seed);
  assert.equal(
    new Set(arranged.tasks.map((t) => JSON.stringify(t.position))).size,
    seed.tasks.length,
  );
  assert.deepEqual(arranged.links, seed.links);
  assert.equal(
    arranged.tasks.find((t) => t.id === "fixture-task-7")!.position.x <
      arranged.tasks.find((t) => t.id === "fixture-task-8")!.position.x,
    true,
  );
});
test("automatic layout keeps the launch order the user built", () => {
  const arranged = arrangeWorkspace(seed);
  assert.deepEqual([...launchOrder(arranged)], [...launchOrder(seed)]);
});
test("automatic layout keeps wires out of the cards they pass", () => {
  const tasks = ["a", "b", "c", "d", "e"].map((id, index) => ({
    ...seed.tasks[0],
    id,
    referenceId: String(index + 1),
    parentId: null,
    position: { x: index * 10, y: 0 },
  }));
  const wire = (source: string, target: string) => ({
    id: `${source}-${target}`,
    source,
    target,
  });
  const arranged = arrangeWorkspace({
    ...seed,
    tasks,
    links: [wire("b", "c"), wire("c", "d"), wire("b", "e")],
  });
  const at = (id: string) => arranged.tasks.find((task) => task.id === id)!;
  assert.equal(at("a").position.x, at("b").position.x);
  assert.equal(at("c").position.x, at("e").position.x);
  assert.ok(at("b").position.x < at("c").position.x);
  assert.ok(at("c").position.x < at("d").position.x);
  const half = nominalCardHeight / 2;
  for (const link of arranged.links) {
    const from = at(link.source).position;
    const to = at(link.target).position;
    const step = (from.x + cardWidth + to.x) / 2;
    for (const task of arranged.tasks) {
      if (task.id === link.source || task.id === link.target) continue;
      const { x, y } = task.position;
      const inside = (px: number, py: number) =>
        px > x && px < x + cardWidth && py > y && py < y + nominalCardHeight;
      for (let px = from.x + cardWidth; px <= to.x; px += 4)
        assert.ok(
          !inside(px, (px < step ? from.y : to.y) + half),
          `${link.id} crosses ${task.id}`,
        );
      for (
        let py = Math.min(from.y, to.y) + half;
        py <= Math.max(from.y, to.y) + half;
        py += 4
      )
        assert.ok(!inside(step, py), `${link.id} crosses ${task.id}`);
    }
  }
});
test("automatic layout leaves a taller card room below it", () => {
  const arranged = arrangeWorkspace(seed, new Map([["fixture-task-1", 400]]));
  const first = arranged.tasks.find((t) => t.id === "fixture-task-1")!;
  const seventh = arranged.tasks.find((t) => t.id === "fixture-task-7")!;
  assert.equal(first.position.x, seventh.position.x);
  assert.ok(seventh.position.y >= first.position.y + 400);
});
test("automatic layout stands a task right of what it waits on", () => {
  const scattered: Workspace = {
    ...seed,
    tasks: seed.tasks.map((task) => ({
      ...task,
      position: { x: 1000 - Number(task.referenceId) * 37, y: 400 },
    })),
  };
  const arranged = arrangeWorkspace(scattered);
  const at = (id: string) => arranged.tasks.find((task) => task.id === id)!;
  for (const link of arranged.links)
    assert.ok(
      at(link.source).position.x < at(link.target).position.x,
      `${link.source} does not run into ${link.target}`,
    );
  for (const task of arranged.tasks)
    if (task.parentId)
      assert.ok(at(task.parentId).position.x < task.position.x);
  const order = launchOrder(arranged);
  const columns = new Map<number, Task[]>();
  for (const task of arranged.tasks)
    columns.set(task.position.x, [
      ...(columns.get(task.position.x) ?? []),
      task,
    ]);
  for (const column of columns.values()) {
    const down = [...column].sort((a, b) => a.position.y - b.position.y);
    for (const [index, task] of down.entries())
      if (index)
        assert.ok(order.get(task.id)! > order.get(down[index - 1].id)!);
  }
});
test("automatic layout starts an unblocked task at the left edge", () => {
  const tasks = ["chain-a", "chain-b", "chain-c", "loose"].map((id, index) => ({
    ...seed.tasks[0],
    id,
    referenceId: String(index + 1),
    parentId: null,
    position: { x: index * 10, y: 0 },
  }));
  const arranged = arrangeWorkspace({
    ...seed,
    tasks,
    links: [
      { id: "ab", source: "chain-a", target: "chain-b" },
      { id: "bc", source: "chain-b", target: "chain-c" },
    ],
  });
  const at = (id: string) => arranged.tasks.find((task) => task.id === id)!;
  assert.equal(at("loose").position.x, at("chain-a").position.x);
  assert.ok(at("chain-c").position.x > at("loose").position.x);
  assert.ok(
    at("loose").position.y - at("chain-a").position.y > nominalCardHeight,
  );
});
test("automatic layout keeps one flow's cards together in a column", () => {
  const names = ["head-a", "head-b", "head-c", "tail-a", "tail-b", "tail-c"];
  const tasks = names.map((id, index) => ({
    ...seed.tasks[0],
    id,
    referenceId: String(index + 1),
    parentId: null,
    position: { x: index < 3 ? 0 : 300, y: (index % 3) * 200 },
  }));
  const arranged = arrangeWorkspace({
    ...seed,
    tasks,
    links: names.slice(0, 3).map((id, index) => ({
      id: `w${index}`,
      source: id,
      target: `tail-${"abc"[index]}`,
    })),
  });
  const at = (id: string) => arranged.tasks.find((task) => task.id === id)!;
  for (const letter of "abc")
    assert.equal(
      at(`head-${letter}`).position.y,
      at(`tail-${letter}`).position.y,
      `head-${letter} does not sit level with tail-${letter}`,
    );
});
test("automatic layout brings a subtask alongside the parent it hangs from", () => {
  const tasks = ["first", "second", "parent", "child"].map((id, index) => ({
    ...seed.tasks[0],
    id,
    referenceId: String(index + 1),
    parentId: id === "child" ? "parent" : null,
    position: { x: id === "child" ? 300 : 0, y: index * 200 },
  }));
  const arranged = arrangeWorkspace({ ...seed, tasks, links: [] });
  const at = (id: string) => arranged.tasks.find((task) => task.id === id)!;
  assert.ok(at("parent").position.x < at("child").position.x);
  assert.equal(at("parent").position.y, at("child").position.y);
});
test("automatic layout leaves room under a card it was never given a height for", () => {
  const tasks = ["tall", "unknown", "short"].map((id, index) => ({
    ...seed.tasks[0],
    id,
    referenceId: String(index + 1),
    parentId: null,
    position: { x: 0, y: index * 200 },
  }));
  const arranged = arrangeWorkspace(
    { ...seed, tasks, links: [] },
    new Map([
      ["tall", 320],
      ["short", 96],
    ]),
  );
  const at = (id: string) => arranged.tasks.find((task) => task.id === id)!;
  assert.ok(at("unknown").position.y >= at("tall").position.y + 320);
  assert.ok(at("short").position.y >= at("unknown").position.y + 320);
});
test("automatic layout only moves the tasks it was given", () => {
  const scattered: Workspace = {
    ...seed,
    tasks: seed.tasks.map((task) => ({
      ...task,
      position: { x: 1000 - Number(task.referenceId) * 37, y: 400 },
    })),
  };
  const scope = new Set(["fixture-task-7", "fixture-task-8"]);
  const arranged = arrangeWorkspace(scattered, undefined, scope);
  const at = (id: string) => arranged.tasks.find((task) => task.id === id)!;
  for (const task of scattered.tasks)
    if (!scope.has(task.id))
      assert.deepEqual(at(task.id).position, task.position);
  assert.ok(at("fixture-task-7").position.x < at("fixture-task-8").position.x);
  const held = [...scope].map((id) =>
    scattered.tasks.find((t) => t.id === id)!,
  );
  assert.equal(
    Math.min(...[...scope].map((id) => at(id).position.x)),
    Math.min(...held.map((task) => task.position.x)),
  );
  assert.equal(
    Math.min(...[...scope].map((id) => at(id).position.y)),
    Math.min(...held.map((task) => task.position.y)),
  );
});

test("deleting a parent removes descendants and dangling links", () => {
  const next = removeTask(seed, "fixture-task-3");
  assert.equal(
    next.tasks.some((t) => ["fixture-task-3", "fixture-task-4"].includes(t.id)),
    false,
  );
  assert.equal(
    next.links.some(
      (e) => e.source === "fixture-task-3" || e.target === "fixture-task-3",
    ),
    false,
  );
  assert.equal(seed.tasks.length, 8);
});
test("task changes remember who made them", () => {
  const next = updateTask(
    seed,
    "fixture-task-1",
    { status: "doing" },
    "Status changed to Doing",
    { author: "Ines R.", authorType: "user", authorId: "u-ines" },
  );
  assert.equal(next.tasks[0].status, "doing");
  assert.equal(
    next.tasks[0].activity.length,
    seed.tasks[0].activity.length + 1,
  );
  assert.equal(next.tasks[0].activity[0].text, "Status changed to Doing");
  assert.equal(next.tasks[0].activity[0].author, "Ines R.");
  assert.equal(next.tasks[0].activity[0].authorId, "u-ines");
  assert.equal(seed.tasks[0].status, "done");
  // Without a message the edit is silent, which is what the MCP helpers rely
  // on: they write their own attributed audit.
  const quiet = updateTask(seed, "fixture-task-1", { status: "doing" });
  assert.deepEqual(quiet.tasks[0].activity, seed.tasks[0].activity);
  assert.throws(() =>
    updateTask(seed, "fixture-task-1", { name: " " }, "Renamed"),
  );
});
test("backup parser roundtrips valid data and rejects cyclic or malformed data", () => {
  assert.deepEqual(parseWorkspace(JSON.stringify(seed)), seed);
  const bad = structuredClone(seed);
  bad.links.push({
    id: "cycle",
    source: "fixture-task-6",
    target: "fixture-task-1",
  });
  assert.throws(() => parseWorkspace(JSON.stringify(bad)));
  assert.throws(() => parseWorkspace('{"version":1}'));
  const parent = structuredClone(seed);
  parent.tasks[2].parentId = "fixture-task-4";
  assert.throws(() => parseWorkspace(JSON.stringify(parent)));
  const position = structuredClone(seed);
  position.tasks[0].position.x = NaN;
  assert.throws(() => parseWorkspace(JSON.stringify(position)));
});
test("v8 workspaces gain a proposed status orb", () => {
  const legacy = structuredClone(seed) as unknown as {
    version: number;
    statusOrbs: Record<string, unknown>;
  };
  legacy.version = 8;
  delete legacy.statusOrbs.proposed;
  const result = parseWorkspace(JSON.stringify(legacy));
  assert.equal(result.version, 9);
  assert.deepEqual(result.statusOrbs.proposed, defaultStatusOrbs.proposed);
  assert.deepEqual(result.statusOrbs.todo, seed.statusOrbs.todo);
});
test("a proposed task parses and keeps who proposed it", () => {
  const workspace = structuredClone(seed);
  workspace.tasks[0].status = "proposed";
  workspace.tasks[0].proposedBy = "Codex";
  assert.deepEqual(parseWorkspace(JSON.stringify(workspace)), workspace);
});
test("activity usage survives a parse round trip", () => {
  const workspace = structuredClone(seed);
  workspace.tasks[0].activity = [
    {
      id: "usage-activity",
      text: "Ran the suite",
      at: new Date().toISOString(),
      author: "Codex",
      authorType: "ai",
      usage: {
        costUsd: 0.42,
        inputTokens: 1200,
        outputTokens: 340,
        model: "claude-opus-5",
        durationMs: 9000,
      },
    },
  ];
  const result = parseWorkspace(JSON.stringify(workspace));
  assert.deepEqual(result.tasks[0].activity[0].usage, {
    costUsd: 0.42,
    inputTokens: 1200,
    outputTokens: 340,
    durationMs: 9000,
    model: "claude-opus-5",
  });
});
test("agent settings fall back to automatic mode on a five minute lease", () => {
  assert.deepEqual(agentSettings(seed), {
    mode: "automatic",
    leaseMinutes: 5,
  });
  const configured = structuredClone(seed);
  configured.map.agents = {
    mode: "directed",
    leaseMinutes: 5,
    pauseAbovePercent: 90,
  };
  assert.deepEqual(agentSettings(configured), {
    mode: "directed",
    leaseMinutes: 5,
    pauseAbovePercent: 90,
  });
  const parsed = parseWorkspace(JSON.stringify(configured));
  assert.deepEqual(agentSettings(parsed), agentSettings(configured));
});
test("a merge policy that is not merge leaves the branch, whatever it was called", () => {
  const policy = (mergePolicy?: string) =>
    mergePolicyOf({
      mode: "automatic",
      leaseMinutes: 5,
      ...(mergePolicy ? { mergePolicy: mergePolicy as MergePolicy } : {}),
    });
  assert.equal(policy(), "merge");
  assert.equal(policy("merge"), "merge");
  assert.equal(policy("branch"), "branch");
  assert.equal(policy("pull-request"), "branch");
});
test("the agent branch is only a name git would take", () => {
  const named = (agentBranch: string) =>
    agentBranchOf({ mode: "automatic", leaseMinutes: 5, agentBranch });
  assert.equal(named("agents"), "agents");
  assert.equal(named("  agents  "), "agents");
  assert.equal(named("team/agents"), "team/agents");
  assert.equal(named("release-2.1"), "release-2.1");
  assert.equal(named(""), "");
  assert.equal(named("agents branch"), "");
  assert.equal(named("-agents"), "");
  assert.equal(named("agents..old"), "");
  assert.equal(named("agents//old"), "");
  assert.equal(named("agents.lock"), "");
  assert.equal(named("a".repeat(201)), "");
  assert.equal(agentBranchOf({ mode: "automatic", leaseMinutes: 5 }), "");
});
test("reordering projects permutes the list without inventing or losing one", () => {
  const moved = reorderProjects(seed, ["sidequest", "launchpad", "core-api"]);
  assert.deepEqual(
    moved.projects.map((p) => p.id),
    ["sidequest", "launchpad", "core-api"],
  );
  assert.deepEqual(
    seed.projects.map((p) => p.id),
    ["launchpad", "core-api", "sidequest"],
  );

  // Unknown and duplicated ids are ignored; omitted projects keep their order.
  const partial = reorderProjects(seed, ["sidequest", "sidequest", "nope"]);
  assert.deepEqual(
    partial.projects.map((p) => p.id),
    ["sidequest", "launchpad", "core-api"],
  );
  assert.deepEqual(reorderProjects(seed, []).projects, seed.projects);

  // Nothing but the order changes.
  assert.deepEqual(
    [...moved.projects].sort((a, b) => a.id.localeCompare(b.id)),
    [...seed.projects].sort((a, b) => a.id.localeCompare(b.id)),
  );
  assert.deepEqual(moved.tasks, seed.tasks);
});

test("the repository layout decides where a project's repository comes from", () => {
  const base = structuredClone(seed);
  const project = {
    ...base.projects[0],
    repositoryUrl: "https://github.com/o/own",
  };
  const workspace = { ...base, projects: [project, ...base.projects.slice(1)] };

  // A monorepo answers with the workspace repository for every project.
  const mono = {
    ...workspace,
    map: {
      ...workspace.map,
      repositoryLayout: "monorepo" as const,
      repositoryUrl: "https://github.com/o/mono",
    },
  };
  assert.equal(repositoryLayout(mono), "monorepo");
  assert.equal(projectRepository(mono, project), "https://github.com/o/mono");

  // A multirepo answers with the project's own, and ignores any workspace
  // repository left behind by an earlier setting.
  const multi = {
    ...workspace,
    map: {
      ...workspace.map,
      repositoryLayout: "multirepo" as const,
      repositoryUrl: "https://github.com/o/stale",
    },
  };
  assert.equal(projectRepository(multi, project), "https://github.com/o/own");

  // Workspaces saved before the setting existed keep behaving as they did: a
  // workspace repository meant monorepo, its absence meant per project.
  const legacyMono = {
    ...workspace,
    map: { ...workspace.map, repositoryUrl: "https://github.com/o/mono" },
  };
  delete (legacyMono.map as { repositoryLayout?: unknown }).repositoryLayout;
  assert.equal(repositoryLayout(legacyMono), "monorepo");
  assert.equal(
    projectRepository(legacyMono, project),
    "https://github.com/o/mono",
  );
  const legacyMulti = {
    ...workspace,
    map: { ...workspace.map, repositoryUrl: "" },
  };
  delete (legacyMulti.map as { repositoryLayout?: unknown }).repositoryLayout;
  assert.equal(repositoryLayout(legacyMulti), "multirepo");
  assert.equal(
    projectRepository(legacyMulti, project),
    "https://github.com/o/own",
  );
});

test("a workspace document round-trips the layout, and rejects an invented one", () => {
  const workspace = structuredClone(seed);
  workspace.map.repositoryLayout = "multirepo";
  workspace.map.repositoryUrl = "";
  assert.equal(
    parseWorkspace(JSON.stringify(workspace)).map.repositoryLayout,
    "multirepo",
  );
  const broken = structuredClone(seed) as unknown as {
    map: { repositoryLayout: string };
  };
  broken.map.repositoryLayout = "polyrepo";
  assert.throws(
    () => parseWorkspace(JSON.stringify(broken)),
    /workspace settings/i,
  );
});

test("legacy connection handles are normalized to launch-order wiring", () => {
  const workspace = structuredClone(seed);
  const [a, b] = workspace.tasks;
  workspace.links = [
    {
      id: "vertical",
      source: a.id,
      target: b.id,
      sourceHandle: "bottom",
      targetHandle: "top",
    } as unknown as (typeof workspace.links)[number],
  ];
  const parsed = parseWorkspace(JSON.stringify(workspace));
  assert.deepEqual(parsed.links[0], {
    id: "vertical",
    source: a.id,
    target: b.id,
  });

  // Links saved before the top and bottom handles existed remain valid.
  const legacy = structuredClone(workspace);
  legacy.links = [{ id: "legacy", source: a.id, target: b.id }];
  assert.doesNotThrow(() => parseWorkspace(JSON.stringify(legacy)));

  // An invented side is rejected rather than silently dropped on the floor.
  const broken = structuredClone(workspace) as unknown as {
    links: { sourceHandle: string }[];
  };
  broken.links[0].sourceHandle = "diagonal";
  assert.throws(() => parseWorkspace(JSON.stringify(broken)), /connections/i);
});

test("a connection can be turned into the other kind without being redrawn", () => {
  const base = structuredClone(seed);
  const [a, b] = base.tasks;
  base.tasks = base.tasks.map((t) => ({ ...t, parentId: null }));
  base.links = [{ id: "dep", source: a.id, target: b.id }];

  assert.equal(connectionKind(base, "dep"), "dependency");
  const asSubtask = setConnectionKind(base, "dep", "subtask");
  assert.equal(asSubtask.links.length, 0);
  assert.equal(asSubtask.tasks.find((t) => t.id === b.id)!.parentId, a.id);
  assert.equal(connectionKind(asSubtask, `parent-${b.id}`), "subtask");
  // The change is recorded on the task, like every other board edit.
  assert.match(
    asSubtask.tasks.find((t) => t.id === b.id)!.activity[0].text,
    /dependency to subtask/,
  );

  // And back again: same pair, same direction, a link once more.
  const asDependency = setConnectionKind(
    asSubtask,
    `parent-${b.id}`,
    "dependency",
  );
  assert.equal(asDependency.tasks.find((t) => t.id === b.id)!.parentId, null);
  assert.equal(asDependency.links.length, 1);
  assert.equal(asDependency.links[0].source, a.id);
  assert.equal(asDependency.links[0].target, b.id);
  // Round-tripping leaves a workspace that still validates.
  assert.doesNotThrow(() => parseWorkspace(JSON.stringify(asDependency)));

  // Asking for the kind it already is changes nothing at all.
  assert.equal(setConnectionKind(base, "dep", "dependency"), base);
  assert.equal(connectionKind(base, "missing"), null);
  assert.throws(
    () => setConnectionKind(base, "missing", "subtask"),
    /no longer exists/,
  );
});

test("deleting a selection folds subtasks in and survives overlap", () => {
  const base = structuredClone(seed);
  const [a, b, c] = base.tasks;
  // b is a subtask of a; deleting a takes b whether or not b was selected too.
  base.tasks = base.tasks.map((t) =>
    t.id === b.id ? { ...t, parentId: a.id } : { ...t, parentId: null },
  );
  base.links = [{ id: "dep", source: a.id, target: c.id }];

  const bulk = (state: typeof base, ids: string[]) =>
    ids.reduce((next, id) => removeTask(next, id), state);

  // The selection the board would hand over: parent and child both selected.
  const both = bulk(base, [a.id, b.id]);
  assert.equal(
    both.tasks.some((t) => t.id === a.id),
    false,
  );
  assert.equal(
    both.tasks.some((t) => t.id === b.id),
    false,
  );
  // Deleting a task removes the links attached to it, so the board cannot be
  // left with an arrow pointing at nothing.
  assert.deepEqual(both.links, []);
  // Everything else is untouched.
  assert.equal(both.tasks.length, base.tasks.length - 2);
  assert.doesNotThrow(() => parseWorkspace(JSON.stringify(both)));

  // Selecting only the parent gives the same result: the child goes with it.
  assert.deepEqual(
    bulk(base, [a.id])
      .tasks.map((t) => t.id)
      .sort(),
    both.tasks.map((t) => t.id).sort(),
  );

  // A selection naming the same task twice is not an error — reduce runs the
  // second removal against a workspace that no longer holds it.
  assert.deepEqual(
    bulk(base, [a.id, a.id])
      .tasks.map((t) => t.id)
      .sort(),
    both.tasks.map((t) => t.id).sort(),
  );
});

test("a version 9 document without a proposed colour gets the default", () => {
  const raw = JSON.parse(JSON.stringify(emptyWorkspace()));
  raw.version = 9;
  delete raw.statusOrbs.proposed;
  const parsed = parseWorkspace(JSON.stringify(raw));
  assert.deepEqual(parsed.statusOrbs.proposed, defaultStatusOrbs.proposed);
});

const reviewed = () => structuredClone(seed);
const reviewedTask = (state: Workspace) =>
  state.tasks.find((task) => task.id === "fixture-task-1")!;
const grace = { author: "Grace", authorType: "user" as const };

test("a review is open until an agent says the next thing on the task", () => {
  const state = sendBack(
    reviewed(),
    "fixture-task-1",
    { text: "The empty state is still the old copy.", to: "Opus" },
    grace,
  );
  const task = reviewedTask(state);
  const review = openReview(task);
  assert.equal(review?.kind, "review");
  assert.equal(review?.to, "Opus");
  // The task is not reopened: done keeps its history and its status, and the
  // review is what says nobody has come back from it yet.
  assert.equal(task.status, "done");

  task.activity.unshift(event("Any word on this?", grace));
  assert.equal(openReview(task)?.id, review?.id);

  task.activity.unshift({
    ...event("Rewrote the empty state.", { author: "Opus", authorType: "ai" }),
    kind: "change",
  });
  assert.equal(openReview(task), undefined);
});

test("a second review reopens a task an agent already answered", () => {
  let state = sendBack(
    reviewed(),
    "fixture-task-1",
    { text: "First pass missed the dark theme." },
    grace,
  );
  reviewedTask(state).activity.unshift({
    ...event("Fixed the dark theme.", { author: "Opus", authorType: "ai" }),
    kind: "change",
  });
  assert.equal(openReview(reviewedTask(state)), undefined);

  state = sendBack(
    state,
    "fixture-task-1",
    { text: "Now the light theme is wrong." },
    grace,
  );
  assert.equal(
    openReview(reviewedTask(state))?.text,
    "Now the light theme is wrong.",
  );
});

test("a review needs something written in it", () => {
  assert.throws(() =>
    sendBack(reviewed(), "fixture-task-1", { text: "   " }, grace),
  );
});

test("a stored review keeps its kind and the agent it names", () => {
  const state = sendBack(
    reviewed(),
    "fixture-task-1",
    { text: "Not what was asked for.", to: "  Opus  " },
    grace,
  );
  const parsed = parseWorkspace(JSON.stringify(state));
  const entry = reviewedTask(parsed).activity[0];
  assert.equal(entry.kind, "review");
  assert.equal(entry.to, "Opus");
});

test("the latest report skips the runner's own closing lines", () => {
  const entry = (
    id: string,
    at: string,
    kind?: Activity["kind"],
    text = id,
  ): Activity => ({
    id,
    text,
    at,
    author: "Claude",
    authorType: "ai",
    ...(kind ? { kind } : {}),
  });
  const task = {
    activity: [
      entry("merged", "2026-01-03T00:00:00Z", undefined, "Merged into main"),
      entry("change", "2026-01-02T00:00:00Z", "change"),
      entry("report", "2026-01-01T00:00:00Z", "report"),
    ],
  };
  assert.equal(latestReport(task)?.id, "report");
  assert.equal(
    latestReport({ activity: task.activity.slice(0, 2) })?.id,
    "change",
  );
  assert.equal(
    latestReport({ activity: task.activity.slice(0, 1) }),
    undefined,
  );
});

test("a report round-trips through its four labelled lines", () => {
  const text = formatReport({
    done: "Added login",
    where: "src/auth.ts, 1a2b3c4",
    next: "Wire the popup",
  });
  assert.equal(
    text,
    "Done: Added login\nWhere: src/auth.ts, 1a2b3c4\nNext: Wire the popup",
  );
  assert.deepEqual(parseReport(text + "\nblocked: nothing\n  really"), {
    done: "Added login",
    where: "src/auth.ts, 1a2b3c4",
    next: "Wire the popup",
    blocked: "nothing really",
  });
});
