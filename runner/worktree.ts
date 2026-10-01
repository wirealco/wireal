import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { normalizeRepositoryUrl } from "../src/domain.ts";
import { configDirectory } from "./session.ts";

export type Run = (
  args: string[],
  cwd: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

export const runGit: Run = (args, cwd) =>
  new Promise((done) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) =>
      done({ code: 1, stdout, stderr: error.message }),
    );
    child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
  });

export type Worktree = { path: string; branch: string; base: string };

export const branchName = (reference: string) => `wireal/${reference}`;

export function taskReference(reference: string): string {
  if (!/^[1-9][0-9]{0,8}$/.test(reference))
    throw new Error(`${reference} is not a task number.`);
  return reference;
}

async function git(run: Run, cwd: string, args: string[]): Promise<string> {
  const result = await run(args, cwd);
  if (result.code !== 0)
    throw new Error(
      `git ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  return result.stdout.trim();
}

export async function defaultBranch(
  repo: string,
  run: Run = runGit,
): Promise<string> {
  const remote = await run(
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    repo,
  );
  if (remote.code === 0 && remote.stdout.trim())
    return remote.stdout.trim().replace(/^origin\//, "");
  const head = await run(["rev-parse", "--abbrev-ref", "HEAD"], repo);
  return head.stdout.trim() || "main";
}

export async function repositoryUrl(
  repo: string,
  run: Run = runGit,
): Promise<string> {
  const remote = await run(["remote", "get-url", "origin"], repo);
  if (remote.code !== 0) return "";
  const raw = remote.stdout.trim();
  const ssh = raw.match(/^(?:ssh:\/\/)?git@github\.com[:/]+(.+)$/i);
  try {
    return normalizeRepositoryUrl(ssh ? `https://github.com/${ssh[1]}` : raw);
  } catch {
    return "";
  }
}

export async function hasRemote(
  repo: string,
  run: Run = runGit,
): Promise<boolean> {
  const remotes = await run(["remote"], repo);
  return remotes.code === 0 && remotes.stdout.trim().length > 0;
}

export function worktreePath(
  repo: string,
  reference: string,
  config = configDirectory(),
): string {
  const repository = resolve(repo);
  const hash = createHash("sha256")
    .update(repository)
    .digest("hex")
    .slice(0, 8);
  return join(
    config,
    "worktrees",
    `${basename(repository) || "repository"}-${hash}`,
    reference,
  );
}

async function tipOf(repo: string, ref: string, run: Run): Promise<string> {
  const read = await run(["rev-parse", "--verify", "--quiet", ref], repo);
  return read.code === 0 ? read.stdout.trim() : "";
}

/* An agent branch that sits where it was cut is the real hazard, not a
   conflict: a worktree opened from it is written against a default branch that
   has moved, and the merge lands clean and fails to compile. It is caught up
   before anything is cut from it, without a checkout, so nobody's folder is
   touched. */
export async function catchUpBase(
  repo: string,
  branch: string,
  target: string,
  run: Run = runGit,
): Promise<string> {
  if (!branch.trim() || branch === target) return "";
  if (!(await hasRemote(repo, run))) return "";
  await run(["fetch", "origin", branch, target], repo);
  const head =
    (await tipOf(repo, `refs/remotes/origin/${branch}`, run)) ||
    (await tipOf(repo, `refs/heads/${branch}`, run));
  const onto = await tipOf(repo, `refs/remotes/origin/${target}`, run);
  if (!head || !onto) return "";
  const carries = await run(["merge-base", "--is-ancestor", onto, head], repo);
  if (carries.code === 0) return "";
  let landing = onto;
  const behind = await run(["merge-base", "--is-ancestor", head, onto], repo);
  if (behind.code !== 0) {
    const written = await run(["merge-tree", "--write-tree", head, onto], repo);
    if (written.code !== 0) return "";
    const tree = written.stdout.split(/\r?\n/)[0]?.trim() ?? "";
    if (!tree) return "";
    const made = await run(
      [
        "commit-tree",
        tree,
        "-p",
        head,
        "-p",
        onto,
        "-m",
        `Merge ${target} into ${branch}`,
      ],
      repo,
    );
    if (made.code !== 0) return "";
    landing = made.stdout.trim();
  }
  if (!landing) return "";
  const pushed = await run(
    ["push", "origin", `${landing}:refs/heads/${branch}`],
    repo,
  );
  if (pushed.code !== 0) return "";
  await run(["fetch", "origin", branch], repo);
  await run(["branch", "--force", branch, landing], repo);
  return landing;
}

export async function ensureBase(
  repo: string,
  wanted: string,
  run: Run = runGit,
): Promise<string> {
  const fallback = await defaultBranch(repo, run);
  const name = wanted.trim();
  if (!name || name === fallback) return fallback;
  const remote = await hasRemote(repo, run);
  if (remote) await run(["fetch", "origin", name], repo);
  const known = async (ref: string) =>
    (await run(["rev-parse", "--verify", "--quiet", ref], repo)).code === 0;
  if (await known(`refs/heads/${name}`)) {
    await catchUpBase(repo, name, fallback, run);
    return name;
  }
  if (await known(`refs/remotes/origin/${name}`)) {
    const tracked = await run(["branch", name, `origin/${name}`], repo);
    if (tracked.code !== 0) return fallback;
    await catchUpBase(repo, name, fallback, run);
    return name;
  }
  const start =
    remote && (await known(`refs/remotes/origin/${fallback}`))
      ? `origin/${fallback}`
      : fallback;
  const made = await run(["branch", name, start], repo);
  return made.code === 0 ? name : fallback;
}

export async function openWorktree(
  repo: string,
  reference: string,
  wanted = "",
  run: Run = runGit,
  config = configDirectory(),
): Promise<Worktree> {
  const branch = branchName(taskReference(reference));
  const path = worktreePath(repo, reference, config);
  const base = await ensureBase(repo, wanted, run);
  mkdirSync(dirname(path), { recursive: true });
  // A runner that was killed mid-task can leave the folder behind without
  // git knowing it as a worktree any more, or git can still list a worktree
  // whose folder is gone; either makes `worktree add` refuse. The folder is
  // the runner's own, under its config directory, so it is cleared outright.
  if (existsSync(path))
    await run(["worktree", "remove", "--force", path], repo);
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  await run(["worktree", "prune"], repo);
  const local = await run(
    ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
    repo,
  );
  const remote =
    local.code === 0
      ? { code: 1 }
      : await run(
          ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`],
          repo,
        );
  await git(
    run,
    repo,
    local.code === 0
      ? ["worktree", "add", path, branch]
      : remote.code === 0
        ? ["worktree", "add", path, "-b", branch, `origin/${branch}`]
        : ["worktree", "add", path, "-b", branch, base],
  );
  return { path, branch, base };
}

export async function commitWorktree(
  repo: string,
  worktree: Worktree,
  message: string,
  run: Run = runGit,
): Promise<{ commit: string; pushed: boolean }> {
  let commit = "";
  let pushed = false;
  await run(["add", "-A"], worktree.path);
  const changes = await run(["status", "--porcelain"], worktree.path);
  if (changes.stdout.trim())
    await run(["commit", "-m", message], worktree.path);
  const head = await run(["rev-parse", "HEAD"], worktree.path);
  commit = head.code === 0 ? head.stdout.trim() : "";
  if (await hasRemote(repo, run)) {
    const push = await run(
      ["push", "--set-upstream", "origin", worktree.branch],
      worktree.path,
    );
    pushed = push.code === 0;
  }
  return { commit, pushed };
}

export async function removeWorktree(
  repo: string,
  worktree: Worktree,
  run: Run = runGit,
): Promise<void> {
  await run(["worktree", "remove", "--force", worktree.path], repo);
}
