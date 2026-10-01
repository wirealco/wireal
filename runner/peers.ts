import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { short } from "./agents/types.ts";
import type { AgentKind } from "../src/domain.ts";

/* Every agent should know what the others are doing without spending a token
   on it. The runner already holds all of it (its own agents, other runners'
   agents from their rows, people coding through their own CLI from the
   heartbeat, the merges it made), so it writes it down in each agent's
   worktree: peers.md for the agent to read when it wants, notice.json for the
   Claude hook to hand over only what concerns that agent and only once. */

export const peersFolder = ".wireal";

export type PeerAgent = {
  agent: string;
  kind?: AgentKind;
  /** The other runner's name when the agent is not one of this runner's. */
  runner?: string;
  taskId: string;
  reference: string;
  projects: string[];
  step?: string;
  files: string[];
};
export type PeerHuman = {
  name: string;
  client: string;
  taskId: string;
  reference: string;
  projects: string[];
  note?: string;
};
export type Merged = {
  reference: string;
  name: string;
  base: string;
  commit: string;
};
export type World = {
  agents: PeerAgent[];
  humans: PeerHuman[];
  merged: Merged[];
};
export type Self = {
  agent: string;
  taskId: string;
  projects: string[];
  /** References of the tasks this one waits on. */
  upstream: string[];
  /** Paths the agent wrote or read, relative to its worktree. */
  files: string[];
};

const label = (reference: string) => (reference ? `WRL·${reference}` : "");

function onTask(reference: string, projects: string[]): string {
  const task = label(reference);
  const where = projects.length ? ` in ${projects.join(", ")}` : "";
  return task ? `${task}${where}` : where.trim();
}

function others(self: Self, world: World) {
  return {
    agents: world.agents.filter(
      (peer) => peer.agent !== self.agent || peer.taskId !== self.taskId,
    ),
    humans: world.humans,
  };
}

/** What peers.md says: a line per agent or person at work, then the merges. */
export function peersText(self: Self, world: World): string {
  const { agents, humans } = others(self, world);
  const lines = ["# Who else is working (kept current by the runner)"];
  for (const peer of agents) {
    const who = `${peer.agent}${peer.kind ? ` [${peer.kind}]` : ""}${peer.runner ? ` on ${peer.runner}` : ""}`;
    const doing = [
      onTask(peer.reference, peer.projects),
      peer.step ? short(peer.step, 80) : "",
      peer.files.length ? `files ${peer.files.slice(-5).join(", ")}` : "",
    ].filter(Boolean);
    lines.push(`- ${who}: ${doing.join("; ") || "idle"}`);
  }
  for (const human of humans)
    lines.push(
      `- ${human.name} (person, ${human.client}): ${[
        onTask(human.reference, human.projects),
        human.note ? short(human.note, 80) : "",
      ]
        .filter(Boolean)
        .join("; ")}`,
    );
  if (!agents.length && !humans.length) lines.push("- nobody else");
  for (const merge of world.merged.slice(-5))
    lines.push(
      `- merged ${label(merge.reference)} ${short(merge.name, 60)} into ${merge.base} as ${merge.commit.slice(0, 7)}`,
    );
  return lines.join("\n") + "\n";
}

/** The facts that concern this agent: someone on a file it has in hand,
 *  someone in its project, a task it waits on landing. Three at most. */
export function noticeLines(self: Self, world: World): string[] {
  const { agents, humans } = others(self, world);
  const mine = new Set(self.files);
  const facts: string[] = [];
  for (const peer of agents) {
    const shared = peer.files.filter((file) => mine.has(file));
    if (shared.length)
      facts.push(
        `Wireal: ${peer.agent} (${label(peer.reference)}) is also changing ${shared.slice(0, 3).join(", ")}; see .wireal/peers.md.`,
      );
  }
  const sameProject = (projects: string[]) =>
    projects.filter((project) => self.projects.includes(project));
  for (const peer of agents) {
    const shared = sameProject(peer.projects);
    if (shared.length && !facts.some((fact) => fact.includes(peer.agent)))
      facts.push(
        `Wireal: ${peer.agent} is on ${label(peer.reference)} in ${shared[0]} too.`,
      );
  }
  for (const human of humans) {
    const shared = sameProject(human.projects);
    if (shared.length || human.taskId === self.taskId)
      facts.push(
        `Wireal: ${human.name} (person, ${human.client}) is on ${human.taskId === self.taskId ? "this task" : `${label(human.reference)} in ${shared[0]}`}.`,
      );
  }
  for (const merge of world.merged)
    if (self.upstream.includes(merge.reference))
      facts.push(
        `Wireal: prerequisite ${label(merge.reference)} merged into ${merge.base} as ${merge.commit.slice(0, 7)}.`,
      );
  return facts.slice(0, 3);
}

function commonGitDir(worktree: string): string {
  const dotGit = join(worktree, ".git");
  try {
    const pointer = readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/m);
    if (!pointer) return dotGit;
    const gitDir = resolve(worktree, pointer[1].trim());
    const common = join(gitDir, "commondir");
    return existsSync(common)
      ? resolve(gitDir, readFileSync(common, "utf8").trim())
      : gitDir;
  } catch {
    return dotGit;
  }
}

/** Keeps .wireal out of every commit: the folder ignores itself, and the
 *  repository's exclude names it for good measure. */
export function excludePeers(worktree: string): void {
  const folder = join(worktree, peersFolder);
  mkdirSync(folder, { recursive: true });
  const ignore = join(folder, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  const gitDir = commonGitDir(worktree);
  if (!isAbsolute(gitDir) || !existsSync(gitDir)) return;
  const exclude = join(gitDir, "info", "exclude");
  try {
    const current = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
    if (/^\/?\.wireal\/?$/m.test(current)) return;
    mkdirSync(dirname(exclude), { recursive: true });
    writeFileSync(
      exclude,
      `${current}${current && !current.endsWith("\n") ? "\n" : ""}/${peersFolder}/\n`,
    );
  } catch {
    return;
  }
}

/** Writes peers.md and notice.json when they changed; returns whether the
 *  notice did, so a caller can tell a fact went out. */
export function publishPeers(
  worktree: string,
  self: Self,
  world: World,
  written: Map<string, string> = new Map(),
): boolean {
  if (!worktree) return false;
  try {
    excludePeers(worktree);
    const text = peersText(self, world);
    const notice = JSON.stringify({ lines: noticeLines(self, world) });
    const peersPath = join(worktree, peersFolder, "peers.md");
    const noticePath = join(worktree, peersFolder, "notice.json");
    if (written.get(peersPath) !== text) {
      writeFileSync(peersPath, text);
      written.set(peersPath, text);
    }
    if (written.get(noticePath) === notice) return false;
    writeFileSync(noticePath, notice);
    written.set(noticePath, notice);
    return true;
  } catch {
    return false;
  }
}
