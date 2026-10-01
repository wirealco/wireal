import { accessSync, constants } from "node:fs";
import { posix, win32 } from "node:path";
import type { AgentKind } from "../src/domain.ts";

export const hostKinds: AgentKind[] = ["claude", "codex"];
export const windowsExtensions = [".com", ".exe", ".bat", ".cmd"];

export type HostParts = {
  path?: string;
  platform?: NodeJS.Platform;
  pathExt?: string;
  exists?: (file: string) => boolean;
};

export function runnable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function extensions(
  platform: NodeJS.Platform,
  pathExt = process.env.PATHEXT,
): string[] {
  if (platform !== "win32") return [""];
  const named = (pathExt ?? "")
    .split(";")
    .map((one) => one.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...(named.length ? named : windowsExtensions), ""])];
}

export function folders(parts: HostParts = {}): string[] {
  const platform = parts.platform ?? process.platform;
  const path = parts.path ?? process.env.PATH ?? "";
  return path.split(platform === "win32" ? ";" : ":").filter(Boolean);
}

export function resolveProgram(name: string, parts: HostParts = {}): string {
  const platform = parts.platform ?? process.platform;
  const exists = parts.exists ?? runnable;
  const join = platform === "win32" ? win32.join : posix.join;
  for (const folder of folders(parts))
    for (const extension of extensions(platform, parts.pathExt)) {
      const candidate = join(folder, name + extension);
      if (exists(candidate)) return candidate;
    }
  return "";
}

export function detectHosts(parts: HostParts = {}): AgentKind[] {
  return hostKinds.filter((kind) => resolveProgram(kind, parts));
}
