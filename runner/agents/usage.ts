import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { configDirectory } from "../session.ts";
import { freshest, moment } from "./events.ts";
import { latestLimits, sessionsDirectory } from "./rollout.ts";
import type { AgentKind, RateLimits } from "./types.ts";

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

export const usageEveryByKind: Record<AgentKind, number> = {
  claude: 3_600_000,
  codex: 300_000,
};
export const usageTimeout = 10_000;
export const shortestWait = 60_000;
export const longestWait = 6 * 3_600_000;
export const claudeUsageUrl = "https://api.anthropic.com/api/oauth/usage";
export const codexUsageUrl = "https://chatgpt.com/backend-api/wham/usage";
export const keychainService = "Claude Code-credentials";

export type Credential = { token: string; accountId?: string };

export type UsageRead = {
  limits?: RateLimits;
  stale?: boolean;
  error?: string;
  waitMs?: number;
};

export type UsageParts = {
  read?: (path: string) => string;
  write?: (path: string, body: string) => void;
  keychain?: () => string;
  call?: typeof fetch;
  rollout?: () => RateLimits | undefined;
  directory?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
  now?: () => Date;
  timeout?: number;
};

export function usageEveryFor(kind: AgentKind): number {
  return usageEveryByKind[kind];
}

export function brandOf(kind: AgentKind): string {
  return kind === "claude" ? "Claude" : "Codex";
}

function readFile(path: string, parts: UsageParts): string {
  const read = parts.read ?? ((file: string) => readFileSync(file, "utf8"));
  try {
    return read(path);
  } catch {
    return "";
  }
}

function writeFile(path: string, body: string, parts: UsageParts): void {
  const write =
    parts.write ??
    ((file: string, content: string) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    });
  try {
    write(path, body);
  } catch {
    return;
  }
}

export function readKeychain(service = keychainService): string {
  try {
    return execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", service, "-w"],
      { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return "";
  }
}

export function claudeHome(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  return env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");
}

export function codexHome(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  return env.CODEX_HOME?.trim() || join(home, ".codex");
}

export function usagePath(parts: UsageParts = {}): string {
  return join(parts.directory ?? configDirectory(), "usage.json");
}

function parsed(body: string): Record<string, unknown> | undefined {
  if (!body.trim()) return undefined;
  try {
    return record(JSON.parse(body));
  } catch {
    return undefined;
  }
}

export function claudeCredential(
  parts: UsageParts = {},
): Credential | undefined {
  const env = parts.env ?? process.env;
  const home = parts.home ?? homedir();
  const platform = parts.platform ?? process.platform;
  const stored = [
    () => readFile(join(claudeHome(env, home), ".credentials.json"), parts),
    () => (platform === "darwin" ? (parts.keychain ?? readKeychain)() : ""),
  ];
  for (const source of stored) {
    const oauth = record(parsed(source())?.claudeAiOauth);
    const token = text(oauth?.accessToken);
    if (token) return { token };
  }
  return undefined;
}

export function codexCredential(
  parts: UsageParts = {},
): Credential | undefined {
  const env = parts.env ?? process.env;
  const home = parts.home ?? homedir();
  const tokens = record(
    parsed(readFile(join(codexHome(env, home), "auth.json"), parts))?.tokens,
  );
  const token = text(tokens?.access_token);
  if (!token) return undefined;
  const accountId = text(tokens?.account_id);
  return { token, ...(accountId ? { accountId } : {}) };
}

export function storedLimits(
  kind: AgentKind,
  parts: UsageParts = {},
): RateLimits | undefined {
  const kept = record(parsed(readFile(usagePath(parts), parts))?.[kind]);
  return kept as RateLimits | undefined;
}

export function storeLimits(
  kind: AgentKind,
  limits: RateLimits,
  parts: UsageParts = {},
): void {
  const path = usagePath(parts);
  const kept = parsed(readFile(path, parts)) ?? {};
  writeFile(path, JSON.stringify({ ...kept, [kind]: limits }, null, 2), parts);
}

export function fileLimits(
  kind: AgentKind,
  parts: UsageParts = {},
): RateLimits | undefined {
  const env = parts.env ?? process.env;
  const home = parts.home ?? homedir();
  const rollout =
    kind === "codex"
      ? (parts.rollout ?? (() => latestLimits(sessionsDirectory(env, home))))()
      : undefined;
  return freshest([storedLimits(kind, parts), rollout]);
}

function window(
  used: number | undefined,
  minutes: number,
  resets: unknown,
): Record<string, unknown> | undefined {
  if (used === undefined) return undefined;
  return {
    used_percentage: used,
    window_minutes: minutes,
    ...(resets === undefined || resets === null ? {} : { resets_at: resets }),
  };
}

export function claudeWindows(body: unknown, at: Date): RateLimits | undefined {
  const usage = record(body);
  if (!usage) return undefined;
  const windows: Record<string, unknown> = {};
  for (const [name, key, minutes] of [
    ["five_hour", "five_hour", 300],
    ["seven_day", "seven_day", 10_080],
  ] as const) {
    const source = record(usage[key]);
    const made = window(
      number(source?.utilization),
      minutes,
      source?.resets_at,
    );
    if (made) windows[name] = made;
  }
  if (!Object.keys(windows).length) return undefined;
  return { ...windows, captured_at: at.toISOString(), source: "claude" };
}

export function codexWindows(body: unknown, at: Date): RateLimits | undefined {
  const limit = record(record(body)?.rate_limit);
  if (!limit) return undefined;
  const windows: Record<string, unknown> = {};
  for (const [name, key, minutes] of [
    ["five_hour", "primary_window", 300],
    ["seven_day", "secondary_window", 10_080],
  ] as const) {
    const source = record(limit[key]);
    const seconds = number(source?.limit_window_seconds);
    const made = window(
      number(source?.used_percent),
      seconds === undefined ? minutes : Math.round(seconds / 60),
      source?.reset_at,
    );
    if (made) windows[name] = made;
  }
  if (!Object.keys(windows).length) return undefined;
  return { ...windows, captured_at: at.toISOString(), source: "codex" };
}

function request(
  kind: AgentKind,
  credential: Credential,
): { url: string; headers: Record<string, string> } {
  if (kind === "claude")
    return {
      url: claudeUsageUrl,
      headers: {
        authorization: `Bearer ${credential.token}`,
        "anthropic-beta": "oauth-2025-04-20",
        accept: "application/json",
      },
    };
  return {
    url: codexUsageUrl,
    headers: {
      authorization: `Bearer ${credential.token}`,
      accept: "application/json",
      ...(credential.accountId
        ? { "chatgpt-account-id": credential.accountId }
        : {}),
    },
  };
}

export function waitFrom(header: string | null, fallback: number): number {
  const seconds = Number(header);
  const asked = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  const at = asked ? 0 : (moment(header)?.getTime() ?? 0);
  const wanted = asked || (at ? at - Date.now() : fallback);
  return Math.min(Math.max(wanted, shortestWait), longestWait);
}

export async function readUsage(
  kind: AgentKind,
  parts: UsageParts = {},
): Promise<UsageRead> {
  const brand = brandOf(kind);
  const kept = (say: (last: boolean) => string, waitMs?: number): UsageRead => {
    const limits = fileLimits(kind, parts);
    return {
      ...(limits ? { limits, stale: true } : {}),
      error: say(!!limits),
      ...(waitMs ? { waitMs } : {}),
    };
  };
  const credential =
    kind === "claude" ? claudeCredential(parts) : codexCredential(parts);
  if (!credential)
    return kept(() => `${brand} is not signed in on this machine`);
  const call = parts.call ?? fetch;
  const at = (parts.now ?? (() => new Date()))();
  const { url, headers } = request(kind, credential);
  try {
    const response = await call(url, {
      headers,
      signal: AbortSignal.timeout(parts.timeout ?? usageTimeout),
    });
    if (response.status === 429)
      return kept(
        (last) =>
          last
            ? `${brand} is holding off on its limits, so these are the last it gave`
            : `${brand} is holding off on its limits, and none has come through yet`,
        waitFrom(
          response.headers?.get?.("retry-after") ?? null,
          usageEveryFor(kind),
        ),
      );
    if (response.status === 401 || response.status === 403)
      return kept(
        () => `${brand}'s sign-in has expired, so its limits stay unread`,
      );
    if (!response.ok)
      return kept(() => `${brand} answered ${response.status} for its limits`);
    const body = await response.json();
    const limits =
      kind === "claude" ? claudeWindows(body, at) : codexWindows(body, at);
    if (!limits) return kept(() => `${brand} reported no usage window`);
    storeLimits(kind, limits, parts);
    return { limits };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return kept(() => `${brand}'s limits could not be read: ${reason}`);
  }
}

export function untilText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function resetText(
  limits: RateLimits | undefined,
  name: string,
  now: number,
): string {
  const at = moment(record(limits?.[name])?.resets_at);
  if (!at) return "";
  return ` (resets in ${untilText(at.getTime() - now)})`;
}

export function usageLine(
  kind: AgentKind,
  read: UsageRead,
  now = Date.now(),
): string {
  const brand = brandOf(kind).padEnd(7);
  if (!read.limits) return `${brand} ${read.error ?? "no usage to read"}`;
  const shown = (name: string, label: string) => {
    const used = number(record(read.limits?.[name])?.used_percentage);
    if (used === undefined) return "";
    return `${label} ${Math.round(used)}%${resetText(read.limits, name, now)}`;
  };
  const captured = moment(read.limits.captured_at);
  const parts = [
    shown("five_hour", "5-hour"),
    shown("seven_day", "7-day"),
    read.stale && captured
      ? `read ${untilText(now - captured.getTime())} ago`
      : "",
  ].filter(Boolean);
  return `${brand} ${parts.join("   ")}`;
}
