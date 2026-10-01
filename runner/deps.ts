import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { runShell, type Shell } from "./merge.ts";
import { configDirectory } from "./session.ts";

export type DepsReport = { linked: boolean; built: boolean; reason: string };

export type DepsFs = {
  exists: (path: string) => boolean;
  read: (path: string) => string;
  write: (path: string, text: string) => void;
  mkdir: (path: string) => void;
  remove: (path: string) => void;
  link: (target: string, path: string) => void;
  move: (from: string, to: string) => boolean;
  list: (path: string) => string[];
  age: (path: string) => number;
};

export const linkType = (platform: NodeJS.Platform = process.platform) =>
  platform === "win32" ? "junction" : "dir";

export const nodeFs: DepsFs = {
  exists: existsSync,
  read: (path) => readFileSync(path, "utf8"),
  write: (path, text) => writeFileSync(path, text),
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  remove: (path) => rmSync(path, { recursive: true, force: true }),
  link: (target, path) => symlinkSync(target, path, linkType()),
  move: (from, to) => {
    try {
      renameSync(from, to);
      return true;
    } catch {
      return false;
    }
  },
  list: (path) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
  age: (path) => {
    try {
      return Date.now() - statSync(path).mtimeMs;
    } catch {
      return 0;
    }
  },
};

export type DepsParts = {
  fs?: DepsFs;
  shell?: Shell;
  store?: string;
  name?: () => string;
  keepFor?: number;
};

export const keepStoresFor = 7 * 24 * 60 * 60 * 1000;

export function storeRoot(repo: string, config = configDirectory()): string {
  const repository = resolve(repo);
  const hash = createHash("sha256")
    .update(repository)
    .digest("hex")
    .slice(0, 8);
  return join(
    config,
    "deps",
    `${basename(repository) || "repository"}-${hash}`,
  );
}

export const lockKey = (lock: string) =>
  createHash("sha256").update(lock).digest("hex").slice(0, 12);

function lastLine(output: string): string {
  return output.trim().split("\n").filter(Boolean).slice(-1)[0] ?? "";
}

function prune(fs: DepsFs, root: string, keep: string, keepFor: number): void {
  for (const entry of fs.list(root)) {
    if (entry === keep) continue;
    const path = join(root, entry);
    if (fs.age(path) > keepFor) fs.remove(path);
  }
}

export async function linkDependencies(
  repo: string,
  worktree: string,
  parts: DepsParts = {},
): Promise<DepsReport> {
  const fs = parts.fs ?? nodeFs;
  const shell = parts.shell ?? runShell;
  const root = parts.store ?? storeRoot(repo);
  const keepFor = parts.keepFor ?? keepStoresFor;
  const manifest = join(worktree, "package.json");
  const lock = join(worktree, "package-lock.json");
  if (!fs.exists(manifest) || !fs.exists(lock))
    return { linked: false, built: false, reason: "" };
  const key = lockKey(fs.read(lock));
  const store = join(root, key);
  let built = false;
  if (!fs.exists(join(store, "ready"))) {
    const staging = join(root, `.building-${(parts.name ?? randomUUID)()}`);
    fs.remove(staging);
    fs.mkdir(staging);
    fs.write(join(staging, "package.json"), fs.read(manifest));
    fs.write(join(staging, "package-lock.json"), fs.read(lock));
    const result = await shell("npm ci --no-audit --no-fund", staging);
    if (result.code !== 0) {
      fs.remove(staging);
      return {
        linked: false,
        built: false,
        reason:
          lastLine(result.output) || "npm ci failed in the dependency store",
      };
    }
    fs.write(join(staging, "ready"), key);
    built = fs.move(staging, store);
    if (!built) fs.remove(staging);
    else prune(fs, root, key, keepFor);
  }
  const target = join(worktree, "node_modules");
  fs.remove(target);
  try {
    fs.link(join(store, "node_modules"), target);
  } catch (error) {
    return {
      linked: false,
      built,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  return { linked: true, built, reason: "" };
}
