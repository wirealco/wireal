import assert from "node:assert/strict";
import test from "node:test";
import {
  branchOfCommit,
  folderState,
  mergeBranch,
  promoteBranch,
  mergeMessage,
  pullFolder,
  runChecks,
  type Shell,
} from "./merge.ts";
import type { Run, Worktree } from "./worktree.ts";

type Call = { args: string[]; cwd: string };

function fakeGit(answers: Record<string, { code?: number; stdout?: string }>) {
  const calls: Call[] = [];
  const run: Run = async (args, cwd) => {
    calls.push({ args, cwd });
    const answer = answers[args.join(" ")] ?? {};
    return {
      code: answer.code ?? 0,
      stdout: answer.stdout ?? "",
      stderr: answer.code ? "git said no" : "",
    };
  };
  return { calls, run, said: () => calls.map((call) => call.args.join(" ")) };
}

function fakeShell(
  answers: Record<string, { code?: number; output?: string }>,
) {
  const calls: { command: string; cwd: string }[] = [];
  const shell: Shell = async (command, cwd) => {
    calls.push({ command, cwd });
    const answer = answers[command] ?? {};
    return { code: answer.code ?? 0, output: answer.output ?? "" };
  };
  return { calls, shell };
}

const line: Worktree = {
  path: "/config/worktrees/repo/14",
  branch: "wireal/14",
  base: "main",
};

test("checks run in order in the worktree and stop at the first failure", async () => {
  const shell = fakeShell({ "npm test": { code: 1, output: "1 failing" } });
  const lines: string[] = [];
  const failed = await runChecks(
    ["npx tsc -b", " ", "npm test", "npm run build"],
    line.path,
    (text) => lines.push(text),
    shell.shell,
  );
  assert.deepEqual(failed, {
    command: "npm test",
    code: 1,
    output: "1 failing",
  });
  assert.deepEqual(
    shell.calls.map((call) => call.command),
    ["npx tsc -b", "npm test"],
  );
  assert.ok(shell.calls.every((call) => call.cwd === line.path));
  assert.deepEqual(lines, [
    "Checks: npx tsc -b",
    "Checks: npm test",
    "  1 failing",
  ]);
});

test("checks that all pass report no failure", async () => {
  const shell = fakeShell({});
  assert.equal(
    await runChecks(["npm test"], line.path, () => {}, shell.shell),
    undefined,
  );
});

test("a task that still sits on its base lands as one commit, fast forward", async () => {
  const git = fakeGit({
    remote: { stdout: "origin\n" },
    "rev-parse HEAD": { stdout: "9ab0f1c2d3e4f5061728394a5b6c7d8e9f001122\n" },
  });
  const outcome = await mergeBranch(
    "/repo",
    line,
    "Merge wireal/14: Agents merge their own work",
    git.run,
  );
  assert.deepEqual(outcome, {
    merged: true,
    commit: "9ab0f1c2d3e4f5061728394a5b6c7d8e9f001122",
  });
  assert.deepEqual(git.said(), [
    "remote",
    "fetch origin main",
    "rev-parse --verify --quiet refs/remotes/origin/main",
    "checkout wireal/14",
    "merge-base --is-ancestor origin/main HEAD",
    "rev-parse HEAD",
    "push origin HEAD:main",
    "push origin --delete wireal/14",
  ]);
  assert.ok(!git.said().some((said) => said.startsWith("merge --no-ff")));
});

test("a base that moved is rebased onto, so the branch still lands as one commit", async () => {
  const git = fakeGit({
    remote: { stdout: "origin\n" },
    "merge-base --is-ancestor origin/main HEAD": { code: 1 },
    "rev-parse HEAD": { stdout: "1122334455667788990011223344556677889900\n" },
  });
  const outcome = await mergeBranch("/repo", line, "Merge wireal/14", git.run);
  assert.deepEqual(outcome, {
    merged: true,
    commit: "1122334455667788990011223344556677889900",
  });
  assert.ok(git.said().includes("rebase origin/main"));
  assert.ok(!git.said().includes("rebase --abort"));
  assert.ok(!git.said().some((said) => said.startsWith("merge --no-ff")));
});

test("a rebase that conflicts is abandoned for a merge commit", async () => {
  const git = fakeGit({
    remote: { stdout: "origin\n" },
    "merge-base --is-ancestor origin/main HEAD": { code: 1 },
    "rebase origin/main": { code: 1 },
    "rev-parse HEAD": { stdout: "9ab0f1c2d3e4f5061728394a5b6c7d8e9f001122\n" },
  });
  const outcome = await mergeBranch(
    "/repo",
    line,
    "Merge wireal/14: Agents merge their own work",
    git.run,
  );
  assert.equal(outcome.merged, true);
  assert.ok(git.said().includes("rebase --abort"));
  assert.ok(
    git
      .said()
      .includes(
        "merge --no-ff -m Merge wireal/14: Agents merge their own work wireal/14",
      ),
  );
  assert.ok(git.said().includes("push origin --delete wireal/14"));
});

test("a conflicting merge names the conflicting files, aborts and keeps the branch", async () => {
  const git = fakeGit({
    remote: { stdout: "origin\n" },
    "merge-base --is-ancestor origin/main HEAD": { code: 1 },
    "rebase origin/main": { code: 1 },
    "merge --no-ff -m Merge wireal/14: Agents merge their own work wireal/14": {
      code: 1,
    },
    "diff --name-only --diff-filter=U": {
      stdout: "src/domain.ts\nrunner/loop.ts\n",
    },
  });
  const outcome = await mergeBranch(
    "/repo",
    line,
    "Merge wireal/14: Agents merge their own work",
    git.run,
  );
  assert.equal(outcome.merged, false);
  assert.deepEqual(outcome.merged === false ? outcome.conflicts : [], [
    "src/domain.ts",
    "runner/loop.ts",
  ]);
  assert.ok(git.said().includes("merge --abort"));
  assert.ok(!git.said().some((said) => said.startsWith("push origin HEAD:")));
  assert.ok(!git.said().some((said) => said.includes("--delete")));
});

test("a branch merges onto the agent branch when the workspace names one", async () => {
  const git = fakeGit({
    remote: { stdout: "origin\n" },
    "rev-parse HEAD": { stdout: "aabbccddeeff00112233445566778899aabbccdd\n" },
  });
  const outcome = await mergeBranch(
    "/repo",
    { ...line, base: "agents" },
    "Merge wireal/14",
    git.run,
  );
  assert.equal(outcome.merged, true);
  assert.ok(git.said().includes("fetch origin agents"));
  assert.ok(git.said().includes("merge-base --is-ancestor origin/agents HEAD"));
  assert.ok(git.said().includes("push origin HEAD:agents"));
});

test("an agent branch that is not on the remote yet lands on the local one", async () => {
  const git = fakeGit({
    remote: { stdout: "origin\n" },
    "fetch origin agents": { code: 1 },
    "rev-parse --verify --quiet refs/remotes/origin/agents": { code: 1 },
    "rev-parse HEAD": { stdout: "aabbccddeeff00112233445566778899aabbccdd\n" },
  });
  const outcome = await mergeBranch(
    "/repo",
    { ...line, base: "agents" },
    "Merge wireal/14",
    git.run,
  );
  assert.equal(outcome.merged, true);
  assert.ok(git.said().includes("merge-base --is-ancestor agents HEAD"));
  assert.ok(git.said().includes("push origin HEAD:agents"));
});

test("promotion carries the agent branch onto the default branch as one commit", async () => {
  const git = fakeGit({
    remote: { stdout: "origin\n" },
    "log --format=%s origin/main..origin/agents": {
      stdout:
        "Task 32: The last workspace can be deleted\nTask 31: Status reads as a circle\nTask 31: a second pass\nTidy up\n",
    },
    "rev-parse origin/agents^{tree}": { stdout: "tree1234\n" },
    "commit-tree tree1234 -p origin/main -p origin/agents -m Merge wireal/31, 32":
      { stdout: "ffeeddccbbaa99887766554433221100ffeeddcc\n" },
  });
  const outcome = await promoteBranch("/repo", "agents", "main", git.run);
  assert.deepEqual(outcome, {
    promoted: true,
    commit: "ffeeddccbbaa99887766554433221100ffeeddcc",
    tasks: ["31", "32"],
  });
  assert.ok(
    git
      .said()
      .includes(
        "push origin ffeeddccbbaa99887766554433221100ffeeddcc:refs/heads/main",
      ),
  );
  assert.ok(
    git
      .said()
      .includes(
        "push origin ffeeddccbbaa99887766554433221100ffeeddcc:refs/heads/agents",
      ),
    "the agent branch lands level with the default branch",
  );
  assert.ok(!git.said().some((said) => said.startsWith("merge-tree")));
});

test("promotion says so when the default branch already has the agent branch", async () => {
  const git = fakeGit({
    remote: { stdout: "origin\n" },
    "log --format=%s origin/main..origin/agents": { stdout: "\n" },
  });
  const outcome = await promoteBranch("/repo", "agents", "main", git.run);
  assert.equal(outcome.promoted, false);
  assert.equal(
    outcome.promoted === false ? outcome.error : "",
    "main already has agents",
  );
});

test("a default branch that moved on its own is merged, and its conflicts are named", async () => {
  const git = fakeGit({
    remote: { stdout: "origin\n" },
    "log --format=%s origin/main..origin/agents": {
      stdout: "Task 29: An account can exist without a workspace\n",
    },
    "merge-base --is-ancestor origin/main origin/agents": { code: 1 },
    "merge-tree --write-tree origin/main origin/agents": {
      code: 1,
      stdout:
        "100644 abc123 2\tsrc/domain.ts\n100644 def456 3\tsrc/domain.ts\n",
    },
  });
  const outcome = await promoteBranch("/repo", "agents", "main", git.run);
  assert.equal(outcome.promoted, false);
  assert.deepEqual(outcome.promoted === false ? outcome.conflicts : [], [
    "src/domain.ts",
  ]);
  assert.deepEqual(outcome.tasks, ["29"]);
});

test("a merge names every task it carries", () => {
  assert.equal(mergeMessage(["29", "30", "31"]), "Merge wireal/29, 30, 31");
  assert.equal(mergeMessage(["38"]), "Merge wireal/38");
  assert.equal(mergeMessage([]), "");
});

test("the branch of a commit is the wireal branch that contains it", async () => {
  const git = fakeGit({
    remote: { stdout: "origin\n" },
    "branch --list wireal/* --contains abc1234": { stdout: "" },
    "branch --remotes --list origin/wireal/* --contains abc1234": {
      stdout: "  origin/wireal/14\n",
    },
  });
  assert.equal(await branchOfCommit("/repo", "abc1234", git.run), "wireal/14");
  assert.ok(git.said().includes("fetch origin"));
  assert.equal(await branchOfCommit("/repo", "  ", git.run), "");
});

test("the folder is measured against what it tracks, not the runner's base", async () => {
  const git = fakeGit({
    "rev-parse --abbrev-ref HEAD": { stdout: "main\n" },
    "status --porcelain": { stdout: " M src/app.tsx\n" },
    "rev-parse --abbrev-ref --symbolic-full-name @{upstream}": {
      stdout: "origin/main\n",
    },
    remote: { stdout: "origin\n" },
    "rev-list --left-right --count HEAD...origin/main": { stdout: "0\t3\n" },
  });
  assert.deepEqual(await folderState("/repo", "agents", true, git.run), {
    branch: "main",
    dirty: true,
    ahead: 0,
    behind: 3,
    upstream: "origin/main",
  });
  assert.ok(
    git.said().includes("fetch origin main"),
    "the branch it tracks is the one fetched",
  );
  assert.ok(
    !git.said().includes("rev-list --left-right --count HEAD...origin/agents"),
  );
  const quiet = fakeGit({
    "rev-parse --abbrev-ref HEAD": { stdout: "main\n" },
    "rev-parse --abbrev-ref --symbolic-full-name @{upstream}": {
      stdout: "origin/main\n",
    },
    "rev-list --left-right --count HEAD...origin/main": { stdout: "0\t0\n" },
  });
  assert.deepEqual(await folderState("/repo", "agents", false, quiet.run), {
    branch: "main",
    dirty: false,
    ahead: 0,
    behind: 0,
    upstream: "origin/main",
  });
  assert.ok(!quiet.said().some((said) => said.startsWith("fetch")));
});

test("a branch tracking nothing falls back to the runner's base", async () => {
  const git = fakeGit({
    "rev-parse --abbrev-ref HEAD": { stdout: "spike\n" },
    "rev-parse --abbrev-ref --symbolic-full-name @{upstream}": { code: 1 },
    remote: { stdout: "origin\n" },
    "rev-list --left-right --count HEAD...origin/agents": { stdout: "0\t2\n" },
  });
  const state = await folderState("/repo", "agents", true, git.run);
  assert.deepEqual(state, {
    branch: "spike",
    dirty: false,
    ahead: 0,
    behind: 2,
    upstream: "",
  });
  assert.ok(git.said().includes("fetch origin agents"));
});

test("the folder is left alone when it is dirty or tracks nothing", async () => {
  const dirty = fakeGit({});
  assert.deepEqual(
    await pullFolder(
      "/repo",
      {
        branch: "main",
        dirty: true,
        ahead: 0,
        behind: 2,
        upstream: "origin/main",
      },
      dirty.run,
    ),
    { pulled: false, reason: "Folder has uncommitted changes" },
  );
  assert.deepEqual(dirty.said(), []);
  const loose = fakeGit({});
  assert.deepEqual(
    await pullFolder(
      "/repo",
      { branch: "spike", dirty: false, ahead: 0, behind: 2, upstream: "" },
      loose.run,
    ),
    { pulled: false, reason: "Folder is on spike, which tracks nothing" },
  );
  assert.deepEqual(loose.said(), []);
});

test("a clean folder follows its own branch, whatever the runner works on", async () => {
  const clean = fakeGit({});
  assert.deepEqual(
    await pullFolder(
      "/repo",
      {
        branch: "main",
        dirty: false,
        ahead: 0,
        behind: 2,
        upstream: "origin/main",
      },
      clean.run,
    ),
    { pulled: true, reason: "Folder pulled" },
  );
  assert.deepEqual(clean.said(), ["pull --ff-only"]);
  const stuck = fakeGit({ "pull --ff-only": { code: 1 } });
  const result = await pullFolder(
    "/repo",
    {
      branch: "main",
      dirty: false,
      ahead: 0,
      behind: 2,
      upstream: "origin/main",
    },
    stuck.run,
  );
  assert.equal(result.pulled, false);
  assert.match(result.reason, /^Folder could not be pulled: git said no/);
});

test("the folder is counted in both directions, so its own commits are seen", async () => {
  const git = fakeGit({
    "rev-parse --abbrev-ref HEAD": { stdout: "main\n" },
    "rev-parse --abbrev-ref --symbolic-full-name @{upstream}": {
      stdout: "origin/main\n",
    },
    remote: { stdout: "origin\n" },
    "rev-list --left-right --count HEAD...origin/main": { stdout: "2\t1\n" },
  });
  assert.deepEqual(await folderState("/repo", "agents", true, git.run), {
    branch: "main",
    dirty: false,
    ahead: 2,
    behind: 1,
    upstream: "origin/main",
  });
});

test("a folder that both moved is named as a rebase, not pulled at", async () => {
  const split = fakeGit({});
  const result = await pullFolder(
    "/repo",
    {
      branch: "main",
      dirty: false,
      ahead: 2,
      behind: 1,
      upstream: "origin/main",
    },
    split.run,
  );
  assert.equal(result.pulled, false);
  assert.match(result.reason, /both moved, 2 here and 1 there/);
  assert.deepEqual(split.said(), []);
});

test("a folder with nothing to pull says it is level, even when it is dirty", async () => {
  const level = fakeGit({});
  assert.deepEqual(
    await pullFolder(
      "/repo",
      {
        branch: "main",
        dirty: true,
        ahead: 0,
        behind: 0,
        upstream: "origin/main",
      },
      level.run,
    ),
    { pulled: false, reason: "Folder is level with origin/main" },
  );
  assert.deepEqual(level.said(), []);
});
