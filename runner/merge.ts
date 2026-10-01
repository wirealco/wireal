import { spawn } from "node:child_process";
import { hasRemote, runGit, type Run, type Worktree } from "./worktree.ts";

export type Shell = (
  command: string,
  cwd: string,
) => Promise<{ code: number; output: string }>;

export const runShell: Shell = (command, cwd) =>
  new Promise((done) => {
    const windows = process.platform === "win32";
    const file = windows
      ? process.env.ComSpec || "cmd.exe"
      : process.env.SHELL || "/bin/sh";
    const args = windows ? ["/d", "/s", "/c", command] : ["-c", command];
    const child = spawn(file, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const take = (chunk: string) => {
      output += chunk;
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => done({ code: 1, output: error.message }));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });

export type CheckRun = { command: string; code: number; output: string };

export async function runChecks(
  commands: readonly string[],
  cwd: string,
  onLine: (text: string) => void = () => {},
  shell: Shell = runShell,
): Promise<CheckRun | undefined> {
  for (const command of commands.map((entry) => entry.trim()).filter(Boolean)) {
    onLine(`Checks: ${command}`);
    const result = await shell(command, cwd);
    for (const line of result.output.split(/\r?\n/))
      if (line.trim()) onLine(`  ${line.trim()}`);
    if (result.code !== 0)
      return { command, code: result.code, output: result.output };
  }
  return undefined;
}

export type MergeOutcome =
  | { merged: true; commit: string }
  | { merged: false; conflicts: string[]; error: string };

export async function mergeBranch(
  repo: string,
  worktree: Worktree,
  message: string,
  run: Run = runGit,
): Promise<MergeOutcome> {
  const remote = await hasRemote(repo, run);
  const known = async (ref: string) =>
    (await run(["rev-parse", "--verify", "--quiet", ref], repo)).code === 0;
  const upstream = `refs/remotes/origin/${worktree.base}`;
  if (remote) {
    const fetched = await run(["fetch", "origin", worktree.base], repo);
    if (fetched.code !== 0 && (await known(upstream)))
      return {
        merged: false,
        conflicts: [],
        error: reason(fetched.stderr, fetched.stdout),
      };
  }
  const tracked = remote && (await known(upstream));
  const target = tracked ? `origin/${worktree.base}` : worktree.base;
  const land = async (commit: string): Promise<MergeOutcome | undefined> => {
    if (remote) {
      const pushed = await run(
        ["push", "origin", `HEAD:${worktree.base}`],
        worktree.path,
      );
      if (pushed.code !== 0) return undefined;
      await run(["push", "origin", "--delete", worktree.branch], worktree.path);
      return { merged: true, commit };
    }
    const moved = await run(
      ["branch", "--force", worktree.base, commit],
      worktree.path,
    );
    return moved.code === 0 ? { merged: true, commit } : undefined;
  };
  const straight = await run(["checkout", worktree.branch], worktree.path);
  if (straight.code === 0) {
    const ahead = await run(
      ["merge-base", "--is-ancestor", target, "HEAD"],
      worktree.path,
    );
    let ready = ahead.code === 0;
    if (!ready) {
      const rebased = await run(["rebase", target], worktree.path);
      ready = rebased.code === 0;
      if (!ready) await run(["rebase", "--abort"], worktree.path);
    }
    if (ready) {
      const head = await run(["rev-parse", "HEAD"], worktree.path);
      const landed = await land(head.code === 0 ? head.stdout.trim() : "");
      if (landed) return landed;
      if (remote) await run(["fetch", "origin", worktree.base], repo);
    }
  }
  const checkout = await run(["checkout", "--detach", target], worktree.path);
  if (checkout.code !== 0)
    return {
      merged: false,
      conflicts: [],
      error: reason(checkout.stderr, checkout.stdout),
    };
  const merged = await run(
    ["merge", "--no-ff", "-m", message, worktree.branch],
    worktree.path,
  );
  if (merged.code !== 0) {
    const unmerged = await run(
      ["diff", "--name-only", "--diff-filter=U"],
      worktree.path,
    );
    const conflicts = unmerged.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    await run(["merge", "--abort"], worktree.path);
    return {
      merged: false,
      conflicts,
      error: reason(merged.stderr, merged.stdout),
    };
  }
  const head = await run(["rev-parse", "HEAD"], worktree.path);
  const commit = head.code === 0 ? head.stdout.trim() : "";
  const landed = await land(commit);
  return (
    landed ?? {
      merged: false,
      conflicts: [],
      error: `${worktree.base} moved while ${worktree.branch} was landing`,
    }
  );
}

export type PromoteOutcome =
  | { promoted: true; commit: string; tasks: string[] }
  | { promoted: false; tasks: string[]; conflicts: string[]; error: string };

/* One merge naming every task it carries, for a promotion and for a line that
   walked more than one task. "Merge wireal/38" hid the two that came after it. */
export function mergeMessage(tasks: readonly string[]): string {
  return tasks.length ? `Merge wireal/${tasks.join(", ")}` : "";
}

export async function promoteBranch(
  repo: string,
  branch: string,
  target: string,
  run: Run = runGit,
): Promise<PromoteOutcome> {
  const nothing = (error: string, tasks: string[] = []): PromoteOutcome => ({
    promoted: false,
    tasks,
    conflicts: [],
    error,
  });
  if (!branch.trim() || branch === target)
    return nothing("There is no agent branch to promote");
  const remote = await hasRemote(repo, run);
  if (!remote) return nothing("The folder has no origin to promote to");
  const fetched = await run(["fetch", "origin", branch, target], repo);
  if (fetched.code !== 0)
    return nothing(reason(fetched.stderr, fetched.stdout));
  const head = `origin/${branch}`;
  const onto = `origin/${target}`;
  const carried = await run(["log", "--format=%s", `${onto}..${head}`], repo);
  if (carried.code !== 0)
    return nothing(reason(carried.stderr, carried.stdout));
  const subjects = carried.stdout.split(/\r?\n/).filter((line) => line.trim());
  if (!subjects.length) return nothing(`${target} already has ${branch}`);
  const tasks = [
    ...new Set(
      subjects
        .map((line) => /^Task (\d+):/.exec(line)?.[1] ?? "")
        .filter(Boolean),
    ),
  ].sort((left, right) => Number(left) - Number(right));
  const message = mergeMessage(tasks) || `Merge ${branch}`;
  const ancestor = await run(["merge-base", "--is-ancestor", onto, head], repo);
  let tree = "";
  if (ancestor.code === 0) {
    const read = await run(["rev-parse", `${head}^{tree}`], repo);
    if (read.code !== 0)
      return nothing(reason(read.stderr, read.stdout), tasks);
    tree = read.stdout.trim();
  } else {
    const written = await run(["merge-tree", "--write-tree", onto, head], repo);
    if (written.code !== 0)
      return {
        promoted: false,
        tasks,
        conflicts: conflicted(written.stdout),
        error: `${branch} conflicts with ${target}`,
      };
    tree = written.stdout.split(/\r?\n/)[0]?.trim() ?? "";
  }
  if (!tree) return nothing(`${branch} produced no tree to promote`, tasks);
  const made = await run(
    ["commit-tree", tree, "-p", onto, "-p", head, "-m", message],
    repo,
  );
  if (made.code !== 0) return nothing(reason(made.stderr, made.stdout), tasks);
  const commit = made.stdout.trim();
  const pushed = await run(
    ["push", "origin", `${commit}:refs/heads/${target}`],
    repo,
  );
  if (pushed.code !== 0)
    return nothing(reason(pushed.stderr, pushed.stdout), tasks);
  // The agent branch is a parent of what was just pushed, so it lands level
  // with the default branch rather than a promotion behind it. A branch left
  // where it was is the one that sends an agent off an old base.
  await run(["push", "origin", `${commit}:refs/heads/${branch}`], repo);
  await run(["fetch", "origin", target, branch], repo);
  await run(["branch", "--force", branch, commit], repo);
  return { promoted: true, commit, tasks };
}

function conflicted(output: string): string[] {
  return [
    ...new Set(
      output
        .split(/\r?\n/)
        .map((line) => /^\d{6} [0-9a-f]+ [123]\t(.+)$/.exec(line.trim())?.[1])
        .filter((name): name is string => !!name),
    ),
  ];
}

export async function branchOfCommit(
  repo: string,
  commit: string,
  run: Run = runGit,
): Promise<string> {
  if (!commit.trim()) return "";
  if (await hasRemote(repo, run)) await run(["fetch", "origin"], repo);
  for (const args of [
    ["branch", "--list", "wireal/*", "--contains", commit],
    ["branch", "--remotes", "--list", "origin/wireal/*", "--contains", commit],
  ]) {
    const found = await run(args, repo);
    if (found.code !== 0) continue;
    const branch = found.stdout
      .split(/\r?\n/)
      .map((line) => line.replace(/^[*+]?\s*/, "").trim())
      .filter(
        (line) => line.startsWith("wireal/") || line.startsWith("origin/"),
      )
      .map((line) => line.replace(/^origin\//, ""))
      .find((line) => line.startsWith("wireal/"));
    if (branch) return branch;
  }
  return "";
}

export type FolderState = {
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  upstream: string;
};

/* Measured against what the folder itself tracks, not against the branch the
   runner works on. Once those two stopped being the same branch, counting
   against the runner's own base told somebody their folder was three commits
   behind and then pulled nothing, because pull follows the upstream. */
export async function folderState(
  repo: string,
  base: string,
  fetch: boolean,
  run: Run = runGit,
): Promise<FolderState> {
  const head = await run(["rev-parse", "--abbrev-ref", "HEAD"], repo);
  const branch = head.code === 0 ? head.stdout.trim() : "";
  const status = await run(["status", "--porcelain"], repo);
  const tracked = await run(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    repo,
  );
  const upstream = tracked.code === 0 ? tracked.stdout.trim() : "";
  if (fetch && (await hasRemote(repo, run)))
    await run(["fetch", "origin", upstream ? branch : base], repo);
  const counted = await run(
    [
      "rev-list",
      "--left-right",
      "--count",
      `HEAD...${upstream || `origin/${base}`}`,
    ],
    repo,
  );
  const [ahead, behind] =
    counted.code === 0
      ? counted.stdout.trim().split(/\s+/).map(Number)
      : [0, 0];
  return {
    branch,
    dirty: status.stdout.trim().length > 0,
    ahead: distance(ahead),
    behind: distance(behind),
    upstream,
  };
}

function distance(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Number(value) : 0;
}

export async function pullFolder(
  repo: string,
  state: FolderState,
  run: Run = runGit,
): Promise<{ pulled: boolean; reason: string }> {
  if (!state.upstream)
    return {
      pulled: false,
      reason: `Folder is on ${state.branch || "no branch"}, which tracks nothing`,
    };
  if (state.ahead && state.behind)
    return {
      pulled: false,
      reason: `Folder and ${state.upstream} have both moved, ${state.ahead} here and ${state.behind} there, so it takes a rebase by hand`,
    };
  if (!state.behind)
    return { pulled: false, reason: `Folder is level with ${state.upstream}` };
  if (state.dirty)
    return { pulled: false, reason: "Folder has uncommitted changes" };
  const pulled = await run(["pull", "--ff-only"], repo);
  return pulled.code === 0
    ? { pulled: true, reason: "Folder pulled" }
    : {
        pulled: false,
        reason: `Folder could not be pulled: ${reason(pulled.stderr, pulled.stdout)}`,
      };
}

function reason(stderr: string, stdout: string): string {
  const text = (stderr.trim() || stdout.trim()).split(/\r?\n/)[0] ?? "";
  return text.slice(0, 160) || "git failed";
}
