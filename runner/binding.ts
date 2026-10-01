import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { createInterface } from "node:readline/promises";
import type { WorkspaceInfo } from "../mcp/client.ts";
import { normalizeRepositoryUrl, type Workspace } from "../src/domain.ts";
import { chooseWorkspace } from "./board.ts";
import {
  absoluteRepositoryPath,
  bindingPath,
  readBinding,
  readChecks,
  writeBinding,
  type RunnerBinding,
} from "./session.ts";
import { terminalName } from "./naming.ts";
import { parseCrew, type CrewSeat } from "./crew.ts";
import { repositoryUrl } from "./worktree.ts";

export type BindingClient = {
  workspaces(): Promise<WorkspaceInfo[]>;
  workspace(workspaceId: string): Promise<Workspace>;
};

export type ResolveBindingOptions = {
  repoPath: string;
  workspace?: string;
  name?: string;
  directory?: string;
  tty?: boolean;
  prompt?: (question: string) => Promise<string>;
  print?: (message: string) => void;
  makeId?: () => string;
  terminal?: () => string;
  repository?: (repoPath: string) => Promise<string>;
  client: BindingClient;
};

async function terminalPrompt(question: string): Promise<string> {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await terminal.question(question);
  } finally {
    terminal.close();
  }
}

function normalizedRepository(input: string): string {
  try {
    return normalizeRepositoryUrl(input).toLowerCase();
  } catch {
    return "";
  }
}

export function workspaceHasRepository(
  workspace: Workspace,
  repository: string,
): boolean {
  const expected = normalizedRepository(repository);
  if (!expected) return false;
  return [
    workspace.map.repositoryUrl,
    ...workspace.projects.map((project) => project.repositoryUrl),
  ].some((candidate) => normalizedRepository(candidate) === expected);
}

async function pickWorkspace(
  workspaces: WorkspaceInfo[],
  prompt: (question: string) => Promise<string>,
  print: (message: string) => void,
): Promise<WorkspaceInfo> {
  if (!workspaces.length)
    throw new Error("No Wireal workspace exists for this account.");
  for (const [index, workspace] of workspaces.entries())
    print(`${index + 1}. ${workspace.name}`);
  while (true) {
    const answer = await prompt(
      `Choose a workspace [1-${workspaces.length}]: `,
    );
    const choice = Number(answer.trim());
    if (Number.isInteger(choice) && choice >= 1 && choice <= workspaces.length)
      return workspaces[choice - 1];
    print("Choose a workspace by number.");
  }
}

export function bindingChecks(
  repoPath: string,
  directory?: string,
): string[] | undefined {
  const absolute = absoluteRepositoryPath(repoPath);
  const saved = readBinding(absolute, bindingPath(absolute, directory));
  return saved ? (saved.checks ?? []) : undefined;
}

export function setBindingChecks(
  repoPath: string,
  commands: readonly string[],
  directory?: string,
): string[] | undefined {
  const absolute = absoluteRepositoryPath(repoPath);
  const path = bindingPath(absolute, directory);
  const saved = readBinding(absolute, path);
  if (!saved) return undefined;
  const checks = readChecks(commands);
  const next: RunnerBinding = { ...saved };
  delete next.checks;
  if (checks.length) next.checks = checks;
  writeBinding(next, path);
  return checks;
}

/** Saves the crew this folder's runner runs, so a restart brings the same
 *  agents. False when the folder has no binding. */
export function setBindingCrew(
  repoPath: string,
  crew: readonly CrewSeat[],
  directory?: string,
): boolean {
  const absolute = absoluteRepositoryPath(repoPath);
  const path = bindingPath(absolute, directory);
  const saved = readBinding(absolute, path);
  if (!saved) return false;
  writeBinding({ ...saved, crew: parseCrew(crew) ?? [] }, path);
  return true;
}

export function renameBinding(
  repoPath: string,
  name: string,
  directory?: string,
): { from: string; to: string } | undefined {
  const wanted = name.trim();
  if (!wanted) throw new Error("A runner needs a name to be renamed to.");
  const absolute = absoluteRepositoryPath(repoPath);
  const path = bindingPath(absolute, directory);
  const saved = readBinding(absolute, path);
  if (!saved) return undefined;
  writeBinding({ ...saved, name: wanted }, path);
  return { from: saved.name, to: wanted };
}

export async function resolveBinding(
  options: ResolveBindingOptions,
): Promise<RunnerBinding> {
  const repoPath = absoluteRepositoryPath(options.repoPath);
  const path = bindingPath(repoPath, options.directory);
  const saved = readBinding(repoPath, path);
  const named = options.name?.trim();
  const tty =
    options.tty ??
    (process.stdin.isTTY === true && process.stdout.isTTY === true);
  const prompt = options.prompt ?? terminalPrompt;
  const print = options.print ?? console.log;

  if (saved && !options.workspace?.trim()) {
    if (!named || named === saved.name) return saved;
    const renamed = { ...saved, name: named };
    writeBinding(renamed, path);
    return renamed;
  }

  const workspaces = await options.client.workspaces();
  let chosen: WorkspaceInfo;
  if (options.workspace?.trim()) {
    chosen = chooseWorkspace(workspaces, options.workspace);
  } else {
    const remote = await (options.repository ?? repositoryUrl)(repoPath);
    const documents = await Promise.all(
      workspaces.map(async (workspace) => ({
        workspace,
        document: await options.client.workspace(workspace.id),
      })),
    );
    const matches = documents
      .filter(({ document }) => workspaceHasRepository(document, remote))
      .map(({ workspace }) => workspace);
    if (matches.length === 1) {
      chosen = matches[0];
    } else if (matches.length > 1) {
      if (!tty)
        throw new Error(
          "Several workspaces have this repository. Pass --workspace <name>.",
        );
      chosen = await pickWorkspace(matches, prompt, print);
    } else {
      if (!tty)
        throw new Error(
          "No workspace has this repository. Pass --workspace <name>.",
        );
      chosen = await pickWorkspace(workspaces, prompt, print);
    }
  }

  const fallback = (options.terminal ?? terminalName)() || basename(repoPath);
  const name =
    named ||
    saved?.name ||
    (tty
      ? (await prompt(`Name this runner [${fallback}]: `)).trim() || fallback
      : fallback);
  const binding: RunnerBinding = {
    id: saved?.id ?? (options.makeId ?? randomUUID)(),
    name,
    workspaceId: chosen.id,
    repoPath,
    ...(saved?.checks?.length ? { checks: saved.checks } : {}),
    ...(saved?.crew ? { crew: saved.crew } : {}),
  };
  writeBinding(binding, path);
  print(`Bound to workspace ${chosen.name}`);
  return binding;
}
