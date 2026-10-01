import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { moment } from "./events.ts";
import type { RateLimits } from "./types.ts";

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

export const dayWindowMinutes = 1440;
export const tailBytes = 262_144;
export const headChunk = 65_536;
export const headCap = 2_097_152;

export function sessionsDirectory(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  return join(env.CODEX_HOME?.trim() || join(home, ".codex"), "sessions");
}

export function dayPath(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return join(String(at.getFullYear()), month, day);
}

export const walkDays = 3;

export function dayPaths(since: number, now: number): string[] {
  const days = new Set<string>();
  const from = Math.max(Math.min(since, now), now - walkDays * 86_400_000);
  for (let at = from; at <= now; at += 3_600_000)
    days.add(dayPath(new Date(at)));
  days.add(dayPath(new Date(now)));
  return [...days];
}

export function sessionCwd(head: string): string | undefined {
  const first = head.split("\n").find((line) => line.trim());
  if (!first) return undefined;
  try {
    const parsed = record(JSON.parse(first));
    if (text(parsed?.type) !== "session_meta") return undefined;
    return text(record(parsed?.payload)?.cwd);
  } catch {
    return undefined;
  }
}

export function windowsOf(
  limits: Record<string, unknown>,
): Record<string, unknown> {
  const windows: Record<string, unknown> = {};
  for (const [key, fallback] of [
    ["primary", 300],
    ["secondary", 10_080],
  ] as const) {
    const window = record(limits[key]);
    const used = number(window?.used_percent);
    if (used === undefined) continue;
    const minutes = number(window?.window_minutes) ?? fallback;
    const name = minutes <= dayWindowMinutes ? "five_hour" : "seven_day";
    windows[name] = {
      used_percentage: used,
      window_minutes: minutes,
      ...(window?.resets_at === undefined
        ? {}
        : { resets_at: window.resets_at }),
    };
  }
  return windows;
}

export function limitsOf(body: string): RateLimits | undefined {
  let latest: RateLimits | undefined;
  for (const line of body.split("\n")) {
    if (!line.includes("rate_limits")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = record(parsed);
    const payload = record(entry?.payload);
    if (text(payload?.type) !== "token_count") continue;
    const limits = record(payload?.rate_limits);
    if (!limits) continue;
    const windows = windowsOf(limits);
    if (!Object.keys(windows).length) continue;
    latest = {
      ...windows,
      captured_at: (moment(entry?.timestamp) ?? new Date()).toISOString(),
      source: "codex",
    };
  }
  return latest;
}

export function firstLine(path: string, cap = headCap): string {
  let handle: number | undefined;
  try {
    handle = openSync(path, "r");
    const buffer = Buffer.alloc(headChunk);
    let read = "";
    while (read.length < cap) {
      const taken = readSync(handle, buffer, 0, buffer.length, read.length);
      if (taken <= 0) break;
      read += buffer.toString("utf8", 0, taken);
      const end = read.indexOf("\n");
      if (end >= 0) return read.slice(0, end);
    }
    return read;
  } catch {
    return "";
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}

export function findRollout(
  directory: string,
  cwd: string,
  since: number,
  now = Date.now(),
): string | undefined {
  const wanted = resolve(cwd);
  let best: { path: string; at: number } | undefined;
  for (const day of dayPaths(since, now)) {
    let names: string[];
    try {
      names = readdirSync(join(directory, day));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) continue;
      const path = join(directory, day, name);
      let at: number;
      try {
        at = statSync(path).mtimeMs;
      } catch {
        continue;
      }
      if (at < since - 5_000) continue;
      const opened = sessionCwd(firstLine(path));
      if (!opened || resolve(opened) !== wanted) continue;
      if (!best || at > best.at) best = { path, at };
    }
  }
  return best?.path;
}

export function rolloutFiles(
  directory: string,
  now = Date.now(),
): { path: string; at: number }[] {
  const found: { path: string; at: number }[] = [];
  for (const day of dayPaths(now - walkDays * 86_400_000, now)) {
    let names: string[];
    try {
      names = readdirSync(join(directory, day));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) continue;
      const path = join(directory, day, name);
      try {
        found.push({ path, at: statSync(path).mtimeMs });
      } catch {
        continue;
      }
    }
  }
  return found.sort((first, second) => second.at - first.at);
}

export const rolloutReads = 3;

export function latestLimits(
  directory = sessionsDirectory(),
  now = Date.now(),
  reads = rolloutReads,
): RateLimits | undefined {
  let best: RateLimits | undefined;
  for (const file of rolloutFiles(directory, now).slice(0, reads)) {
    const limits = openRollout(file.path).limits();
    if (!limits) continue;
    if (!best || String(limits.captured_at) > String(best.captured_at))
      best = limits;
  }
  return best;
}

export type Rollout = { path: string; limits: () => RateLimits | undefined };

export function openRollout(path: string): Rollout {
  let read = 0;
  let latest: RateLimits | undefined;
  return {
    path,
    limits: () => {
      let size = 0;
      try {
        size = statSync(path).size;
      } catch {
        return latest;
      }
      if (size < read) read = 0;
      if (size === read) return latest;
      const from = Math.max(read, size - tailBytes);
      let handle: number | undefined;
      try {
        handle = openSync(path, "r");
        const buffer = Buffer.alloc(size - from);
        readSync(handle, buffer, 0, buffer.length, from);
        latest = limitsOf(buffer.toString("utf8")) ?? latest;
      } catch {
        return latest;
      } finally {
        if (handle !== undefined) closeSync(handle);
      }
      read = size;
      return latest;
    },
  };
}
