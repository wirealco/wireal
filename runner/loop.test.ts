import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  parseWorkspace,
  type AgentMode,
  type AgentSettings,
  type AgentSpec,
  type Workspace,
} from "../src/domain.ts";
import { testWorkspace } from "../src/test-workspace.ts";
import type { AgentOptions, AgentResult, McpProxy } from "./agents/types.ts";
import type { LeaseRow } from "./api.ts";
import {
  Board,
  type BoardClient,
  type Candidate,
  type FlowRequest,
  type Lock,
  type Presence,
} from "./board.ts";
import {
  addressedHere,
  agentActivity,
  crewLine,
  pauseNote,
  presenceLeases,
  sanitizedLine,
  run,
  shortPath,
  skipReason,
  type LoopParts,
  type RunOptions,
} from "./loop.ts";
import { reset, type Screen } from "./screen.ts";
import { crewAgentId, legacyAgentId, type CrewSeat } from "./crew.ts";
import type { Ui, View } from "./ui.ts";
import type { Worktree } from "./worktree.ts";

const proxy: McpProxy = {
  name: "wirealrunner",
  command: "/usr/bin/node",
  args: ["--import", "/loader.mjs", "/runner/mcp-stdio.ts"],
  configPath: join(tmpdir(), "wireal-mcp-test.json"),
};
const mergeCommit = "1111111222222233333334444444555555566666";
const promoteCommit = "7777777888888899999990000000aaaaaaabbbb";
const worktree: Worktree = {
  path: "/repo/.wirealruns/7",
  branch: "wireal/7",
  base: "main",
};
const repository = "https://github.com/wireal/wireal";

function workable(state: Workspace): Workspace {
  for (const project of state.projects) project.repositoryUrl = repository;
  for (const task of state.tasks)
    task.objective = task.objective || `Finish ${task.name}.`;
  return state;
}

const fixture = () => {
  const state = workable(parseWorkspace(JSON.stringify(testWorkspace)));
  state.map.agents = {
    mode: "automatic",
    leaseMinutes: 5,
    roster: [
      {
        id: "ada",
        name: "Claude",
        kind: "claude",
        enabled: true,
      },
    ],
  };
  return state;
};

function board(
  state: Workspace,
  requests: FlowRequest[] = [],
  onClaim: () => void = () => {},
  leases: LeaseRow[] = [],
  reply: {
    seats?: string[];
    wanted?: string[];
    locks?: Lock[];
    presence?: Presence[];
  } = {},
  identity = { id: "runner-one", name: "Ada's laptop" },
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let current = state;
  let pending = requests;
  const held = new Set<string>();
  const unlocked = new Set<string>();
  const client: BoardClient = {
    read: async () => ({
      workspace: current,
      revision: 2,
      workspaceId: "11111111-1111-4111-8111-111111111111",
    }),
    command: async <T>(name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "claim_task") {
        onClaim();
        held.add(String(args.task_id));
      }
      if (name === "release_task") held.delete(String(args.task_id));
      if (name === "complete_request")
        pending = pending.filter(
          (request) => request.request_id !== args.request_id,
        );
      const reported = (args.agents as { id: string }[] | undefined) ?? [];
      const replies: Record<string, unknown> = {
        runner_heartbeat: {
          leases: [...held]
            .filter((taskId) => !unlocked.has(taskId))
            .map((taskId) => ({
              task_id: taskId,
              until: new Date(Date.now() + 300_000).toISOString(),
            })),
          seats: reply.seats ?? reported.map((agent) => agent.id),
          wanted:
            reply.wanted ?? reply.seats ?? reported.map((agent) => agent.id),
          locks: (
            reply.locks ??
            current.tasks.map((task) => ({ task_id: task.id, agent: null }))
          ).filter((lock) => !unlocked.has(lock.task_id)),
          requests: pending,
          ...(reply.presence ? { presence: reply.presence } : {}),
          ping_requested_at: null,
          ping_answered_at: null,
          server_time: new Date().toISOString(),
        },
        claim_task: { task_id: String(args.task_id), until: "" },
        release_task: { released: true },
        set_runner_seats: { seats: args.agents, taken: [] },
        complete_request: { completed: true },
        runner_leave: { left: true },
      };
      return replies[name] as T;
    },
    mutate: async <T>(
      change: (state: Workspace) => { state: Workspace; value: T },
    ) => {
      const changed = change(current);
      current = parseWorkspace(JSON.stringify(changed.state));
      return { value: changed.value, revision: 3 };
    },
  };
  return {
    calls,
    state: () => current,
    /** Changes the workspace the way another client would. */
    edit: (change: (state: Workspace) => void) => {
      const next = structuredClone(current);
      change(next);
      current = next;
    },
    unlocked,
    board: new Board(
      {
        workspaces: async () => [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: state.map.name,
            repositoryUrl: state.map.repositoryUrl,
            revision: 2,
            isActive: true,
          },
        ],
        pinned: () => client,
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
      identity,
      "studio.example.com",
    ),
  };
}

const quiet = (): Ui => ({ update: () => {}, log: () => {}, stop: () => {} });

function modal(mode: AgentMode, over: Partial<AgentSettings> = {}): Workspace {
  const state = fixture();
  state.map.agents = {
    ...state.map.agents!,
    mode,
    ...over,
  };
  return state;
}

function finished(state: Workspace, ...ids: string[]): Workspace {
  for (const task of state.tasks)
    if (ids.includes(task.id)) task.status = "done";
  return state;
}

const ada = (over: Partial<AgentSpec> = {}): AgentSpec => ({
  id: "ada",
  name: "Ada",
  kind: "claude",
  enabled: true,
  ...over,
});

const rex = (over: Partial<AgentSpec> = {}): AgentSpec => ({
  id: "rex",
  name: "Rex",
  kind: "codex",
  enabled: true,
  ...over,
});

const request = (over: Partial<FlowRequest> = {}): FlowRequest => ({
  request_id: "request-1",
  task_id: "fixture-task-7",
  agent: "",
  kind: "merge",
  requested_at: "2026-09-16T00:00:00.000Z",
  ...over,
});

const committed = async () => ({
  commit: "abc123def4567890abc123def4567890abc123de",
  pushed: false,
});

const closed = (state: Workspace, taskId: string) =>
  state.tasks
    .find((candidate) => candidate.id === taskId)
    ?.activity.find((entry) => !entry.text.startsWith("Merged into main"));

const claimed = (calls: { name: string; args: Record<string, unknown> }[]) =>
  calls
    .filter((call) => call.name === "claim_task")
    .map((call) => call.args.task_id);

function parts(over: Partial<LoopParts>): LoopParts {
  return {
    board: board(fixture()).board,
    ui: quiet,
    proxy: () => proxy,
    repository: async () => repository,
    start: () => ({ done: Promise.resolve({ ok: true }), stop: () => {} }),
    open: async () => worktree,
    commit: async () => ({ commit: "", pushed: false }),
    remove: async () => {},
    checks: async () => undefined,
    merge: async () => ({ merged: true, commit: mergeCommit }),
    branchOf: async () => "wireal/7",
    base: async (_repo, wanted) => wanted || "main",
    catchUp: async () => "",
    promote: async () => ({
      promoted: true,
      commit: promoteCommit,
      tasks: ["7"],
    }),
    folder: async () => ({
      branch: "main",
      dirty: false,
      ahead: 0,
      behind: 0,
      upstream: "origin/main",
    }),
    pull: async () => ({ pulled: true, reason: "Folder pulled" }),
    hosts: () => ["claude", "codex"],
    browser: async () => ({ ready: true, downloaded: false, reason: "" }),
    deps: async () => ({ linked: true, built: false, reason: "" }),
    awake: () => ({ held: () => true, why: "test", release: () => {} }),
    named: () => "",
    usage: async () => ({}),
    usageEvery: () => 60_000,
    keep: () => {},
    peers: () => {},
    interval: 20,
    signals: false,
    ...over,
  };
}

const options = (over: Partial<RunOptions> = {}): RunOptions => ({
  repo: "/repo",
  once: true,
  cap: 1,
  crew: { each: 0 },
  ...over,
});

test("a runner with no agent slots heartbeats once and leaves cleanly", async () => {
  const board0 = board(fixture());
  await run(options({ cap: 0 }), parts({ board: board0.board }));
  assert.deepEqual(
    [...new Set(board0.calls.map((call) => call.name))],
    ["runner_heartbeat", "runner_leave"],
  );
  assert.equal(board0.calls.at(-1)?.name, "runner_leave");
  assert.equal(
    board0.calls.filter((call) => call.name === "claim_task").length,
    0,
  );
});

test("a runner started with no agents and no hand-made ones idles and claims nothing", async () => {
  const empty = board(modal("automatic", { roster: [] }));
  const notes: string[] = [];
  await run(
    options(),
    parts({
      board: empty.board,
      ui: () => ({
        update: () => {},
        log: (text) => notes.push(text),
        stop: () => {},
      }),
    }),
  );
  assert.ok(notes.includes("No agents: this runner runs none, + adds one"));
  assert.equal(
    empty.calls.filter((call) => call.name === "claim_task").length,
    0,
  );
  assert.equal(
    empty.calls.filter((call) => call.name === "runner_heartbeat").length,
    1,
  );
});

test("the screen hears the startup steps, the feed, each CLI's limits and the browser fetch", async () => {
  const views: View[] = [];
  const resets = "2026-09-30T20:00:00.000Z";
  await run(
    options({ cap: 0 }),
    parts({
      board: board(fixture()).board,
      hosts: () => ["claude"],
      usage: async () => ({
        limits: {
          five_hour: { used_percentage: 30, resets_at: resets },
          seven_day: { used_percentage: 64 },
          captured_at: "2026-09-30T18:00:00.000Z",
        },
      }),
      browser: async () => {
        await new Promise((ready) => setTimeout(ready, 0));
        return { ready: true, downloaded: true, reason: "" };
      },
      ui: () => ({
        update: (view) => views.push(structuredClone({ ...view, slots: [] })),
        log: () => {},
        stop: () => {},
      }),
    }),
  );
  await new Promise((ready) => setTimeout(ready, 5));

  assert.deepEqual(views[0].starting, [
    { text: "Connecting to Wireal", state: "doing" },
  ]);
  assert.equal(views[0].workspace, "");
  const booted = views.filter((view) => view.starting).at(-1);
  assert.deepEqual(
    booted?.starting?.map((step) => step.state),
    ["done", "done", "done", "done"],
  );
  assert.match(booted?.starting?.[0].text ?? "", /^bound to /);
  assert.equal(booted?.starting?.[1].text, "0 agents");
  const last = views.at(-1) as View;
  assert.equal(last.starting, undefined);
  assert.deepEqual(last.usage, [
    {
      kind: "claude",
      fiveHour: 30,
      sevenDay: 64,
      fiveHourReset: Date.parse(resets),
      sevenDayReset: undefined,
      at: last.usage?.[0].at,
    },
  ]);
  assert.equal(typeof last.usage?.[0].at, "number");
  assert.ok(
    views.some((view) =>
      view.feed?.some(
        (line) => line.pending && /^Readying the browser/.test(line.text),
      ),
    ),
  );
  const said = (last.feed ?? []).map((line) => line.text);
  assert.ok(said.includes("starting"));
  assert.ok(said.includes("Cached the browser agents take screenshots with"));
  assert.ok(!last.feed?.some((line) => line.pending));
});

test("a working slot keeps a screen buffer of what its agent drew", async () => {
  const running = board(fixture());
  const seen: (Screen | undefined)[] = [];
  let preview: string[] = [];
  await run(
    options(),
    parts({
      board: running.board,
      ui: () => ({
        update: (state) => seen.push(state.slots[0]?.screen),
        log: () => {},
        stop: () => {},
      }),
      start: () => {
        const data = new Set<(chunk: string) => void>();
        const say = (chunk: string) => {
          for (const listen of [...data]) listen(chunk);
        };
        return {
          done: (async () => {
            await new Promise((ready) => setTimeout(ready, 0));
            say("Reading runner/ui.ts\r\n");
            say("Working 1s");
            say(`\rWorking 2s ${String.fromCharCode(27)}[32mdone`);
            const screen = seen.filter(Boolean).at(-1);
            await screen?.settled();
            preview = screen ? screen.lines(4, 20) : [];
            return { ok: true };
          })(),
          stop: () => {},
          pty: {
            write: () => {},
            resize: () => {},
            onData: (listen) => {
              data.add(listen);
              return () => data.delete(listen);
            },
          },
        };
      },
    }),
  );

  assert.equal(seen[0], undefined);
  assert.equal(seen.at(-1), seen.filter(Boolean)[0]);
  assert.deepEqual(preview, [
    "Reading runner/ui.ts",
    `Working 2s ${String.fromCharCode(27)}[32mdone${reset}     `,
  ]);
});

test("a claimed task runs in its worktree and closes with the commit and the cost", async () => {
  const running = board(fixture());
  const spawned: AgentOptions[] = [];
  const messages: string[] = [];
  const result: AgentResult = {
    ok: true,
    summary: "Set up authentication end to end.",
    costUsd: 0.5,
    inputTokens: 1200,
    outputTokens: 340,
    model: "claude-opus-5",
    durationMs: 9000,
  };
  await run(
    options(),
    parts({
      board: running.board,
      start: (agent, agentOptions) => {
        spawned.push(agentOptions);
        agentOptions.onLine("Write runner/cli.ts");
        return { done: Promise.resolve(result), stop: () => {} };
      },
      commit: async (repo, tree, message) => {
        messages.push(`${repo} ${tree.branch} ${message}`);
        return {
          commit: "abc123def4567890abc123def4567890abc123de",
          pushed: true,
        };
      },
    }),
  );

  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].cwd, worktree.path);
  assert.equal(spawned[0].agentName, "Claude");
  assert.match(spawned[0].prompt, /^Task 7: Set up authentication/);
  assert.match(spawned[0].prompt, /Work only in \/repo\/\.wirealruns\/7 /);
  assert.deepEqual(messages, ["/repo wireal/7 Task 7: Set up authentication"]);

  const names = running.calls.map((call) => call.name);
  assert.ok(names.includes("runner_heartbeat"));
  assert.deepEqual(
    running.calls
      .filter((call) => call.name === "claim_task")
      .map((call) => call.args.task_id),
    ["fixture-task-7"],
  );
  assert.deepEqual(
    running.calls
      .filter((call) => call.name === "release_task")
      .map((call) => call.args.task_id),
    ["fixture-task-7"],
  );
  assert.equal(names.at(-1), "runner_leave");

  const task = running
    .state()
    .tasks.find((candidate) => candidate.id === "fixture-task-7");
  assert.equal(task?.status, "done");
  const entry = closed(running.state(), "fixture-task-7");
  assert.equal(
    entry?.text,
    "Done in 9 s for $0.50 on claude-opus-5. Set up authentication end to end.",
  );
  assert.equal(entry?.commit, "abc123def4567890abc123def4567890abc123de");
  assert.deepEqual(entry?.usage, {
    costUsd: 0.5,
    inputTokens: 1200,
    outputTokens: 340,
    model: "claude-opus-5",
    durationMs: 9000,
  });
});

test("an agent that cannot be started leaves the task open and released", async () => {
  const failing = board(fixture());
  await run(
    options(),
    parts({
      board: failing.board,
      open: async () => {
        throw new Error("git worktree add failed: branch is checked out");
      },
    }),
  );
  const task = failing
    .state()
    .tasks.find((candidate) => candidate.id === "fixture-task-7");
  assert.equal(task?.status, "todo");
  assert.match(task?.activity[0].text ?? "", /branch is checked out/);
  assert.equal(task?.activity[0].usage, undefined);
  assert.deepEqual(
    failing.calls
      .filter((call) => call.name === "release_task")
      .map((call) => call.args.task_id),
    ["fixture-task-7"],
  );
});

test("the pause line appears only once the five hour window is at or above the setting", () => {
  const limits = (used: number) => ({
    five_hour: { used_percentage: used, resets_at: 1789525800 },
    captured_at: "2026-09-16T00:00:09.000Z",
    source: "claude",
  });
  assert.equal(pauseNote(limits(91), undefined), "");
  assert.equal(pauseNote(undefined, 90), "");
  assert.equal(pauseNote(limits(89.4), 90), "");
  assert.equal(
    pauseNote(limits(90), 90),
    "Paused: 5-hour window at 90% (limit 90%)",
  );
  assert.equal(
    pauseNote(limits(96.6), 90),
    "Paused: 5-hour window at 97% (limit 90%)",
  );
  assert.equal(pauseNote({ source: "claude" }, 90), "");
});

test("an agent pause limit overrides the workspace limit", async () => {
  const state = fixture();
  state.map.agents = {
    ...state.map.agents!,
    pauseAbovePercent: 99,
    roster: [
      {
        ...state.map.agents!.roster![0],
        pauseAbovePercent: 80,
      },
    ],
  };
  const paused = board(parseWorkspace(JSON.stringify(state)));
  const limits = {
    five_hour: { used_percentage: 94, resets_at: 1789525800 },
    seven_day: { used_percentage: 43, resets_at: 1789974000 },
    captured_at: "2026-09-16T00:00:09.000Z",
    source: "claude",
  };
  const notes: string[] = [];
  await run(
    options({ once: false }),
    parts({
      board: paused.board,
      ui: (onQuit) => ({
        update: () => {},
        log: (text) => {
          notes.push(text);
          if (text.startsWith("Paused")) onQuit();
        },
        stop: () => {},
      }),
      start: (agent, agentOptions) => {
        agentOptions.onStatus?.({ costUsd: 0.5, rateLimits: limits });
        return {
          done: Promise.resolve({ ok: true, costUsd: 0.5 }),
          stop: () => {},
        };
      },
    }),
  );
  assert.ok(notes.includes("Paused: 5-hour window at 94% (limit 80%)"));
  assert.equal(
    paused.calls.filter((call) => call.name === "claim_task").length,
    1,
  );
  const beats = paused.calls.filter((call) => call.name === "runner_heartbeat");
  assert.deepEqual(beats.at(-1)?.args.rate_limits, {
    ...limits,
    by_kind: { claude: limits },
  });
  assert.equal(beats[0]?.args.rate_limits, undefined);
});

test("an agent without a pause limit uses the workspace limit", async () => {
  const state = fixture();
  state.map.agents = {
    ...state.map.agents!,
    pauseAbovePercent: 90,
  };
  const paused = board(parseWorkspace(JSON.stringify(state)));
  const limits = {
    five_hour: { used_percentage: 94, resets_at: 1789525800 },
    captured_at: "2026-09-16T00:00:09.000Z",
    source: "claude",
  };
  const notes: string[] = [];
  await run(
    options({ once: false }),
    parts({
      board: paused.board,
      ui: (onQuit) => ({
        update: () => {},
        log: (text) => {
          notes.push(text);
          if (text.startsWith("Paused")) onQuit();
        },
        stop: () => {},
      }),
      start: (agent, agentOptions) => {
        agentOptions.onStatus?.({ rateLimits: limits });
        return {
          done: Promise.resolve({ ok: true }),
          stop: () => {},
        };
      },
    }),
  );
  assert.ok(notes.includes("Paused: 5-hour window at 94% (limit 90%)"));
  assert.equal(
    paused.calls.filter((call) => call.name === "claim_task").length,
    1,
  );
});

test("one paused agent does not stop another agent from claiming", async () => {
  const state = finished(
    modal("automatic", {
      pauseAbovePercent: 99,
      roster: [ada({ pauseAbovePercent: 80 }), rex()],
    }),
    "fixture-task-2",
    "fixture-task-3",
  );
  const running = board(state);
  const limits = (used: number, source: string) => ({
    five_hour: { used_percentage: used },
    captured_at: "2026-09-16T00:00:09.000Z",
    source,
  });
  const spawned: string[] = [];
  let stop = () => {};
  await run(
    options({ cap: 2, once: false }),
    parts({
      board: running.board,
      ui: (onQuit) => {
        stop = onQuit;
        return quiet();
      },
      start: (agent, agentOptions) => {
        spawned.push(agentOptions.agentName);
        agentOptions.onStatus?.({
          rateLimits:
            agentOptions.agentName === "Claude · Ada"
              ? limits(90, "claude")
              : limits(50, "codex"),
        });
        if (spawned.length === 3) setTimeout(stop, 0).unref();
        return { done: Promise.resolve({ ok: true }), stop: () => {} };
      },
    }),
  );
  assert.deepEqual(
    running.calls
      .filter((call) => call.name === "claim_task")
      .map((call) => call.args.agent),
    ["ada", "rex", "rex"],
  );
  const beat = running.calls
    .filter((call) => call.name === "runner_heartbeat")
    .at(-1);
  assert.deepEqual(beat?.args.rate_limits, {
    ...limits(50, "codex"),
    by_kind: { claude: limits(90, "claude"), codex: limits(50, "codex") },
  });
});

test("the limits are read from each hosted CLI before any agent starts", async () => {
  const resting = board(fixture());
  const asked: string[] = [];
  const limits = (kind: string, at: string) => ({
    five_hour: { used_percentage: kind === "claude" ? 12 : 34 },
    captured_at: at,
    source: kind,
  });
  const claude = limits("claude", "2026-09-17T00:00:01.000Z");
  const codex = limits("codex", "2026-09-17T00:00:02.000Z");
  await run(
    options({ cap: 0 }),
    parts({
      board: resting.board,
      usage: async (kind) => {
        asked.push(kind);
        return { limits: kind === "claude" ? claude : codex };
      },
      start: () => assert.fail("no agent should start to read a limit"),
    }),
  );
  assert.deepEqual(asked.sort(), ["claude", "codex"]);
  const beat = resting.calls
    .filter((call) => call.name === "runner_heartbeat")
    .at(0);
  assert.deepEqual(beat?.args.rate_limits, {
    ...codex,
    by_kind: { claude, codex },
  });
});

test("a limit read off the CLI holds an agent back before it claims", async () => {
  const held = board(
    modal("automatic", { pauseAbovePercent: 80, roster: [ada()] }),
  );
  const limits = {
    five_hour: { used_percentage: 94 },
    captured_at: "2026-09-17T00:00:00.000Z",
    source: "claude",
  };
  const notes: string[] = [];
  await run(
    options({ once: false }),
    parts({
      board: held.board,
      hosts: () => ["claude"],
      usage: async () => ({ limits }),
      ui: (onQuit) => ({
        update: () => {},
        log: (text) => {
          notes.push(text);
          if (text.startsWith("Paused")) onQuit();
        },
        stop: () => {},
      }),
      start: () => assert.fail("a paused agent should not start"),
    }),
  );
  assert.ok(notes.includes("Paused: 5-hour window at 94% (limit 80%)"));
  assert.equal(
    held.calls.filter((call) => call.name === "claim_task").length,
    0,
  );
});

test("a signed out machine is told once and the runner stops waiting", async () => {
  const out = board(fixture());
  const revoked = new Error(
    "This machine's Wireal session was revoked. Run `wireal-run login` again.",
  );
  const notes: string[] = [];
  let beats = 0;
  const failing = Object.create(out.board) as typeof out.board;
  const asked = out.board.settings.bind(failing);
  failing.heartbeat = async () => {
    beats += 1;
    throw revoked;
  };
  failing.settings = async () => (beats ? Promise.reject(revoked) : asked());
  await run(
    options({ cap: 0, once: false }),
    parts({
      board: failing,
      ui: () => ({
        update: () => {},
        log: (text) => notes.push(text),
        stop: () => {},
      }),
      start: () => assert.fail("no agent should start"),
    }),
  );
  assert.equal(beats, 1);
  assert.equal(
    notes.filter((text) => text.includes("signed out of Wireal")).length,
    1,
  );
  assert.equal(
    notes.some((text) => text.startsWith("heartbeat failed")),
    false,
  );
});

test("a rename reaches the next heartbeat without the runner restarting", async () => {
  const renamed = board(fixture());
  let called = "";
  const notes: string[] = [];
  await run(
    options({ cap: 0, once: false }),
    parts({
      board: renamed.board,
      named: () => called,
      ui: (onQuit) => {
        setTimeout(() => {
          called = "Usage limits";
        }, 60).unref();
        setTimeout(onQuit, 220).unref();
        return {
          update: () => {},
          log: (text) => notes.push(text),
          stop: () => {},
        };
      },
    }),
  );
  const names = renamed.calls
    .filter((call) => call.name === "runner_heartbeat")
    .map((call) => call.args.name);
  assert.ok(names.includes("Usage limits"));
  assert.notEqual(names[0], "Usage limits");
  assert.ok(notes.includes("this runner is now called Usage limits"));
});

test("the limits a session reports are kept for the next runner to read", async () => {
  const kept: { kind: string; at: unknown }[] = [];
  const limits = {
    five_hour: { used_percentage: 44 },
    captured_at: "2026-09-17T09:30:00.000Z",
    source: "claude",
  };
  await run(
    options(),
    parts({
      keep: (kind, value) => kept.push({ kind, at: value.captured_at }),
      start: (agent, agentOptions) => {
        agentOptions.onStatus?.({ rateLimits: limits });
        agentOptions.onStatus?.({ rateLimits: limits });
        return { done: Promise.resolve({ ok: true }), stop: () => {} };
      },
    }),
  );
  assert.deepEqual(kept, [{ kind: "claude", at: "2026-09-17T09:30:00.000Z" }]);
});

test("a rate limited read waits it out and keeps showing the last figures", async () => {
  const waiting = board(fixture());
  const limits = {
    five_hour: { used_percentage: 7 },
    captured_at: "2026-09-17T09:00:00.000Z",
    source: "claude",
  };
  const notes: string[] = [];
  let calls = 0;
  await run(
    options({ cap: 0, once: false }),
    parts({
      board: waiting.board,
      hosts: () => ["claude"],
      usageEvery: () => 0,
      usage: async () => {
        calls += 1;
        return {
          limits,
          stale: true,
          waitMs: 3_600_000,
          error: "Claude is answering its limits once in a while",
        };
      },
      ui: (onQuit) => {
        setTimeout(onQuit, 200).unref();
        return {
          update: () => {},
          log: (text) => notes.push(text),
          stop: () => {},
        };
      },
      start: () => assert.fail("no agent should start"),
    }),
  );
  assert.equal(calls, 1);
  assert.equal(
    notes.filter((text) => text.includes("once in a while")).length,
    0,
  );
  const beat = waiting.calls
    .filter((call) => call.name === "runner_heartbeat")
    .at(-1);
  assert.deepEqual(beat?.args.rate_limits, {
    ...limits,
    by_kind: { claude: limits },
  });
});

test("a CLI that cannot answer is named once, not every round", async () => {
  const silent = board(fixture());
  const notes: string[] = [];
  let rounds = 0;
  let stop = () => {};
  await run(
    options({ cap: 0, once: false }),
    parts({
      board: silent.board,
      hosts: () => ["codex"],
      usageEvery: () => 0,
      usage: async () => {
        rounds += 1;
        if (rounds >= 3) setTimeout(stop, 0).unref();
        return { error: "Codex is not signed in on this machine" };
      },
      ui: (onQuit) => {
        stop = onQuit;
        return {
          update: () => {},
          log: (text) => notes.push(text),
          stop: () => {},
        };
      },
      start: () => assert.fail("no agent should start"),
    }),
  );
  assert.ok(rounds >= 3);
  assert.equal(
    notes.filter((text) => text.includes("not signed in")).length,
    1,
  );
});

test("the closing activity carries the cost and model the status line reported", async () => {
  const closing = board(fixture());
  await run(
    options(),
    parts({
      board: closing.board,
      start: () => ({
        done: Promise.resolve({
          ok: true,
          summary: "Wrote the parser.",
          costUsd: 0.0216478,
          durationMs: 6176,
          model: "claude-haiku-4-5-20251001",
          rateLimits: {
            source: "claude",
            captured_at: "2026-09-16T00:00:09.000Z",
          },
        }),
        stop: () => {},
      }),
      commit: async () => ({ commit: "abc123def4567890", pushed: false }),
    }),
  );
  assert.deepEqual(closed(closing.state(), "fixture-task-7")?.usage, {
    costUsd: 0.0216478,
    model: "claude-haiku-4-5-20251001",
    durationMs: 6176,
  });
});

test("the first session limits become the start and the last become the end", async () => {
  const closing = board(fixture());
  const limits = (fiveHour: number, sevenDay: number, second: number) => ({
    five_hour: { used_percentage: fiveHour },
    seven_day: { used_percentage: sevenDay },
    captured_at: `2026-09-16T00:00:${second}.000Z`,
    source: "claude",
  });
  await run(
    options(),
    parts({
      board: closing.board,
      start: (agent, agentOptions) => {
        agentOptions.onStatus?.({ rateLimits: limits(42, 18, 9) });
        agentOptions.onStatus?.({ rateLimits: limits(45, 18.5, 10) });
        return {
          done: Promise.resolve({
            ok: true,
            rateLimits: limits(47, 19, 11),
          }),
          stop: () => {},
        };
      },
      commit: committed,
    }),
  );
  assert.deepEqual(closed(closing.state(), "fixture-task-7")?.usage?.windows, {
    fiveHour: { start: 42, end: 47 },
    sevenDay: { start: 18, end: 19 },
  });
});

test("a later task starts from the freshest limits the runner already knew", async () => {
  const closing = board(modal("directed"));
  const limits = (fiveHour: number, sevenDay: number, second: number) => ({
    five_hour: { used_percentage: fiveHour },
    seven_day: { used_percentage: sevenDay },
    captured_at: `2026-09-16T00:00:${second}.000Z`,
    source: "claude",
  });
  let runs = 0;
  await run(
    options(),
    parts({
      board: closing.board,
      start: (agent, agentOptions) => {
        runs += 1;
        if (runs === 1) {
          agentOptions.onStatus?.({ rateLimits: limits(30, 10, 9) });
          return {
            done: Promise.resolve({
              ok: true,
              rateLimits: limits(32, 11, 10),
            }),
            stop: () => {},
          };
        }
        agentOptions.onStatus?.({ rateLimits: limits(36, 13, 11) });
        return {
          done: Promise.resolve({
            ok: true,
            rateLimits: limits(38, 14, 12),
          }),
          stop: () => {},
        };
      },
      commit: committed,
    }),
  );
  assert.deepEqual(closed(closing.state(), "fixture-task-8")?.usage?.windows, {
    fiveHour: { start: 32, end: 38 },
    sevenDay: { start: 11, end: 14 },
  });
});

test("a paused workspace keeps heartbeating and claims nothing", async () => {
  const held = board(modal("paused"));
  await run(options(), parts({ board: held.board }));
  const names = held.calls.map((call) => call.name);
  assert.ok(names.includes("runner_heartbeat"));
  assert.deepEqual(claimed(held.calls), []);
  assert.equal(names.at(-1), "runner_leave");
});

test("a runner passes over a task locked to an agent it does not host", async () => {
  const directed = board(
    finished(modal("directed"), "fixture-task-2", "fixture-task-3"),
    [],
    () => {},
    [],
    {
      locks: [
        { task_id: "fixture-task-4", agent: "codex" },
        { task_id: "fixture-task-7", agent: null },
      ],
    },
  );
  await run(options(), parts({ board: directed.board }));
  assert.deepEqual(claimed(directed.calls), ["fixture-task-7"]);
});

test("a directed agent follows the line and stops where the line ends", async () => {
  const following = board(modal("directed"));
  await run(options(), parts({ board: following.board, commit: committed }));
  assert.deepEqual(claimed(following.calls), [
    "fixture-task-7",
    "fixture-task-8",
  ]);
  const tasks = following.state().tasks;
  assert.equal(
    tasks.find((task) => task.id === "fixture-task-8")?.status,
    "done",
  );
});

test("a directed line comes back for the branch it walked past", async () => {
  const state = finished(modal("directed"), "fixture-task-2");
  const third = state.tasks.find((task) => task.id === "fixture-task-3");
  if (third) third.status = "todo";
  const branching = board(state);
  await run(options(), parts({ board: branching.board, commit: committed }));
  assert.deepEqual(claimed(branching.calls).sort(), [
    "fixture-task-3",
    "fixture-task-4",
    "fixture-task-5",
    "fixture-task-6",
    "fixture-task-7",
    "fixture-task-8",
  ]);
});

test("a directed line ends when the agent does not finish its task", async () => {
  const stopped = board(modal("directed"));
  await run(
    options(),
    parts({
      board: stopped.board,
      start: () => ({
        done: Promise.resolve({ ok: false, error: "killed" }),
        stop: () => {},
      }),
      commit: committed,
    }),
  );
  assert.deepEqual(claimed(stopped.calls), ["fixture-task-7"]);
  assert.equal(
    stopped.state().tasks.find((task) => task.id === "fixture-task-7")?.status,
    "todo",
  );
});

test("a claim another runner won first is tried again on the next loop", async () => {
  const contested = board(modal("directed", { roster: [ada()] }), [], () => {
    throw new Error("Agent is busy.");
  });
  const notes: string[] = [];
  await run(
    options({ once: false }),
    parts({
      board: contested.board,
      ui: (onQuit) => ({
        update: () => {},
        log: (text) => {
          notes.push(text);
          if (
            notes.filter((line) => line.includes("could not be claimed"))
              .length >= 2
          )
            setTimeout(onQuit, 20).unref();
        },
        stop: () => {},
      }),
    }),
  );
  const claims = claimed(contested.calls);
  assert.ok(claims.length >= 2);
  assert.equal(claims[0], "fixture-task-7");
  assert.equal(claims[1], "fixture-task-7");
});

test("an automatic runner gives each free agent the next task in launch order", async () => {
  const automatic = board(
    finished(
      modal("automatic", { roster: [ada(), rex()] }),
      "fixture-task-2",
      "fixture-task-3",
    ),
  );
  await run(options({ cap: 2 }), parts({ board: automatic.board }));
  assert.deepEqual(claimed(automatic.calls), [
    "fixture-task-7",
    "fixture-task-4",
  ]);
  assert.deepEqual(
    automatic.calls
      .filter((call) => call.name === "claim_task")
      .map((call) => call.args.agent),
    ["ada", "rex"],
  );
});

test("two ready tasks in the same project never run side by side", async () => {
  const state = finished(
    modal("automatic", { roster: [ada(), rex()] }),
    "fixture-task-2",
    "fixture-task-3",
  );
  for (const task of state.tasks)
    if (task.id === "fixture-task-7") task.projectIds = ["launchpad"];
  const crowded = board(state);
  await run(options({ cap: 2 }), parts({ board: crowded.board }));
  assert.deepEqual(claimed(crowded.calls), ["fixture-task-7"]);
});

test("a project another runner is already in is left alone", async () => {
  const elsewhere = board(
    finished(
      modal("automatic", { roster: [ada(), rex()] }),
      "fixture-task-2",
      "fixture-task-3",
    ),
    [],
    () => {},
    [
      {
        task_id: "fixture-task-5",
        agent: "zoe",
        until: "2099-01-01T00:00:00.000Z",
      },
    ],
  );
  await run(options({ cap: 2 }), parts({ board: elsewhere.board }));
  assert.deepEqual(claimed(elsewhere.calls), ["fixture-task-7"]);
});

test("an agent another runner is already using takes nothing here", async () => {
  const shared = board(
    finished(
      modal("automatic", { roster: [ada(), rex()] }),
      "fixture-task-2",
      "fixture-task-3",
    ),
    [],
    () => {},
    [
      {
        task_id: "fixture-task-5",
        agent: "ada",
        until: "2099-01-01T00:00:00.000Z",
      },
    ],
  );
  await run(options({ cap: 2 }), parts({ board: shared.board }));
  assert.deepEqual(
    shared.calls
      .filter((call) => call.name === "claim_task")
      .map((call) => [call.args.agent, call.args.task_id]),
    [["rex", "fixture-task-7"]],
  );
});

test("--agents caps how many of the roster run on this machine at once", async () => {
  const capped = board(
    finished(
      modal("automatic", { roster: [ada(), rex()] }),
      "fixture-task-2",
      "fixture-task-3",
    ),
  );
  await run(options({ cap: 1 }), parts({ board: capped.board }));
  assert.deepEqual(claimed(capped.calls), ["fixture-task-7"]);
});

test("each agent carries its own model, its brief and its name into the run", async () => {
  const roster = board(
    finished(
      modal("automatic", {
        roster: [
          ada({ model: "claude-opus-5", brief: "Write the tests first." }),
          rex({ model: "gpt-5-codex" }),
        ],
      }),
      "fixture-task-2",
      "fixture-task-3",
    ),
  );
  const spawned: [string, AgentOptions][] = [];
  await run(
    options({ cap: 2 }),
    parts({
      board: roster.board,
      start: (kind, agentOptions) => {
        spawned.push([kind, agentOptions]);
        return { done: Promise.resolve({ ok: true }), stop: () => {} };
      },
    }),
  );
  assert.deepEqual(
    spawned.map(([kind, run]) => [kind, run.agentName, run.model]),
    [
      ["claude", "Claude · Ada", "claude-opus-5"],
      ["codex", "Codex · Rex", "gpt-5-codex"],
    ],
  );
  assert.match(
    spawned[0][1].prompt,
    /\n\nWorking style: Write the tests first\.$/,
  );
  assert.equal(/Working style/.test(spawned[1][1].prompt), false);
});

test("one free seat goes to the agent a lock named, not the first in the roster", async () => {
  const queued = board(
    finished(
      modal("directed", { roster: [ada(), rex()] }),
      "fixture-task-2",
      "fixture-task-3",
    ),
    [],
    () => {},
    [],
    { locks: [{ task_id: "fixture-task-7", agent: "rex" }] },
  );
  await run(options({ cap: 1 }), parts({ board: queued.board }));
  assert.deepEqual(
    queued.calls
      .filter((call) => call.name === "claim_task")
      .map((call) => [call.args.agent, call.args.task_id]),
    [["rex", "fixture-task-7"]],
  );
});

test("a slot takes the task locked to its agent and leaves the rest", async () => {
  const directed = board(
    finished(
      modal("directed", { roster: [ada(), rex()] }),
      "fixture-task-2",
      "fixture-task-3",
    ),
    [],
    () => {},
    [],
    { locks: [{ task_id: "fixture-task-7", agent: "rex" }] },
  );
  const spawned: string[] = [];
  await run(
    options({ cap: 2 }),
    parts({
      board: directed.board,
      start: (kind, agentOptions) => {
        spawned.push(agentOptions.agentName);
        return { done: Promise.resolve({ ok: true }), stop: () => {} };
      },
    }),
  );
  assert.deepEqual(
    directed.calls
      .filter((call) => call.name === "claim_task")
      .map((call) => [call.args.agent, call.args.task_id]),
    [["rex", "fixture-task-7"]],
  );
  assert.deepEqual(spawned, ["Codex · Rex"]);
});

test("an agent is enrolled only once the server seats it here", async () => {
  const unseated = board(fixture(), [], () => {}, [], {
    seats: [],
    wanted: ["ada"],
  });
  const notes: string[] = [];
  await run(
    options(),
    parts({
      board: unseated.board,
      ui: () => ({
        update: () => {},
        log: (text) => notes.push(text),
        stop: () => {},
      }),
    }),
  );
  assert.deepEqual(claimed(unseated.calls), []);
  assert.ok(notes.includes("No agent is seated on this runner"));
  assert.deepEqual(
    (
      unseated.calls.find((call) => call.name === "runner_heartbeat")?.args
        .agents as { id: string }[]
    ).map((agent) => agent.id),
    ["ada"],
  );
});

test("the heartbeat reports every enabled roster agent and names what another runner holds", async () => {
  const picked = board(
    modal("automatic", { roster: [ada(), rex()] }),
    [],
    () => {},
    [],
    { seats: ["ada"], wanted: ["ada", "rex"] },
  );
  const notes: string[] = [];
  await run(
    options({ cap: 2 }),
    parts({
      board: picked.board,
      ui: () => ({
        update: () => {},
        log: (text) => notes.push(text),
        stop: () => {},
      }),
    }),
  );
  assert.deepEqual(
    (
      picked.calls.find((call) => call.name === "runner_heartbeat")?.args
        .agents as { id: string }[]
    ).map((agent) => agent.id),
    ["ada", "rex"],
  );
  assert.ok(notes.includes("Rex is held by another runner"));
});

test("a runner with nothing seated says so", async () => {
  const idlePick = board(fixture(), [], () => {}, [], {
    seats: [],
    wanted: [],
  });
  const notes: string[] = [];
  await run(
    options(),
    parts({
      board: idlePick.board,
      ui: () => ({
        update: () => {},
        log: (text) => notes.push(text),
        stop: () => {},
      }),
    }),
  );
  assert.ok(notes.includes("No agent is seated on this runner"));
});

test("a task unlocked in the app stops the agent and leaves its branch", async () => {
  let settle: (result: AgentResult) => void = () => {};
  let stopped = false;
  const running = board(fixture(), [], () =>
    running.unlocked.add("fixture-task-7"),
  );
  const notes: string[] = [];
  const removed: string[] = [];
  await run(
    options({ once: false }),
    parts({
      board: running.board,
      start: () => ({
        done: new Promise<AgentResult>((done) => {
          settle = done;
        }),
        stop: () => {
          stopped = true;
          settle({ ok: false, error: "stopped" });
        },
      }),
      remove: async (repo, tree) => {
        removed.push(tree.branch);
      },
      ui: (onQuit) => ({
        update: () => {},
        log: (text) => {
          notes.push(text);
          if (text.includes("was unlocked in the app"))
            setTimeout(onQuit, 60).unref();
        },
        stop: () => {},
      }),
    }),
  );
  assert.equal(stopped, true);
  assert.ok(
    notes.some((note) =>
      /^WRL·7 was unlocked in the app, .+ stopped$/.test(note),
    ),
    notes.join("\n"),
  );
  assert.ok(
    notes.includes("WRL·7 partial work stays on wireal/7, worktree kept"),
    notes.join("\n"),
  );
  assert.deepEqual(removed, []);
  assert.deepEqual(claimed(running.calls), ["fixture-task-7"]);
  assert.equal(
    running.calls.filter((call) => call.name === "release_task").length,
    0,
  );
  assert.equal(
    running
      .state()
      .tasks.find((task) => task.id === "fixture-task-7")
      ?.activity.some((entry) => entry.text.startsWith("Abandoned")),
    false,
  );
});

test("an agent no runner on this machine can host stays out of the roster's turn", async () => {
  const codexOnly = board(
    finished(
      modal("automatic", { roster: [ada(), rex()] }),
      "fixture-task-2",
      "fixture-task-3",
    ),
  );
  await run(
    options({ cap: 2 }),
    parts({ board: codexOnly.board, hosts: () => ["codex"] }),
  );
  assert.deepEqual(
    codexOnly.calls
      .filter((call) => call.name === "claim_task")
      .map((call) => call.args.agent),
    ["rex"],
  );
});

test("a task in another repository and a task with no objective are skipped", () => {
  const candidate = (over: Partial<Candidate> = {}): Candidate => ({
    id: "fixture-task-7",
    referenceId: "7",
    name: "Set up authentication",
    objective: "Finish the login flow.",
    projectIds: ["core-api"],
    busy: [],
    projects: [{ name: "Core API", repositoryUrl: repository, folders: [] }],
    upstream: [],
    ...over,
  });
  assert.equal(skipReason(candidate(), repository), "");
  assert.equal(
    skipReason(
      candidate({
        projects: [
          {
            name: "Site",
            repositoryUrl: "https://github.com/acme/site",
            folders: [],
          },
        ],
      }),
      repository,
    ),
    "belongs to acme/site",
  );
  assert.equal(
    skipReason(candidate({ projects: [] }), repository),
    "no repository",
  );
  assert.equal(
    skipReason(candidate({ objective: "   " }), repository),
    "no objective",
  );
  assert.equal(skipReason(candidate({ objective: "" }), ""), "no objective");
  assert.equal(
    skipReason(
      candidate({
        objective: "",
        review: { text: "The heading is wrong.", by: "Grace" },
      }),
      repository,
    ),
    "",
  );
  assert.equal(
    skipReason(candidate({ busy: ["Core API"] }), repository),
    "another agent is in Core API",
  );
  assert.equal(
    skipReason(
      candidate({
        projects: [
          { name: "Core API", repositoryUrl: repository, folders: [] },
          {
            name: "Site",
            repositoryUrl: "https://github.com/acme/site",
            folders: [],
          },
        ],
      }),
      repository,
    ),
    "",
  );
});

test("a runner passes over tasks that belong to another repository", async () => {
  const state = finished(fixture(), "fixture-task-2", "fixture-task-3");
  for (const project of state.projects)
    if (project.id !== "core-api")
      project.repositoryUrl = "https://github.com/acme/site";
  const guarded = board(state);
  const notes: string[] = [];
  const views: string[][] = [];
  await run(
    options({ cap: 2 }),
    parts({
      board: guarded.board,
      ui: () => ({
        update: (view) =>
          views.push(
            view.skipped.map((task) => `${task.reference} ${task.reason}`),
          ),
        log: (text) => notes.push(text),
        stop: () => {},
      }),
    }),
  );
  assert.deepEqual(claimed(guarded.calls), ["fixture-task-7"]);
  assert.deepEqual(
    notes.filter((text) => text.includes("skipped")),
    ["4 skipped: belongs to acme/site", "5 skipped: belongs to acme/site"],
  );
  assert.deepEqual(views.at(-1), [
    "4 belongs to acme/site",
    "5 belongs to acme/site",
  ]);
});

test("a task nobody wrote an objective for is skipped and never started", async () => {
  const state = fixture();
  for (const task of state.tasks) task.objective = "";
  const empty = board(state);
  const notes: string[] = [];
  await run(
    options(),
    parts({
      board: empty.board,
      ui: () => ({
        update: () => {},
        log: (text) => notes.push(text),
        stop: () => {},
      }),
    }),
  );
  assert.deepEqual(claimed(empty.calls), []);
  assert.deepEqual(
    notes.filter((text) => text.includes("skipped")),
    ["7 skipped: no objective"],
  );
});

test("a locked task that is not runnable is skipped and claimed by nobody", async () => {
  const state = modal("directed");
  const seventh = state.tasks.find((task) => task.id === "fixture-task-7");
  if (seventh) seventh.objective = "";
  const pending = board(state, [], () => {}, [], {
    locks: [{ task_id: "fixture-task-7", agent: null }],
  });
  const notes: string[] = [];
  await run(
    options({ once: false }),
    parts({
      board: pending.board,
      ui: (onQuit) => ({
        update: () => {},
        log: (text) => {
          notes.push(text);
          if (text.includes("skipped")) setTimeout(onQuit, 120).unref();
        },
        stop: () => {},
      }),
    }),
  );
  assert.deepEqual(claimed(pending.calls), []);
  assert.deepEqual(
    notes.filter((text) => text.includes("skipped")),
    ["7 skipped: no objective"],
  );
  assert.ok(
    pending.calls.filter((call) => call.name === "runner_heartbeat").length > 2,
  );
});

test("the agent's own MCP proxy is pinned to the workspace the runner chose", async () => {
  const pinned = board(fixture());
  const proxies: string[] = [];
  await run(
    options(),
    parts({
      board: pinned.board,
      proxy: (agentName, workspaceId) => {
        proxies.push(`${agentName} ${workspaceId}`);
        return proxy;
      },
    }),
  );
  assert.deepEqual(proxies, ["Claude 11111111-1111-4111-8111-111111111111"]);
});

test("a line keeps one branch across both its tasks and merges once, naming both", async () => {
  const following = board(modal("directed"));
  const opened: string[] = [];
  const messages: string[] = [];
  const removed: string[] = [];
  const merges: string[] = [];
  await run(
    options(),
    parts({
      board: following.board,
      open: async (repo, reference) => {
        opened.push(`${repo} ${reference}`);
        return worktree;
      },
      commit: async (repo, tree, message) => {
        messages.push(`${tree.branch} ${message}`);
        return { commit: `${tree.branch} head`, pushed: true };
      },
      remove: async (repo, tree) => {
        removed.push(tree.branch);
      },
      merge: async (repo, tree, message) => {
        merges.push(`${tree.branch} ${message}`);
        return { merged: true, commit: mergeCommit };
      },
    }),
  );
  assert.deepEqual(opened, ["/repo 7"]);
  assert.deepEqual(messages, [
    "wireal/7 Task 7: Set up authentication",
    "wireal/7 Task 8: Prototype movement",
  ]);
  assert.deepEqual(
    merges,
    ["wireal/7 Merge wireal/7, 8"],
    "the line's merge names every task it carried, not only the first",
  );
  assert.deepEqual(removed, ["wireal/7"]);
  assert.equal(
    following.state().tasks.find((task) => task.id === "fixture-task-8")
      ?.activity[0].text,
    "Merged into main as 1111111",
  );
});

test("a merge waits for the checks and runs them in the line's worktree", async () => {
  const merging = board(modal("automatic"));
  const order: string[] = [];
  await run(
    options({ checks: ["npm test"] }),
    parts({
      board: merging.board,
      commit: committed,
      checks: async (commands, cwd) => {
        order.push(`checks ${commands.join(", ")} in ${cwd}`);
        return undefined;
      },
      merge: async (repo, tree, message) => {
        order.push(`merge ${message}`);
        return { merged: true, commit: mergeCommit };
      },
      pull: async () => {
        order.push("pull");
        return { pulled: true, reason: "Folder pulled" };
      },
    }),
  );
  assert.deepEqual(order, [
    `checks npm test in ${worktree.path}`,
    "merge Merge wireal/7: Set up authentication",
    "pull",
  ]);
  assert.equal(
    closed(merging.state(), "fixture-task-7")?.text.startsWith("Done"),
    true,
  );
  const merged = merging
    .state()
    .tasks.find((task) => task.id === "fixture-task-7")?.activity[0];
  assert.equal(merged?.text, "Merged into main as 1111111");
  assert.equal(merged?.commit, mergeCommit);
  assert.equal(merged?.kind, "change");
});

test("a failing check leaves the branch and records the blocker that names it", async () => {
  const failing = board(modal("automatic"));
  let merged = false;
  await run(
    options({ checks: ["npm test"] }),
    parts({
      board: failing.board,
      commit: committed,
      checks: async () => ({
        command: "npm test",
        code: 1,
        output: "1 failing",
      }),
      merge: async () => {
        merged = true;
        return { merged: true, commit: mergeCommit };
      },
    }),
  );
  assert.equal(merged, false);
  const entry = failing
    .state()
    .tasks.find((task) => task.id === "fixture-task-7")?.activity[0];
  assert.equal(
    entry?.text,
    "Checks failed on wireal/7, so it stays a branch: npm test exited 1",
  );
  assert.equal(entry?.kind, "blocker");
});

test("a conflicting merge leaves the branch and names the conflicting files", async () => {
  const stuck = board(fixture());
  let pulled = false;
  await run(
    options(),
    parts({
      board: stuck.board,
      commit: committed,
      merge: async () => ({
        merged: false,
        conflicts: ["src/domain.ts", "runner/loop.ts"],
        error: "Automatic merge failed",
      }),
      pull: async () => {
        pulled = true;
        return { pulled: true, reason: "Folder pulled" };
      },
    }),
  );
  const entry = stuck.state().tasks.find((task) => task.id === "fixture-task-7")
    ?.activity[0];
  assert.equal(
    entry?.text,
    "wireal/7 conflicts with main, so it stays a branch: src/domain.ts, runner/loop.ts",
  );
  assert.equal(entry?.kind, "blocker");
  assert.equal(pulled, false);
});

test("the branch policy commits and pushes the branch without merging it", async () => {
  const branching = board(modal("automatic", { mergePolicy: "branch" }));
  let merged = false;
  await run(
    options(),
    parts({
      board: branching.board,
      commit: committed,
      merge: async () => {
        merged = true;
        return { merged: true, commit: mergeCommit };
      },
    }),
  );
  assert.equal(merged, false);
  assert.equal(
    branching.state().tasks.find((task) => task.id === "fixture-task-7")
      ?.activity[0].text,
    "Done.",
  );
});

test("the folder is left alone after a merge when it has uncommitted changes", async () => {
  const dirty = board(fixture());
  const reasons: string[] = [];
  await run(
    options(),
    parts({
      board: dirty.board,
      commit: committed,
      folder: async () => ({
        branch: "main",
        dirty: true,
        ahead: 0,
        behind: 2,
        upstream: "origin/main",
      }),
      pull: async (repo, state) => {
        assert.equal(state.dirty, true);
        return { pulled: false, reason: "Folder has uncommitted changes" };
      },
      ui: () => ({
        update: () => {},
        log: (text) => reasons.push(text),
        stop: () => {},
      }),
    }),
  );
  assert.ok(reasons.includes("Folder has uncommitted changes"));
  assert.ok(!reasons.includes("Folder pulled"));
});

test("every heartbeat names the folder it watched, its branch and its distance behind", async () => {
  const beating = board(fixture());
  await run(
    options({ cap: 0 }),
    parts({
      board: beating.board,
      folder: async () => ({
        branch: "main",
        dirty: false,
        ahead: 0,
        behind: 4,
        upstream: "origin/main",
      }),
    }),
  );
  const beat = beating.calls.find((call) => call.name === "runner_heartbeat");
  assert.deepEqual(beat?.args.folder, {
    branch: "main",
    dirty: false,
    ahead: 0,
    behind: 4,
    upstream: "origin/main",
    path: "/repo",
  });
  assert.equal(
    shortPath("/Users/ada/code/wireal/", "/Users/ada"),
    "~/code/wireal",
  );
  assert.equal(shortPath("/Users/ada", "/Users/ada"), "~");
  assert.equal(shortPath("/srv/repo", "/Users/ada"), "/srv/repo");
  assert.equal(shortPath("/" + "long/".repeat(30), "/Users/ada").length, 60);
});

test("a merge request merges that task's branch and completes the request", async () => {
  const state = finished(fixture(), "fixture-task-7");
  const task = state.tasks.find(
    (candidate) => candidate.id === "fixture-task-7",
  )!;
  task.activity = [
    {
      id: "activity-merge",
      text: "Done. Set up authentication end to end.",
      at: "2026-09-16T00:00:00.000Z",
      author: "Claude",
      authorType: "ai",
      commit: "abc123def4567890abc123def4567890abc123de",
    },
    ...task.activity,
  ];
  const asked = board(state, [
    request({ request_id: "request-merge", kind: "merge" }),
  ]);
  const merges: string[] = [];
  await run(
    options(),
    parts({
      board: asked.board,
      branchOf: async (repo, commit) => {
        assert.equal(commit, "abc123def4567890abc123def4567890abc123de");
        return "wireal/7";
      },
      merge: async (repo, tree, message) => {
        merges.push(message);
        return { merged: true, commit: mergeCommit };
      },
    }),
  );
  assert.deepEqual(merges, ["Merge wireal/7: Set up authentication"]);
  assert.deepEqual(
    asked.calls
      .filter((call) => call.name === "complete_request")
      .map((call) => call.args.request_id),
    ["request-merge"],
  );
  assert.equal(
    asked.state().tasks.find((candidate) => candidate.id === "fixture-task-7")
      ?.activity[0].text,
    "Merged into main as 1111111",
  );
});

test("a pull request pulls the folder and completes the request", async () => {
  const asked = board(finished(fixture(), "fixture-task-7", "fixture-task-8"), [
    request({
      request_id: "request-pull",
      task_id: "",
      kind: "pull",
      agent: "runner-one",
    }),
  ]);
  const pulls: boolean[] = [];
  await run(
    options(),
    parts({
      board: asked.board,
      folder: async () => ({
        branch: "wireal/7",
        dirty: false,
        ahead: 0,
        behind: 2,
        upstream: "origin/wireal/7",
      }),
      pull: async () => {
        pulls.push(true);
        return { pulled: true, reason: "Folder pulled" };
      },
    }),
  );
  assert.deepEqual(pulls, [true]);
  assert.deepEqual(
    asked.calls
      .filter((call) => call.name === "complete_request")
      .map((call) => call.args.request_id),
    ["request-pull"],
  );
});

test("a promote request carries the agent branch into the default branch", async () => {
  const state = finished(
    modal("automatic", { agentBranch: "agents" }),
    "fixture-task-7",
    "fixture-task-8",
  );
  const asked = board(state, [
    request({
      request_id: "request-promote",
      task_id: "",
      kind: "promote",
      agent: "runner-one",
    }),
  ]);
  const promotions: { branch: string; target: string }[] = [];
  await run(
    options(),
    parts({
      board: asked.board,
      promote: async (repo, branch, target) => {
        promotions.push({ branch, target });
        return { promoted: true, commit: promoteCommit, tasks: ["7"] };
      },
    }),
  );
  assert.deepEqual(promotions, [{ branch: "agents", target: "main" }]);
  assert.deepEqual(
    asked.calls
      .filter((call) => call.name === "complete_request")
      .map((call) => call.args.request_id),
    ["request-promote"],
  );
  assert.equal(
    asked.state().tasks.find((candidate) => candidate.id === "fixture-task-7")
      ?.activity[0].text,
    `Promoted agents into main as ${promoteCommit.slice(0, 7)}`,
  );
});

test("a promote request with no agent branch set promotes nothing", async () => {
  const asked = board(finished(fixture(), "fixture-task-7", "fixture-task-8"), [
    request({
      request_id: "request-promote",
      task_id: "",
      kind: "promote",
      agent: "runner-one",
    }),
  ]);
  let promoted = false;
  await run(
    options(),
    parts({
      board: asked.board,
      promote: async () => {
        promoted = true;
        return { promoted: true, commit: promoteCommit, tasks: [] };
      },
    }),
  );
  assert.equal(promoted, false);
  assert.deepEqual(
    asked.calls
      .filter((call) => call.name === "complete_request")
      .map((call) => call.args.request_id),
    ["request-promote"],
  );
});

test("a line opens its worktree from the agent branch when one is set", async () => {
  const asked = board(modal("automatic", { agentBranch: "agents" }));
  const opened: string[] = [];
  await run(
    options(),
    parts({
      board: asked.board,
      open: async (repo, reference, base) => {
        opened.push(base);
        return { ...worktree, base };
      },
    }),
  );
  assert.ok(opened.length > 0);
  assert.ok(opened.every((base) => base === "agents"));
});

test("a pull another runner asked for is left to that runner", async () => {
  const asked = board(finished(fixture(), "fixture-task-7", "fixture-task-8"), [
    request({
      request_id: "request-pull",
      task_id: "",
      kind: "pull",
      agent: "runner-two",
    }),
    request({
      request_id: "request-pull-elsewhere",
      task_id: "runner-three",
      kind: "pull",
      agent: "",
    }),
  ]);
  let pulled = false;
  await run(
    options(),
    parts({
      board: asked.board,
      pull: async () => {
        pulled = true;
        return { pulled: true, reason: "Folder pulled" };
      },
    }),
  );
  assert.equal(pulled, false);
  assert.equal(
    asked.calls.filter((call) => call.name === "complete_request").length,
    0,
  );
});

test("a pull names its runner in either field, and no name means any runner", () => {
  assert.equal(
    addressedHere({ agent: "runner-one", task_id: "" }, "runner-one"),
    true,
  );
  assert.equal(
    addressedHere({ agent: "", task_id: "runner-one" }, "runner-one"),
    true,
  );
  assert.equal(addressedHere({ agent: "", task_id: "" }, "runner-one"), true);
  assert.equal(
    addressedHere({ agent: "runner-two", task_id: "" }, "runner-one"),
    false,
  );
});

test("a promotion that carries nothing still reconciles the folder", async () => {
  const state = finished(
    modal("automatic", { agentBranch: "agents" }),
    "fixture-task-7",
    "fixture-task-8",
  );
  const asked = board(state, [
    request({
      request_id: "request-promote",
      task_id: "",
      kind: "promote",
      agent: "runner-one",
    }),
  ]);
  const said: string[] = [];
  const pulls: string[] = [];
  await run(
    options(),
    parts({
      board: asked.board,
      promote: async () => ({
        promoted: false,
        tasks: [],
        conflicts: [],
        error: "main already has agents",
      }),
      folder: async () => ({
        branch: "main",
        dirty: false,
        ahead: 0,
        behind: 1,
        upstream: "origin/main",
      }),
      pull: async (repo, folder) => {
        pulls.push(folder.branch);
        return { pulled: true, reason: "Folder pulled" };
      },
      ui: () => ({
        update: () => {},
        log: (text) => said.push(text),
        stop: () => {},
      }),
    }),
  );
  assert.deepEqual(pulls, ["main"]);
  assert.ok(said.includes("main already has agents"));
  assert.ok(said.includes("Folder pulled"));
});

test("the agent branch is caught up with the default branch as the runner watches", async () => {
  const asked = board(modal("automatic", { agentBranch: "agents" }));
  const caught: { branch: string; target: string }[] = [];
  const said: string[] = [];
  await run(
    options({ cap: 0 }),
    parts({
      board: asked.board,
      catchUp: async (repo, branch, target) => {
        caught.push({ branch, target });
        return "aaaabbbbccccddddeeeeffff0000111122223333";
      },
      ui: () => ({
        update: () => {},
        log: (text) => said.push(text),
        stop: () => {},
      }),
    }),
  );
  assert.deepEqual(caught, [{ branch: "agents", target: "main" }]);
  assert.ok(said.includes("agents caught up with main at aaaabbb"));
});

test("a folder holding commits origin has not seen says so once", async () => {
  const asked = board(fixture());
  const said: string[] = [];
  await run(
    options({ cap: 0 }),
    parts({
      board: asked.board,
      folder: async () => ({
        branch: "main",
        dirty: false,
        ahead: 2,
        behind: 0,
        upstream: "origin/main",
      }),
      ui: () => ({
        update: () => {},
        log: (text) => said.push(text),
        stop: () => {},
      }),
    }),
  );
  assert.deepEqual(
    said.filter((text) => text.includes("origin has not seen")),
    [
      "main holds 2 commits origin has not seen, so no agent is building on them",
    ],
  );
});

test("the heartbeat carries each working agent's step, last line and files", async () => {
  const running = board(fixture());
  const told: { worktree: string; files: string[]; others: number }[] = [];
  await run(
    options(),
    parts({
      board: running.board,
      peers: (path, self, world) =>
        told.push({
          worktree: path,
          files: self.files,
          others: world.agents.length,
        }),
      start: (_agent, agentOptions) => {
        agentOptions.onActivity?.({
          step: "editing src/api.ts",
          edited: ["src/api.ts"],
          read: ["src/app.tsx"],
        });
        agentOptions.onLine(`Edit ${String.fromCharCode(27)}[1msrc/api.ts\n`);
        return {
          done: new Promise<AgentResult>((finish) =>
            setTimeout(() => finish({ ok: true }), 120),
          ),
          stop: () => {},
        };
      },
    }),
  );
  const reported = running.calls
    .filter((call) => call.name === "runner_heartbeat")
    .flatMap((call) => call.args.agents as Record<string, unknown>[])
    .find((agent) => agent.task_id);
  assert.equal(reported?.step, "editing src/api.ts");
  assert.equal(reported?.last, "Edit src/api.ts");
  assert.deepEqual(reported?.files, ["src/api.ts"]);
  assert.ok(told.length > 0);
  assert.equal(told[0].worktree, worktree.path);
  assert.deepEqual(told.at(-1)?.files, ["src/api.ts", "src/app.tsx"]);
  assert.deepEqual(agentActivity(undefined), {});
  assert.deepEqual(agentActivity({ step: "", last: "", edited: [] }), {});
  assert.equal(
    agentActivity({
      step: "x",
      last: "y".repeat(400),
      edited: Array.from({ length: 25 }, (_, index) => `f${index}`),
    }).files?.length,
    20,
  );
  assert.equal(sanitizedLine("a\u0007b\tc").trim(), "a b c");
  assert.equal(sanitizedLine("z".repeat(400)).length, 300);
});

test("a task a person is working on through their own CLI is left to them", async () => {
  const state = fixture();
  const running = board(state, [], () => {}, [], {
    presence: [
      {
        user_id: "u1",
        user_name: "Grace",
        client: "Claude Code",
        task_id: "fixture-task-7",
        last_seen: new Date().toISOString(),
      },
    ],
  });
  const notes: string[] = [];
  await run(
    options(),
    parts({
      board: running.board,
      ui: () => ({
        update: () => {},
        log: (text) => notes.push(text),
        stop: () => {},
      }),
    }),
  );
  assert.ok(!claimed(running.calls).includes("fixture-task-7"));
  assert.equal(
    notes.filter(
      (note) => note === "WRL·7 is being worked on by Grace in Claude Code",
    ).length,
    1,
  );
  const project = state.tasks.find((task) => task.id === "fixture-task-7")
    ?.projectIds[0];
  for (const id of claimed(running.calls))
    assert.ok(
      !state.tasks
        .find((task) => task.id === id)
        ?.projectIds.includes(project ?? ""),
      `${String(id)} shares a project with the person's task`,
    );
  assert.deepEqual(
    presenceLeases(
      [
        { user_id: "u1", task_id: "t1" },
        { user_name: "Nobody", task_id: null },
      ],
      0,
    ),
    [
      {
        task_id: "t1",
        agent: "person:u1",
        until: new Date(600_000).toISOString(),
      },
    ],
  );
});

test("the runner names itself as one orchestrator with tagged agents", () => {
  assert.equal(
    crewLine("studio", [ada(), rex()]),
    "runner studio · 2 agents: Ada [claude], Rex [codex]",
  );
});

const ownClaude = crewAgentId("runner-one", 1);
const ownCodex = crewAgentId("runner-one", 2);

test("a runner writes one agent per CLI into the workspace and seats them on itself", async () => {
  const fresh = board(modal("automatic", { roster: [] }), [], () => {}, [], {
    seats: [],
    wanted: [],
  });
  await run(options({ crew: {}, cap: 2 }), parts({ board: fresh.board }));
  const roster = fresh.state().map.agents?.roster ?? [];
  assert.deepEqual(
    roster.map(({ id, name, kind, enabled, runner }) => ({
      id,
      name,
      kind,
      enabled,
      runner,
    })),
    [
      {
        id: ownClaude,
        name: "Ada's laptop 1",
        kind: "claude",
        enabled: true,
        runner: "runner-one",
      },
      {
        id: ownCodex,
        name: "Ada's laptop 2",
        kind: "codex",
        enabled: true,
        runner: "runner-one",
      },
    ],
  );
  const heartbeat = fresh.calls.find(
    (call) => call.name === "runner_heartbeat",
  );
  assert.deepEqual(
    (heartbeat?.args.agents as { id: string }[]).map((agent) => agent.id),
    [ownClaude, ownCodex],
  );
  const seat = fresh.calls.find((call) => call.name === "set_runner_seats");
  assert.deepEqual(seat?.args.agents, [ownClaude, ownCodex]);
  assert.equal(seat?.args.runner, "runner-one");
  const agents = fresh.calls
    .filter((call) => call.name === "claim_task")
    .map((call) => call.args.agent);
  assert.ok(agents.length > 0);
  for (const agent of agents)
    assert.ok([ownClaude, ownCodex].includes(String(agent)));
});

test("--agents runs more of each, and only for the CLIs this machine has", async () => {
  const more = board(modal("automatic", { roster: [] }));
  await run(
    options({ crew: { each: 2 }, cap: 0 }),
    parts({ board: more.board, hosts: () => ["claude"] }),
  );
  assert.deepEqual(
    (more.state().map.agents?.roster ?? []).map((spec) => spec.name),
    ["Ada's laptop 1", "Ada's laptop 2"],
  );
});

test("a restart finds its agents where it left them and writes nothing new", async () => {
  const first = board(modal("automatic", { roster: [] }));
  await run(options({ crew: {}, cap: 0 }), parts({ board: first.board }));
  const after = first.state();
  const again = board(after);
  await run(options({ crew: {}, cap: 0 }), parts({ board: again.board }));
  assert.deepEqual(again.state().map.agents?.roster, after.map.agents?.roster);
});

test("a task locked to a runner's own agent is claimed by that agent", async () => {
  const locked = board(modal("directed", { roster: [] }), [], () => {}, [], {
    locks: [{ task_id: "fixture-task-7", agent: ownCodex }],
  });
  await run(options({ crew: {}, cap: 2 }), parts({ board: locked.board }));
  const claims = locked.calls.filter((call) => call.name === "claim_task");
  assert.deepEqual(
    claims.map((call) => [call.args.task_id, call.args.agent]),
    [["fixture-task-7", ownCodex]],
  );
});

test("two runners in one workspace keep distinct agents, even under one name", async () => {
  const one = board(modal("automatic", { roster: [ada()] }));
  await run(options({ crew: {}, cap: 0 }), parts({ board: one.board }));
  const two = board(
    one.state(),
    [],
    () => {},
    [],
    {},
    {
      id: "runner-three",
      name: "Ada's laptop",
    },
  );
  await run(options({ crew: {}, cap: 0 }), parts({ board: two.board }));
  const roster = two.state().map.agents?.roster ?? [];
  assert.equal(roster.length, 5);
  assert.equal(roster[0]?.id, "ada");
  assert.equal(new Set(roster.map((spec) => spec.id)).size, 5);
  assert.equal(new Set(roster.map((spec) => spec.name.toLowerCase())).size, 5);
  const reported = (
    two.calls.find((call) => call.name === "runner_heartbeat")?.args.agents as {
      id: string;
    }[]
  ).map((agent) => agent.id);
  assert.ok(reported.includes("ada"));
  assert.ok(!reported.includes(ownClaude));
  assert.ok(!reported.includes(ownCodex));
});

test("a runner that runs fewer agents drops the extra once no lock names it", async () => {
  const wide = board(modal("automatic", { roster: [] }));
  await run(
    options({ crew: { each: 2 }, cap: 0 }),
    parts({ board: wide.board }),
  );
  const extra = crewAgentId("runner-one", 4);
  const held = board(wide.state(), [], () => {}, [], {
    locks: [{ task_id: "fixture-task-7", agent: extra }],
  });
  await run(options({ crew: {}, cap: 0 }), parts({ board: held.board }));
  assert.ok(
    (held.state().map.agents?.roster ?? []).some((spec) => spec.id === extra),
  );
  const free = board(held.state(), [], () => {}, [], { locks: [] });
  await run(options({ crew: {}, cap: 0 }), parts({ board: free.board }));
  assert.deepEqual(
    (free.state().map.agents?.roster ?? []).map((spec) => spec.id),
    [ownClaude, ownCodex],
  );
});

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((done) => setTimeout(done, 5));
  }
};

/** A long-running runner whose keys the test presses. */
function steered(over: Partial<LoopParts>, crew: RunOptions["crew"] = {}) {
  const notes: string[] = [];
  const saved: CrewSeat[][] = [];
  let press: (key: string) => void = () => {};
  let stop: () => void = () => {};
  const running = run(
    options({ crew, cap: 0, once: false }),
    parts({
      saveCrew: (_repo, seats) => saved.push([...seats]),
      ui: (onQuit, onKey) => {
        stop = onQuit;
        press = (key) => onKey?.(key);
        return {
          update: () => {},
          log: (text) => notes.push(text),
          stop: () => {},
        };
      },
      ...over,
    }),
  );
  return {
    notes,
    saved,
    press: (key: string) => press(key),
    stop: async () => {
      stop();
      await running;
    },
  };
}

test("+ and - change the crew while the runner runs, and the crew is saved", async () => {
  const live = board(modal("automatic", { roster: [] }));
  const runner = steered({ board: live.board });
  try {
    await until(() =>
      runner.notes.some((note) =>
        note.startsWith("runner Ada's laptop · 2 agents"),
      ),
    );
    assert.equal(runner.saved.length, 0);
    runner.press("+");
    await until(() => runner.notes.some((note) => note.startsWith("Added")));
    assert.ok(
      runner.notes.includes("Added Ada's laptop 3 [claude], 3 agents now"),
      runner.notes.join("\n"),
    );
    runner.press("x");
    await until(() =>
      runner.notes.includes("Added Ada's laptop 4 [codex], 4 agents now"),
    );
    const seat = live.calls.filter((call) => call.name === "set_runner_seats");
    assert.ok(
      (seat.at(-1)?.args.agents as string[]).includes(
        crewAgentId("runner-one", 4),
      ),
    );
    runner.press("-");
    await until(() =>
      runner.notes.includes("Removed Ada's laptop 4 [codex], 3 agents now"),
    );
    // The removed agent's seat is given up too, so the server stops asking
    // for it and the runner never reports it as held somewhere else.
    await until(() => {
      const seats = live.calls.filter(
        (call) => call.name === "set_runner_seats",
      );
      return !(seats.at(-1)?.args.agents as string[]).includes(
        crewAgentId("runner-one", 4),
      );
    });
    assert.ok(!runner.notes.some((note) => /is held by/.test(note)));
    assert.deepEqual(
      (live.state().map.agents?.roster ?? []).map((spec) => [
        spec.name,
        spec.kind,
      ]),
      [
        ["Ada's laptop 1", "claude"],
        ["Ada's laptop 2", "codex"],
        ["Ada's laptop 3", "claude"],
      ],
    );
    assert.deepEqual(
      runner.saved.at(-1)?.map((seat) => [seat.n, seat.kind]),
      [
        [1, "claude"],
        [2, "codex"],
        [3, "claude"],
      ],
    );
  } finally {
    await runner.stop();
  }
});

test("- never takes an agent a lock names, and says so", async () => {
  const locked = board(modal("automatic", { roster: [] }), [], () => {}, [], {
    locks: [
      { task_id: "fixture-task-7", agent: crewAgentId("runner-one", 1) },
      { task_id: "fixture-task-8", agent: crewAgentId("runner-one", 2) },
    ],
  });
  const runner = steered({ board: locked.board });
  try {
    await until(() =>
      runner.notes.some((note) => note.startsWith("runner Ada's laptop")),
    );
    runner.press("-");
    await until(() =>
      runner.notes.includes(
        "Every agent is working or has a task locked to it, so none was removed",
      ),
    );
    assert.equal(runner.saved.length, 0);
  } finally {
    await runner.stop();
  }
});

test("p pauses this runner's intake and the heartbeat says so", async () => {
  const live = board(modal("automatic", { roster: [] }));
  const runner = steered({ board: live.board });
  try {
    await until(() =>
      runner.notes.some((note) => note.startsWith("runner Ada's laptop")),
    );
    runner.press("p");
    await until(() =>
      live.calls.some(
        (call) =>
          call.name === "runner_heartbeat" &&
          (call.args.agents as { waiting?: string }[]).length > 0 &&
          (call.args.agents as { waiting?: string }[]).every(
            (agent) => agent.waiting === "Paused on its runner",
          ),
      ),
    );
    runner.press("p");
    await until(() => runner.notes.includes("Intake resumed on this runner"));
  } finally {
    await runner.stop();
  }
});

test("a saved crew is what a restart brings, and flags replace it", async () => {
  const saved: CrewSeat[] = [
    { n: 1, kind: "codex", id: crewAgentId("runner-one", 1) },
  ];
  const kept = board(modal("automatic", { roster: [] }));
  await run(
    options({ crew: {}, cap: 0 }),
    parts({ board: kept.board, savedCrew: () => saved }),
  );
  assert.deepEqual(
    (kept.state().map.agents?.roster ?? []).map((spec) => [
      spec.name,
      spec.kind,
    ]),
    [["Ada's laptop 1", "codex"]],
  );
  const written: CrewSeat[][] = [];
  const flagged = board(modal("automatic", { roster: [] }));
  await run(
    options({ crew: { claude: 2, codex: 0 }, cap: 0 }),
    parts({
      board: flagged.board,
      savedCrew: () => saved,
      saveCrew: (_repo, seats) => written.push([...seats]),
    }),
  );
  assert.deepEqual(
    written.at(-1)?.map((seat) => seat.kind),
    ["claude", "claude"],
  );
});

test("a runner that wrote per-kind ids keeps them under neutral names", async () => {
  const old = board(
    modal("automatic", {
      roster: [
        {
          id: legacyAgentId("runner-one", "claude", 1),
          name: "Ada's laptop · Claude",
          kind: "claude",
          enabled: true,
          runner: "runner-one",
        },
      ],
    }),
  );
  await run(options({ crew: {}, cap: 0 }), parts({ board: old.board }));
  assert.deepEqual(
    (old.state().map.agents?.roster ?? []).map((spec) => [spec.id, spec.name]),
    [
      [legacyAgentId("runner-one", "claude", 1), "Ada's laptop 1"],
      [crewAgentId("runner-one", 2), "Ada's laptop 2"],
    ],
  );
});

test("a workspace switched out of paused reaches intake on the next tick", async () => {
  let beatsAtResume = -1;
  let beatsAtClaim = -1;
  const beats = () =>
    held.calls.filter((call) => call.name === "runner_heartbeat").length;
  const held = board(modal("paused"), [], () => {
    if (beatsAtClaim < 0) beatsAtClaim = beats();
  });
  let quit: () => void = () => {};
  const running = run(
    options({ once: false }),
    parts({
      board: held.board,
      ui: (onQuit) => {
        quit = onQuit;
        return { update: () => {}, log: () => {}, stop: () => {} };
      },
    }),
  );
  await until(() => beats() >= 3);
  beatsAtResume = beats();
  held.edit((state) => {
    state.map.agents = { ...state.map.agents!, mode: "automatic" };
  });
  await until(() => beatsAtClaim >= 0);
  quit();
  await running;
  assert.ok(
    beatsAtClaim - beatsAtResume <= 1,
    `${beatsAtResume} then ${beatsAtClaim}`,
  );
});

test("a task an agent here just failed rests instead of being claimed again at once", async () => {
  const failing = board(fixture());
  const notes: string[] = [];
  let stop: () => void = () => {};
  const running = run(
    options({ once: false }),
    parts({
      board: failing.board,
      start: () => ({
        done: Promise.resolve({ ok: false, error: "sandbox is read-only" }),
        stop: () => {},
      }),
      ui: (onQuit) => {
        stop = onQuit;
        return {
          update: () => {},
          log: (text) => notes.push(text),
          stop: () => {},
        };
      },
    }),
  );
  try {
    await until(() => notes.some((note) => /rests 5m/.test(note)));
    // Many more ticks go by; none of them claims the task again.
    await new Promise((done) => setTimeout(done, 300));
    const claims = failing.calls.filter(
      (call) =>
        call.name === "claim_task" && call.args.task_id === "fixture-task-7",
    );
    assert.equal(claims.length, 1, notes.join("\n"));
    assert.ok(
      notes.some((note) =>
        /skipped: failed here, tried again after/.test(note),
      ),
    );
  } finally {
    stop();
    await running;
  }
});
