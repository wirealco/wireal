import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkspace, sendBack } from "../src/domain.ts";
import { testWorkspace as seed } from "../src/test-workspace.ts";
import {
  addActivity,
  addDependency,
  closeTask,
  createLabel,
  createProject,
  configureProjectFolders,
  configureProjectRepository,
  createTask,
  createTasks,
  deleteLabel,
  deleteProject,
  deleteTask,
  linkCommit,
  patchTask,
  proposeTask,
  readyTasks,
  reportTask,
  setTaskStatus,
  taskBrief,
  updateLabel,
  updateProject,
} from "./workspace.ts";

const workspace = () => structuredClone(seed);

test("creates and edits an MCP task with valid workspace data", () => {
  let state = createLabel(workspace(), "MCP");
  const created = createTask(
    state,
    {
      name: "Expose task tools",
      projects: ["Launchpad"],
      objective: "Let agents manage Wireal",
      labels: ["mcp"],
    },
    "Codex",
  );
  state = created.state;
  assert.equal(created.task.status, "todo");
  assert.deepEqual(created.task.labels, ["MCP"]);

  const status = setTaskStatus(
    state,
    created.task.referenceId,
    "doing",
    "Codex",
  );
  state = status.state;
  const edited = patchTask(
    state,
    created.task.id,
    {
      name: undefined,
      projectIds: ["core-api"],
      labels: undefined,
    },
    "Codex",
  );
  assert.equal(edited.task.name, "Expose task tools");
  // The objective an agent cannot reach: it survives every other edit.
  assert.equal(edited.task.objective, created.task.objective);
  assert.deepEqual(edited.task.projectIds, ["core-api"]);
  assert.equal(edited.task.activity[0].authorType, "ai");
  assert.doesNotThrow(() => parseWorkspace(JSON.stringify(edited.state)));
});

test("deleting an MCP task removes its subtasks and attached links", () => {
  const state = workspace();
  const removed = deleteTask(state, "fixture-task-3");
  assert.equal(removed.task.name, "Build the workspace");
  assert.deepEqual(
    removed.removedTasks.map((task) => task.id),
    ["fixture-task-3", "fixture-task-4"],
  );
  assert.equal(
    removed.state.links.some(
      (link) =>
        link.source === "fixture-task-3" || link.target === "fixture-task-3",
    ),
    false,
  );
  assert.doesNotThrow(() => parseWorkspace(JSON.stringify(removed.state)));
});

test("MCP label updates propagate and deletion cleans every task", () => {
  let state = createLabel(workspace(), "Needs review");
  state.tasks[0].labels = ["Needs review"];
  const updated = updateLabel(state, "needs review", {
    name: "Reviewed",
    color: "#123abc",
  });
  assert.equal(updated.label.name, "Reviewed");
  assert.equal(updated.label.color, "#123abc");
  assert.deepEqual(updated.state.tasks[0].labels, ["Reviewed"]);
  assert.throws(
    () => updateLabel(updated.state, "Reviewed", { name: "" }),
    /needs a name/,
  );

  const removed = deleteLabel(updated.state, updated.label.id);
  assert.equal(removed.label.name, "Reviewed");
  assert.deepEqual(removed.state.tasks[0].labels, []);
  assert.doesNotThrow(() => parseWorkspace(JSON.stringify(removed.state)));
});

test("MCP project updates preserve membership and deletion keeps shared tasks", () => {
  const state = workspace();
  const updated = updateProject(state, "Core API", {
    name: "Platform API",
    color: "#123abc",
    repositoryUrl: "https://github.com/Example/App.GIT/",
  });
  assert.equal(updated.project.name, "Platform API");
  assert.equal(updated.project.color, "#123abc");
  assert.equal(updated.project.repositoryUrl, "https://github.com/Example/App");
  assert.ok(updated.state.tasks[6].projectIds.includes("core-api"));

  const removed = deleteProject(updated.state, "Platform API");
  assert.equal(removed.removedTasks.length, 0);
  assert.deepEqual(removed.state.tasks[6].projectIds, ["sidequest"]);
  assert.doesNotThrow(() => parseWorkspace(JSON.stringify(removed.state)));

  const launchpad = deleteProject(state, "Launchpad");
  assert.equal(launchpad.removedTasks.length, 6);
  assert.equal(
    launchpad.state.links.some((link) =>
      launchpad.removedTasks.some(
        (task) => task.id === link.source || task.id === link.target,
      ),
    ),
    false,
  );
});

test("links only commits from the selected task project", () => {
  const state = workspace();
  state.projects[0].repositoryUrl = "https://github.com/example/repo";
  const sha = "a".repeat(40);
  const linked = linkCommit(state, "fixture-task-1", "Launchpad", sha, "Codex");
  assert.deepEqual(linked.task.commitUrls, [
    `https://github.com/example/repo/commit/${sha}`,
  ]);
  assert.throws(
    () =>
      linkCommit(
        state,
        "fixture-task-1",
        "Launchpad",
        `https://github.com/other/repo/commit/${sha}`,
        "Codex",
      ),
    /must belong/,
  );
});

test("prevents dependency cycles", () => {
  const state = workspace();
  assert.throws(
    () => addDependency(state, "fixture-task-1", "fixture-task-6"),
    /cycle/,
  );
});

test("adds attributed activity and creates a GitHub project", () => {
  const activity = addActivity(
    workspace(),
    "fixture-task-1",
    { kind: "verification", summary: "Verified MCP" },
    "Codex",
  );
  assert.equal(activity.task.activity[0].text, "Verified MCP");
  assert.equal(activity.task.activity[0].author, "Codex");
  assert.equal(activity.task.activity[0].kind, "verification");

  const created = createProject(workspace(), {
    name: "MCP",
    repositoryUrl: "https://github.com/example/repo.git",
  });
  assert.equal(
    created.project.repositoryUrl,
    "https://github.com/example/repo",
  );
  assert.doesNotThrow(() => parseWorkspace(JSON.stringify(created.state)));
});

test("addActivity stores kind and commit", () => {
  const changed = addActivity(
    workspace(),
    "fixture-task-1",
    {
      kind: "change",
      summary: "Rationed verification emails",
      commit: "8bc0d8d",
    },
    "Claude",
  );
  const entry = changed.task.activity[0];
  assert.equal(entry.kind, "change");
  assert.equal(entry.commit, "8bc0d8d");
});

test("project repository configuration preserves tasks", () => {
  const state = workspace();
  const configured = configureProjectRepository(state, "Launchpad", {
    repositoryUrl: "https://github.com/Example/App.GIT/",
  });
  assert.equal(
    configured.project.repositoryUrl,
    "https://github.com/Example/App",
  );
  assert.deepEqual(configured.state.tasks, state.tasks);
  assert.doesNotThrow(() => parseWorkspace(JSON.stringify(configured.state)));
  const cleared = configureProjectRepository(configured.state, "Launchpad", {
    repositoryUrl: "",
  });
  assert.equal(cleared.project.repositoryUrl, "");
});

test("project folder configuration adds, removes, replaces, and normalizes folders", () => {
  const state = workspace();
  state.projects[0].paths = ["packages/shared"];
  const added = configureProjectFolders(state, "Launchpad", {
    add: ["./apps/web/", "packages/shared", "services/api"],
  });
  assert.deepEqual(added.project.paths, [
    "packages/shared",
    "apps/web",
    "services/api",
  ]);

  const removed = configureProjectFolders(added.state, "Launchpad", {
    remove: ["./apps/web/", "unknown"],
  });
  assert.deepEqual(removed.project.paths, ["packages/shared", "services/api"]);

  const replaced = configureProjectFolders(removed.state, "Launchpad", {
    replace: [" ./tools/ ", "tools", ""],
    add: ["apps/admin"],
    remove: ["tools"],
  });
  assert.deepEqual(replaced.project.paths, ["apps/admin"]);

  const cleared = configureProjectFolders(replaced.state, "Launchpad", {
    replace: [],
  });
  assert.equal("paths" in cleared.project, false);
  assert.doesNotThrow(() => parseWorkspace(JSON.stringify(cleared.state)));
});

test("project folder configuration rejects unsupported and invalid folders", () => {
  const everyday = workspace();
  everyday.map.kind = "everyday";
  assert.throws(
    () => configureProjectFolders(everyday, "Launchpad", { add: ["apps/web"] }),
    /Project folders are only available in coding workspaces\./,
  );

  assert.throws(
    () =>
      configureProjectFolders(workspace(), "Launchpad", {
        replace: Array.from({ length: 51 }, (_, index) => `app-${index}`),
      }),
    /A project can own at most 50 folders\./,
  );

  assert.throws(
    () =>
      configureProjectFolders(workspace(), "Launchpad", {
        add: ["apps/../web"],
      }),
    /Folders are repository-relative paths of up to 200 characters\./,
  );
});

test("project creation and updates accept normalized folders", () => {
  const created = createProject(workspace(), {
    name: "MCP folders",
    folders: ["./apps/web/", "apps/web", "services/api"],
  });
  assert.deepEqual(created.project.paths, ["apps/web", "services/api"]);

  const updated = updateProject(created.state, created.project.id, {
    folders: [],
  });
  assert.equal("paths" in updated.project, false);
});

test("many agent-created tasks form a grid rather than one endless row", () => {
  let state = workspace();
  for (let index = 0; index < 30; index += 1)
    state = createTask(
      state,
      { name: `Roadmap task ${index}`, projects: ["Launchpad"] },
      "Claude",
    ).state;

  const xs = state.tasks.map((task) => task.position.x);
  const ys = state.tasks.map((task) => task.position.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  // A row of 30 tasks used to span past 11,000px against no height at all,
  // which fit view cannot frame and every arrow has to cross.
  assert.equal(width < 2500, true);
  assert.equal(height > 0, true);

  const slots = state.tasks.map(
    (task) => `${task.position.x}:${task.position.y}`,
  );
  assert.equal(new Set(slots).size, state.tasks.length);
});

test("a subtask steps past a sibling instead of stacking on it", () => {
  let state = workspace();
  const parent = state.tasks[0];
  const first = createTask(
    state,
    { name: "First subtask", projects: ["Launchpad"], parent: parent.id },
    "Claude",
  );
  const second = createTask(
    first.state,
    { name: "Second subtask", projects: ["Launchpad"], parent: parent.id },
    "Claude",
  );
  assert.equal(second.task.position.x, first.task.position.x);
  assert.equal(second.task.position.y > first.task.position.y, true);
});

test("ready tasks require done parents and dependency sources and follow launch order", () => {
  const state = workspace();
  for (const task of state.tasks) task.status = "done";
  state.tasks[1].status = "todo";
  state.tasks[3].status = "todo";
  state.tasks[6].status = "todo";
  const ready = readyTasks(state);
  assert.deepEqual(
    ready.map((task) => task.id),
    ["fixture-task-7", "fixture-task-2", "fixture-task-4"],
  );

  state.tasks[2].status = "todo";
  state.tasks[6].status = "proposed";
  assert.deepEqual(
    readyTasks(state).map((task) => task.id),
    ["fixture-task-2"],
  );
});

test("a done task a person sent back is ready again, and stops being ready once the agent answers", () => {
  let state = sendBack(
    workspace(),
    "fixture-task-1",
    { text: "The heading is still wrong.", to: "Opus" },
    { author: "Grace", authorType: "user" },
  );
  for (const task of state.tasks)
    if (task.id !== "fixture-task-1") task.status = "proposed";
  assert.deepEqual(
    readyTasks(state).map((task) => task.id),
    ["fixture-task-1"],
  );

  const brief = taskBrief(state, "fixture-task-1");
  assert.deepEqual(brief.review, {
    text: "The heading is still wrong.",
    by: "Grace",
    at: brief.review?.at ?? "",
    to: "Opus",
  });

  state = closeTask(
    state,
    {
      task: "fixture-task-1",
      outcome: "done",
      summary: "Rewrote the heading.",
    },
    "Opus",
  ).state;
  assert.deepEqual(readyTasks(state), []);
  assert.equal(taskBrief(state, "fixture-task-1").review, undefined);
});

test("an agent that abandons a sent-back task leaves it done rather than forgetting it ever finished", () => {
  const sent = sendBack(
    workspace(),
    "fixture-task-1",
    { text: "The heading is still wrong." },
    { author: "Grace", authorType: "user" },
  );
  const abandoned = closeTask(
    sent,
    {
      task: "fixture-task-1",
      outcome: "abandoned",
      summary: "Ran out of context.",
    },
    "Opus",
  );
  assert.equal(abandoned.task.status, "done");

  // A task that never finished still goes back in the queue.
  sent.tasks[3].status = "doing";
  assert.equal(
    closeTask(
      sent,
      { task: "fixture-task-4", outcome: "abandoned", summary: "Gave up." },
      "Opus",
    ).task.status,
    "todo",
  );
});

test("task brief gives each upstream task its latest report, not the runner's closing line", () => {
  const state = workspace();
  state.map.repositoryUrl = "https://github.com/example/wireal";
  state.projects[0].paths = ["apps/web"];
  state.links.push({
    id: "extra-upstream",
    source: "fixture-task-1",
    target: "fixture-task-4",
  });
  state.tasks[0].activity = ["newest", "second", "third", "oldest"].map(
    (text, index) => ({
      id: `entry-${index}`,
      text,
      at: new Date(2026, 0, 4 - index).toISOString(),
      author: "Codex",
      authorType: "ai" as const,
      kind: "change" as const,
      commit: `abcdef${index}`,
    }),
  );
  const brief = taskBrief(state, "fixture-task-4");
  assert.equal(brief.repository, "https://github.com/example/wireal");
  assert.deepEqual(brief.projects, [
    {
      name: "Launchpad",
      repositoryUrl: "https://github.com/example/wireal",
      folders: ["apps/web"],
    },
  ]);
  assert.deepEqual(
    brief.upstream.map((task) => task.referenceId),
    ["1", "3"],
  );
  assert.equal(brief.upstream[0].report, "newest");
  assert.deepEqual(
    brief.upstream[0].activity.map((entry) => entry.text),
    ["newest"],
  );
  assert.equal("at" in brief.upstream[0].activity[0], false);
  assert.equal(brief.upstream[1].report, undefined);
  assert.deepEqual(brief.upstream[1].activity, []);

  // The runner's own lines carry no kind and sit on top; a report wins over
  // an older change note either way.
  state.tasks[0].activity.unshift(
    {
      id: "runner-merge",
      text: "Merged into main at 1234567",
      at: new Date(2026, 0, 9).toISOString(),
      author: "Wireal runner",
      authorType: "ai",
    },
    {
      id: "the-report",
      text: "Done: Shipped the login flow",
      at: new Date(2026, 0, 8).toISOString(),
      author: "Codex",
      authorType: "ai",
      kind: "report",
    },
  );
  assert.equal(
    taskBrief(state, "fixture-task-4").upstream[0].report,
    "Done: Shipped the login flow",
  );
});

test("createTasks makes a batch in one write and wires refs, numbers and parents", () => {
  const state = workspace();
  const { state: next, created } = createTasks(
    state,
    [
      { ref: "api", name: "Build the API", projects: ["Core API"] },
      { ref: "ui", name: "Build the UI", projects: ["Launchpad"] },
      {
        ref: "e2e",
        name: "End to end",
        projects: ["Launchpad"],
        dependsOn: ["api", "ui", 1],
      },
      { name: "Fix copy", parent: "ui" },
    ],
    "Claude · a1",
  );
  assert.deepEqual(
    created.map((entry) => [entry.ref, entry.task.referenceId]),
    [
      ["api", "9"],
      ["ui", "10"],
      ["e2e", "11"],
      [undefined, "12"],
    ],
  );
  const e2e = created[2].task;
  assert.deepEqual(
    next.links
      .filter((link) => link.target === e2e.id)
      .map((link) => link.source)
      .sort(),
    [created[0].task.id, created[1].task.id, "fixture-task-1"].sort(),
  );
  // No projects named: the parent's are used.
  assert.equal(created[3].task.parentId, created[1].task.id);
  assert.deepEqual(created[3].task.projectIds, ["launchpad"]);
  assert.equal(parseWorkspace(JSON.stringify(next)).tasks.length, 12);

  assert.throws(
    () => createTasks(state, [{ name: "Nowhere" }], "Claude"),
    /Name the projects for Nowhere/,
  );
  assert.throws(
    () =>
      createTasks(
        state,
        [
          { name: "Child", parent: "later", projects: ["Launchpad"] },
          { ref: "later", name: "Parent", projects: ["Launchpad"] },
        ],
        "Claude",
      ),
    /used before/,
  );
  assert.throws(
    () =>
      createTasks(
        state,
        [
          { ref: "a", name: "A", projects: ["Launchpad"], dependsOn: ["b"] },
          { ref: "b", name: "B", projects: ["Launchpad"], dependsOn: ["a"] },
        ],
        "Claude",
      ),
    /cycle/,
  );
});

test("reportTask writes one report entry in labelled lines and keeps only a full SHA", () => {
  const state = workspace();
  state.projects[0].repositoryUrl = "https://github.com/example/wireal";
  const sha = "68af5a14311fbd9d411d7b0e7df3c989ce6f7b96";
  const reported = reportTask(
    state,
    "1",
    { done: "Login works", where: "src/login.ts", next: "", commit: sha },
    "Claude · a1",
  );
  const entry = reported.task.activity[0];
  assert.equal(entry.kind, "report");
  assert.equal(entry.text, "Done: Login works\nWhere: src/login.ts");
  assert.equal(entry.commit, sha);
  assert.equal(
    reported.commitUrl,
    `https://github.com/example/wireal/commit/${sha}`,
  );
  assert.deepEqual(reported.task.commitUrls, [reported.commitUrl]);

  const short = reportTask(
    state,
    "1",
    { done: "Login works", blocked: "Needs a key", commit: "68af5a1" },
    "Claude · a1",
  );
  assert.equal(short.commitIgnored, true);
  assert.equal(short.task.activity[0].commit, undefined);
  assert.equal(
    short.task.activity[0].text,
    "Done: Login works\nBlocked: Needs a key",
  );
  assert.throws(() => reportTask(state, "1", { done: " " }, "C"), /done/);
});

test("proposals inherit projects, sit below the source, create a dependency, and cap at three", () => {
  let state = workspace();
  const source = state.tasks[0];
  for (let index = 0; index < 3; index += 1) {
    const proposed = proposeTask(
      state,
      {
        from: source.id,
        name: `Follow-up ${index + 1}`,
        objective: `Handle follow-up ${index + 1}`,
      },
      "Codex",
    );
    state = proposed.state;
    assert.equal(proposed.task.status, "proposed");
    assert.equal(proposed.task.proposedBy, "Codex");
    assert.deepEqual(proposed.task.projectIds, source.projectIds);
    assert.deepEqual(proposed.task.position, {
      x: source.position.x,
      y: source.position.y + 270,
    });
    assert.ok(
      state.links.some(
        (link) => link.source === source.id && link.target === proposed.task.id,
      ),
    );
    assert.equal(
      state.tasks.find((task) => task.id === source.id)?.activity[0].text,
      `Proposed ${proposed.task.referenceId} ${proposed.task.name}`,
    );
  }
  assert.throws(
    () =>
      proposeTask(
        state,
        {
          from: source.id,
          name: "Fourth follow-up",
          objective: "Too many follow-ups",
        },
        "Codex",
      ),
    /at most three/,
  );
  assert.doesNotThrow(() =>
    proposeTask(
      state,
      {
        from: source.id,
        name: "Another agent follow-up",
        objective: "Owned by another agent",
      },
      "Claude",
    ),
  );
});

test("close task records exactly one closing activity for every outcome", () => {
  const usage = {
    costUsd: 0.12,
    inputTokens: 120,
    outputTokens: 45,
    model: "codex",
    durationMs: 900,
  };
  const doneState = workspace();
  const doneBefore = doneState.tasks[1].activity.length;
  const done = closeTask(
    doneState,
    {
      task: "fixture-task-2",
      outcome: "done",
      summary: "Implemented the task",
      commit: "abcdef0",
      usage,
    },
    "Codex",
  );
  assert.equal(done.task.status, "done");
  assert.equal(done.task.activity.length, doneBefore + 1);
  assert.equal(done.task.activity[0].text, "Implemented the task");
  assert.equal(done.task.activity[0].commit, "abcdef0");
  assert.deepEqual(done.task.activity[0].usage, usage);
  assert.equal(done.task.activity[0].kind, undefined);

  const blockedState = workspace();
  const blockedBefore = blockedState.tasks[1].activity.length;
  const blocked = closeTask(
    blockedState,
    {
      task: "fixture-task-2",
      outcome: "blocked",
      summary: "Waiting for access",
    },
    "Claude",
  );
  assert.equal(blocked.task.status, "doing");
  assert.equal(blocked.task.activity.length, blockedBefore + 1);
  assert.equal(blocked.task.activity[0].kind, "blocker");

  const abandonedState = workspace();
  const abandonedBefore = abandonedState.tasks[1].activity.length;
  const abandoned = closeTask(
    abandonedState,
    {
      task: "fixture-task-2",
      outcome: "abandoned",
      summary: "Returned for reassignment",
    },
    "Codex",
  );
  assert.equal(abandoned.task.status, "todo");
  assert.equal(abandoned.task.activity.length, abandonedBefore + 1);
  assert.equal(abandoned.task.activity[0].kind, undefined);
});

test("an activity or closing entry with a commit wires it to the task", () => {
  const state = workspace();
  state.projects[0].repositoryUrl = "https://github.com/example/repo";
  const noted = addActivity(
    state,
    "fixture-task-1",
    {
      kind: "change",
      summary: "Committed the helper",
      commit: "A624C2E0ACF6589B9A6EF529051D5EA555EF1D71",
    },
    "Claude · studio 1",
  );
  assert.deepEqual(noted.task.commitUrls, [
    "https://github.com/example/repo/commit/a624c2e0acf6589b9a6ef529051d5ea555ef1d71",
  ]);
  assert.equal(
    noted.commitUrl,
    "https://github.com/example/repo/commit/a624c2e0acf6589b9a6ef529051d5ea555ef1d71",
  );
  const abbreviated = addActivity(
    state,
    "fixture-task-1",
    { kind: "change", summary: "Short SHA", commit: "a624c2e" },
    "Claude · studio 1",
  );
  assert.deepEqual(abbreviated.task.commitUrls, []);
  assert.equal(abbreviated.commitUrl, undefined);
  const closed = closeTask(
    noted.state,
    {
      task: "fixture-task-1",
      outcome: "done",
      summary: "Finished",
      commit: "a624c2e0acf6589b9a6ef529051d5ea555ef1d71",
    },
    "Claude · studio 1",
  );
  assert.deepEqual(closed.task.commitUrls, [
    "https://github.com/example/repo/commit/a624c2e0acf6589b9a6ef529051d5ea555ef1d71",
  ]);
  const bare = addActivity(
    workspace(),
    "fixture-task-1",
    {
      kind: "change",
      summary: "No repository here",
      commit: "a624c2e0acf6589b9a6ef529051d5ea555ef1d71",
    },
    "Claude",
  );
  assert.deepEqual(bare.task.commitUrls, []);
  assert.equal(bare.commitUrl, undefined);
});
