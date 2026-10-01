import assert from "node:assert/strict";
import test from "node:test";
import { composePrompt } from "./prompt.ts";
import { parseCommand, usage } from "./cli.ts";

test("puts the task, its projects and what came before in front of the agent", () => {
  const prompt = composePrompt(
    {
      referenceId: "7",
      name: "Runner CLI",
      objective: "Claim tasks and run an agent on each.",
      projects: [
        {
          name: "Runner",
          repositoryUrl: "https://github.com/wireal/wireal",
          folders: ["runner", "mcp"],
        },
      ],
      upstream: [
        {
          referenceId: "6",
          name: "Document model",
          summary: "Added proposed.",
        },
      ],
    },
    { worktree: "/repo/.wirealruns/7", branch: "wireal/7" },
  );
  assert.match(
    prompt,
    /^Task 7: Runner CLI\n\nClaim tasks and run an agent on each\./,
  );
  assert.match(
    prompt,
    /- Runner \(https:\/\/github\.com\/wireal\/wireal\) owns runner, mcp/,
  );
  assert.match(prompt, /- 6 Document model: Added proposed\./);
  assert.match(
    prompt,
    /Work only in \/repo\/\.wirealruns\/7 \(branch wireal\/7\)/,
  );
  assert.match(prompt, /message starting "Task 7:"/);
  assert.match(prompt, /If \.wireal\/peers\.md exists/);
  assert.match(prompt, /Separate work you notice: propose_task/);
  assert.match(
    prompt,
    /Stuck partway: add_task_activity kind blocker, then report\./,
  );
  assert.match(
    prompt,
    /Finish with exactly one report call on task 7: done = what changed; where = files; commit = full SHA from git rev-parse HEAD; next = what remains, or none; blocked = only if blocked\./,
  );
  assert.match(prompt, /Never change the task's status/);
  assert.match(prompt, /never narrate progress over MCP/);
  assert.match(prompt, /never ask questions/);
  assert.match(prompt, /After the report, stop\.$/);
});

test("the rules ask for one report and nothing that contradicts it", () => {
  const prompt = composePrompt(
    {
      referenceId: "3",
      name: "Tidy",
      objective: "Tidy the header.",
      projects: [],
      upstream: [],
    },
    { worktree: "/w/3", branch: "wireal/3", deps: true, shots: true },
  );
  const rules = prompt.slice(prompt.indexOf("Rules"));
  assert.equal(rules.match(/exactly one/g)?.length, 1);
  assert.doesNotMatch(rules, /kind change/);
  assert.doesNotMatch(rules, /add_task_activity on this task/);
  assert.doesNotMatch(rules, /activity entry/);
  assert.ok(rules.length < 1000, `the rules run to ${rules.length} characters`);
});

test("tells the agent how to look at a page only where the script exists", () => {
  const brief = {
    referenceId: "9",
    name: "Landing",
    objective: "Widen the docs page.",
    projects: [],
    upstream: [],
  };
  const worktree = { worktree: "/repo/.wirealruns/9", branch: "wireal/9" };
  assert.doesNotMatch(composePrompt(brief, worktree), /npm run shot/);
  assert.doesNotMatch(composePrompt(brief, worktree), /node_modules/);
  const ready = composePrompt(brief, { ...worktree, deps: true });
  assert.match(ready, /node_modules is shared with other agents/);
  assert.match(ready, /never run npm install, npm ci or npm update/);
  const shots = composePrompt(brief, { ...worktree, shots: true });
  assert.match(shots, /npm run shot -- docs privacy --width=1440/);
  assert.match(shots, /no leading slash/);
  assert.match(shots, /never install a browser/);
});

test("leaves out sections a task has nothing for", () => {
  const prompt = composePrompt(
    {
      referenceId: "3",
      name: "Tidy",
      objective: "",
      projects: [],
      upstream: [],
    },
    { worktree: "/repo/.wirealruns/3", branch: "wireal/3" },
  );
  assert.match(prompt, /No objective was written for this task\./);
  assert.doesNotMatch(prompt, /Projects/);
  assert.doesNotMatch(prompt, /What earlier tasks reported/);
  assert.doesNotMatch(prompt, /Sent back for review/);
});

test("what is wrong with finished work reaches the prompt right under the objective", () => {
  const prompt = composePrompt(
    {
      referenceId: "12",
      name: "Docs page",
      objective: "Widen the docs page.",
      projects: [],
      upstream: [],
      review: {
        text: "The table still overflows on a phone.",
        by: "Grace",
      },
    },
    { worktree: "/repo/.wirealruns/12", branch: "wireal/12" },
  );
  assert.match(
    prompt,
    /^Task 12: Docs page\n\nWiden the docs page\.\n\nSent back for review\n/,
  );
  assert.match(prompt, /Grace sent it back/);
  assert.match(prompt, /do not start the task over/);
  assert.match(prompt, /The table still overflows on a phone\./);
});

test("reads the command line the way the help describes it", () => {
  assert.deepEqual(parseCommand([]), { kind: "help" });
  assert.deepEqual(parseCommand(["--help"]), { kind: "help" });
  assert.deepEqual(parseCommand(["login"]), { kind: "login" });
  assert.deepEqual(parseCommand(["logout"]), { kind: "logout" });
  assert.deepEqual(parseCommand(["status"], "/repo"), {
    kind: "status",
    repo: "/repo",
  });
  assert.deepEqual(parseCommand(["unbind"], "/repo"), {
    kind: "unbind",
    repo: "/repo",
  });
  assert.deepEqual(parseCommand(["run"], "/repo", {}), {
    kind: "run",
    workspace: undefined,
    name: undefined,
    crew: {},
    repo: "/repo",
    once: false,
    force: false,
    allowSleep: false,
    trustWorktree: true,
  });
  assert.deepEqual(
    parseCommand(
      [
        "run",
        "--workspace",
        "Wireal",
        "--name",
        "Studio",
        "--agents",
        "3",
        "--repo",
        "/work",
        "--once",
        "--ask-trust",
      ],
      "/repo",
      {},
    ),
    {
      kind: "run",
      workspace: "Wireal",
      name: "Studio",
      crew: { each: 3 },
      repo: "/work",
      once: true,
      force: false,
      allowSleep: false,
      trustWorktree: false,
    },
  );
  assert.throws(
    () => parseCommand(["run", "--agent", "codex"]),
    /Unknown option '--agent'/,
  );
  assert.throws(() => parseCommand(["run", "--name", " "]), /non-empty/);
  assert.equal(parseCommand(["run", "--agents", "0"]).kind, "run");
  assert.throws(() => parseCommand(["run", "--agents=-1"]), /whole number/);
  assert.throws(() => parseCommand(["run", "--agents", "two"]), /whole number/);
  assert.throws(() => parseCommand(["sing"]), /Unknown command/);
  assert.match(usage, /wireal-run run \[options\]/);
});
