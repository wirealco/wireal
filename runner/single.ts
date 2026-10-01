import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, uptime } from "node:os";
import { join } from "node:path";
import type { RunnerRow } from "./api.ts";
import { configDirectory, shortHostname } from "./session.ts";

export type Held = {
  runnerId: string;
  pid: number;
  host: string;
  name: string;
  repo: string;
  startedAt: string;
};

export type HoldParts = {
  directory?: string;
  read?: (path: string) => string;
  write?: (path: string, body: string) => void;
  remove?: (path: string) => void;
  list?: (path: string) => string[];
  alive?: (pid: number) => boolean;
  booted?: () => number;
  platform?: NodeJS.Platform;
  host?: string;
  pid?: number;
  now?: () => Date;
};

export const seenWithinMs = 60_000;
export const bootSlackMs = 60_000;

export function bootedAt(seconds = uptime(), now = Date.now()): number {
  return now - seconds * 1000;
}

export function samePath(
  left: string,
  right: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const plain = (value: string) =>
    value.replace(/[\\/]+$/, "").replace(/\\/g, "/");
  return platform === "win32"
    ? plain(left).toLowerCase() === plain(right).toLowerCase()
    : plain(left) === plain(right);
}

export function holdFolder(directory = configDirectory()): string {
  return join(directory, "running");
}

export function holdPath(runnerId: string, directory?: string): string {
  return join(holdFolder(directory), `${runnerId}.json`);
}

export function running(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function reader(parts: HoldParts) {
  return parts.read ?? ((path: string) => readFileSync(path, "utf8"));
}

function held(body: string): Held | undefined {
  try {
    const parsed = JSON.parse(body) as Partial<Held>;
    if (typeof parsed.pid !== "number" || typeof parsed.runnerId !== "string")
      return undefined;
    return {
      runnerId: parsed.runnerId,
      pid: parsed.pid,
      host: parsed.host ?? "",
      name: parsed.name ?? "",
      repo: parsed.repo ?? "",
      startedAt: parsed.startedAt ?? "",
    };
  } catch {
    return undefined;
  }
}

export function holders(parts: HoldParts = {}): Held[] {
  const folder = holdFolder(parts.directory);
  const list = parts.list ?? ((path: string) => readdirSync(path));
  const read = reader(parts);
  let names: string[];
  try {
    names = list(folder);
  } catch {
    return [];
  }
  const found: Held[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let body = "";
    try {
      body = read(join(folder, name));
    } catch {
      continue;
    }
    const one = held(body);
    if (one) found.push(one);
  }
  return found;
}

export function beforeBoot(one: Held, booted: number): boolean {
  const started = Date.parse(one.startedAt);
  return Number.isFinite(started) && started < booted - bootSlackMs;
}

export function holderOf(
  runner: { id: string; repo: string },
  parts: HoldParts = {},
): Held | undefined {
  const host = parts.host ?? shortHostname(hostname());
  const alive = parts.alive ?? running;
  const booted = (parts.booted ?? (() => bootedAt()))();
  const platform = parts.platform ?? process.platform;
  const mine = parts.pid ?? process.pid;
  return holders(parts).find(
    (one) =>
      one.pid !== mine &&
      one.host === host &&
      !beforeBoot(one, booted) &&
      alive(one.pid) &&
      (one.runnerId === runner.id || samePath(one.repo, runner.repo, platform)),
  );
}

export function clockTime(at: string): string {
  const moment = new Date(at);
  return Number.isNaN(moment.getTime())
    ? ""
    : moment.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function takenMessage(one: Held): string {
  const started = clockTime(one.startedAt);
  const since = started ? ` since ${started}` : "";
  const where = one.repo ? ` on ${one.repo}` : "";
  return `${one.name || "A runner"} is already running here as pid ${one.pid}${since}${where}. Quit that one with q, or start this one with --force to take it over.`;
}

export function elsewhereMessage(row: RunnerRow, seconds: number): string {
  return `${row.name || "This runner"} is already reporting in from ${row.host} (${seconds}s ago). Quit that one, or start this one with --force to take it over.`;
}

export function liveElsewhere(
  rows: readonly RunnerRow[],
  runnerId: string,
  host: string,
  now = Date.now(),
): { row: RunnerRow; seconds: number } | undefined {
  for (const row of rows) {
    if (row.runner_id !== runnerId) continue;
    const seen = Date.parse(row.last_seen ?? "");
    if (!Number.isFinite(seen)) continue;
    const since = now - seen;
    if (since > seenWithinMs || row.host === host) continue;
    return { row, seconds: Math.max(0, Math.round(since / 1000)) };
  }
  return undefined;
}

export function holdRunner(
  runner: { id: string; name: string; repo: string },
  options: { force?: boolean } & HoldParts = {},
): () => void {
  const taken = holderOf(runner, options);
  if (taken && !options.force) throw new Error(takenMessage(taken));
  const path = holdPath(runner.id, options.directory);
  const write =
    options.write ??
    ((file: string, body: string) => {
      mkdirSync(holdFolder(options.directory), { recursive: true });
      writeFileSync(file, body);
    });
  const mine: Held = {
    runnerId: runner.id,
    pid: options.pid ?? process.pid,
    host: options.host ?? shortHostname(hostname()),
    name: runner.name,
    repo: runner.repo,
    startedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  write(path, JSON.stringify(mine, null, 2));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const read = reader(options);
    let body = "";
    try {
      body = read(path);
    } catch {
      return;
    }
    if (held(body)?.pid !== mine.pid) return;
    const remove =
      options.remove ?? ((file: string) => rmSync(file, { force: true }));
    try {
      remove(path);
    } catch {
      return;
    }
  };
}
