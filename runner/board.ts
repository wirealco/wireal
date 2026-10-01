import { hostname } from "node:os";
import type { WirealClient, WorkspaceInfo } from "../mcp/client.ts";
import {
  addActivity,
  closeTask,
  findTask,
  readyTasks,
  taskBrief,
} from "../mcp/workspace.ts";
import {
  agentSettings,
  openReview,
  type ActivityKind,
  type ActivityUsage,
  type AgentKind,
  type AgentSettings,
  type AgentSpec,
  type Task,
  type Workspace,
} from "../src/domain.ts";
import { short, type RateLimits } from "./agents/types.ts";
import {
  liveLeases,
  openSession,
  runnerRows,
  type LeaseRow,
  type RunnerRow,
} from "./api.ts";
import type { RunnerIdentity } from "./session.ts";

export type { AgentKind, AgentSettings };
export type AgentReport = {
  id: string;
  name: string;
  kind: AgentKind;
  task_id: string | null;
  since: string;
  waiting?: string;
  /** What the agent is doing now ("editing src/api.ts"), at most 120. */
  step?: string;
  /** Its latest output line, at most 300. */
  last?: string;
  /** Paths it is changing, at most 20. */
  files?: string[];
};
/** A person working a task through their own CLI over MCP. */
export type Presence = {
  workspace_id?: string;
  session?: string;
  user_id?: string;
  user_name?: string;
  client?: string;
  handle?: string;
  task_id?: string | null;
  note?: string | null;
  last_seen?: string;
};
export type Lease = { task_id: string; until: string };
export type Lock = { task_id: string; agent?: string | null; since?: string };
export type FlowKind = "merge" | "pull" | "promote";
export type FlowRequest = {
  request_id: string;
  task_id: string;
  agent: string;
  kind: FlowKind;
  requested_at: string;
};
export type FolderReport = {
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  upstream: string;
  path: string;
};
export type HeartbeatReply = {
  leases: Lease[];
  seats?: string[];
  wanted?: string[];
  locks?: Lock[];
  requests?: FlowRequest[];
  presence?: Presence[];
  ping_requested_at: string | null;
  ping_answered_at: string | null;
  server_time: string;
};
export type Candidate = {
  id: string;
  referenceId: string;
  name: string;
  objective: string;
  projectIds: string[];
  busy: string[];
  projects: { name: string; repositoryUrl: string; folders: string[] }[];
  upstream: { referenceId: string; name: string; summary: string }[];
  review?: { text: string; by: string };
};
export type Outcome = "done" | "blocked" | "abandoned";
export type Closing = {
  ok: boolean;
  summary?: string;
  error?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  durationMs?: number;
  windows?: ActivityUsage["windows"];
};

export type BoardClient = {
  read(): Promise<{
    workspace: Workspace;
    revision: number;
    workspaceId?: string;
  }>;
  command<T>(name: string, args: Record<string, unknown>): Promise<T>;
  mutate<T>(
    change: (state: Workspace) => { state: Workspace; value: T },
  ): Promise<{ value: T; revision: number }>;
};
export type BoardSession = {
  workspaces(): Promise<WorkspaceInfo[]>;
  pinned(workspaceId: string): BoardClient;
};
export type RunnerReader = (workspaceId: string) => Promise<RunnerRow[]>;

export function sessionClient(
  agentName = "Wireal runner",
  workspaceId?: string,
): WirealClient {
  return openSession().client(agentName, workspaceId);
}

export function chooseWorkspace(
  workspaces: WorkspaceInfo[],
  identifier?: string,
): WorkspaceInfo {
  if (!identifier?.trim()) {
    const active = workspaces.find((workspace) => workspace.isActive);
    if (!active)
      throw new Error("No Wireal workspace exists for this account.");
    return active;
  }
  const needle = identifier.trim().toLowerCase();
  const matches = workspaces.filter(
    (workspace) =>
      workspace.id.toLowerCase() === needle ||
      workspace.name.toLowerCase() === needle,
  );
  if (matches.length > 1)
    throw new Error(`Ambiguous workspace: ${identifier}. Use its ID.`);
  if (!matches[0]) throw new Error(`Unknown workspace: ${identifier}`);
  return matches[0];
}

export function directDependents(
  state: Workspace,
  taskId: string,
): Set<string> {
  return new Set([
    ...state.links
      .filter((link) => link.source === taskId)
      .map((link) => link.target),
    ...state.tasks
      .filter((task) => task.parentId === taskId)
      .map((task) => task.id),
  ]);
}

export function pendingRequests(
  reply: HeartbeatReply | undefined,
): FlowRequest[] {
  return (reply?.requests ?? [])
    .filter(
      (request) =>
        request.kind === "merge" ||
        request.kind === "pull" ||
        request.kind === "promote",
    )
    .sort(
      (left, right) =>
        Date.parse(left.requested_at) - Date.parse(right.requested_at),
    );
}

export function ownLocks(reply: HeartbeatReply | undefined): Lock[] {
  return (reply?.locks ?? []).filter((lock) => lock.task_id);
}

export function lockedTo(lock: Pick<Lock, "agent">, agentId: string): boolean {
  const named = (lock.agent ?? "").trim();
  return !named || named === agentId;
}

export const mergedText = "Merged into main";

/** People seen within ten minutes who are on a task. An older backend sends
 *  no presence, which reads as nobody. */
export function livePresence(
  reply: Pick<HeartbeatReply, "presence"> | undefined,
  now = Date.now(),
): Presence[] {
  return (reply?.presence ?? []).filter((row) => {
    if (!row?.task_id) return false;
    const seen = Date.parse(row.last_seen ?? "");
    return !Number.isFinite(seen) || now - seen <= 10 * 60_000;
  });
}

const runnerLine =
  /^(Merged into |Promoted |Checks failed on |(Done|Blocked|Abandoned)( (in|for|on) |\.))/;

/** What the last agent said about a task: its newest report, or failing that
 *  its newest change note. The runner's own lines are never picked, which is
 *  what reading activity[0] got wrong. Mirrors latestReport in src/domain.ts. */
export function upstreamReport(task: Pick<Task, "activity">): string {
  const newest = (kind: string) =>
    task.activity
      .filter(
        (entry) =>
          entry.authorType === "ai" &&
          (entry.kind as string | undefined) === kind &&
          !runnerLine.test(entry.text),
      )
      .reduce<Task["activity"][number] | undefined>(
        (best, entry) =>
          !best || (Date.parse(entry.at) || 0) > (Date.parse(best.at) || 0)
            ? entry
            : best,
        undefined,
      );
  return (newest("report") ?? newest("change"))?.text.trim() ?? "";
}

/** A report written since the start whose Blocked line says something. */
export function reportedBlocked(
  task: Pick<Task, "activity">,
  startedAt?: string,
): boolean {
  const since = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (!Number.isFinite(since)) return false;
  return task.activity.some(
    (entry) =>
      entry.authorType === "ai" &&
      (entry.kind as string | undefined) === "report" &&
      Date.parse(entry.at) >= since - 1000 &&
      /^\s*blocked\s*:(?!\s*(none|no|nothing|n\/a|-)?\s*\.?\s*$)/im.test(
        entry.text,
      ),
  );
}

export function latestCommit(task: Task): string {
  return (
    task.activity.find((entry) => entry.commit?.trim())?.commit?.trim() ?? ""
  );
}

export function alreadyMerged(task: Task): boolean {
  return task.activity.some((entry) => entry.text.startsWith(mergedText));
}

export function outcomeOf(
  result: Closing,
  commit: string,
  blocked = false,
): Outcome {
  if (blocked) return "blocked";
  if (result.ok && commit) return "done";
  const reported = `${result.summary ?? ""} ${result.error ?? ""}`;
  return /block(ed|er|ing)/i.test(reported) ? "blocked" : "abandoned";
}

const outcomeWord: Record<Outcome, string> = {
  done: "Done",
  blocked: "Blocked",
  abandoned: "Abandoned",
};

export function stripMarkdown(value: string): string {
  return String(value ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function firstSentence(value: string, limit = 200): string {
  const plain = stripMarkdown(value);
  if (!plain) return "";
  const end = plain.match(/^.*?[.!?](?=\s|$)/);
  return short(end ? end[0] : plain, limit);
}

function spell(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds / 1000));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

export function closingText(
  result: Closing,
  outcome: Outcome,
  reported: boolean,
): string {
  const measures = [
    typeof result.durationMs === "number"
      ? `in ${spell(result.durationMs)}`
      : "",
    typeof result.costUsd === "number"
      ? `for $${result.costUsd.toFixed(2)}`
      : "",
    result.model ? `on ${result.model}` : "",
  ].filter(Boolean);
  const windows = completedWindows(result.windows);
  const windowText = [
    windows?.fiveHour
      ? `5h ${windows.fiveHour.start}→${windows.fiveHour.end}%`
      : "",
    windows?.sevenDay
      ? `7d ${windows.sevenDay.start}→${windows.sevenDay.end}%`
      : "",
  ].filter(Boolean);
  const head = `${outcomeWord[outcome]}${measures.length ? ` ${measures.join(" ")}` : ""}.${windowText.length ? ` ${windowText.join(", ")}.` : ""}`;
  if (reported) return head;
  const tail = firstSentence(result.summary || result.error || "");
  return tail ? `${head} ${tail}` : head;
}

export function agentReported(
  state: Workspace,
  taskId: string,
  startedAt?: string,
): boolean {
  const since = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (!Number.isFinite(since)) return false;
  return findTask(state, taskId).activity.some(
    (entry) =>
      entry.authorType === "ai" && Date.parse(entry.at) >= since - 1000,
  );
}

export function closingUsage(result: Closing): ActivityUsage | undefined {
  const usage: ActivityUsage = {};
  if (typeof result.costUsd === "number") usage.costUsd = result.costUsd;
  if (typeof result.inputTokens === "number")
    usage.inputTokens = result.inputTokens;
  if (typeof result.outputTokens === "number")
    usage.outputTokens = result.outputTokens;
  if (result.model) usage.model = result.model;
  if (typeof result.durationMs === "number")
    usage.durationMs = result.durationMs;
  const windows = completedWindows(result.windows);
  if (windows) usage.windows = windows;
  return Object.keys(usage).length ? usage : undefined;
}

function completedWindows(
  windows: ActivityUsage["windows"],
): ActivityUsage["windows"] {
  if (!windows) return undefined;
  const completed: NonNullable<ActivityUsage["windows"]> = {};
  for (const key of ["fiveHour", "sevenDay"] as const) {
    const window = windows[key];
    if (
      typeof window?.start === "number" &&
      Number.isFinite(window.start) &&
      typeof window.end === "number" &&
      Number.isFinite(window.end)
    )
      completed[key] = { start: window.start, end: window.end };
  }
  return Object.keys(completed).length ? completed : undefined;
}

export class Board {
  readonly runnerId: string;
  readonly host: string;
  name: string;
  private workspaceId = "";
  private workspaceName = "";
  private pinned?: BoardClient;
  private latest?: Workspace;
  constructor(
    private readonly session: BoardSession,
    private readonly rows: RunnerReader,
    identity: RunnerIdentity,
    host = hostname(),
  ) {
    this.runnerId = identity.id;
    this.name = identity.name;
    this.host = host;
  }

  rename(name: string): void {
    const wanted = name.trim();
    if (wanted) this.name = wanted;
  }

  workspace(): { id: string; name: string } {
    return { id: this.workspaceId, name: this.workspaceName };
  }

  async connect(identifier?: string): Promise<AgentSettings> {
    const chosen = chooseWorkspace(await this.session.workspaces(), identifier);
    this.workspaceId = chosen.id;
    this.workspaceName = chosen.name;
    this.pinned = this.session.pinned(chosen.id);
    return this.settings();
  }

  private get client(): BoardClient {
    if (!this.pinned)
      throw new Error("The runner has not connected to a workspace yet.");
    return this.pinned;
  }

  private async current(): Promise<Workspace> {
    const current = await this.client.read();
    this.workspaceName = current.workspace.map.name;
    this.latest = current.workspace;
    return current.workspace;
  }

  /** Tasks as last read, with their project names, so the runner can say what
   *  peers are on without another round trip. */
  known(): Map<
    string,
    { referenceId: string; name: string; projects: string[] }
  > {
    const state = this.latest;
    const projects = new Map(
      (state?.projects ?? []).map((project) => [project.id, project.name]),
    );
    return new Map(
      (state?.tasks ?? []).map((task) => [
        task.id,
        {
          referenceId: task.referenceId,
          name: task.name,
          projects: task.projectIds
            .map((id) => projects.get(id) ?? "")
            .filter(Boolean),
        },
      ]),
    );
  }

  async settings(): Promise<AgentSettings> {
    return agentSettings(await this.current());
  }

  /** Rewrites the workspace's agent list when `change` says it should, and
   *  returns the settings as they stand afterwards. */
  async provision(
    change: (roster: AgentSpec[]) => AgentSpec[] | null,
  ): Promise<AgentSettings> {
    const { value } = await this.client.mutate((state) => {
      const next = change(agentSettings(state).roster ?? []);
      if (!next) return { state, value: agentSettings(state) };
      const changed: Workspace = {
        ...state,
        map: {
          ...state.map,
          agents: { ...agentSettings(state), roster: next },
        },
      };
      return { state: changed, value: agentSettings(changed) };
    });
    return value;
  }

  /** Asks the server to seat these agents on this runner. It answers with the
   *  ones it now holds; an agent another live runner holds stays there. */
  async seat(agents: readonly string[]): Promise<string[]> {
    const reply = await this.client.command<{ seats?: unknown[] } | null>(
      "set_runner_seats",
      {
        workspace_id: this.workspaceId,
        runner: this.runnerId,
        agents: [...agents],
      },
    );
    return (reply?.seats ?? []).map((id) => String(id));
  }

  async heartbeat(
    agents: AgentReport[],
    hosts: AgentKind[],
    costUsd: number,
    leaseMinutes: number,
    rateLimits?: RateLimits,
    folder?: FolderReport,
  ): Promise<HeartbeatReply> {
    return this.client.command<HeartbeatReply>("runner_heartbeat", {
      workspace_id: this.workspaceId,
      runner: this.runnerId,
      name: this.name,
      host: this.host,
      agents,
      hosts,
      cost_usd: costUsd,
      lease_minutes: leaseMinutes,
      ...(rateLimits ? { rate_limits: rateLimits } : {}),
      ...(folder ? { folder } : {}),
    });
  }

  async completeRequest(requestId: string): Promise<boolean> {
    const result = await this.client.command<{ completed: boolean }>(
      "complete_request",
      {
        workspace_id: this.workspaceId,
        request_id: requestId,
      },
    );
    return result?.completed === true;
  }

  async note(
    taskId: string,
    kind: ActivityKind,
    summary: string,
    commit?: string,
    agentName = this.name,
  ): Promise<void> {
    await this.client.mutate((state) => {
      const changed = addActivity(
        state,
        taskId,
        { kind, summary, ...(commit ? { commit } : {}) },
        agentName,
      );
      return { state: changed.state, value: changed.task.id };
    });
  }

  async agentOf(taskId: string): Promise<string> {
    const task = findTask(await this.current(), taskId);
    const entry = task.activity.find(
      (candidate) => candidate.authorType === "ai" && candidate.commit,
    );
    return entry?.author ?? this.name;
  }

  async lineOf(taskId: string): Promise<{
    id: string;
    referenceId: string;
    name: string;
    commit: string;
    merged: boolean;
  }> {
    const task = findTask(await this.current(), taskId);
    return {
      id: task.id,
      referenceId: task.referenceId,
      name: task.name,
      commit: latestCommit(task),
      merged: alreadyMerged(task),
    };
  }

  async named(
    reference: string,
  ): Promise<{ id: string; name: string } | undefined> {
    const task = (await this.current()).tasks.find(
      (candidate) => candidate.referenceId === reference,
    );
    return task ? { id: task.id, name: task.name } : undefined;
  }

  async claim(
    taskId: string,
    agent: string,
    leaseMinutes: number,
  ): Promise<Lease> {
    return this.client.command<Lease>("claim_task", {
      workspace_id: this.workspaceId,
      task_id: taskId,
      agent,
      runner: this.runnerId,
      lease_minutes: leaseMinutes,
    });
  }

  async release(taskId: string): Promise<boolean> {
    const result = await this.client.command<{ released: boolean }>(
      "release_task",
      {
        workspace_id: this.workspaceId,
        task_id: taskId,
        runner: this.runnerId,
      },
    );
    return result?.released === true;
  }

  async leave(): Promise<void> {
    await this.client.command<{ left: boolean }>("runner_leave", {
      workspace_id: this.workspaceId,
      runner: this.runnerId,
    });
  }

  async close(
    taskId: string,
    result: Closing,
    commit: string,
    agentName: string,
    startedAt?: string,
  ): Promise<Outcome> {
    const usage = closingUsage(result);
    let outcome: Outcome = outcomeOf(result, commit);
    await this.client.mutate((state) => {
      outcome = outcomeOf(
        result,
        commit,
        reportedBlocked(findTask(state, taskId), startedAt),
      );
      const changed = closeTask(
        state,
        {
          task: taskId,
          outcome,
          summary: closingText(
            result,
            outcome,
            agentReported(state, taskId, startedAt),
          ),
          ...(commit ? { commit } : {}),
          ...(usage ? { usage } : {}),
        },
        agentName,
      );
      return { state: changed.state, value: changed.task.status };
    });
    return outcome;
  }

  async runners(): Promise<RunnerRow[]> {
    return this.rows(this.workspaceId);
  }

  async live(): Promise<LeaseRow[]> {
    return liveLeases(await this.rows(this.workspaceId));
  }

  async candidates(
    walked?: ReadonlySet<string>,
    leases?: readonly LeaseRow[],
  ): Promise<Candidate[]> {
    const state = await this.current();
    const held = new Set(
      (leases ?? (await this.live())).map((lease) => lease.task_id),
    );
    const engaged = new Set<string>();
    for (const task of state.tasks)
      if (held.has(task.id))
        for (const projectId of task.projectIds) engaged.add(projectId);
    const line = walked?.size
      ? new Set(
          [...walked].flatMap((taskId) => [...directDependents(state, taskId)]),
        )
      : undefined;
    return readyTasks(state)
      .filter((task) => !held.has(task.id))
      .filter((task) => !line || line.has(task.id))
      .map((task) => {
        const brief = taskBrief(state, task.id);
        const review = openReview(task);
        return {
          id: task.id,
          referenceId: task.referenceId,
          name: task.name,
          objective: task.objective,
          projectIds: [...task.projectIds],
          busy: state.projects
            .filter(
              (project) =>
                engaged.has(project.id) && task.projectIds.includes(project.id),
            )
            .map((project) => project.name),
          projects: brief.projects,
          upstream: brief.upstream.map((upstream) => ({
            referenceId: upstream.referenceId,
            name: upstream.name,
            summary: short(
              upstreamReport(
                state.tasks.find(
                  (task) => task.referenceId === upstream.referenceId,
                ) ?? { activity: [] },
              ) || `${upstream.status}, no report`,
              240,
            ),
          })),
          ...(review
            ? { review: { text: review.text, by: review.author } }
            : {}),
        };
      });
  }
}

export function openBoard(
  identity?: RunnerIdentity,
  agentName = "Wireal runner",
): Board {
  if (!identity) throw new Error("This repository has no saved binding.");
  const session = openSession();
  return new Board(
    {
      workspaces: () => session.client(agentName).listWorkspaces(),
      pinned: (workspaceId) => session.client(agentName, workspaceId),
    },
    runnerRows(session.data),
    identity,
  );
}
