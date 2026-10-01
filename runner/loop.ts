import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverFor } from "./agents/index.ts";
import type {
  AgentOptions,
  AgentRun,
  AgentStatus,
  McpProxy,
  AgentResult,
  RateLimits,
} from "./agents/types.ts";
import { short } from "./agents/types.ts";
import {
  freshest,
  limitsByKind,
  windowPercent,
  windowReset,
} from "./agents/events.ts";
import {
  readUsage,
  storeLimits,
  usageEveryFor,
  type UsageRead,
} from "./agents/usage.ts";
import {
  Board,
  livePresence,
  lockedTo,
  openBoard,
  ownLocks,
  pendingRequests,
  type AgentKind,
  type AgentReport,
  type AgentSettings,
  type Candidate,
  type Closing,
  type FlowRequest,
  type Lock,
  type Outcome,
  type Presence,
} from "./board.ts";
import {
  publishPeers,
  type Merged,
  type Self,
  type PeerAgent,
  type PeerHuman,
  type World,
} from "./peers.ts";
import {
  branchOfCommit,
  folderState,
  mergeBranch,
  mergeMessage,
  promoteBranch,
  pullFolder,
  runChecks,
  type CheckRun,
  type FolderState,
  type MergeOutcome,
  type PromoteOutcome,
} from "./merge.ts";
import { liveLeases, signedOut, type LeaseRow, type RunnerRow } from "./api.ts";
import { agentBranchOf, type AgentSpec } from "../src/domain.ts";
import { detectHosts } from "./hosts.ts";
import { readyBrowser, type BrowserReport } from "./browser.ts";
import { linkDependencies, type DepsReport } from "./deps.ts";
import { keepAwake, type Awake } from "./awake.ts";
import { agentIdentity, freeAgents, leaseHolders, rosterOf } from "./roster.ts";
import {
  addSeat,
  crewSpecs,
  leastUsed,
  ownedBy,
  reconcileRoster,
  removableSeat,
  seatLimit,
  seatsWanted,
  startingCrew,
  type Crew,
  type CrewSeat,
} from "./crew.ts";
import { setBindingCrew } from "./binding.ts";
import { brandNames } from "./roster.ts";
import { homedir } from "node:os";
import { composePrompt } from "./prompt.ts";
import { apiUrl, readBinding } from "./session.ts";
import type { RunnerIdentity } from "./session.ts";
import { createScreen, type Screen } from "./screen.ts";
import {
  createUi,
  processTerminal,
  type FeedLine,
  type SlotState,
  type SlotView,
  type StartStep,
  type Ui,
  type UsageView,
  type View,
} from "./ui.ts";
import {
  catchUpBase,
  commitWorktree,
  ensureBase,
  openWorktree,
  removeWorktree,
  repositoryUrl,
  type Worktree,
} from "./worktree.ts";

export type LoopParts = {
  board: Board;
  /** `onKey` hears the crew keys (+ - c x p) typed into the runner. */
  ui: (onQuit: () => void, onKey?: (key: string) => void) => Ui;
  /** The crew saved for this folder by an earlier run, if any. */
  savedCrew?: (repo: string) => CrewSeat[] | undefined;
  saveCrew?: (repo: string, seats: readonly CrewSeat[]) => void;
  proxy: (agentName: string, workspaceId: string) => McpProxy;
  repository: (repo: string) => Promise<string>;
  start: (agent: AgentKind, options: AgentOptions) => AgentRun;
  open: (repo: string, reference: string, base: string) => Promise<Worktree>;
  commit: (
    repo: string,
    worktree: Worktree,
    message: string,
  ) => Promise<{ commit: string; pushed: boolean }>;
  remove: (repo: string, worktree: Worktree) => Promise<void>;
  checks: (
    commands: readonly string[],
    cwd: string,
    onLine: (text: string) => void,
  ) => Promise<CheckRun | undefined>;
  merge: (
    repo: string,
    worktree: Worktree,
    message: string,
  ) => Promise<MergeOutcome>;
  branchOf: (repo: string, commit: string) => Promise<string>;
  base: (repo: string, wanted: string) => Promise<string>;
  catchUp: (repo: string, branch: string, target: string) => Promise<string>;
  promote: (
    repo: string,
    branch: string,
    target: string,
  ) => Promise<PromoteOutcome>;
  folder: (repo: string, base: string, fetch: boolean) => Promise<FolderState>;
  pull: (
    repo: string,
    state: FolderState,
  ) => Promise<{ pulled: boolean; reason: string }>;
  hosts: () => AgentKind[];
  browser: (repo: string) => Promise<BrowserReport>;
  deps: (repo: string, worktree: string) => Promise<DepsReport>;
  awake: () => Awake;
  named: (repo: string) => string;
  usage: (kind: AgentKind) => Promise<UsageRead>;
  usageEvery: (kind: AgentKind) => number;
  keep: (kind: AgentKind, limits: RateLimits) => void;
  /** Writes .wireal/peers.md and notice.json into a working agent's
   *  worktree when they changed. */
  peers: (worktree: string, self: Self, world: World) => void;
  interval: number;
  signals: boolean;
};

export type RunOptions = {
  workspace?: string;
  /** The agents this runner provisions for itself; one per CLI when unset. */
  crew?: Crew;
  /** At most this many agents working at once; all of them when unset. */
  cap?: number;
  repo: string;
  once: boolean;
  allowSleep?: boolean;
  trustWorktree?: boolean;
  checks?: readonly string[];
  identity?: RunnerIdentity;
};

export type Skipped = {
  id: string;
  reference: string;
  name: string;
  reason: string;
};

function repositoryName(url: string): string {
  return url.replace(/^https:\/\/github\.com\//i, "");
}

export function shortPath(path: string, home = homedir()): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const shown =
    home && (trimmed === home || trimmed.startsWith(home + "/"))
      ? "~" + trimmed.slice(home.length)
      : trimmed;
  return shown.length <= 60 ? shown : "…" + shown.slice(shown.length - 59);
}

export function count(amount: number, noun: string): string {
  return `${amount} ${noun}${amount === 1 ? "" : "s"}`;
}

export function skipReason(candidate: Candidate, repository: string): string {
  if (repository) {
    const owned = candidate.projects
      .map((project) => project.repositoryUrl.trim())
      .filter(Boolean);
    if (!owned.some((url) => url.toLowerCase() === repository.toLowerCase()))
      return owned.length
        ? `belongs to ${repositoryName(owned[0])}`
        : "no repository";
  }
  if (!candidate.objective.trim() && !candidate.review) return "no objective";
  if (candidate.busy.length) return `another agent is in ${candidate.busy[0]}`;
  return "";
}

export function addressedHere(
  request: Pick<FlowRequest, "agent" | "task_id">,
  runnerId: string,
): boolean {
  const named = [request.agent, request.task_id]
    .map((value) => (value ?? "").trim())
    .filter(Boolean);
  return !named.length || named.includes(runnerId);
}

export function pauseNote(
  limits: RateLimits | undefined,
  above: number | undefined,
): string {
  if (above === undefined) return "";
  const used = windowPercent(limits, "five_hour");
  if (used === undefined || used < above) return "";
  return `Paused: 5-hour window at ${Math.round(used)}% (limit ${Math.round(above)}%)`;
}

const ansi = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*(\u0007|\u001b\\)/g;

/** An output line fit for the board: no escape codes, no control characters,
 *  one line, at most 300 characters. */
export function sanitizedLine(value: string, limit = 300): string {
  return short(
    String(value ?? "")
      .replace(ansi, "")
      .replace(/[\u0000-\u001f\u007f]+/g, " "),
    limit,
  );
}

type Heartbeat = {
  step: string;
  last: string;
  edited: string[];
};

/** The per-agent fields the heartbeat carries beyond who and which task. */
export function agentActivity(slot: Heartbeat | undefined): {
  step?: string;
  last?: string;
  files?: string[];
} {
  if (!slot) return {};
  const step = sanitizedLine(slot.step, 120);
  const last = sanitizedLine(slot.last, 300);
  const files = slot.edited.slice(-20);
  return {
    ...(step ? { step } : {}),
    ...(last ? { last } : {}),
    ...(files.length ? { files } : {}),
  };
}

/** The runner is one orchestrator with named agents; the kind is a tag. */
export function crewLine(
  runner: string,
  agents: readonly Pick<AgentSpec, "name" | "kind">[],
): string {
  return `runner ${runner} · ${count(agents.length, "agent")}: ${agents
    .map((agent) => `${agent.name} [${agent.kind}]`)
    .join(", ")}`;
}

/** A person on a task holds it the way a lease does: the task is not
 *  claimed and its projects count as engaged. */
export function presenceLeases(
  presence: readonly Presence[],
  now = Date.now(),
): LeaseRow[] {
  const until = new Date(now + 10 * 60_000).toISOString();
  return presence
    .filter((row) => row.task_id)
    .map((row) => ({
      task_id: row.task_id as string,
      agent: `person:${row.user_id || row.user_name || row.session || ""}`,
      until,
    }));
}

function usageWindows(
  start: RateLimits | undefined,
  end: RateLimits | undefined,
): Closing["windows"] {
  const windows: NonNullable<Closing["windows"]> = {};
  for (const [key, name] of [
    ["fiveHour", "five_hour"],
    ["sevenDay", "seven_day"],
  ] as const) {
    const from = windowPercent(start, name);
    const to = windowPercent(end, name);
    if (from !== undefined && to !== undefined)
      windows[key] = { start: from, end: to };
  }
  return Object.keys(windows).length ? windows : undefined;
}

type Slot = {
  spec: AgentSpec;
  state: SlotState;
  taskId: string | null;
  reference: string;
  name: string;
  since: number;
  last: string;
  waiting: string;
  lines: string[];
  costUsd: number;
  following: string;
  rateLimits?: RateLimits;
  unlocked: boolean;
  step: string;
  edited: string[];
  read: string[];
  worktree: string;
  upstream: string[];
  run?: AgentRun;
  screen?: Screen;
  dropScreen?: () => void;
  work?: Promise<void>;
};

const idle = (spec: AgentSpec): Slot => ({
  spec,
  state: "idle",
  taskId: null,
  reference: "",
  name: "",
  since: 0,
  last: "",
  waiting: "",
  lines: [],
  costUsd: 0,
  following: "",
  unlocked: false,
  step: "",
  edited: [],
  read: [],
  worktree: "",
  upstream: [],
});

function closeScreen(slot: Slot): void {
  slot.dropScreen?.();
  slot.dropScreen = undefined;
  slot.screen?.dispose();
  slot.screen = undefined;
}

function openScreen(slot: Slot, agent: AgentRun): void {
  if (agent.screen) {
    slot.screen = agent.screen;
    return;
  }
  if (!agent.pty) return;
  const screen = createScreen();
  slot.screen = screen;
  slot.dropScreen = agent.pty.onData((chunk) => screen.write(chunk));
}

export function proxyFor(agentName: string, workspaceId: string): McpProxy {
  const packaged = !import.meta.url.endsWith(".ts");
  const entry = fileURLToPath(
    new URL(packaged ? "./mcp-stdio.mjs" : "./mcp-stdio.ts", import.meta.url),
  );
  const command = process.execPath;
  const args = packaged
    ? [entry]
    : ["--import", fileURLToPath(import.meta.resolve("tsx")), entry];
  const configPath = join(
    tmpdir(),
    `wireal-mcp-${process.pid}-${agentName.replace(/\W+/g, "")}.json`,
  );
  writeFileSync(
    configPath,
    JSON.stringify({
      mcpServers: {
        wirealrunner: {
          command,
          args,
          env: {
            WIREAL_AGENT_NAME: agentName,
            WIREAL_API_URL: apiUrl(),
            WIREAL_WORKSPACE_ID: workspaceId,
            WIREAL_MCP_PROFILE: "runner",
          },
        },
      },
    }),
  );
  return { name: "wirealrunner", command, args, configPath };
}

export function loopParts(identity?: RunnerIdentity): LoopParts {
  return {
    board: openBoard(identity),
    ui: (onQuit, onKey) => createUi(onQuit, processTerminal(), { onKey }),
    savedCrew: (repo) => readBinding(repo)?.crew,
    saveCrew: (repo, seats) => {
      setBindingCrew(repo, seats);
    },
    proxy: proxyFor,
    repository: (repo) => repositoryUrl(repo),
    start: (agent, options) => driverFor(agent).start(options),
    open: (repo, reference, base) => openWorktree(repo, reference, base),
    commit: commitWorktree,
    remove: removeWorktree,
    checks: runChecks,
    merge: mergeBranch,
    branchOf: branchOfCommit,
    base: (repo, wanted) => ensureBase(repo, wanted),
    catchUp: (repo, branch, target) => catchUpBase(repo, branch, target),
    promote: (repo, branch, target) => promoteBranch(repo, branch, target),
    folder: folderState,
    pull: (repo, state) => pullFolder(repo, state),
    hosts: () => detectHosts(),
    browser: (repo) => readyBrowser(repo),
    deps: (repo, worktree) => linkDependencies(repo, worktree),
    awake: () => keepAwake(),
    named: (repo) => readBinding(repo)?.name ?? "",
    usage: (kind) => readUsage(kind),
    usageEvery: usageEveryFor,
    keep: (kind, limits) => storeLimits(kind, limits),
    peers: (() => {
      const written = new Map<string, string>();
      return (worktree: string, self: Self, world: World) => {
        publishPeers(worktree, self, world, written);
      };
    })(),
    interval: 15_000,
    signals: true,
  };
}

export async function run(
  options: RunOptions,
  parts: LoopParts = loopParts(options.identity),
): Promise<void> {
  const board = parts.board;
  const hosts = parts.hosts();
  // Set once quit exists. A q or ctrl-c while the runner is still starting
  // has no agents to stop yet, so it leaves at once.
  let stopping: ((reason: string) => void) | undefined;
  // Set once the crew keys can act; a key pressed while the runner is still
  // connecting has no crew to change.
  let steering: (key: string) => void = () => {};
  const ui = parts.ui(
    () => {
      if (stopping) {
        stopping("stopping");
        return;
      }
      ui.stop();
      void board
        .leave()
        .catch(() => false)
        .finally(() => process.exit(130));
    },
    (key) => steering(key),
  );
  // The steps the startup splash lists, and the feed the screen shows below
  // the agents: the lines `say` reports, newest last.
  const starting: StartStep[] = [];
  let booting = true;
  const feed: FeedLine[] = [];
  const bare = (): View => ({
    runner: board.name,
    runnerId: board.runnerId,
    host: board.host,
    workspace: "",
    mode: "automatic",
    costUsd: 0,
    paused: "",
    skipped: [],
    slots: [],
    feed: [...feed],
    starting: starting.map((step) => ({ ...step })),
  });
  // Until the workspace answers there are no settings to build the full view
  // from, so the splash is drawn from what the runner knows about itself.
  let view: () => View = bare;
  const refresh = () => ui.update(view());
  const begin = (text: string) => {
    const step: StartStep = { text, state: "doing" };
    starting.push(step);
    refresh();
    return (said: string, failed = false) => {
      step.text = said;
      step.state = failed ? "failed" : "done";
      refresh();
    };
  };
  const post = (text: string, pending = false): FeedLine => {
    const last = feed.at(-1);
    if (!pending && last && !last.pending && last.text === text) {
      last.times = (last.times ?? 1) + 1;
      last.at = Date.now();
      return last;
    }
    const entry: FeedLine = {
      at: Date.now(),
      text,
      ...(pending ? { pending } : {}),
    };
    feed.push(entry);
    if (feed.length > 200) feed.splice(0, feed.length - 200);
    return entry;
  };
  const connecting = begin("Connecting to Wireal");
  let settings: AgentSettings;
  try {
    settings = await board.connect(options.workspace);
  } catch (error) {
    ui.stop();
    throw error;
  }
  connecting(`bound to ${board.workspace().name || "the workspace"}`);
  const cap = options.cap;
  const start = startingCrew({
    runnerId: board.runnerId,
    hosts,
    crew: options.crew,
    saved: parts.savedCrew?.(options.repo),
    roster: rosterOf(settings),
  });
  let seats: CrewSeat[] = start.seats;
  if (start.save) parts.saveCrew?.(options.repo, seats);
  /** Set with the p key: agents finish what they hold, nothing new starts. */
  let halted = false;
  const ownCrew = () =>
    crewSpecs(
      { id: board.runnerId, name: board.name },
      seats,
      rosterOf(settings),
      hosts,
    );
  const ownIds = () =>
    rosterOf(settings)
      .filter((spec) => ownedBy(spec, board.runnerId))
      .map((spec) => spec.id);
  let tidied = false;
  let seatTold = "";
  let slots: Slot[] = [];
  let seated: Set<string> | undefined;
  const enrol = () => {
    const roster = rosterOf(settings).filter((spec) => seated?.has(spec.id));
    const next = roster.map((spec) => {
      const seat = slots.find((slot) => slot.spec.id === spec.id);
      if (!seat) return idle(spec);
      seat.spec = spec;
      return seat;
    });
    for (const slot of slots)
      if (slot.state !== "idle" && !next.includes(slot)) next.push(slot);
    for (const slot of slots) if (!next.includes(slot)) closeScreen(slot);
    slots = next;
  };
  let spent = 0;
  let note = "";
  let paused = "";
  let locks: Lock[] = [];
  let rows: RunnerRow[] = [];
  let wanted: string[] = [];
  let toldHeld = "";
  let toldCrew = "";
  let blocked: Skipped[] = [];
  let presence: Presence[] = [];
  const merged: Merged[] = [];
  const knownLimits = new Map<AgentKind, RateLimits>();
  const remember = (kind: AgentKind, limits: RateLimits | undefined) => {
    const current = knownLimits.get(kind);
    const best = freshest([current, limits]);
    if (!best) return;
    knownLimits.set(kind, best);
    if (String(best.captured_at ?? "") === String(current?.captured_at ?? ""))
      return;
    parts.keep(kind, best);
  };
  const limitsOf = (slot: Slot): RateLimits | undefined =>
    freshest([knownLimits.get(slot.spec.kind), slot.rateLimits]);
  const asking = new Map<AgentKind, number>();
  let base = "main";
  let branchWanted = "";
  let landing = "";
  let folder: FolderState | undefined;
  let fetched = 0;
  let announced = -1;
  const lines = new Map<string, Worktree>();
  const doing = new Set<string>();
  const chores = new Map<string, Promise<void>>();
  const noted = new Set<string>();
  let lockedOut = false;
  let quitting = false;
  let started = false;
  let settle: () => void = () => {};
  const finished = new Promise<void>((done) => {
    settle = done;
  });
  const unpicked = "No agent is seated on this runner";
  // Only an agent still on the roster can be held elsewhere: an id the
  // server still lists as wanted after its agent was removed is not news.
  const heldIds = (): string[] => {
    const known = new Set(rosterOf(settings).map((spec) => spec.id));
    return wanted.filter((id) => known.has(id) && !seated?.has(id));
  };
  const heldLines = (): string[] => {
    const roster = rosterOf(settings);
    return heldIds().map((id) => {
      const holder = rows.find(
        (row) =>
          row.runner_id !== board.runnerId &&
          (row.seats ?? []).some((seat) => seat.agent_id === id),
      );
      const called = roster.find((spec) => spec.id === id)?.name ?? id;
      return `${called} is held by ${holder ? holder.name : "another runner"}`;
    });
  };
  const seating = (): string => {
    if (!wanted.length) return unpicked;
    const here = rosterOf(settings)
      .filter((spec) => seated?.has(spec.id))
      .map((spec) => spec.name);
    const mine = here.length
      ? `Seated here: ${here.join(", ")}`
      : "No agent seated here";
    return [mine, ...heldLines()].join("   ");
  };
  const awake = options.allowSleep
    ? { held: () => false, why: "", release: () => {} }
    : parts.awake();
  let offline = false;
  const firstRead = new Map<AgentKind, number>();
  /** A CLI's limits for the usage bars, from whichever reading is freshest:
   *  the runner's own or one an agent reported. */
  const usageOf = (kind: AgentKind): UsageView => {
    const limits = freshest([
      knownLimits.get(kind),
      ...slots
        .filter((slot) => slot.spec.kind === kind)
        .map((slot) => slot.rateLimits),
    ]);
    const resetOf = (name: string) => {
      const at = Date.parse(windowReset(limits, name) ?? "");
      return Number.isFinite(at) ? at : undefined;
    };
    const fiveHour = windowPercent(limits, "five_hour");
    const sevenDay = windowPercent(limits, "seven_day");
    if (
      (fiveHour !== undefined || sevenDay !== undefined) &&
      !firstRead.has(kind)
    )
      firstRead.set(kind, Date.now());
    return {
      kind,
      fiveHour,
      sevenDay,
      fiveHourReset: resetOf("five_hour"),
      sevenDayReset: resetOf("seven_day"),
      at: firstRead.get(kind),
    };
  };
  /** The task locked to an idle agent by name, which it takes next. */
  const lockedFor = (slot: Slot): string => {
    if (slot.state !== "idle") return "";
    const lock = locks.find(
      (entry) => (entry.agent ?? "").trim() === slot.spec.id,
    );
    return lock ? (board.known().get(lock.task_id)?.referenceId ?? "") : "";
  };
  view = (): View => ({
    awake: awake.held(),
    runner: board.name,
    runnerId: board.runnerId,
    host: board.host,
    workspace: board.workspace().name,
    mode: settings.mode,
    costUsd: spent,
    paused,
    seating: seating(),
    skipped: blocked.map(({ reference, name, reason }) => ({
      reference,
      name,
      reason,
    })),
    feed: [...feed],
    usage: hosts.map(usageOf),
    ...(booting ? { starting: starting.map((step) => ({ ...step })) } : {}),
    ...(offline ? { offline } : {}),
    ...(folder ? { folder: { ...folder, path: shortPath(options.repo) } } : {}),
    slots: slots.map((slot): SlotView => ({
      agent: slot.spec.name,
      kind: slot.spec.kind,
      model: slot.spec.model ?? "",
      enabled: slot.spec.enabled,
      hosted: hosts.includes(slot.spec.kind),
      reference: slot.reference,
      name: slot.name,
      state: slot.state,
      since: slot.since,
      last: slot.last,
      lines: slot.lines,
      costUsd: slot.costUsd,
      following: slot.following,
      step: slot.step,
      files: slot.edited,
      locked: lockedFor(slot),
      fiveHour: windowPercent(limitsOf(slot), "five_hour"),
      sevenDay: windowPercent(limitsOf(slot), "seven_day"),
      paused: pauseNote(
        limitsOf(slot),
        slot.spec.pauseAbovePercent ?? settings.pauseAbovePercent,
      ),
      pty: slot.run?.pty,
      screen: slot.screen,
    })),
  });
  const say = (text: string) => {
    note = text;
    post(text);
    ui.log(text);
    refresh();
  };
  /** A line of the merge checks' own output that names the check running.
   *  It goes to the feed, but not to the log, which has it already. */
  const mark = (text: string) => {
    post(text);
    refresh();
  };
  const flow = say;
  const measure = async (now: boolean): Promise<FolderState | undefined> => {
    const due = now || Date.now() - fetched >= 60_000;
    if (due) fetched = Date.now();
    if (due) await align();
    folder = await parts.folder(options.repo, base, due).catch(() => folder);
    if (folder && folder.ahead !== announced) {
      announced = folder.ahead;
      if (folder.ahead)
        flow(
          `${folder.branch || "The folder"} holds ${count(folder.ahead, "commit")} origin has not seen, so no agent is building on ${folder.ahead === 1 ? "it" : "them"}`,
        );
    }
    return folder;
  };
  const align = async () => {
    if (!base || !landing || base === landing) return;
    const moved = await parts
      .catchUp(options.repo, base, landing)
      .catch(() => "");
    if (moved)
      flow(`${base} caught up with ${landing} at ${moved.slice(0, 7)}`);
  };
  const rebase = async () => {
    const wanted = agentBranchOf(settings);
    if (wanted === branchWanted && base) return base;
    branchWanted = wanted;
    base = await parts.base(options.repo, wanted).catch(() => base || "main");
    return base;
  };
  const provision = async (prune: boolean) => {
    const desired = ownCrew();
    const keep = new Set<string>([
      ...locks.map((lock) => (lock.agent ?? "").trim()).filter(Boolean),
      ...slots
        .filter((slot) => slot.state !== "idle")
        .map((slot) => slot.spec.id),
      ...(rows.find((row) => row.runner_id === board.runnerId)?.leases ?? [])
        .map((lease) => lease.agent ?? "")
        .filter(Boolean),
    ]);
    const due = reconcileRoster(rosterOf(settings), desired, board.runnerId, {
      prune,
      keep,
    });
    if (!due && (tidied || !prune)) return;
    let listed: Set<string> | undefined;
    if (prune && !tidied) {
      rows = await board.runners().catch(() => rows);
      const ids = new Set(rows.map((row) => row.runner_id));
      if (ids.has(board.runnerId)) listed = ids;
    }
    settings = await board.provision((roster) =>
      reconcileRoster(roster, desired, board.runnerId, {
        prune,
        keep,
        ...(listed ? { listed } : {}),
      }),
    );
    if (prune) tidied = true;
  };
  const seatCrew = async () => {
    const roster = rosterOf(settings);
    // Removed agents must leave the wanted list too, or the server keeps
    // their seats asked for and the runner reports them as held elsewhere.
    const needed = seatsWanted(roster, wanted, ownIds());
    if (
      needed.length === wanted.length &&
      needed.every((id) => wanted.includes(id))
    )
      return;
    try {
      seated = new Set(await board.seat(needed));
      wanted = needed;
      seatTold = "";
    } catch (error) {
      const text = `could not seat this runner's agents: ${message(error)}`;
      if (text !== seatTold) say(text);
      seatTold = text;
    }
  };
  /** The crew keys. A change is saved for this folder and written to the
   *  workspace at once; a new agent is seated on this runner, and a removed
   *  one leaves the roster once nothing holds it. */
  const steer = async (key: string) => {
    if (quitting) return;
    if (key === "p") {
      halted = !halted;
      say(
        halted
          ? "Intake paused on this runner: agents finish what they hold, nothing new starts. p resumes"
          : "Intake resumed on this runner",
      );
      return;
    }
    let next: CrewSeat[];
    let change: CrewSeat;
    if (key === "+" || key === "c" || key === "x") {
      const kind =
        key === "c"
          ? "claude"
          : key === "x"
            ? "codex"
            : leastUsed(seats, hosts);
      if (!kind || !hosts.includes(kind)) {
        say(
          kind
            ? `No ${brandNames[kind]} agent to add: ${kind} is not on this runner's PATH`
            : "No agent to add: neither claude nor codex is on this runner's PATH",
        );
        return;
      }
      if (seats.length >= seatLimit) {
        say(`This runner already runs ${seatLimit} agents, the most it holds`);
        return;
      }
      next = addSeat(seats, board.runnerId, kind);
      change = next.find((seat) => !seats.includes(seat)) as CrewSeat;
    } else if (key === "-") {
      const busy = new Set<string>([
        ...slots
          .filter((slot) => slot.state !== "idle")
          .map((slot) => slot.spec.id),
        ...locks.map((lock) => (lock.agent ?? "").trim()).filter(Boolean),
      ]);
      const gone = removableSeat(seats, busy);
      if (!gone) {
        say(
          seats.length
            ? "Every agent is working or has a task locked to it, so none was removed"
            : "This runner has no agent to remove",
        );
        return;
      }
      next = seats.filter((seat) => seat !== gone);
      change = gone;
    } else return;
    const before = rosterOf(settings).find((spec) => spec.id === change.id);
    seats = next;
    parts.saveCrew?.(options.repo, seats);
    try {
      await provision(tidied);
      await seatCrew();
    } catch (error) {
      say(`could not write this runner's agents: ${message(error)}`);
    }
    enrol();
    const named =
      rosterOf(settings).find((spec) => spec.id === change.id) ?? before;
    const who = `${named?.name ?? `agent ${change.n}`} [${change.kind}]`;
    say(
      `${seats.includes(change) ? "Added" : "Removed"} ${who}, ${count(seats.length, "agent")} now`,
    );
  };
  steering = (key) => void steer(key);
  say("starting");
  const provisioning = begin("Writing this runner's agents");
  let written = true;
  await provision(false).catch((error) => {
    written = false;
    say(`could not write this runner's agents: ${message(error)}`);
  });
  provisioning(
    written ? count(seats.length, "agent") : "could not write the agents",
    !written,
  );
  const finding = begin("Reading the repository");
  await rebase();
  landing = await parts.base(options.repo, "").catch(() => "main");
  let repository = "";
  try {
    repository = await parts.repository(options.repo);
  } catch (error) {
    ui.stop();
    throw error;
  }
  if (!repository)
    say(`${options.repo} has no GitHub origin, so no task matches it`);
  finding(
    repository
      ? `${repositoryName(repository)}, agents branch from ${base}`
      : "no GitHub origin, so no task matches it",
    !repository,
  );
  // The first start in a repository with playwright-core downloads the
  // browser agents take screenshots with, which can take minutes. It happens
  // beside the loop, so the runner joins the board and takes work at once;
  // an agent started before it is ready is simply not told about screenshots.
  let browser: BrowserReport = { ready: false, downloaded: false, reason: "" };
  const fetching = post(
    "Readying the browser agents take screenshots with",
    true,
  );
  void parts
    .browser(options.repo)
    .catch((error): BrowserReport => ({
      ready: false,
      downloaded: false,
      reason: message(error),
    }))
    .then((report) => {
      browser = report;
      const at = feed.indexOf(fetching);
      if (at >= 0) feed.splice(at, 1);
      if (report.downloaded)
        say("Cached the browser agents take screenshots with");
      else if (!report.ready)
        say(`No browser for screenshots: ${report.reason}`);
      else refresh();
    });

  const world = (): World => {
    const known = board.known();
    const task = (id: string | null | undefined) =>
      (id && known.get(id)) || { referenceId: "", name: "", projects: [] };
    const agents: PeerAgent[] = slots
      .filter((slot) => slot.taskId)
      .map((slot) => ({
        agent: slot.spec.name,
        kind: slot.spec.kind,
        taskId: slot.taskId as string,
        reference: slot.reference,
        projects: task(slot.taskId).projects,
        step: slot.step,
        files: slot.edited,
      }));
    const fresh = Date.now() - 5 * 60_000;
    for (const row of rows) {
      if (row.runner_id === board.runnerId) continue;
      if (!(Date.parse(row.last_seen) > fresh)) continue;
      for (const agent of row.agents ?? []) {
        if (!agent?.task_id) continue;
        const on = task(agent.task_id);
        agents.push({
          agent: agent.name || agent.id,
          ...(agent.kind ? { kind: agent.kind } : {}),
          runner: row.name,
          taskId: agent.task_id,
          reference: on.referenceId,
          projects: on.projects,
          ...(agent.step ? { step: agent.step } : {}),
          files: Array.isArray(agent.files) ? agent.files : [],
        });
      }
    }
    const humans: PeerHuman[] = presence.map((row) => {
      const on = task(row.task_id);
      return {
        name: row.user_name || row.handle || "someone",
        client: row.client || "their CLI",
        taskId: row.task_id ?? "",
        reference: on.referenceId,
        projects: on.projects,
        ...(row.note ? { note: row.note } : {}),
      };
    });
    return { agents, humans, merged: [...merged] };
  };
  const tellPeers = () => {
    const now = world();
    for (const slot of slots) {
      if (!slot.worktree || !slot.taskId) continue;
      parts.peers(
        slot.worktree,
        {
          agent: slot.spec.name,
          taskId: slot.taskId,
          projects: board.known().get(slot.taskId)?.projects ?? [],
          upstream: slot.upstream,
          files: [...new Set([...slot.edited, ...slot.read])],
        },
        now,
      );
    }
  };

  // A task an agent here just failed rests before this runner tries it
  // again, longer each time, so a task that cannot succeed as it stands is
  // not claimed, run and abandoned over and over within a minute.
  const resting = new Map<string, { until: number; failures: number }>();
  const rest = (taskId: string) => {
    const failures = (resting.get(taskId)?.failures ?? 0) + 1;
    const minutes = Math.min(60, 5 * 2 ** (failures - 1));
    resting.set(taskId, { until: Date.now() + minutes * 60_000, failures });
    return minutes;
  };
  const restReason = (taskId: string): string => {
    const held = resting.get(taskId);
    if (!held) return "";
    if (held.until <= Date.now()) return "";
    const at = new Date(held.until).toTimeString().slice(0, 5);
    return `failed here, tried again after ${at}`;
  };
  const sift = (tasks: Candidate[]) => {
    const runnable: Candidate[] = [];
    const skipped: Skipped[] = [];
    for (const candidate of tasks) {
      const reason =
        skipReason(candidate, repository) || restReason(candidate.id);
      if (!reason) {
        runnable.push(candidate);
        continue;
      }
      skipped.push({
        id: candidate.id,
        reference: candidate.referenceId,
        name: candidate.name,
        reason,
      });
      const seen = `${candidate.id} ${reason}`;
      if (noted.has(seen)) continue;
      noted.add(seen);
      say(`${candidate.referenceId} skipped: ${reason}`);
    }
    return { runnable, skipped };
  };

  const work = async (
    slot: Slot,
    candidate: Candidate,
    hold: () => Promise<Worktree>,
  ): Promise<Outcome | undefined> => {
    let startRateLimits: RateLimits | undefined;
    let sessionRateLimits: RateLimits | undefined;
    slot.state = "claiming";
    slot.taskId = candidate.id;
    slot.reference = candidate.referenceId;
    slot.name = candidate.name;
    slot.since = Date.now();
    slot.lines = [];
    slot.last = "";
    slot.waiting = "";
    slot.costUsd = 0;
    slot.rateLimits = undefined;
    slot.unlocked = false;
    slot.step = "";
    slot.edited = [];
    slot.read = [];
    slot.upstream = candidate.upstream.map((task) => task.referenceId);
    closeScreen(slot);
    const startedAt = new Date(slot.since).toISOString();
    refresh();
    try {
      await board.claim(candidate.id, slot.spec.id, settings.leaseMinutes);
    } catch (error) {
      // The API answers a refused claim with a sentence of its own, and it is
      // the only place that knows why. Kept on the slot so the heartbeat can
      // carry it to the board, where an agent that cannot start otherwise
      // looks exactly like one with nothing to do.
      slot.waiting = message(error);
      say(`${candidate.referenceId} could not be claimed: ${slot.waiting}`);
      return undefined;
    }
    const knownAtClaim = freshest([
      knownLimits.get(slot.spec.kind),
      ...slots
        .filter((current) => current.spec.kind === slot.spec.kind)
        .map((current) => current.rateLimits),
    ]);
    remember(slot.spec.kind, knownAtClaim);
    if (slot.spec.kind === "claude") startRateLimits = knownAtClaim;
    const agentName = agentIdentity(slot.spec);
    let commit = "";
    let branch = "";
    let proxyPath = "";
    let outcome: Outcome | undefined;
    let result: AgentResult = {
      ok: false,
      error: "The agent never started.",
    };
    try {
      const worktree = await hold();
      slot.worktree = worktree.path;
      branch = worktree.branch;
      const deps = await parts
        .deps(options.repo, worktree.path)
        .catch((error): DepsReport => ({
          linked: false,
          built: false,
          reason: message(error),
        }));
      if (deps.built)
        say(`${candidate.referenceId} built the shared node_modules`);
      else if (deps.reason)
        say(
          `${candidate.referenceId} installs its own dependencies: ${deps.reason}`,
        );
      const proxy = parts.proxy(agentName, board.workspace().id);
      proxyPath = proxy.configPath;
      const prompt = composePrompt(
        candidate,
        {
          worktree: worktree.path,
          branch: worktree.branch,
          deps: deps.linked,
          shots:
            browser.ready &&
            existsSync(join(worktree.path, "scripts", "shot.mjs")),
        },
        slot.spec.brief ?? "",
      );
      slot.state = "working";
      slot.since = Date.now();
      tellPeers();
      refresh();
      const agent = parts.start(slot.spec.kind, {
        prompt,
        cwd: worktree.path,
        repo: options.repo,
        ...(slot.spec.model ? { model: slot.spec.model } : {}),
        agentName,
        mcp: proxy,
        trustWorktree: options.trustWorktree,
        onStatus: (status: AgentStatus) => {
          if (status.rateLimits) {
            if (!startRateLimits) startRateLimits = status.rateLimits;
            sessionRateLimits = status.rateLimits;
            remember(slot.spec.kind, status.rateLimits);
            slot.rateLimits = status.rateLimits;
          }
          if (typeof status.costUsd === "number") slot.costUsd = status.costUsd;
          refresh();
        },
        onActivity: (activity) => {
          slot.step = activity.step;
          slot.edited = activity.edited;
          slot.read = activity.read;
        },
        onLine: (text) => {
          slot.last = text;
          slot.lines.push(text);
          if (slot.lines.length > 200) slot.lines.splice(0, 100);
          ui.log(`${slot.spec.name} ${candidate.referenceId} ${text}`);
          refresh();
        },
      });
      slot.run = agent;
      openScreen(slot, agent);
      refresh();
      result = await agent.done;
      // Codex reports no duration of its own, so the closing line read just
      // "Done."; the runner timed the session and says how long it took.
      const ran = Date.now() - slot.since;
      if (result.durationMs === undefined && ran >= 1000)
        result = { ...result, durationMs: ran };
      if (result.rateLimits) {
        if (!startRateLimits) startRateLimits = result.rateLimits;
        sessionRateLimits = result.rateLimits;
        remember(slot.spec.kind, result.rateLimits);
        slot.rateLimits = result.rateLimits;
      }
      slot.costUsd = result.costUsd ?? slot.costUsd;
      spent += result.costUsd ?? 0;
      slot.run = undefined;
      slot.state = "committing";
      refresh();
      const closed = await parts.commit(
        options.repo,
        worktree,
        `Task ${candidate.referenceId}: ${candidate.name}`,
      );
      commit = closed.commit;
      if (closed.pushed)
        say(`${candidate.referenceId} pushed ${short(commit.slice(0, 7))}`);
    } catch (error) {
      result = { ...result, ok: false, error: message(error) };
      say(`${candidate.referenceId} stopped: ${message(error)}`);
    } finally {
      if (proxyPath) rmSync(proxyPath, { force: true });
      const windows =
        slot.spec.kind === "claude"
          ? usageWindows(startRateLimits, sessionRateLimits)
          : undefined;
      if (!slot.unlocked) {
        outcome = await board
          .close(
            candidate.id,
            { ...result, ...(windows ? { windows } : {}) },
            commit,
            agentName,
            startedAt,
          )
          .catch((error) => {
            say(
              `${candidate.referenceId} could not be closed: ${message(error)}`,
            );
            return undefined;
          });
        if (outcome)
          say(
            `${candidate.referenceId} ${outcome}${commit ? ` ${commit.slice(0, 7)}` : ""}${result.costUsd ? ` ${money(result.costUsd)}` : ""}`,
          );
        if (outcome === "done") resting.delete(candidate.id);
        else if (outcome === "abandoned" || !result.ok) {
          const minutes = rest(candidate.id);
          say(
            `${candidate.referenceId} rests ${minutes}m before this runner tries it again${result.error ? `: ${result.error}` : ""}`,
          );
        }
        await board.release(candidate.id).catch(() => false);
      } else if (branch)
        say(
          `WRL·${candidate.referenceId} partial work stays on ${branch}${commit ? ` at ${commit.slice(0, 7)}` : ""}, worktree kept`,
        );
      refresh();
    }
    return outcome;
  };

  const merge = async (
    worktree: Worktree,
    carried: readonly string[],
    firstName: string,
    lastTaskId: string,
    agentName: string,
  ): Promise<boolean> => {
    const reference = carried[0] ?? "";
    const checks = options.checks ?? [];
    flow(
      checks.length
        ? `Merging ${worktree.branch}`
        : `Merging ${worktree.branch}, with no checks set on this machine`,
    );
    const failed = await parts
      .checks(checks, worktree.path, (text) => {
        ui.log(text);
        if (text.startsWith("Checks: ")) mark(text);
      })
      .catch((error): CheckRun => ({
        command: "checks",
        code: 1,
        output: message(error),
      }));
    if (failed) {
      const text = `Checks failed on ${worktree.branch}, so it stays a branch: ${failed.command} exited ${failed.code}`;
      flow(text);
      await board
        .note(lastTaskId, "blocker", text, undefined, agentName)
        .catch(() => {});
      return false;
    }
    const outcome = await parts
      .merge(
        options.repo,
        worktree,
        carried.length > 1
          ? mergeMessage(carried)
          : `Merge ${worktree.branch}: ${firstName}`,
      )
      .catch((error): MergeOutcome => ({
        merged: false,
        conflicts: [],
        error: message(error),
      }));
    if (!outcome.merged) {
      const text = outcome.conflicts.length
        ? `${worktree.branch} conflicts with ${worktree.base}, so it stays a branch: ${outcome.conflicts.join(", ")}`
        : `${worktree.branch} could not be merged into ${worktree.base}, so it stays a branch: ${outcome.error}`;
      flow(text);
      await board
        .note(lastTaskId, "blocker", short(text, 300), undefined, agentName)
        .catch(() => {});
      return false;
    }
    const mergedLine = `Merged into ${worktree.base} as ${outcome.commit.slice(0, 7)}`;
    flow(mergedLine);
    for (const carriedReference of carried)
      merged.push({
        reference: carriedReference,
        name: carriedReference === reference ? firstName : "",
        base: worktree.base,
        commit: outcome.commit,
      });
    merged.splice(0, Math.max(0, merged.length - 20));
    tellPeers();
    await board
      .note(lastTaskId, "change", mergedLine, outcome.commit, agentName)
      .catch((error) =>
        say(`${reference} merge note failed: ${message(error)}`),
      );
    await follow();
    return true;
  };

  const follow = async () => {
    const state = await measure(true);
    if (!state) return;
    const pulled = await parts
      .pull(options.repo, state)
      .catch((error) => ({ pulled: false, reason: message(error) }));
    flow(pulled.reason);
    if (pulled.pulled) await measure(true);
  };

  const line = async (slot: Slot, first: Candidate) => {
    let candidate: Candidate | undefined = first;
    let following = "";
    const walked = new Set<string>();
    const carried: string[] = [];
    let worktree: Worktree | undefined;
    let last = first;
    let outcome: Outcome | undefined;
    const hold = async () => {
      if (!worktree) {
        worktree = await parts.open(
          options.repo,
          first.referenceId,
          await rebase(),
        );
        lines.set(worktree.branch, worktree);
      }
      return worktree;
    };
    try {
      while (candidate) {
        slot.following = following;
        last = candidate;
        carried.push(candidate.referenceId);
        outcome = await work(slot, candidate, hold);
        if (slot.unlocked) break;
        const held = pauseNote(
          slot.rateLimits,
          slot.spec.pauseAbovePercent ?? settings.pauseAbovePercent,
        );
        if (
          settings.mode !== "directed" ||
          outcome !== "done" ||
          held ||
          halted
        )
          break;
        following = candidate.referenceId;
        walked.add(candidate.id);
        slot.state = "claiming";
        slot.following = following;
        slot.last = "";
        refresh();
        const next: Candidate[] = sift(
          await board
            .live()
            .then((leases) =>
              board.candidates(walked, [
                ...leases,
                ...presenceLeases(presence),
              ]),
            )
            .catch((error) => {
              say(`task list failed: ${message(error)}`);
              return [] as Candidate[];
            }),
        ).runnable;
        const taken = new Set(
          slots.filter((other) => other !== slot).map((other) => other.taskId),
        );
        candidate = next.find(
          (task) =>
            !taken.has(task.id) &&
            locks.some(
              (lock) =>
                lock.task_id === task.id && lockedTo(lock, slot.spec.id),
            ),
        );
      }
      if (
        worktree &&
        !slot.unlocked &&
        outcome === "done" &&
        (settings.mergePolicy ?? "merge") === "merge"
      ) {
        slot.state = "merging";
        slot.last = `merging ${worktree.branch}`;
        refresh();
        await merge(
          worktree,
          carried,
          first.name,
          last.id,
          agentIdentity(slot.spec),
        );
      }
    } finally {
      if (worktree) {
        const open = worktree;
        lines.delete(open.branch);
        if (!slot.unlocked)
          await parts
            .remove(options.repo, open)
            .catch((error) =>
              say(`${first.referenceId} left a worktree: ${message(error)}`),
            );
      }
      Object.assign(slot, idle(slot.spec));
      refresh();
    }
  };

  const promote = async () => {
    const branch = await rebase();
    const target = await parts.base(options.repo, "").catch(() => "main");
    if (!branch || branch === target) {
      flow(`No agent branch to promote into ${target}`);
      return;
    }
    flow(`Promoting ${branch} into ${target}`);
    const outcome = await parts
      .promote(options.repo, branch, target)
      .catch((error): PromoteOutcome => ({
        promoted: false,
        tasks: [],
        conflicts: [],
        error: message(error),
      }));
    if (!outcome.promoted) {
      flow(
        outcome.conflicts.length
          ? `${branch} conflicts with ${target}: ${outcome.conflicts.join(", ")}`
          : outcome.error,
      );
      await follow();
      return;
    }
    const carried = `Promoted ${branch} into ${target} as ${outcome.commit.slice(0, 7)}`;
    flow(
      outcome.tasks.length
        ? `${carried}, carrying ${count(outcome.tasks.length, "task")}`
        : carried,
    );
    for (const reference of outcome.tasks) {
      const task = await board.named(reference).catch(() => undefined);
      if (!task) continue;
      await board
        .note(task.id, "change", carried, outcome.commit)
        .catch(() => {});
    }
    await follow();
  };

  const chore = async (pending: FlowRequest) => {
    let settled = true;
    try {
      if (pending.kind === "pull") {
        await follow();
        return;
      }
      if (pending.kind === "promote") {
        await promote();
        return;
      }
      const task = await board.lineOf(pending.task_id);
      if (task.merged) {
        flow(`${task.referenceId} was merged already`);
        return;
      }
      const branch = await parts.branchOf(options.repo, task.commit);
      if (!branch) {
        flow(`${task.referenceId} has no branch to merge`);
        return;
      }
      if (lines.has(branch)) {
        settled = false;
        return;
      }
      const reference = branch.slice("wireal/".length);
      const first = await board.named(reference).catch(() => undefined);
      const worktree = await parts.open(
        options.repo,
        reference,
        await rebase(),
      );
      lines.set(worktree.branch, worktree);
      try {
        await merge(
          worktree,
          [reference],
          first?.name ?? task.name,
          task.id,
          await board.agentOf(task.id),
        );
      } finally {
        lines.delete(worktree.branch);
        await parts
          .remove(options.repo, worktree)
          .catch((error) =>
            say(`${reference} left a worktree: ${message(error)}`),
          );
      }
    } catch (error) {
      flow(`request failed: ${message(error)}`);
    } finally {
      if (settled)
        await board.completeRequest(pending.request_id).catch(() => false);
      doing.delete(pending.request_id);
      chores.delete(pending.request_id);
      refresh();
    }
  };

  const askUsage = async (now = Date.now()) => {
    const due = hosts.filter((kind) => (asking.get(kind) ?? 0) <= now);
    if (!due.length) return;
    await Promise.all(
      due.map(async (kind) => {
        const read = await parts
          .usage(kind)
          .catch((error) => ({ error: message(error) }) as UsageRead);
        asking.set(kind, now + (read.waitMs ?? parts.usageEvery(kind)));
        if (read.limits) remember(kind, read.limits);
        if (!read.error || (read.limits && read.waitMs)) return;
        const seen = `usage ${kind} ${read.error}`;
        if (noted.has(seen)) return;
        noted.add(seen);
        say(read.error);
      }),
    );
    refresh();
  };

  const tick = async () => {
    if (quitting) return;
    const called = parts.named(options.repo);
    if (called && called !== board.name) {
      board.rename(called);
      say(`this runner is now called ${called}`);
    }
    await askUsage();
    const reported = rosterOf(settings).filter(
      (spec) =>
        (spec.enabled &&
          hosts.includes(spec.kind) &&
          (!spec.runner || ownedBy(spec, board.runnerId))) ||
        slots.some((slot) => slot.spec.id === spec.id && slot.state !== "idle"),
    );
    const reports: AgentReport[] = reported.map((spec) => {
      const slot = slots.find((seat) => seat.spec.id === spec.id);
      const held = pauseNote(
        slot?.rateLimits,
        spec.pauseAbovePercent ?? settings.pauseAbovePercent,
      );
      const waiting = slot?.taskId
        ? ""
        : (halted ? "Paused on its runner" : "") || held || slot?.waiting || "";
      return {
        id: spec.id,
        name: spec.name,
        kind: spec.kind,
        task_id: slot?.taskId ?? null,
        since: new Date(slot?.since || Date.now()).toISOString(),
        ...(waiting ? { waiting: waiting.slice(0, 300) } : {}),
        ...(slot?.taskId ? agentActivity(slot) : {}),
      };
    });
    await measure(false);
    let heard = false;
    try {
      const reply = await board.heartbeat(
        reports,
        hosts,
        spent,
        settings.leaseMinutes,
        limitsByKind(
          [...knownLimits].map(([kind, limits]) => ({ kind, limits })),
        ),
        folder && {
          branch: folder.branch,
          dirty: folder.dirty,
          ahead: folder.ahead,
          behind: folder.behind,
          upstream: folder.upstream,
          path: shortPath(options.repo),
        },
      );
      if (
        reply?.ping_requested_at &&
        reply.ping_requested_at !== reply.ping_answered_at
      )
        say("the app pinged this runner");
      heard = true;
      offline = false;
      seated = new Set(reply?.seats ?? []);
      presence = livePresence(reply);
      wanted = reply?.wanted ?? [];
      locks = ownLocks(reply);
      const leased = new Set(
        (reply?.leases ?? []).map((lease) => lease.task_id),
      );
      for (const slot of slots) {
        if (slot.state !== "working" || !slot.taskId) continue;
        if (leased.has(slot.taskId)) continue;
        slot.unlocked = true;
        const person = presence.find((row) => row.task_id === slot.taskId);
        say(
          person
            ? `WRL·${slot.reference} was taken over by ${person.user_name || "someone"} in ${person.client || "their CLI"}, ${slot.spec.name} stopped`
            : `WRL·${slot.reference} was unlocked in the app, ${slot.spec.name} stopped`,
        );
        slot.run?.stop();
      }
      for (const request of pendingRequests(reply)) {
        if (doing.has(request.request_id)) continue;
        if (
          (request.kind === "pull" || request.kind === "promote") &&
          !addressedHere(request, board.runnerId)
        )
          continue;
        doing.add(request.request_id);
        chores.set(request.request_id, chore(request));
      }
    } catch (error) {
      offline = true;
      if (!signedOut(error)) say(`heartbeat failed: ${message(error)}`);
      else if (!lockedOut) {
        lockedOut = true;
        say(
          "This machine is signed out of Wireal. Run `wireal-run login`, then start the runner again.",
        );
      }
    }
    try {
      settings = await board.settings();
    } catch (error) {
      if (!signedOut(error)) say(`workspace read failed: ${message(error)}`);
    }
    if (!lockedOut && heard) {
      await provision(true).catch((error) =>
        say(`could not write this runner's agents: ${message(error)}`),
      );
      await seatCrew();
    }
    enrol();
    const crew = crewLine(
      board.name,
      slots.map((slot) => slot.spec),
    );
    if (slots.length && crew !== toldCrew) {
      toldCrew = crew;
      say(crew);
    }
    const known = board.known();
    for (const row of presence) {
      const task = known.get(row.task_id ?? "");
      const seen = `presence ${row.task_id} ${row.user_id || row.user_name}`;
      if (!task || noted.has(seen)) continue;
      noted.add(seen);
      say(
        `WRL·${task.referenceId} is being worked on by ${row.user_name || "someone"} in ${row.client || "their CLI"}`,
      );
    }
    tellPeers();
    if (lockedOut) {
      if (slots.every((slot) => slot.state === "idle") && !chores.size)
        await quit("signed out");
      return;
    }
    const signature = heldIds().join(",");
    if (signature !== toldHeld) {
      toldHeld = signature;
      if (signature) {
        rows = await board.runners().catch(() => rows);
        for (const line of heldLines()) say(line);
      }
    }
    if (!slots.length) {
      const empty = !hosts.length
        ? "No agents: neither claude nor codex is on this runner's PATH"
        : !rosterOf(settings).length
          ? "No agents: this runner runs none, + adds one"
          : unpicked;
      if (note !== empty) say(empty);
      started = true;
      if (options.once) await quit("done");
      return;
    }
    if (options.once && started) {
      if (slots.every((slot) => slot.state === "idle") && !chores.size)
        await quit("done");
      return;
    }
    const held =
      settings.mode === "paused"
        ? "Paused"
        : halted
          ? "Intake paused on this runner, p resumes"
          : "";
    if (held !== paused) {
      paused = held;
      if (held) say(held);
      else refresh();
    }
    if (paused) {
      if (options.once && slots.every((slot) => slot.state === "idle"))
        await quit("paused");
      return;
    }
    const newlyPaused = slots
      .map((slot) => ({
        slot,
        note: pauseNote(
          limitsOf(slot),
          slot.spec.pauseAbovePercent ?? settings.pauseAbovePercent,
        ),
      }))
      .filter(({ note: pause }) => pause);
    for (const { slot, note: pause } of newlyPaused) {
      const seen = `${slot.spec.id} ${pause}`;
      if (noted.has(seen)) continue;
      noted.add(seen);
      say(pause);
    }
    const working = slots.filter((slot) => slot.state !== "idle");
    const heldAgents = new Set(newlyPaused.map(({ slot }) => slot.spec.id));
    const open = slots.filter(
      (slot) => slot.state === "idle" && !heldAgents.has(slot.spec.id),
    );
    const room =
      cap === undefined ? open.length : Math.max(0, cap - working.length);
    if (room)
      rows = await board.runners().catch((error) => {
        say(`runner list failed: ${message(error)}`);
        return [] as RunnerRow[];
      });
    else if (working.length) rows = await board.runners().catch(() => rows);
    const leases = room
      ? [...liveLeases(rows), ...presenceLeases(presence)]
      : [];
    const busy = leaseHolders(leases);
    for (const slot of working) busy.add(slot.spec.id);
    const available = new Set(
      freeAgents(
        open.map((slot) => slot.spec),
        hosts,
        busy,
      ).map((agent) => agent.id),
    );
    const named = new Set(
      locks.map((lock) => (lock.agent ?? "").trim()).filter(Boolean),
    );
    const free = open
      .filter((slot) => available.has(slot.spec.id))
      .sort(
        (left, right) =>
          Number(named.has(right.spec.id)) - Number(named.has(left.spec.id)),
      )
      .slice(0, room);
    const sifted = sift(
      free.length
        ? await board.candidates(undefined, leases).catch((error) => {
            say(`task list failed: ${message(error)}`);
            return [] as Candidate[];
          })
        : [],
    );
    const ready = sifted.runnable;
    blocked = sifted.skipped;
    const taken = new Set(slots.map((slot) => slot.taskId));
    const engaged = new Set<string>();
    for (const slot of free) {
      const candidate = ready.find(
        (task) =>
          !taken.has(task.id) &&
          !task.projectIds.some((projectId) => engaged.has(projectId)) &&
          locks.some(
            (lock) => lock.task_id === task.id && lockedTo(lock, slot.spec.id),
          ),
      );
      if (!candidate) continue;
      taken.add(candidate.id);
      for (const projectId of candidate.projectIds) engaged.add(projectId);
      slot.work = line(slot, candidate);
    }
    started = true;
    if (
      options.once &&
      slots.every((slot) => slot.state === "idle") &&
      !chores.size
    )
      await quit("nothing to do");
  };

  const quit = async (reason: string) => {
    if (quitting) return;
    quitting = true;
    say(`${reason}, stopping agents`);
    for (const slot of slots) slot.run?.stop();
    await Promise.race([
      Promise.allSettled([
        ...slots.map((slot) => slot.work),
        ...chores.values(),
      ]),
      new Promise((done) => setTimeout(done, 30_000).unref()),
    ]);
    for (const slot of slots)
      if (slot.taskId) await board.release(slot.taskId).catch(() => false);
    await board.leave().catch(() => false);
    clearInterval(timer);
    awake.release();
    if (parts.signals) {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    }
    ui.stop();
    for (const slot of slots) closeScreen(slot);
    settle();
  };
  stopping = (reason) => void quit(reason);

  const timer = setInterval(() => {
    void tick();
  }, parts.interval);
  const interrupt = () => void quit("interrupted");
  const terminate = () => void quit("terminated");
  if (parts.signals) {
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
  }
  say(
    hosts.length
      ? `runner ${board.name} ready, its agents can run on ${hosts.join(" and ")}`
      : `runner ${board.name} ready, but neither claude nor codex is on its PATH`,
  );
  const joining = begin("Joining the board");
  await tick();
  joining(offline ? "the board did not answer" : "on the board", offline);
  booting = false;
  refresh();
  await finished;
}

function money(value: number | undefined): string {
  return value === undefined ? "" : `$${value.toFixed(2)}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
