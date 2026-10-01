import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  short,
  type AgentKind,
  type AgentStatus,
  type RateLimits,
} from "./types.ts";

export type AgentEvent = {
  at: string;
  kind: string;
  payload: Record<string, unknown>;
};

export type Lifecycle = {
  stopped: boolean;
  ended: boolean;
  reason?: string;
  isError: boolean;
  summary?: string;
  lines: string[];
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

export function parseEvents(body: string): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = record(parsed);
    const kind = text(entry?.kind);
    if (!entry || !kind) continue;
    events.push({
      at: text(entry.at) ?? "",
      kind,
      payload: record(entry.payload) ?? {},
    });
  }
  return events;
}

export function readEvents(path: string): AgentEvent[] {
  try {
    return parseEvents(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

export function rateLimitsOf(
  payload: Record<string, unknown>,
  at: string,
): RateLimits | undefined {
  const limits = record(payload.rate_limits);
  if (!limits) return undefined;
  const captured = moment(at) ?? new Date();
  return { ...limits, captured_at: captured.toISOString(), source: "claude" };
}

export function statusOf(events: AgentEvent[]): AgentStatus {
  const lines = events.filter((event) => event.kind === "statusline");
  const spend = (event: AgentEvent) =>
    number(record(event.payload.cost)?.total_cost_usd) ?? -1;
  const richest = lines.reduce<AgentEvent | undefined>(
    (best, event) =>
      best === undefined || spend(event) >= spend(best) ? event : best,
    undefined,
  );
  const limited = lines
    .filter((event) => record(event.payload.rate_limits))
    .at(-1);
  if (!richest) return {};
  const cost = record(richest.payload.cost);
  const model = record(richest.payload.model);
  const status: AgentStatus = {
    costUsd: number(cost?.total_cost_usd),
    durationMs: number(cost?.total_duration_ms),
    model: text(model?.id) ?? text(model?.display_name),
    rateLimits: limited && rateLimitsOf(limited.payload, limited.at),
  };
  for (const key of Object.keys(status))
    if (status[key as keyof AgentStatus] === undefined)
      delete status[key as keyof AgentStatus];
  return status;
}

export function lifecycleOf(events: AgentEvent[]): Lifecycle {
  const life: Lifecycle = {
    stopped: false,
    ended: false,
    isError: false,
    lines: [],
  };
  for (const event of events) {
    if (event.kind === "Stop" && !life.stopped) {
      life.stopped = true;
      life.summary = text(event.payload.last_assistant_message);
    }
    if (event.kind === "SessionEnd") {
      life.ended = true;
      life.reason = text(event.payload.reason);
      life.isError = endedBadly(life.reason);
    }
    const asked = toolLine(event);
    if (asked) life.lines.push(asked);
  }
  return life;
}

export type AgentActivity = {
  /** What the agent is doing now, as a person would say it. */
  step: string;
  /** Worktree-relative paths it wrote, oldest first, at most twenty. */
  edited: string[];
  /** Worktree-relative paths it read, oldest first, at most twenty. */
  read: string[];
};

const writingTools = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const toolEvents = new Set(["PreToolUse", "PermissionRequest", "PostToolUse"]);

export function worktreePath(cwd: string, value: string): string {
  if (!cwd || !value) return "";
  const root = resolve(cwd);
  const full = isAbsolute(value) ? resolve(value) : resolve(root, value);
  if (full !== root && !full.startsWith(root + sep)) return "";
  return relative(root, full).split(sep).join("/");
}

function remembered(list: string[], path: string): void {
  if (!path) return;
  const at = list.indexOf(path);
  if (at >= 0) list.splice(at, 1);
  list.push(path);
  if (list.length > 20) list.shift();
}

export function stepOf(
  name: string,
  input: Record<string, unknown>,
  cwd = "",
): string {
  const file = text(input.file_path) ?? text(input.notebook_path) ?? "";
  const where = worktreePath(cwd, file) || file;
  if (writingTools.has(name) && where) return short(`editing ${where}`, 120);
  if (name === "Read" && where) return short(`reading ${where}`, 120);
  if (name === "Bash" && text(input.command))
    return short(`running ${text(input.command)}`, 120);
  if ((name === "Grep" || name === "Glob") && text(input.pattern))
    return short(`searching ${text(input.pattern)}`, 120);
  const tool = name.match(/^mcp__[^_]+(?:_[^_]+)*__(.+)$/)?.[1];
  return short(tool ? `calling ${tool}` : name, 120);
}

/** Where a Claude agent is and which files it has in hand, read from the hook
 *  events the runner already records, so nobody asks the model. */
export function activityOf(events: AgentEvent[], cwd: string): AgentActivity {
  const activity: AgentActivity = { step: "", edited: [], read: [] };
  for (const event of events) {
    if (!toolEvents.has(event.kind)) continue;
    const name = text(event.payload.tool_name);
    if (!name) continue;
    const input = record(event.payload.tool_input) ?? {};
    activity.step = stepOf(name, input, cwd);
    const path = worktreePath(
      cwd,
      text(input.file_path) ?? text(input.notebook_path) ?? "",
    );
    if (writingTools.has(name)) remembered(activity.edited, path);
    else if (name === "Read") remembered(activity.read, path);
  }
  return activity;
}

export function endedBadly(reason: string | undefined): boolean {
  return reason === undefined ? false : /error|crash|fail|denied/i.test(reason);
}

function toolLine(event: AgentEvent): string {
  if (event.kind !== "PermissionRequest" && event.kind !== "PreToolUse")
    return "";
  const name = text(event.payload.tool_name);
  if (!name) return "";
  const input = record(event.payload.tool_input) ?? {};
  for (const key of ["command", "file_path", "path", "pattern", "url"]) {
    const value = text(input[key]);
    if (value) return `${name} ${short(value, 70)}`;
  }
  return name;
}

export function moment(value: unknown): Date | undefined {
  if (typeof value === "number" && Number.isFinite(value))
    return new Date(value > 1e11 ? value : value * 1000);
  if (typeof value !== "string" || !value.trim()) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(value.trim()))
    return moment(numeric);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function windowPercent(
  limits: RateLimits | undefined,
  name = "five_hour",
): number | undefined {
  const window = record(limits?.[name]);
  return number(window?.used_percentage);
}

export function windowReset(
  limits: RateLimits | undefined,
  name = "five_hour",
): string | undefined {
  const window = record(limits?.[name]);
  return moment(window?.resets_at)?.toISOString();
}

export function freshest(
  all: (RateLimits | undefined)[],
): RateLimits | undefined {
  let best: RateLimits | undefined;
  let bestAt = -Infinity;
  for (const limits of all) {
    if (!limits) continue;
    const at = moment(limits.captured_at)?.getTime() ?? 0;
    if (at >= bestAt) {
      best = limits;
      bestAt = at;
    }
  }
  return best;
}

export function limitsByKind(
  entries: readonly { kind: AgentKind; limits: RateLimits | undefined }[],
): RateLimits | undefined {
  const byKind: Record<string, RateLimits> = {};
  for (const { kind, limits } of entries) {
    const best = freshest([byKind[kind], limits]);
    if (best) byKind[kind] = best;
  }
  const kinds = Object.values(byKind);
  if (!kinds.length) return undefined;
  return { ...freshest(kinds), by_kind: byKind };
}
