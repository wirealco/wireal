import assert from "node:assert/strict";
import test from "node:test";
import {
  agentLabel,
  agentRoster,
  agentState,
  agentWaiting,
  awaitingMerge,
  compareUrl,
  connectedRunners,
  cutsWork,
  folderState,
  lineBranch,
  lockReason,
  mergedCommit,
  formatCountdown,
  formatElapsed,
  formatPercent,
  leftOverAgent,
  peakWeeklyUsage,
  usageReadings,
  formatUsd,
  hostedKinds,
  kindRateLimits,
  isConnected,
  isWired,
  newAgentId,
  parseAgentDrag,
  parseAgentSpec,
  parseFlowRequest,
  parseRunner,
  parseTaskLock,
  ownsAgentSeat,
  ownsConnectedRunner,
  seatRunner,
  seatState,
  taskLock,
  pingOutcome,
  rateLimitTone,
  rateWindow,
  runnerKinds,
  pausePercent,
  secondsSince,
  wiredRunners,
  workingAgents,
  writeAgentDrag,
  type FlowRequest,
  type Runner,
  type TaskLock,
} from "./runners.ts";
import {
  defaultAgentSettings,
  type Activity,
  type AgentSpec,
  type Task,
} from "./domain.ts";

const now = Date.parse("2026-09-16T12:00:00.000Z");
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

const runner = (overrides: Partial<Runner> = {}): Runner =>
  parseRunner({
    runner_id: "runner-1",
    name: "Studio",
    host: "mac-studio",
    owner_id: "owner-1",
    owner_name: "Grace",
    since: ago(600),
    last_seen: ago(5),
    workspace_id: "workspace-1",
    workspace_name: "Wireal",
    hosts: ["claude", "codex"],
    agents: [
      {
        id: "ada",
        name: "Ada",
        kind: "claude",
        task_id: "task-1",
        since: ago(60),
        waiting: "",
      },
    ],
    rate_limits: null,
    cost_usd: 1.5,
    ping_requested_at: null,
    ping_answered_at: null,
    leases: [
      { task_id: "task-1", agent: "ada", since: ago(60), until: ago(-240) },
    ],
    ...overrides,
  });

test("reads a runner row and fills in what the backend left out", () => {
  const parsed = parseRunner({ runner_id: "runner-2", cost_usd: "2.25" });
  assert.equal(parsed.runner_id, "runner-2");
  assert.equal(parsed.name, "");
  assert.equal(parsed.cost_usd, 2.25);
  assert.deepEqual(parsed.agents, []);
  assert.deepEqual(parsed.leases, []);
  assert.equal(parsed.rate_limits, null);
  assert.equal(parsed.ping_answered_at, null);
  assert.deepEqual(parsed.hosts, []);
  assert.equal(parsed.workspace_name, "");
  const legacy = parseRunner({ agents: [{ agent: "codex" }] }).agents[0];
  assert.equal(legacy.id, "codex");
  assert.equal(legacy.name, "codex");
  assert.equal(legacy.kind, "codex");
  assert.equal(legacy.task_id, null);
  const rich = parseRunner({
    hosts: ["codex", "codex", "gemini", "claude"],
    agents: [{ id: "rex", name: "Rex", kind: "codex", task_id: "task-3" }],
  });
  assert.deepEqual(rich.hosts, ["codex", "claude"]);
  assert.deepEqual(rich.agents[0], {
    id: "rex",
    name: "Rex",
    kind: "codex",
    task_id: "task-3",
    since: "",
    waiting: "",
  });
  const held = parseRunner({
    agents: [
      {
        id: "ada",
        name: "Ada",
        kind: "claude",
        waiting: "Another agent is working in this project.",
      },
    ],
  });
  assert.equal(
    held.agents[0]?.waiting,
    "Another agent is working in this project.",
  );
});

test("reads rate windows with second, millisecond and ISO reset times", () => {
  const seconds = rateWindow(
    { five_hour: { used_percentage: 42.5, resets_at: 1_800_000_000 } },
    "five_hour",
  );
  assert.equal(seconds.usedPercentage, 42.5);
  assert.equal(seconds.resetsAt?.getTime(), 1_800_000_000_000);

  const milliseconds = rateWindow(
    { seven_day: { used_percentage: 91, resets_at: 1_800_000_000_123 } },
    "seven_day",
  );
  assert.equal(milliseconds.resetsAt?.getTime(), 1_800_000_000_123);
  assert.equal(
    rateWindow(
      { five_hour: { resets_at: "2026-09-16T14:00:00Z" } },
      "five_hour",
      Date.parse("2026-09-01T00:00:00Z"),
    ).resetsAt?.toISOString(),
    "2026-09-16T14:00:00.000Z",
  );
  assert.deepEqual(rateWindow(null, "five_hour"), {
    usedPercentage: null,
    resetsAt: null,
  });
  assert.deepEqual(
    rateWindow(
      { five_hour: { used_percentage: Number.NaN, resets_at: "nope" } },
      "five_hour",
    ),
    { usedPercentage: null, resetsAt: null },
  );
});

test("a window that has reset since it was reported reads as empty", () => {
  assert.deepEqual(
    rateWindow(
      { five_hour: { used_percentage: 92, resets_at: "2026-09-16T14:00:00Z" } },
      "five_hour",
      Date.parse("2026-09-17T00:00:00Z"),
    ),
    { usedPercentage: 0, resetsAt: null },
  );
});

test("splits the reported windows by the agent kind that captured them", () => {
  const both = runner({
    rate_limits: {
      captured_at: ago(10),
      five_hour: { used_percentage: 42 },
      source: "claude",
      by_kind: {
        claude: { captured_at: ago(10), five_hour: { used_percentage: 42 } },
        codex: { captured_at: ago(30), five_hour: { used_percentage: 7 } },
      },
    },
  });
  assert.equal(
    rateWindow(kindRateLimits(both, "claude"), "five_hour").usedPercentage,
    42,
  );
  assert.equal(
    rateWindow(kindRateLimits(both, "codex"), "five_hour").usedPercentage,
    7,
  );
  const missing = runner({
    rate_limits: {
      captured_at: ago(10),
      by_kind: {
        claude: { captured_at: ago(10), five_hour: { used_percentage: 42 } },
      },
    },
  });
  assert.equal(kindRateLimits(missing, "codex"), null);
  assert.equal(kindRateLimits(runner(), "claude"), null);
});

test("an older runner's single blob counts for the kind that captured it", () => {
  const flat = runner({
    rate_limits: {
      captured_at: ago(10),
      five_hour: { used_percentage: 42 },
      source: "claude",
    },
  });
  assert.equal(
    rateWindow(kindRateLimits(flat, "claude"), "five_hour").usedPercentage,
    42,
  );
  assert.equal(kindRateLimits(flat, "codex"), null);
  const unsigned = runner({
    hosts: ["codex"],
    rate_limits: { captured_at: ago(10), five_hour: { used_percentage: 11 } },
  });
  assert.equal(
    rateWindow(kindRateLimits(unsigned, "codex"), "five_hour").usedPercentage,
    11,
  );
  assert.equal(kindRateLimits(unsigned, "claude"), null);
  assert.equal(
    kindRateLimits(
      runner({
        hosts: [],
        rate_limits: { captured_at: ago(10) },
      }),
      "claude",
    )?.captured_at,
    ago(10),
  );
});

test("a runner's kinds are what it hosts, else what its agents are", () => {
  assert.deepEqual(runnerKinds(runner()), ["claude", "codex"]);
  assert.deepEqual(runnerKinds(runner({ hosts: [] })), ["claude"]);
  assert.deepEqual(runnerKinds(runner({ hosts: [], agents: [] })), []);
});

test("rate limit tones follow the usage thresholds", () => {
  assert.equal(rateLimitTone(null), "success");
  assert.equal(rateLimitTone(59.9), "success");
  assert.equal(rateLimitTone(60), "warning");
  assert.equal(rateLimitTone(84.9), "warning");
  assert.equal(rateLimitTone(85), "danger");
});

test("counts a runner as connected for two minutes after its last heartbeat", () => {
  assert.equal(isConnected(runner({ last_seen: ago(5) }), now), true);
  assert.equal(isConnected(runner({ last_seen: ago(119) }), now), true);
  assert.equal(isConnected(runner({ last_seen: ago(121) }), now), false);
  assert.equal(isConnected(runner({ last_seen: "" }), now), false);
  assert.equal(isConnected(runner({ last_seen: ago(-3) }), now), true);
});

test("working agents come from connected runners that hold a task", () => {
  const live = runner();
  const idle = runner({
    runner_id: "runner-2",
    agents: [
      {
        id: "rex",
        name: "Rex",
        kind: "codex",
        task_id: null,
        since: ago(10),
        waiting: "",
      },
    ],
  });
  const stale = runner({
    runner_id: "runner-3",
    last_seen: ago(600),
    agents: [
      {
        id: "ada",
        name: "Ada",
        kind: "claude",
        task_id: "task-9",
        since: ago(600),
        waiting: "",
      },
    ],
  });
  const runners = [live, idle, stale];
  assert.deepEqual(
    connectedRunners(runners, now).map((item) => item.runner_id),
    ["runner-1", "runner-2"],
  );
  const working = workingAgents(runners, now);
  assert.equal(working.length, 1);
  assert.equal(working[0].runner.runner_id, "runner-1");
  assert.equal(working[0].agent.task_id, "task-1");
});

test("a ping is waiting, answered or timed out", () => {
  const request = { at: ago(4), startedAt: now - 4000 };
  assert.deepEqual(pingOutcome(runner(), null, now), { state: "idle" });
  assert.deepEqual(pingOutcome(runner(), request, now), {
    state: "waiting",
    seconds: 4,
  });
  assert.deepEqual(
    pingOutcome(runner({ ping_answered_at: ago(2) }), request, now),
    { state: "answered", seconds: 2 },
  );
  assert.deepEqual(
    pingOutcome(runner({ ping_answered_at: ago(400) }), request, now),
    { state: "waiting", seconds: 4 },
  );
  assert.deepEqual(
    pingOutcome(runner(), { at: ago(31), startedAt: now - 31_000 }, now),
    { state: "timeout", seconds: 30 },
  );
});

test("reports how long ago a runner was seen", () => {
  assert.equal(secondsSince(ago(12), now), 12);
  assert.equal(secondsSince(ago(-5), now), 0);
  assert.equal(secondsSince("not a time", now), null);
});

test("spend reads as money", () => {
  assert.equal(formatUsd(0), "$0.00");
  assert.equal(formatUsd(12.345), "$12.35");
  assert.equal(formatUsd(Number.NaN), "$0.00");
});

test("percentages round to whole numbers", () => {
  assert.equal(formatPercent(54.4), "54%");
  assert.equal(formatPercent(54.5), "55%");
  assert.equal(formatPercent(0.49), "0%");
});

test("percentages stay between zero and one hundred", () => {
  assert.equal(formatPercent(-12), "0%");
  assert.equal(formatPercent(130.7), "100%");
  assert.equal(formatPercent(100), "100%");
});

test("reads a flow request row and fills in what the backend left out", () => {
  const parsed = parseFlowRequest({
    request_id: "req-1",
    task_id: "task-2",
    requested_by: "user-1",
    requested_at: ago(30),
  });
  assert.equal(parsed.request_id, "req-1");
  assert.equal(parsed.task_id, "task-2");
  assert.equal(parsed.agent, "");
  assert.equal(parsed.requested_by_name, "");
  assert.equal(parsed.requested_at, ago(30));
  assert.equal(parseFlowRequest(null).request_id, "");
});

test("an empty roster stays empty and names read as brands", () => {
  assert.deepEqual(agentRoster(defaultAgentSettings), []);
  assert.deepEqual(agentRoster({ ...defaultAgentSettings, roster: [] }), []);
  const rex: AgentSpec = {
    id: "rex",
    name: "Rex",
    kind: "codex",
    enabled: true,
  };
  assert.deepEqual(agentRoster({ ...defaultAgentSettings, roster: [rex] }), [
    rex,
  ]);
  assert.equal(agentLabel(rex), "Codex · Rex");
  assert.equal(agentLabel({ kind: "claude", name: "Claude" }), "Claude");
  assert.equal(agentLabel({ kind: "claude", name: "  " }), "Claude");
  assert.equal(agentLabel({ kind: "claude", name: "Ada" }), "Claude · Ada");
  assert.equal(
    agentLabel({ kind: "claude", name: "Studio · Claude 2" }),
    "Studio · Claude 2",
  );
  // A runner's own agents are named neutrally; their kind is a tag.
  assert.equal(
    agentLabel({ kind: "codex", name: "Studio 2", runner: "studio" }),
    "Studio 2",
  );
  assert.equal(
    agentLabel({ kind: "codex", name: "Claudette" }),
    "Codex · Claudette",
  );
  assert.notEqual(newAgentId(), newAgentId());
});

test("an agent spec keeps the runner that provisioned it", () => {
  assert.equal(
    parseAgentSpec({ id: "r1-claude-1", kind: "claude", runner: "studio" })
      .runner,
    "studio",
  );
  assert.equal(parseAgentSpec({ kind: "claude" }).runner, undefined);
});

test("an agent spec fills in what the editor left out", () => {
  const spec = parseAgentSpec({ kind: "codex", model: "  ", brief: " go " });
  assert.equal(spec.kind, "codex");
  assert.equal(spec.name, "Codex");
  assert.equal(spec.model, undefined);
  assert.equal(spec.brief, "go");
  assert.equal(spec.enabled, true);
  assert.ok(spec.id);
  assert.equal(parseAgentSpec({ kind: "gemini" }).kind, "claude");
  assert.equal(parseAgentSpec({ enabled: false }).enabled, false);
  assert.equal(
    parseAgentSpec({ model: "  provider/model:exact  " }).model,
    "provider/model:exact",
  );
  assert.equal(parseAgentSpec({ model: "m".repeat(81) }).model, "m".repeat(80));
});

test("hosted kinds come from the connected runners only", () => {
  const stale = runner({
    runner_id: "runner-9",
    last_seen: ago(600),
    hosts: ["codex"],
  });
  assert.deepEqual(hostedKinds([runner({ hosts: ["claude"] }), stale], now), [
    "claude",
  ]);
  assert.deepEqual(hostedKinds([stale], now), []);
});

test("an idle agent carries the reason the runner was given", () => {
  const held = runner({
    agents: [
      {
        id: "ada",
        name: "Ada",
        kind: "claude",
        task_id: null,
        since: ago(10),
        waiting: "Another agent is working in this project.",
      },
    ],
  });
  assert.equal(
    agentWaiting({ id: "ada" }, [held], now),
    "Another agent is working in this project.",
  );
  const busy = runner({
    agents: [
      {
        id: "ada",
        name: "Ada",
        kind: "claude",
        task_id: "task-1",
        since: ago(10),
        waiting: "Another agent is working in this project.",
      },
    ],
  });
  assert.equal(agentWaiting({ id: "ada" }, [busy], now), "");
  const stale = runner({ last_seen: ago(600) });
  assert.equal(agentWaiting({ id: "ada" }, [stale], now), "");
  assert.equal(agentWaiting({ id: "rex" }, [held], now), "");
});

test("an agent is working, paused, offline, locked or idle", () => {
  const ada: AgentSpec = {
    id: "ada",
    name: "Ada",
    kind: "claude",
    enabled: true,
  };
  const rex: AgentSpec = {
    id: "rex",
    name: "Rex",
    kind: "codex",
    enabled: true,
  };
  const busy = agentState(ada, [runner()], [], now);
  assert.equal(busy.state, "working");
  assert.equal(busy.state === "working" && busy.taskId, "task-1");
  assert.equal(
    busy.state === "working" && busy.runner.workspace_name,
    "Wireal",
  );
  assert.deepEqual(agentState(rex, [runner()], [], now), { state: "idle" });
  assert.deepEqual(
    agentState({ ...rex, enabled: false }, [runner()], [], now),
    {
      state: "paused",
    },
  );
  assert.deepEqual(agentState(rex, [runner({ hosts: ["claude"] })], [], now), {
    state: "offline",
  });
  assert.deepEqual(agentState(rex, [], [], now), { state: "offline" });
  assert.deepEqual(
    agentState(
      rex,
      [runner()],
      [parseTaskLock({ task_id: "task-4", agent: "rex" })],
      now,
    ),
    { state: "locked", taskId: "task-4" },
  );
});

test("a lease keeps an agent working when the heartbeat has not caught up", () => {
  const ada: AgentSpec = {
    id: "ada",
    name: "Ada",
    kind: "claude",
    enabled: false,
  };
  const lagging = runner({ agents: [] });
  const state = agentState(ada, [lagging], [], now);
  assert.equal(state.state, "working");
  assert.equal(state.state === "working" && state.taskId, "task-1");
});

test("a mode switch cuts work only when it changes and agents are working", () => {
  assert.equal(cutsWork("automatic", "paused", 2), true);
  assert.equal(cutsWork("automatic", "directed", 1), true);
  assert.equal(cutsWork("paused", "automatic", 1), true);
  assert.equal(cutsWork("automatic", "automatic", 2), false);
  assert.equal(cutsWork("automatic", "paused", 0), false);
});

test("an agent drag carries the roster id and rejects anything else", () => {
  const drag = { agent: "ada", runnerId: "runner-1" };
  assert.deepEqual(parseAgentDrag(writeAgentDrag(drag)), drag);
  assert.deepEqual(parseAgentDrag(writeAgentDrag({ agent: "rex" })), {
    agent: "rex",
    runnerId: "",
  });
  assert.equal(parseAgentDrag('{"runnerId":"runner-2"}'), null);
  assert.equal(parseAgentDrag("a task name"), null);
  assert.equal(parseAgentDrag(""), null);
});

test("a workspace is wired only by a connected runner bound to it", () => {
  const here = runner();
  const stale = runner({ runner_id: "runner-2", last_seen: ago(600) });
  const elsewhere = runner({
    runner_id: "runner-3",
    workspace_id: "workspace-2",
    workspace_name: "Landing",
  });
  assert.equal(isWired([here], "workspace-1", now), true);
  assert.equal(isWired([stale], "workspace-1", now), false);
  assert.equal(isWired([elsewhere], "workspace-1", now), false);
  assert.equal(isWired([stale, elsewhere, here], "workspace-1", now), true);
  assert.equal(isWired([here], "", now), false);
  assert.equal(isWired([], "workspace-1", now), false);
  assert.deepEqual(
    wiredRunners([stale, elsewhere, here], "workspace-1", now).map(
      (entry) => entry.runner_id,
    ),
    ["runner-1"],
  );
});

test("a per-agent pause reads as a whole percent between 50 and 100", () => {
  assert.equal(pausePercent(80), 80);
  assert.equal(pausePercent("80.4"), 80);
  assert.equal(pausePercent(10), 50);
  assert.equal(pausePercent(140), 100);
  assert.equal(pausePercent(""), undefined);
  assert.equal(pausePercent("  "), undefined);
  assert.equal(pausePercent(null), undefined);
  assert.equal(parseAgentSpec({ pauseAbovePercent: 92 }).pauseAbovePercent, 92);
  assert.equal(parseAgentSpec({}).pauseAbovePercent, undefined);
});

const entry = (text: string, commit?: string): Activity => ({
  id: `activity-${text.length}-${commit ?? ""}`,
  text,
  at: ago(30),
  author: "Ada",
  authorType: "ai",
  ...(commit ? { commit } : {}),
});

const task = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  referenceId: "17",
  name: "Merge policy",
  projectIds: [],
  commitUrls: [],
  status: "done",
  objective: "",
  labels: [],
  parentId: null,
  position: { x: 0, y: 0 },
  activity: [],
  ...overrides,
});

const request = (overrides: Partial<FlowRequest> = {}): FlowRequest =>
  parseFlowRequest({
    request_id: "request-1",
    task_id: "task-1",
    agent: "",
    kind: "merge",
    requested_by: "owner-1",
    requested_by_name: "Grace",
    requested_at: ago(5),
    ...overrides,
  });

test("a request carries its kind, and anything unknown reads as a merge", () => {
  assert.equal(parseFlowRequest({ kind: "merge" }).kind, "merge");
  assert.equal(parseFlowRequest({ kind: "pull" }).kind, "pull");
  assert.equal(parseFlowRequest({}).kind, "merge");
  assert.equal(parseFlowRequest({ kind: "run" }).kind, "merge");
});

test("the merged activity names the commit main now carries", () => {
  assert.equal(mergedCommit(task()), null);
  assert.equal(
    mergedCommit(
      task({ activity: [entry("Merged into main as 4f2c9ab", "4f2c9ab1e")] }),
    ),
    "4f2c9ab1e",
  );
  assert.equal(
    mergedCommit(task({ activity: [entry("Merged into main as 4f2c9ab")] })),
    "4f2c9ab",
  );
  assert.equal(
    mergedCommit(task({ activity: [entry("Pushed to wireal/17")] })),
    null,
  );
});

test("a task is awaiting a merge only while a merge request stands", () => {
  assert.equal(awaitingMerge(task(), []), false);
  assert.equal(awaitingMerge(task(), [request()]), true);
  assert.equal(awaitingMerge(task(), [request({ kind: "pull" })]), false);
  assert.equal(awaitingMerge(task(), [request({ task_id: "task-2" })]), false);
});

test("a line branch is named after the task that opened it", () => {
  assert.equal(lineBranch(task()), "wireal/17");
  assert.equal(
    compareUrl("https://github.com/example/repo", "wireal/17"),
    "https://github.com/example/repo/compare/main...wireal/17?expand=1",
  );
  assert.equal(
    compareUrl("https://github.com/example/repo/", "wireal/17"),
    "https://github.com/example/repo/compare/main...wireal/17?expand=1",
  );
  assert.equal(compareUrl("", "wireal/17"), "");
  assert.equal(
    compareUrl("https://github.com/example/repo", "wireal/17", "agents"),
    "https://github.com/example/repo/compare/agents...wireal/17?expand=1",
  );
});

test("the folder a wired runner watches reports its branch, dirt and drift", () => {
  assert.equal(parseRunner({}).folder, null);
  assert.deepEqual(parseRunner({ folder: { behind: "3.4" } }).folder, {
    branch: "",
    dirty: false,
    ahead: 0,
    behind: 3,
    upstream: "",
    path: "",
  });
  assert.deepEqual(
    parseRunner({
      folder: { branch: "main", ahead: 2, behind: 0, upstream: "origin/main" },
    }).folder,
    {
      branch: "main",
      dirty: false,
      ahead: 2,
      behind: 0,
      upstream: "origin/main",
      path: "",
    },
  );
  assert.equal(folderState([runner()], "workspace-1", now), null);
  const clean = runner({
    folder: {
      branch: "main",
      dirty: false,
      ahead: 0,
      behind: 0,
      upstream: "origin/main",
      path: "~/code/wireal",
    },
  });
  const behind = runner({
    runner_id: "runner-6",
    name: "Laptop",
    folder: {
      branch: "main",
      dirty: false,
      ahead: 0,
      behind: 2,
      upstream: "origin/main",
      path: "~/laptop/wireal",
    },
  });
  const dirty = runner({
    runner_id: "runner-7",
    folder: {
      branch: "main",
      dirty: true,
      ahead: 0,
      behind: 0,
      upstream: "origin/main",
      path: "~/code/wireal",
    },
  });
  assert.deepEqual(folderState([clean], "workspace-1", now), {
    runnerId: "runner-1",
    runnerName: "Studio",
    branch: "main",
    dirty: false,
    ahead: 0,
    behind: 0,
    upstream: "origin/main",
    path: "~/code/wireal",
  });
  assert.equal(
    folderState([clean, behind, dirty], "workspace-1", now)?.runnerId,
    "runner-6",
  );
  assert.equal(
    folderState([clean, dirty], "workspace-1", now)?.runnerId,
    "runner-7",
  );
  assert.equal(folderState([behind], "workspace-2", now), null);
  assert.equal(
    folderState(
      [
        runner({
          last_seen: ago(600),
          folder: {
            branch: "main",
            dirty: false,
            ahead: 0,
            behind: 4,
            upstream: "origin/main",
            path: "~/code/wireal",
          },
        }),
      ],
      "workspace-1",
      now,
    ),
    null,
  );
});

test("reads a task lock row and fills in what the backend left out", () => {
  const parsed = parseTaskLock({
    workspace_id: "workspace-1",
    task_id: "task-1",
    agent: "ada",
    owner_id: "owner-1",
    owner_name: "Grace",
    since: ago(30),
  });
  assert.deepEqual(parsed, {
    workspace_id: "workspace-1",
    task_id: "task-1",
    agent: "ada",
    owner_id: "owner-1",
    owner_name: "Grace",
    since: ago(30),
  });
  assert.equal(parseTaskLock({ task_id: "task-2" }).agent, null);
  assert.equal(parseTaskLock({ task_id: "task-2", agent: "" }).agent, null);
  assert.equal(parseTaskLock(null).task_id, "");
  const locks: TaskLock[] = [parsed];
  assert.equal(taskLock(locks, "task-1")?.owner_name, "Grace");
  assert.equal(taskLock(locks, "task-9"), null);
});

test("a runner reports the seats it holds, and a stale one holds none", () => {
  assert.deepEqual(parseRunner({}).seats, []);
  assert.deepEqual(
    parseRunner({ seats: [{ agent_id: "ada", since: ago(60) }, {}] }).seats,
    [{ agent_id: "ada", since: ago(60) }],
  );
  const seated = runner({ seats: [{ agent_id: "ada", since: ago(60) }] });
  assert.equal(seatRunner([seated], "ada", now)?.runner_id, "runner-1");
  assert.equal(seatRunner([seated], "rex", now), null);
  assert.equal(seatRunner([seated], "", now), null);
  assert.equal(
    seatRunner(
      [runner({ last_seen: ago(600), seats: seated.seats })],
      "ada",
      now,
    ),
    null,
  );
});

test("a seat reads as seated, picked, held or free for its runner", () => {
  assert.deepEqual(parseRunner({}).wanted, []);
  assert.deepEqual(parseRunner({ wanted: ["ada", "ada", 7] }).wanted, ["ada"]);
  const mine = runner({
    wanted: ["ada", "rex", "kit"],
    seats: [{ agent_id: "ada", since: ago(60) }],
  });
  const theirs = runner({
    runner_id: "runner-2",
    name: "Laptop",
    owner_id: "owner-2",
    owner_name: "Dilay",
    seats: [
      { agent_id: "rex", since: ago(60) },
      { agent_id: "zoe", since: ago(60) },
    ],
  });
  const fleet = [mine, theirs];
  assert.deepEqual(seatState(fleet, mine, "ada", now), { state: "seated" });
  assert.deepEqual(seatState(fleet, mine, "rex", now), {
    state: "picked",
    holder: theirs,
  });
  assert.deepEqual(seatState(fleet, mine, "kit", now), {
    state: "picked",
    holder: null,
  });
  assert.deepEqual(seatState(fleet, mine, "zoe", now), {
    state: "held",
    holder: theirs,
  });
  assert.deepEqual(seatState(fleet, mine, "new", now), { state: "free" });
  assert.deepEqual(seatState(fleet, mine, "", now), { state: "free" });
  const stale = runner({ ...theirs, last_seen: ago(600) });
  assert.deepEqual(seatState([mine, stale], mine, "zoe", now), {
    state: "free",
  });
});

test("a blocked lock says whether a runner is missing or bound elsewhere", () => {
  const mine = runner({});
  const theirs = runner({
    runner_id: "runner-2",
    owner_id: "owner-2",
    owner_name: "Dilay",
  });
  const elsewhere = runner({
    runner_id: "runner-3",
    name: "Laptop",
    workspace_id: "workspace-2",
  });
  assert.equal(lockReason([mine], "workspace-1", "owner-1", now), null);
  assert.deepEqual(lockReason([theirs], "workspace-1", "owner-1", now), {
    reason: "needRunner",
  });
  assert.deepEqual(lockReason([elsewhere], "workspace-1", "owner-1", now), {
    reason: "runnerElsewhere",
    name: "Laptop",
  });
  assert.deepEqual(
    lockReason(
      [runner({ runner_id: "runner-4", last_seen: ago(600) })],
      "workspace-1",
      "owner-1",
      now,
    ),
    { reason: "needRunner" },
  );
  assert.deepEqual(lockReason([elsewhere], "workspace-1", "", now), {
    reason: "needRunner",
  });
});

test("only the owner of the runner holding a seat may direct that agent", () => {
  const mine = runner({ seats: [{ agent_id: "ada", since: ago(60) }] });
  const theirs = runner({
    runner_id: "runner-2",
    owner_id: "owner-2",
    owner_name: "Dilay",
    seats: [{ agent_id: "rex", since: ago(60) }],
  });
  assert.equal(ownsAgentSeat([mine, theirs], "ada", "owner-1", now), true);
  assert.equal(ownsAgentSeat([mine, theirs], "rex", "owner-1", now), false);
  assert.equal(ownsAgentSeat([mine, theirs], "kit", "owner-1", now), false);
  assert.equal(ownsAgentSeat([mine, theirs], "ada", "", now), false);
  assert.equal(
    ownsConnectedRunner([mine, theirs], "workspace-1", "owner-1", now),
    true,
  );
  assert.equal(
    ownsConnectedRunner([theirs], "workspace-1", "owner-1", now),
    false,
  );
  assert.equal(
    ownsConnectedRunner([mine], "workspace-2", "owner-1", now),
    false,
  );
});

test("usage is read per CLI from live runners only, and the peak is the fullest week", () => {
  const busy = runner({
    hosts: ["claude", "codex"],
    rate_limits: {
      by_kind: {
        claude: {
          five_hour: { used_percentage: 38, resets_at: now + 3_600_000 },
          seven_day: { used_percentage: 61, resets_at: now + 86_400_000 },
        },
        codex: {
          seven_day: { used_percentage: 72.5, resets_at: now + 86_400_000 },
        },
      },
      captured_at: ago(30),
    },
  });
  const stale = runner({
    runner_id: "runner-2",
    last_seen: ago(600),
    hosts: ["claude"],
    rate_limits: {
      source: "claude",
      seven_day: { used_percentage: 99 },
    },
  });
  const readings = usageReadings([busy, stale], now);
  assert.deepEqual(
    readings.map((reading) => [
      reading.kind,
      reading.fiveHour.usedPercentage,
      reading.weekly.usedPercentage,
    ]),
    [
      ["claude", 38, 61],
      ["codex", null, 72.5],
    ],
  );
  assert.equal(readings[0].capturedAt, now - 30_000);
  assert.equal(peakWeeklyUsage([busy, stale], now), 72.5);
  assert.equal(peakWeeklyUsage([stale], now), null);
  assert.equal(peakWeeklyUsage([runner({ rate_limits: null })], now), null);
});

test("an elapsed timer ticks in seconds and a reset counts down in two units", () => {
  assert.equal(formatElapsed(ago(42), now), "0:42");
  assert.equal(formatElapsed(ago(12 * 60 + 5), now), "12:05");
  assert.equal(formatElapsed(ago(3723), now), "1:02:03");
  assert.equal(formatElapsed(ago(-5), now), "0:00");
  assert.equal(formatElapsed("", now), "");
  assert.equal(formatCountdown(null, now), "");
  assert.equal(formatCountdown(new Date(now + 20_000), now), "1m");
  assert.equal(formatCountdown(new Date(now + 45 * 60_000), now), "45m");
  assert.equal(formatCountdown(new Date(now + 130 * 60_000), now), "2h 10m");
  assert.equal(formatCountdown(new Date(now + 3 * 3_600_000), now), "3h");
  assert.equal(formatCountdown(new Date(now + 76 * 3_600_000), now), "3d 4h");
  assert.equal(formatCountdown(new Date(now + 48 * 3_600_000), now), "2d");
});

test("an agent is left over once no live runner brings it", () => {
  const live = runner();
  const gone = runner({ runner_id: "runner-2", last_seen: ago(600) });
  assert.equal(
    leftOverAgent({ runner: "runner-1" }, [live], false, now),
    false,
  );
  assert.equal(leftOverAgent({ runner: "runner-2" }, [gone], false, now), true);
  assert.equal(leftOverAgent({ runner: "runner-9" }, [live], false, now), true);
  assert.equal(leftOverAgent({}, [live], false, now), true);
  assert.equal(leftOverAgent({}, [live], true, now), false);
});
