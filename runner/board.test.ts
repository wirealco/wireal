import assert from "node:assert/strict";
import test from "node:test";
import {
  parseWorkspace,
  type ActivityKind,
  type Workspace,
} from "../src/domain.ts";
import { testWorkspace } from "../src/test-workspace.ts";
import { liveLeases, type LeaseRow } from "./api.ts";
import {
  Board,
  agentReported,
  chooseWorkspace,
  closingText,
  closingUsage,
  directDependents,
  firstSentence,
  livePresence,
  lockedTo,
  outcomeOf,
  ownLocks,
  pendingRequests,
  reportedBlocked,
  stripMarkdown,
  upstreamReport,
  type BoardClient,
  type Closing,
  type HeartbeatReply,
} from "./board.ts";

function ready(): Workspace {
  const state = structuredClone(testWorkspace);
  for (const task of state.tasks)
    if (task.id === "fixture-task-2" || task.id === "fixture-task-3")
      task.status = "done";
  const upstream = state.tasks.find((task) => task.id === "fixture-task-3");
  upstream?.activity.unshift({
    id: "activity-1",
    text: "Built the workspace and left the schema alone.",
    at: "2026-09-16T00:00:00.000Z",
    author: "Claude 3",
    authorType: "ai",
    kind: "change",
    commit: "1234567890abcdef1234567890abcdef12345678",
  });
  return parseWorkspace(JSON.stringify(state));
}

function fake(state: Workspace, leases: LeaseRow[] = []) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const replies: Record<string, unknown> = {
    runner_heartbeat: {
      leases: [],
      ping_requested_at: null,
      ping_answered_at: null,
      server_time: "2026-09-16T00:00:00.000Z",
    },
    claim_task: {
      task_id: "fixture-task-7",
      until: "2026-09-16T00:05:00.000Z",
    },
    release_task: { released: true },
    runner_leave: { left: true },
  };
  let current = state;
  const pinned: string[] = [];
  const client: BoardClient = {
    read: async () => ({
      workspace: current,
      revision: 4,
      workspaceId: "11111111-1111-4111-8111-111111111111",
    }),
    command: async <T>(name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return replies[name] as T;
    },
    mutate: async <T>(
      change: (state: Workspace) => { state: Workspace; value: T },
    ) => {
      const changed = change(current);
      current = parseWorkspace(JSON.stringify(changed.state));
      return { value: changed.value, revision: 5 };
    },
  };
  return {
    calls,
    pinned,
    board: new Board(
      {
        workspaces: async () => [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: state.map.name,
            repositoryUrl: state.map.repositoryUrl,
            revision: 4,
            isActive: true,
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            name: "Everyday",
            repositoryUrl: "",
            revision: 1,
            isActive: false,
          },
        ],
        pinned: (workspaceId) => {
          pinned.push(workspaceId);
          return client;
        },
      },
      async () => [
        {
          runner_id: "runner-two",
          name: "Rex's desktop",
          host: "desk.example.com",
          last_seen: new Date().toISOString(),
          leases,
        },
      ],
      { id: "runner-one", name: "Ada's laptop" },
      "studio.example.com",
    ),
    state: () => current,
  };
}

const soon = new Date(Date.now() + 120_000).toISOString();
const past = new Date(Date.now() - 120_000).toISOString();

test("candidates are the ready tasks nobody holds, in launch order", async () => {
  const free = fake(ready());
  await free.board.connect();
  assert.deepEqual(
    (await free.board.candidates()).map((candidate) => candidate.referenceId),
    ["7", "4", "5"],
  );

  const held = fake(ready(), [
    { task_id: "fixture-task-4", agent: "claude", until: soon },
  ]);
  await held.board.connect();
  assert.deepEqual(
    (await held.board.candidates()).map((candidate) => candidate.referenceId),
    ["7", "5"],
  );
});

test("a lease that has run out does not hold a task back", () => {
  assert.deepEqual(
    liveLeases([
      {
        runner_id: "one",
        name: "ada@studio",
        host: "studio",
        last_seen: soon,
        leases: [
          { task_id: "fixture-task-4", agent: "claude", until: soon },
          { task_id: "fixture-task-7", agent: "codex", until: past },
        ],
      },
      { runner_id: "two", name: "bo@laptop", host: "laptop", last_seen: soon },
    ]).map((lease) => lease.task_id),
    ["fixture-task-4"],
  );
});

test("a candidate carries its projects and what the tasks before it reported", async () => {
  const briefed = fake(ready());
  await briefed.board.connect();
  const fourth = (await briefed.board.candidates()).find(
    (candidate) => candidate.referenceId === "4",
  );
  assert.equal(fourth?.id, "fixture-task-4");
  assert.equal(fourth?.name, "Create task nodes");
  assert.deepEqual(fourth?.projects, [
    { name: "Launchpad", repositoryUrl: "", folders: [] },
  ]);
  assert.deepEqual(fourth?.upstream, [
    {
      referenceId: "3",
      name: "Build the workspace",
      summary: "Built the workspace and left the schema alone.",
    },
  ]);
});

test("a done task that was sent back becomes a candidate carrying what is wrong with it", async () => {
  const state = ready();
  const finished = state.tasks.find((task) => task.id === "fixture-task-2");
  finished?.activity.unshift({
    id: "review-1",
    text: "The schema is exactly what I asked you to leave alone.",
    at: "2026-09-17T00:00:00.000Z",
    author: "Grace",
    authorType: "user",
    kind: "review",
    to: "Opus",
  });
  const board = fake(parseWorkspace(JSON.stringify(state))).board;
  await board.connect();
  const sent = (await board.candidates()).find(
    (candidate) => candidate.referenceId === "2",
  );
  assert.deepEqual(sent?.review, {
    text: "The schema is exactly what I asked you to leave alone.",
    by: "Grace",
  });
});

test("an upstream task that reported nothing still says where it stands", async () => {
  const state = ready();
  const upstream = state.tasks.find((task) => task.id === "fixture-task-3");
  if (upstream) upstream.activity = [];
  const board = fake(state).board;
  await board.connect();
  const candidates = await board.candidates();
  const fourth = candidates.find((candidate) => candidate.referenceId === "4");
  assert.equal(fourth?.upstream[0].summary, "done, no report");
  assert.deepEqual(
    candidates.find((candidate) => candidate.referenceId === "7")?.upstream,
    [],
  );
});

test("a finished agent closes its task with the commit and what it spent", async () => {
  const closing = fake(ready());
  await closing.board.connect();
  const outcome = await closing.board.close(
    "fixture-task-7",
    {
      ok: true,
      summary: "Added the runner and its tests.",
      costUsd: 0.42,
      inputTokens: 21372,
      outputTokens: 47,
      model: "claude-opus-5",
      durationMs: 1435,
      windows: {
        fiveHour: { start: 42, end: 47 },
        sevenDay: { start: 18, end: 19 },
      },
    },
    "8f1c0de9c0ffee8f1c0de9c0ffee8f1c0de9c0ff",
    "Claude 7",
  );
  assert.equal(outcome, "done");
  const task = closing
    .state()
    .tasks.find((candidate) => candidate.id === "fixture-task-7");
  assert.equal(task?.status, "done");
  const entry = task?.activity[0];
  assert.equal(
    entry?.text,
    "Done in 1 s for $0.42 on claude-opus-5. 5h 42→47%, 7d 18→19%. Added the runner and its tests.",
  );
  assert.equal(entry?.author, "Claude 7");
  assert.equal(entry?.authorType, "ai");
  assert.equal(entry?.commit, "8f1c0de9c0ffee8f1c0de9c0ffee8f1c0de9c0ff");
  assert.deepEqual(entry?.usage, {
    costUsd: 0.42,
    inputTokens: 21372,
    outputTokens: 47,
    model: "claude-opus-5",
    durationMs: 1435,
    windows: {
      fiveHour: { start: 42, end: 47 },
      sevenDay: { start: 18, end: 19 },
    },
  });
});

test("an agent that stopped on a blocker leaves the task where it is", async () => {
  const blocked = fake(ready());
  await blocked.board.connect();
  assert.equal(
    await blocked.board.close(
      "fixture-task-7",
      { ok: false, summary: "Blocked: the API rejects the new field." },
      "",
      "Codex 7",
    ),
    "blocked",
  );
  const task = blocked
    .state()
    .tasks.find((candidate) => candidate.id === "fixture-task-7");
  assert.equal(task?.status, "todo");
  assert.equal(
    task?.activity[0].text,
    "Blocked. Blocked: the API rejects the new field.",
  );
  assert.equal(task?.activity[0].kind, "blocker");
  assert.equal(task?.activity[0].commit, undefined);
  assert.equal(task?.activity[0].usage, undefined);
});

test("an agent that said nothing at all still leaves a readable entry", async () => {
  const quiet = fake(ready());
  await quiet.board.connect();
  assert.equal(
    await quiet.board.close("fixture-task-7", { ok: false }, "", "Claude 7"),
    "abandoned",
  );
  assert.equal(
    quiet.state().tasks.find((candidate) => candidate.id === "fixture-task-7")
      ?.activity[0].text,
    "Abandoned.",
  );
});

test("the outcome follows the agent's result and whether it committed", () => {
  const done: Closing = { ok: true, summary: "Shipped." };
  assert.equal(outcomeOf(done, "abc1234"), "done");
  assert.equal(outcomeOf(done, ""), "abandoned");
  assert.equal(
    outcomeOf({ ok: false, error: "killed" }, "abc1234"),
    "abandoned",
  );
  assert.equal(
    outcomeOf({ ok: false, summary: "I am blocked on the schema." }, ""),
    "blocked",
  );
  assert.equal(
    outcomeOf({ ok: false, error: "the blocker is upstream" }, "abc1234"),
    "blocked",
  );
  assert.equal(closingUsage({ ok: true }), undefined);
  assert.deepEqual(closingUsage({ ok: true, costUsd: 0 }), { costUsd: 0 });
  assert.deepEqual(
    closingUsage({
      ok: true,
      windows: {
        fiveHour: { start: 42, end: 47 },
        sevenDay: { start: 18 },
      },
    }),
    { windows: { fiveHour: { start: 42, end: 47 } } },
  );
});

test("every runner command carries the workspace, this runner and the lease", async () => {
  const running = fake(ready());
  await running.board.connect("Workspace");
  await running.board.heartbeat(
    [
      {
        id: "ada",
        name: "Ada",
        kind: "claude",
        task_id: "fixture-task-7",
        since: "2026-09-16T00:00:00.000Z",
      },
    ],
    ["claude", "codex"],
    1.25,
    5,
  );
  await running.board.claim("fixture-task-7", "ada", 5);
  assert.equal(await running.board.release("fixture-task-7"), true);
  await running.board.leave();
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const runner = running.board.runnerId;
  assert.deepEqual(running.pinned, [workspaceId]);
  assert.deepEqual(
    running.calls.map((call) => call.name),
    ["runner_heartbeat", "claim_task", "release_task", "runner_leave"],
  );
  assert.deepEqual(running.calls[0].args, {
    workspace_id: workspaceId,
    runner,
    name: "Ada's laptop",
    host: "studio.example.com",
    agents: [
      {
        id: "ada",
        name: "Ada",
        kind: "claude",
        task_id: "fixture-task-7",
        since: "2026-09-16T00:00:00.000Z",
      },
    ],
    hosts: ["claude", "codex"],
    cost_usd: 1.25,
    lease_minutes: 5,
  });
  assert.deepEqual(running.calls[1].args, {
    workspace_id: workspaceId,
    task_id: "fixture-task-7",
    agent: "ada",
    runner,
    lease_minutes: 5,
  });
  assert.deepEqual(running.calls[2].args, {
    workspace_id: workspaceId,
    task_id: "fixture-task-7",
    runner,
  });
  assert.deepEqual(running.calls[3].args, {
    workspace_id: workspaceId,
    runner,
  });
});

test("the tasks after a finished one are only the ones that depend on it", async () => {
  const state = ready();
  const seventh = state.tasks.find((task) => task.id === "fixture-task-7");
  if (seventh) seventh.status = "done";
  const line = fake(parseWorkspace(JSON.stringify(state)));
  await line.board.connect();
  assert.deepEqual(
    (await line.board.candidates()).map((candidate) => candidate.referenceId),
    ["8", "4", "5"],
  );
  assert.deepEqual(
    (await line.board.candidates(new Set(["fixture-task-7"]))).map(
      (candidate) => candidate.referenceId,
    ),
    ["8"],
  );
  assert.deepEqual(
    await line.board.candidates(new Set(["fixture-task-8"])),
    [],
  );
});

test("a line keeps the branches it walked past", async () => {
  const state = ready();
  const subtask = state.tasks.find((task) => task.id === "fixture-task-4");
  const walked = fake(parseWorkspace(JSON.stringify(state)));
  await walked.board.connect();
  assert.deepEqual(
    (await walked.board.candidates(new Set(["fixture-task-3"]))).map(
      (candidate) => candidate.referenceId,
    ),
    ["4", "5"],
  );
  if (subtask) subtask.status = "done";
  const after = fake(parseWorkspace(JSON.stringify(state)));
  await after.board.connect();
  assert.deepEqual(
    (
      await after.board.candidates(
        new Set(["fixture-task-3", "fixture-task-4"]),
      )
    ).map((candidate) => candidate.referenceId),
    ["5"],
  );
});

test("a task's direct dependents are its links and its subtasks", () => {
  const state = ready();
  assert.deepEqual([...directDependents(state, "fixture-task-3")].sort(), [
    "fixture-task-4",
    "fixture-task-5",
  ]);
  assert.deepEqual([...directDependents(state, "fixture-task-7")].sort(), [
    "fixture-task-3",
    "fixture-task-8",
  ]);
  assert.deepEqual([...directDependents(state, "fixture-task-6")], []);
});

test("a claim names the agent and the runner and nothing else", async () => {
  const directed = fake(ready());
  await directed.board.connect();
  await directed.board.claim("fixture-task-7", "ada", 5);
  const claims = directed.calls.filter((call) => call.name === "claim_task");
  assert.deepEqual(claims[0].args, {
    workspace_id: "11111111-1111-4111-8111-111111111111",
    task_id: "fixture-task-7",
    agent: "ada",
    runner: "runner-one",
    lease_minutes: 5,
  });
});

test("the owner's locks drop the empty ones and name who may take them", () => {
  const locked: HeartbeatReply = {
    leases: [],
    locks: [
      {
        task_id: "fixture-task-4",
        agent: "rex",
        since: "2026-09-16T00:02:00.000Z",
      },
      { task_id: "", agent: null, since: "2026-09-16T00:00:00.000Z" },
      {
        task_id: "fixture-task-7",
        agent: null,
        since: "2026-09-16T00:01:00.000Z",
      },
    ],
    ping_requested_at: null,
    ping_answered_at: null,
    server_time: "2026-09-16T00:03:00.000Z",
  };
  assert.deepEqual(
    ownLocks(locked).map((lock) => lock.task_id),
    ["fixture-task-4", "fixture-task-7"],
  );
  assert.deepEqual(ownLocks(undefined), []);
  assert.equal(lockedTo({ agent: null }, "ada"), true);
  assert.equal(lockedTo({ agent: "ada" }, "ada"), true);
  assert.equal(lockedTo({ agent: "rex" }, "ada"), false);
});

test("pending requests arrive oldest first whatever order the reply had", () => {
  const reply: HeartbeatReply = {
    leases: [],
    requests: [
      {
        request_id: "b",
        task_id: "fixture-task-4",
        agent: "codex",
        kind: "merge",
        requested_at: "2026-09-16T00:02:00.000Z",
      },
      {
        request_id: "a",
        task_id: "fixture-task-7",
        agent: "",
        kind: "pull",
        requested_at: "2026-09-16T00:01:00.000Z",
      },
    ],
    ping_requested_at: null,
    ping_answered_at: null,
    server_time: "2026-09-16T00:03:00.000Z",
  };
  assert.deepEqual(
    pendingRequests(reply).map((request) => request.request_id),
    ["a", "b"],
  );
  assert.deepEqual(pendingRequests(undefined), []);
  assert.deepEqual(pendingRequests({ ...reply, requests: undefined }), []);
});

test("the runner pins the workspace it was given and never the active one", async () => {
  const named = fake(ready());
  await named.board.connect("Everyday");
  assert.deepEqual(named.pinned, ["22222222-2222-4222-8222-222222222222"]);
  assert.equal(
    named.board.workspace().id,
    "22222222-2222-4222-8222-222222222222",
  );
  assert.equal(
    named.calls.some((call) => call.name === "set_active_workspace"),
    false,
  );

  const catalog = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Wireal",
      repositoryUrl: "",
      revision: 1,
      isActive: false,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Everyday",
      repositoryUrl: "",
      revision: 1,
      isActive: true,
    },
  ];
  assert.equal(chooseWorkspace(catalog).id, catalog[1].id);
  assert.equal(chooseWorkspace(catalog, "wireal").id, catalog[0].id);
  assert.equal(
    chooseWorkspace(catalog, "11111111-1111-4111-8111-111111111111").id,
    catalog[0].id,
  );
  assert.throws(() => chooseWorkspace(catalog, "Product"), /Unknown workspace/);
  assert.throws(
    () =>
      chooseWorkspace(
        [catalog[0], { ...catalog[1], name: "Wireal" }],
        "Wireal",
      ),
    /Ambiguous workspace/,
  );
  assert.throws(() => chooseWorkspace([]), /No Wireal workspace/);
});

test("the closing entry is one terse sentence with the outcome word first", () => {
  assert.equal(
    closingText(
      {
        ok: true,
        durationMs: 32_400,
        costUsd: 0.6142,
        model: "claude-fable-5-1",
      },
      "done",
      true,
    ),
    "Done in 32 s for $0.61 on claude-fable-5-1.",
  );
  assert.equal(
    closingText(
      {
        ok: true,
        durationMs: 32_400,
        costUsd: 0.6142,
        model: "claude-fable-5-1",
        windows: {
          fiveHour: { start: 42, end: 47 },
          sevenDay: { start: 18, end: 19 },
        },
      },
      "done",
      true,
    ),
    "Done in 32 s for $0.61 on claude-fable-5-1. 5h 42→47%, 7d 18→19%.",
  );
  assert.equal(
    closingText({ ok: true, durationMs: 372_000 }, "done", true),
    "Done in 6 min 12 s.",
  );
  assert.equal(
    closingText({ ok: true, durationMs: 300_000 }, "done", true),
    "Done in 5 min.",
  );
  assert.equal(closingText({ ok: false }, "abandoned", true), "Abandoned.");
  assert.equal(closingText({ ok: false }, "blocked", true), "Blocked.");
});

test("a silent agent lends its last message, stripped of markdown and capped", () => {
  const markdown = [
    "## Summary",
    "",
    "**Done.** Added `formatPercent` to the runner and wired it in.",
    "",
    "| file | change |",
    "| --- | --- |",
    "| ui.ts | new helper |",
    "",
    "- Ran `npm test`",
  ].join("\n");
  assert.equal(
    closingText(
      { ok: true, durationMs: 32_000, summary: markdown },
      "done",
      false,
    ),
    "Done in 32 s. Summary Done.",
  );
  assert.equal(
    closingText(
      { ok: true, durationMs: 32_000, summary: markdown },
      "done",
      true,
    ),
    "Done in 32 s.",
  );
  assert.equal(
    closingText(
      { ok: false, error: "The agent never started." },
      "abandoned",
      false,
    ),
    "Abandoned. The agent never started.",
  );
  assert.equal(
    stripMarkdown("Called **add_task_activity** with [the commit](http://x)."),
    "Called add_task_activity with the commit.",
  );
  assert.equal(firstSentence("x".repeat(400)), "x".repeat(199) + "…");
  assert.equal(
    firstSentence("```\nnpm test\n```\nShipped it. And more."),
    "Shipped it.",
  );
});

test("an activity the agent wrote during the run stands in for the runner's own", () => {
  const state = ready();
  const task = state.tasks.find(
    (candidate) => candidate.id === "fixture-task-7",
  );
  task?.activity.unshift({
    id: "activity-runner",
    text: "Added the guard and its tests in abc1234.",
    at: "2026-09-16T00:10:00.000Z",
    author: "Claude · studio 1",
    authorType: "ai",
    kind: "change",
  });
  assert.equal(
    agentReported(state, "fixture-task-7", "2026-09-16T00:09:00.000Z"),
    true,
  );
  assert.equal(
    agentReported(state, "fixture-task-7", "2026-09-16T00:11:00.000Z"),
    false,
  );
  assert.equal(agentReported(state, "fixture-task-7"), false);
  assert.equal(
    agentReported(state, "fixture-task-4", "2026-09-16T00:09:00.000Z"),
    false,
  );
});

const reportKind = "report" as ActivityKind;

test("an upstream summary is the agent's report, never the runner's own lines", async () => {
  const state = ready();
  const upstream = state.tasks.find((task) => task.id === "fixture-task-3");
  upstream?.activity.unshift(
    {
      id: "report-1",
      text: "Done: built the workspace\nWhere: src/workspace.ts",
      at: "2026-09-16T01:00:00.000Z",
      author: "Claude 3",
      authorType: "ai",
      kind: reportKind,
    },
    {
      id: "closing-1",
      text: "Done in 4 min for $0.31.",
      at: "2026-09-16T01:01:00.000Z",
      author: "Claude 3",
      authorType: "ai",
    },
    {
      id: "merge-1",
      text: "Merged into main as 1234567",
      at: "2026-09-16T01:02:00.000Z",
      author: "Claude 3",
      authorType: "ai",
      kind: "change",
      commit: "1234567890abcdef1234567890abcdef12345678",
    },
  );
  const board = fake(state).board;
  await board.connect();
  const fourth = (await board.candidates()).find(
    (candidate) => candidate.referenceId === "4",
  );
  assert.equal(
    fourth?.upstream[0].summary,
    "Done: built the workspace Where: src/workspace.ts",
  );
  assert.equal(
    upstreamReport({
      activity: [
        {
          id: "a",
          text: "Merged into main as 1234567",
          at: "2026-09-16T01:02:00.000Z",
          author: "Claude 3",
          authorType: "ai",
          kind: "change",
        },
        {
          id: "b",
          text: "  Moved the schema.  ",
          at: "2026-09-16T01:00:00.000Z",
          author: "Claude 3",
          authorType: "ai",
          kind: "change",
        },
      ],
    }),
    "Moved the schema.",
  );
  assert.equal(upstreamReport({ activity: [] }), "");
});

test("a report that names a blocker closes the task as blocked", async () => {
  const state = ready();
  const task = state.tasks.find(
    (candidate) => candidate.id === "fixture-task-7",
  );
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  const entry = (text: string) => ({
    id: `report-${text.length}`,
    text,
    at: new Date().toISOString(),
    author: "Claude 7",
    authorType: "ai" as const,
    kind: reportKind,
  });
  assert.equal(
    reportedBlocked(
      { activity: [entry("Done: nothing\nBlocked: none")] },
      startedAt,
    ),
    false,
  );
  assert.equal(
    reportedBlocked(
      { activity: [entry("Done: half\nBlocked: no API key")] },
      startedAt,
    ),
    true,
  );
  assert.equal(
    reportedBlocked({ activity: [entry("Blocked: no API key")] }, undefined),
    false,
  );
  task?.activity.unshift(
    entry("Done: half of it\nBlocked: the API has no key"),
  );
  const blocked = fake(state);
  await blocked.board.connect();
  assert.equal(
    await blocked.board.close(
      "fixture-task-7",
      { ok: true },
      "1234567890abcdef1234567890abcdef12345678",
      "Claude 7",
      startedAt,
    ),
    "blocked",
  );
});

test("presence rows older than ten minutes or without a task are nobody", () => {
  const now = Date.parse("2026-09-30T12:00:00.000Z");
  const rows = livePresence(
    {
      presence: [
        {
          user_name: "Grace",
          task_id: "t1",
          last_seen: "2026-09-30T11:55:00.000Z",
        },
        {
          user_name: "Old",
          task_id: "t2",
          last_seen: "2026-09-30T11:40:00.000Z",
        },
        {
          user_name: "Idle",
          task_id: null,
          last_seen: "2026-09-30T11:59:00.000Z",
        },
      ],
    },
    now,
  );
  assert.deepEqual(
    rows.map((row) => row.user_name),
    ["Grace"],
  );
  assert.deepEqual(livePresence(undefined), []);
  assert.deepEqual(livePresence({}), []);
});
