import type {
  AgentKind,
  AgentMode,
  AgentSettings,
  AgentSpec,
  Link,
  Task,
} from "./domain";
import { namesBrand } from "./domain";

export type RunnerAgent = {
  id: string;
  name: string;
  kind: AgentKind;
  task_id: string | null;
  since: string;
  waiting: string;
  /** What the agent is doing right now, e.g. "editing src/api.ts". */
  step?: string;
  /** Its latest line of output. */
  last?: string;
  /** The files it is touching. */
  files?: string[];
};

/** A person's own CLI session (Claude Code, Codex…) working through the Wireal
 *  MCP outside any runner. It is reported so the runner's agents and the app
 *  both know someone is on that task. */
export type Presence = {
  workspace_id: string;
  session: string;
  user_id: string;
  user_name: string;
  client: string;
  handle: string;
  task_id: string | null;
  note: string;
  last_seen: string;
};

export type RunnerFolder = {
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  upstream: string;
  path: string;
};

export type Lease = {
  task_id: string;
  agent: string;
  since: string;
  until: string;
};

export type RunnerSeat = {
  agent_id: string;
  since: string;
};

export type TaskLock = {
  workspace_id: string;
  task_id: string;
  agent: string | null;
  owner_id: string;
  owner_name: string;
  since: string;
};

export type RateLimitWindow = {
  used_percentage?: number;
  resets_at?: number | string;
  [key: string]: unknown;
};

export type RateLimits = {
  five_hour?: RateLimitWindow;
  seven_day?: RateLimitWindow;
  captured_at?: string;
  source?: string;
  [key: string]: unknown;
};

export type ParsedRateWindow = {
  usedPercentage: number | null;
  resetsAt: Date | null;
};

export type RateLimitTone = "success" | "warning" | "danger";

export type Runner = {
  runner_id: string;
  name: string;
  host: string;
  owner_id: string;
  owner_name: string;
  workspace_id: string;
  workspace_name: string;
  hosts: AgentKind[];
  since: string;
  last_seen: string;
  agents: RunnerAgent[];
  rate_limits: RateLimits | null;
  cost_usd: number;
  ping_requested_at: string | null;
  ping_answered_at: string | null;
  leases: Lease[];
  seats: RunnerSeat[];
  wanted: string[];
  folder: RunnerFolder | null;
};

export type RunnerAgentSlot = { runner: Runner; agent: RunnerAgent };

export type PingRequest = { at: string; startedAt: number };

export type PingOutcome =
  | { state: "idle" }
  | { state: "waiting"; seconds: number }
  | { state: "answered"; seconds: number }
  | { state: "timeout"; seconds: number };

export const connectedWindowMs = 120_000;
export const pingTimeoutMs = 30_000;
export const runnerPollMs = 10_000;

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asOptionalText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseRateLimits(value: unknown): RateLimits | null {
  const limits = asObject(value);
  return limits ? (limits as RateLimits) : null;
}

export function agentKind(value: unknown, fallback: AgentKind = "claude") {
  return value === "codex" || value === "claude" ? value : fallback;
}

function parseHosts(value: unknown): AgentKind[] {
  if (!Array.isArray(value)) return [];
  const kinds: AgentKind[] = [];
  for (const entry of value) {
    if (entry !== "claude" && entry !== "codex") continue;
    if (!kinds.includes(entry)) kinds.push(entry);
  }
  return kinds;
}

function parseAgent(value: unknown): RunnerAgent {
  const row = (value ?? {}) as Record<string, unknown>;
  const legacy = asText(row.agent);
  return {
    id: asText(row.id) || legacy,
    name: asText(row.name) || legacy,
    kind: agentKind(row.kind, legacy === "codex" ? "codex" : "claude"),
    task_id: asOptionalText(row.task_id),
    since: asText(row.since),
    waiting: asText(row.waiting).slice(0, 300),
    ...(asText(row.step) ? { step: asText(row.step).slice(0, 120) } : {}),
    ...(asText(row.last) ? { last: asText(row.last).slice(0, 300) } : {}),
    ...(Array.isArray(row.files) && row.files.length
      ? {
          files: row.files
            .filter((file): file is string => typeof file === "string")
            .slice(0, 20),
        }
      : {}),
  };
}

export const presenceWindowMs = 10 * 60_000;

export function parsePresence(value: unknown): Presence {
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    workspace_id: asText(row.workspace_id),
    session: asText(row.session),
    user_id: asText(row.user_id),
    user_name: asText(row.user_name),
    client: asText(row.client),
    handle: asText(row.handle),
    task_id: asOptionalText(row.task_id),
    note: asText(row.note).slice(0, 200),
    last_seen: asText(row.last_seen),
  };
}

export function livePresence(
  rows: readonly Presence[],
  now = Date.now(),
): Presence[] {
  return rows.filter((row) => {
    const seen = Date.parse(row.last_seen);
    return Number.isFinite(seen) && now - seen <= presenceWindowMs;
  });
}

function parseFolder(value: unknown): RunnerFolder | null {
  const row = asObject(value);
  if (!row) return null;
  const distance = (entry: unknown) => Math.max(0, Math.round(asNumber(entry)));
  return {
    branch: asText(row.branch),
    dirty: row.dirty === true,
    ahead: distance(row.ahead),
    behind: distance(row.behind),
    upstream: asText(row.upstream),
    path: asText(row.path),
  };
}

function parseLease(value: unknown): Lease {
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    task_id: asText(row.task_id),
    agent: asText(row.agent),
    since: asText(row.since),
    until: asText(row.until),
  };
}

function parseSeat(value: unknown): RunnerSeat {
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    agent_id: asText(row.agent_id) || asText(row.agent) || asText(row.id),
    since: asText(row.since),
  };
}

function parseWanted(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    const id = asText(entry);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function parseTaskLock(value: unknown): TaskLock {
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    workspace_id: asText(row.workspace_id),
    task_id: asText(row.task_id),
    agent: asOptionalText(row.agent),
    owner_id: asText(row.owner_id),
    owner_name: asText(row.owner_name),
    since: asText(row.since),
  };
}

export function parseRunner(value: unknown): Runner {
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    runner_id: asText(row.runner_id),
    name: asText(row.name),
    host: asText(row.host),
    owner_id: asText(row.owner_id),
    owner_name: asText(row.owner_name),
    workspace_id: asText(row.workspace_id),
    workspace_name: asText(row.workspace_name),
    hosts: parseHosts(row.hosts),
    since: asText(row.since),
    last_seen: asText(row.last_seen),
    agents: Array.isArray(row.agents) ? row.agents.map(parseAgent) : [],
    rate_limits: parseRateLimits(row.rate_limits),
    cost_usd: asNumber(row.cost_usd),
    ping_requested_at: asOptionalText(row.ping_requested_at),
    ping_answered_at: asOptionalText(row.ping_answered_at),
    leases: Array.isArray(row.leases) ? row.leases.map(parseLease) : [],
    seats: Array.isArray(row.seats)
      ? row.seats.map(parseSeat).filter((seat) => !!seat.agent_id)
      : [],
    wanted: parseWanted(row.wanted),
    folder: parseFolder(row.folder),
  };
}
export function rateWindow(
  limits: RateLimits | null | undefined,
  key: string,
  now = Date.now(),
): ParsedRateWindow {
  const window = asObject(limits?.[key]);
  const percentage = window?.used_percentage;
  const usedPercentage =
    typeof percentage === "number" && Number.isFinite(percentage)
      ? percentage
      : null;
  const resetValue = window?.resets_at;
  let resetTime = Number.NaN;
  if (typeof resetValue === "number" && Number.isFinite(resetValue)) {
    resetTime =
      Math.abs(resetValue) < 1_000_000_000_000 ? resetValue * 1000 : resetValue;
  } else if (typeof resetValue === "string" && resetValue.trim()) {
    const numeric = Number(resetValue);
    resetTime = Number.isFinite(numeric)
      ? Math.abs(numeric) < 1_000_000_000_000
        ? numeric * 1000
        : numeric
      : Date.parse(resetValue);
  }
  const resetsAt = Number.isFinite(resetTime) ? new Date(resetTime) : null;
  // A window that has reset since the report was taken is empty now, however
  // full it was then.
  if (resetsAt && resetsAt.getTime() <= now)
    return {
      usedPercentage: usedPercentage === null ? null : 0,
      resetsAt: null,
    };
  return {
    usedPercentage,
    resetsAt: resetsAt && Number.isFinite(resetsAt.getTime()) ? resetsAt : null,
  };
}

/** The crew pill, the rings and the cards share one scale: calm below 60%,
 *  amber from there, and red from 85%, a little under the pause limit most
 *  workspaces set, so the colour arrives before the pause does. */
export function rateLimitTone(percentage: number | null): RateLimitTone {
  if (percentage !== null && percentage >= 85) return "danger";
  if (percentage !== null && percentage >= 60) return "warning";
  return "success";
}

export function runnerKinds(runner: Runner): AgentKind[] {
  if (runner.hosts.length) return runner.hosts;
  const kinds: AgentKind[] = [];
  for (const agent of runner.agents)
    if (!kinds.includes(agent.kind)) kinds.push(agent.kind);
  return kinds;
}

export function kindRateLimits(
  runner: Runner,
  kind: AgentKind,
): RateLimits | null {
  const limits = runner.rate_limits;
  const keyed = asObject(limits?.by_kind);
  if (keyed) return (asObject(keyed[kind]) as RateLimits | null) ?? null;
  if (!limits) return null;
  const source = asText(limits.source);
  if (source) return source === kind ? limits : null;
  const kinds = runnerKinds(runner);
  return kinds.length === 1 && kinds[0] === kind ? limits : null;
}

/** What one CLI on one live runner has used of its two windows. */
export type UsageReading = {
  runner: Runner;
  kind: AgentKind;
  fiveHour: ParsedRateWindow;
  weekly: ParsedRateWindow;
  capturedAt: number | null;
};

/** Every CLI's usage on the live runners. An offline runner's limits are
 *  whatever it last reported, which can be hours old and read as current, so
 *  only a connected one is read. */
export function usageReadings(
  runners: readonly Runner[],
  now = Date.now(),
): UsageReading[] {
  return connectedRunners(runners, now).flatMap((runner) =>
    runnerKinds(runner).flatMap((kind) => {
      const limits = kindRateLimits(runner, kind);
      if (!limits) return [];
      const fiveHour = rateWindow(limits, "five_hour", now);
      const weekly = rateWindow(limits, "seven_day", now);
      if (fiveHour.usedPercentage === null && weekly.usedPercentage === null)
        return [];
      // A report split by CLI stamps the whole report once, not each CLI.
      const captured = Date.parse(
        limits.captured_at ?? runner.rate_limits?.captured_at ?? "",
      );
      return [
        {
          runner,
          kind,
          fiveHour,
          weekly,
          capturedAt: Number.isFinite(captured) ? captured : null,
        },
      ];
    }),
  );
}

/** The fullest weekly window on any live runner, which is the one that stops
 *  work first, or null when no runner has said. */
export function peakWeeklyUsage(
  runners: readonly Runner[],
  now = Date.now(),
): number | null {
  let peak: number | null = null;
  for (const reading of usageReadings(runners, now)) {
    const used = reading.weekly.usedPercentage;
    if (used !== null && (peak === null || used > peak)) peak = used;
  }
  return peak;
}

/** Each CLI's weekly use, the highest across live runners, Claude first. */
export function weeklyUsageByKind(
  runners: readonly Runner[],
  now = Date.now(),
): { kind: AgentKind; used: number }[] {
  const peaks = new Map<AgentKind, number>();
  for (const reading of usageReadings(runners, now)) {
    const used = reading.weekly.usedPercentage;
    if (used === null) continue;
    peaks.set(reading.kind, Math.max(used, peaks.get(reading.kind) ?? 0));
  }
  return [...peaks]
    .map(([kind, used]) => ({ kind, used }))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "claude" ? -1 : 1));
}

/** A running clock for how long an agent has been on its task: 0:42, 12:05,
 *  1:02:03. Seconds are shown so the timer visibly moves. */
export function formatElapsed(since: string, now: number): string {
  const start = Date.parse(since);
  if (!Number.isFinite(start)) return "";
  const total = Math.max(0, Math.floor((now - start) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** How long until a window resets, in the largest two units that matter. */
export function formatCountdown(until: Date | null, now: number): string {
  if (!until) return "";
  const minutes = Math.max(0, Math.round((until.getTime() - now) / 60000));
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}

export function secondsSince(value: string, now: number): number | null {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.round((now - time) / 1000));
}

export function isConnected(runner: Runner, now = Date.now()): boolean {
  const time = Date.parse(runner.last_seen);
  if (!Number.isFinite(time)) return false;
  return now - time <= connectedWindowMs;
}

export function connectedRunners(
  runners: readonly Runner[],
  now = Date.now(),
): Runner[] {
  return runners.filter((runner) => isConnected(runner, now));
}

export function workingAgents(
  runners: readonly Runner[],
  now = Date.now(),
): RunnerAgentSlot[] {
  return connectedRunners(runners, now).flatMap((runner) =>
    runner.agents
      .filter((agent) => !!agent.task_id)
      .map((agent) => ({ runner, agent })),
  );
}

export function pingOutcome(
  runner: Runner | null | undefined,
  request: PingRequest | null,
  now: number,
  timeoutMs = pingTimeoutMs,
): PingOutcome {
  if (!request) return { state: "idle" };
  const requested = Date.parse(request.at);
  const answered = Date.parse(runner?.ping_answered_at ?? "");
  if (
    Number.isFinite(requested) &&
    Number.isFinite(answered) &&
    answered >= requested
  )
    return {
      state: "answered",
      seconds: Math.max(0, Math.round((answered - requested) / 1000)),
    };
  const elapsed = now - request.startedAt;
  if (elapsed >= timeoutMs)
    return { state: "timeout", seconds: Math.round(timeoutMs / 1000) };
  return { state: "waiting", seconds: Math.max(0, Math.round(elapsed / 1000)) };
}

export function formatUsd(value: number): string {
  const amount = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `$${amount.toFixed(2)}`;
}

export function formatPercent(value: number): string {
  const amount = Number.isFinite(value) ? value : 0;
  return `${Math.round(Math.min(100, Math.max(0, amount)))}%`;
}

export type LiveLease = {
  taskId: string;
  agent: string;
  runnerId: string;
  runnerName: string;
  until: string;
};

export function liveLeases(
  runners: readonly Runner[],
  now = Date.now(),
): LiveLease[] {
  return connectedRunners(runners, now).flatMap((runner) =>
    runner.leases
      .filter((lease) => {
        const until = Date.parse(lease.until);
        return !!lease.task_id && Number.isFinite(until) && until > now;
      })
      .map((lease) => ({
        taskId: lease.task_id,
        agent: lease.agent,
        runnerId: runner.runner_id,
        runnerName: runner.name,
        until: lease.until,
      })),
  );
}

export const flowRequestKinds = ["merge", "pull"] as const;

export type FlowRequestKind = (typeof flowRequestKinds)[number];

export type FlowRequest = {
  request_id: string;
  task_id: string;
  agent: string;
  kind: FlowRequestKind;
  requested_by: string;
  requested_by_name: string;
  requested_at: string;
};

export function flowRequestKind(value: unknown): FlowRequestKind {
  const kind = asText(value);
  return (flowRequestKinds as readonly string[]).includes(kind)
    ? (kind as FlowRequestKind)
    : "merge";
}

export function parseFlowRequest(value: unknown): FlowRequest {
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    request_id: asText(row.request_id),
    task_id: asText(row.task_id),
    agent: asText(row.agent),
    kind: flowRequestKind(row.kind),
    requested_by: asText(row.requested_by),
    requested_by_name: asText(row.requested_by_name),
    requested_at: asText(row.requested_at),
  };
}

const mergedActivity = /^Merged into main as\s+([0-9a-f]{7,40})/i;

export function mergedCommit(task: Pick<Task, "activity">): string | null {
  for (const entry of task.activity) {
    const match = mergedActivity.exec(entry.text.trim());
    if (match) return entry.commit || match[1];
  }
  return null;
}

export function awaitingMerge(
  task: Pick<Task, "id">,
  requests: readonly FlowRequest[],
): boolean {
  return requests.some(
    (request) => request.kind === "merge" && request.task_id === task.id,
  );
}

export function lineBranch(task: Pick<Task, "referenceId">): string {
  return `wireal/${task.referenceId}`;
}

export function compareUrl(
  repositoryUrl: string,
  branch: string,
  onto = "main",
): string {
  const base = repositoryUrl.replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/compare/${onto || "main"}...${branch}?expand=1`;
}

export type FolderState = {
  runnerId: string;
  runnerName: string;
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  upstream: string;
  path: string;
};

export function folderState(
  runners: readonly Runner[],
  workspaceId: string,
  now = Date.now(),
): FolderState | null {
  let best: FolderState | null = null;
  for (const runner of wiredRunners(runners, workspaceId, now)) {
    const folder = runner.folder;
    if (!folder) continue;
    const candidate: FolderState = {
      runnerId: runner.runner_id,
      runnerName: runner.name,
      branch: folder.branch,
      dirty: folder.dirty,
      ahead: folder.ahead,
      behind: folder.behind,
      upstream: folder.upstream,
      path: folder.path,
    };
    if (!best) {
      best = candidate;
      continue;
    }
    if (candidate.behind > best.behind) best = candidate;
    else if (candidate.behind === best.behind && candidate.dirty && !best.dirty)
      best = candidate;
  }
  return best;
}

export function agentRoster(settings: AgentSettings): AgentSpec[] {
  return settings.roster ?? [];
}

export function pausePercent(value: unknown): number | undefined {
  const parsed =
    typeof value === "number" ? value : Number(asText(value).trim() || NaN);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(100, Math.max(50, Math.round(parsed)));
}

export function parseAgentSpec(value: unknown): AgentSpec {
  const row = (value ?? {}) as Record<string, unknown>;
  const kind = agentKind(row.kind);
  const model = asText(row.model).trim();
  const brief = asText(row.brief).trim();
  const pause = pausePercent(row.pauseAbovePercent);
  const runner = asText(row.runner).trim();
  return {
    id: asText(row.id) || newAgentId(),
    name: asText(row.name).trim().slice(0, 60) || brandName(kind),
    kind,
    ...(model ? { model: model.slice(0, 80) } : {}),
    ...(brief ? { brief: brief.slice(0, 2000) } : {}),
    ...(pause === undefined ? {} : { pauseAbovePercent: pause }),
    enabled: row.enabled !== false,
    ...(runner ? { runner: runner.slice(0, 100) } : {}),
  };
}

export function newAgentId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `a${Date.now().toString(36)}${random}`;
}

const brandNames: Record<AgentKind, string> = {
  claude: "Claude",
  codex: "Codex",
};

export function brandName(kind: AgentKind): string {
  return brandNames[kind];
}

/** How an agent is called on the board. A runner's own agents are named
 *  neutrally ("Studio 2") and show their kind as a tag beside the name, so
 *  the name stays as it is; a hand-made one reads "Claude · Ada". */
export function agentLabel(
  spec: Pick<AgentSpec, "kind" | "name" | "runner">,
): string {
  const brand = brandNames[spec.kind];
  const name = spec.name.trim();
  if (!name || name.toLowerCase() === brand.toLowerCase()) return brand;
  if (spec.runner) return name;
  return namesBrand(name, brand) ? name : `${brand} · ${name}`;
}

export function hostedKinds(
  runners: readonly Runner[],
  now = Date.now(),
): AgentKind[] {
  const kinds: AgentKind[] = [];
  for (const runner of connectedRunners(runners, now))
    for (const kind of runner.hosts)
      if (!kinds.includes(kind)) kinds.push(kind);
  return kinds;
}

export type AgentActivity =
  | { state: "working"; taskId: string; runner: Runner }
  | { state: "paused" }
  | { state: "offline" }
  | { state: "locked"; taskId: string }
  | { state: "idle" };

export function agentSlot(
  spec: Pick<AgentSpec, "id">,
  runners: readonly Runner[],
  now = Date.now(),
): RunnerAgentSlot | null {
  for (const runner of connectedRunners(runners, now))
    for (const agent of runner.agents)
      if (agent.id === spec.id && agent.task_id) return { runner, agent };
  return null;
}

export function agentWaiting(
  spec: Pick<AgentSpec, "id">,
  runners: readonly Runner[],
  now = Date.now(),
): string {
  for (const runner of connectedRunners(runners, now))
    for (const agent of runner.agents)
      if (agent.id === spec.id && !agent.task_id && agent.waiting)
        return agent.waiting;
  return "";
}

export function agentState(
  spec: AgentSpec,
  runners: readonly Runner[],
  locks: readonly TaskLock[] = [],
  now = Date.now(),
): AgentActivity {
  const slot = agentSlot(spec, runners, now);
  if (slot?.agent.task_id)
    return {
      state: "working",
      taskId: slot.agent.task_id,
      runner: slot.runner,
    };
  const lease = liveLeases(runners, now).find(
    (entry) => entry.agent === spec.id,
  );
  if (lease) {
    const runner = runners.find((item) => item.runner_id === lease.runnerId);
    if (runner) return { state: "working", taskId: lease.taskId, runner };
  }
  if (!spec.enabled) return { state: "paused" };
  if (!hostedKinds(runners, now).includes(spec.kind))
    return { state: "offline" };
  const lock = locks.find((entry) => entry.agent === spec.id);
  if (lock) return { state: "locked", taskId: lock.task_id };
  return { state: "idle" };
}

export function cutsWork(
  mode: AgentMode,
  next: AgentMode,
  working: number,
): boolean {
  return next !== mode && working > 0;
}

export function taskLock(
  locks: readonly TaskLock[],
  taskId: string,
): TaskLock | null {
  return locks.find((lock) => lock.task_id === taskId) ?? null;
}

export function seatRunner(
  runners: readonly Runner[],
  agentId: string,
  now = Date.now(),
): Runner | null {
  if (!agentId) return null;
  for (const runner of connectedRunners(runners, now))
    if (runner.seats.some((seat) => seat.agent_id === agentId)) return runner;
  return null;
}

export type SeatState =
  | { state: "seated" }
  | { state: "picked"; holder: Runner | null }
  | { state: "held"; holder: Runner }
  | { state: "free" };

export function seatState(
  runners: readonly Runner[],
  runner: Runner,
  agentId: string,
  now = Date.now(),
): SeatState {
  if (!agentId) return { state: "free" };
  if (runner.seats.some((seat) => seat.agent_id === agentId))
    return { state: "seated" };
  const holder =
    connectedRunners(runners, now).find(
      (entry) =>
        entry.runner_id !== runner.runner_id &&
        entry.seats.some((seat) => seat.agent_id === agentId),
    ) ?? null;
  if (runner.wanted.includes(agentId)) return { state: "picked", holder };
  return holder ? { state: "held", holder } : { state: "free" };
}

/** An agent is left over when no live runner brings it: its runner was
 *  forgotten or has stopped, or it was made by hand before runners wrote
 *  their own. A live runner would only write its own agents back, so those
 *  are never offered for removal, and neither is one still on a task. */
export function leftOverAgent(
  spec: Pick<AgentSpec, "runner">,
  runners: readonly Runner[],
  working: boolean,
  now = Date.now(),
): boolean {
  if (working) return false;
  if (!spec.runner) return true;
  const runner = runners.find((item) => item.runner_id === spec.runner);
  return !runner || !isConnected(runner, now);
}

export function ownsAgentSeat(
  runners: readonly Runner[],
  agentId: string,
  userId: string,
  now = Date.now(),
): boolean {
  if (!userId) return false;
  const runner = seatRunner(runners, agentId, now);
  return !!runner && runner.owner_id === userId;
}

export function ownsConnectedRunner(
  runners: readonly Runner[],
  workspaceId: string,
  userId: string,
  now = Date.now(),
): boolean {
  if (!userId) return false;
  return wiredRunners(runners, workspaceId, now).some(
    (runner) => runner.owner_id === userId,
  );
}

export type LockBlock =
  { reason: "needRunner" } | { reason: "runnerElsewhere"; name: string };

export function lockReason(
  runners: readonly Runner[],
  workspaceId: string,
  userId: string,
  now = Date.now(),
): LockBlock | null {
  if (ownsConnectedRunner(runners, workspaceId, userId, now)) return null;
  const elsewhere = userId
    ? connectedRunners(runners, now).find(
        (runner) =>
          runner.owner_id === userId && runner.workspace_id !== workspaceId,
      )
    : undefined;
  return elsewhere
    ? { reason: "runnerElsewhere", name: elsewhere.name }
    : { reason: "needRunner" };
}

export function canUnlockTask(
  lock: TaskLock | null,
  userId: string,
  workspaceOwner: boolean,
): boolean {
  if (!lock) return false;
  return workspaceOwner || (!!userId && lock.owner_id === userId);
}

export function lineTasks(
  state: { tasks: readonly Task[]; links: readonly Link[] },
  taskId: string,
): Task[] {
  const byId = new Map(state.tasks.map((task) => [task.id, task]));
  const start = byId.get(taskId);
  if (!start) return [];
  const seen = new Set<string>([taskId]);
  const order: Task[] = [start];
  const queue = [taskId];
  while (queue.length) {
    const current = queue.shift()!;
    const downstream = [
      ...state.tasks
        .filter((task) => task.parentId === current)
        .map((task) => task.id),
      ...state.links
        .filter((link) => link.source === current)
        .map((link) => link.target),
    ];
    for (const id of downstream) {
      if (seen.has(id)) continue;
      const task = byId.get(id);
      if (!task) continue;
      seen.add(id);
      queue.push(id);
      order.push(task);
    }
  }
  return order.filter((task, index) => index === 0 || task.status !== "done");
}

export const agentDragType = "application/x-wireal-agent";

export type AgentDrag = { agent: string; runnerId: string };

export function writeAgentDrag(drag: {
  agent: string;
  runnerId?: string;
}): string {
  return JSON.stringify({ agent: drag.agent, runnerId: drag.runnerId ?? "" });
}

export function parseAgentDrag(text: string): AgentDrag | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const agent = asText(value?.agent);
    return agent ? { agent, runnerId: asText(value?.runnerId) } : null;
  } catch {
    return null;
  }
}

export function wiredRunners(
  runners: readonly Runner[],
  workspaceId: string,
  now = Date.now(),
): Runner[] {
  return connectedRunners(runners, now).filter(
    (runner) => !!workspaceId && runner.workspace_id === workspaceId,
  );
}

export function isWired(
  runners: readonly Runner[],
  workspaceId: string,
  now = Date.now(),
): boolean {
  return wiredRunners(runners, workspaceId, now).length > 0;
}
