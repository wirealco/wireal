import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir, hostname } from "node:os";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { parseCrew, type CrewSeat } from "./crew.ts";

export type Session = {
  apiUrl: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  savedAt: string;
};

export type Platform = "darwin" | "win32" | "linux";

export type RunnerIdentity = {
  id: string;
  name: string;
};

export type RunnerBinding = RunnerIdentity & {
  workspaceId: string;
  repoPath: string;
  checks?: string[];
  /** The agents this folder's runner runs, as last set with its + and -
   *  keys or its count flags. Unset means one per CLI found. */
  crew?: CrewSeat[];
};

export function apiUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.WIREAL_API_URL || "https://api.wireal.co").replace(/\/$/, "");
}

export function mcpResource(env: NodeJS.ProcessEnv = process.env): string {
  return env.WIREAL_MCP_RESOURCE || "https://mcp.wireal.co";
}

export function configDirectory(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const under = platform === "win32" ? win32.join : posix.join;
  if (platform === "darwin")
    return under(home, "Library", "Application Support", "wireal");
  if (platform === "win32")
    return under(env.APPDATA || under(home, "AppData", "Roaming"), "wireal");
  return under(env.XDG_CONFIG_HOME || under(home, ".config"), "wireal");
}

export function sessionPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  return (platform === "win32" ? win32.join : posix.join)(
    configDirectory(platform, env, home),
    "session.json",
  );
}

export function absoluteRepositoryPath(repoPath: string): string {
  return resolve(repoPath);
}

export function bindingHash(repoPath: string): string {
  return createHash("sha256")
    .update(absoluteRepositoryPath(repoPath))
    .digest("hex")
    .slice(0, 8);
}

export function bindingPath(
  repoPath: string,
  directory = configDirectory(),
): string {
  return join(directory, "bindings", `${bindingHash(repoPath)}.json`);
}

export function readChecks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((line): line is string => typeof line === "string")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function readBinding(
  repoPath: string,
  path = bindingPath(repoPath),
): RunnerBinding | null {
  try {
    const parsed = JSON.parse(
      readFileSync(path, "utf8"),
    ) as Partial<RunnerBinding>;
    const absolute = absoluteRepositoryPath(repoPath);
    if (typeof parsed.id !== "string" || !parsed.id.trim()) return null;
    if (typeof parsed.name !== "string" || !parsed.name.trim()) return null;
    if (typeof parsed.workspaceId !== "string" || !parsed.workspaceId.trim())
      return null;
    if (
      typeof parsed.repoPath !== "string" ||
      absoluteRepositoryPath(parsed.repoPath) !== absolute
    )
      return null;
    const checks = readChecks(parsed.checks);
    const crew = parseCrew(parsed.crew);
    return {
      id: parsed.id.trim(),
      name: parsed.name.trim(),
      workspaceId: parsed.workspaceId.trim(),
      repoPath: absolute,
      ...(checks.length ? { checks } : {}),
      ...(crew ? { crew } : {}),
    };
  } catch {
    return null;
  }
}

export function writeBinding(
  binding: RunnerBinding,
  path = bindingPath(binding.repoPath),
): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(binding, null, 2), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    return;
  }
}

export function clearBinding(
  repoPath: string,
  path = bindingPath(repoPath),
): boolean {
  try {
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}

export function shortHostname(host = hostname()): string {
  return host.split(".")[0] || host;
}

export function readSession(path = sessionPath()): Session | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Session>;
    if (!parsed.accessToken && !parsed.refreshToken) return null;
    return {
      apiUrl: parsed.apiUrl || apiUrl(),
      clientId: parsed.clientId ?? "",
      accessToken: parsed.accessToken ?? "",
      refreshToken: parsed.refreshToken ?? "",
      savedAt: parsed.savedAt ?? "",
    };
  } catch {
    return null;
  }
}

export function writeSession(session: Session, path = sessionPath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(session, null, 2), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    return;
  }
}

export const lockStaleMs = 30_000;

export const lockBusyNote =
  "Another wireal-run on this machine is refreshing the saved session.";

export async function withSessionLock<T>(
  work: () => Promise<T>,
  path = sessionPath(),
  waitMs = 60_000,
): Promise<T> {
  const lock = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const until = Date.now() + waitMs;
  let held: number | undefined;
  while (held === undefined && Date.now() < until) {
    try {
      held = openSync(lock, "wx", 0o600);
    } catch {
      const stale = statSync(lock, { throwIfNoEntry: false });
      if (stale && Date.now() - stale.mtimeMs > lockStaleMs) {
        rmSync(lock, { force: true });
        continue;
      }
      await new Promise((wake) => setTimeout(wake, 40));
    }
  }
  if (held === undefined) throw new Error(lockBusyNote);
  try {
    return await work();
  } finally {
    closeSync(held);
    rmSync(lock, { force: true });
  }
}

export function clearSession(path = sessionPath()): boolean {
  try {
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}
