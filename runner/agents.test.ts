import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  claudeArgs,
  claudeSettings,
  dialogOf,
  hookScript,
  startClaude,
  trustQuestion,
} from "./agents/claude.ts";
import {
  body,
  codexApproval,
  codexProgram,
  codexSandbox,
  codexArgs,
  speech,
  startCodex,
  trustQuestion as codexTrustQuestion,
} from "./agents/codex.ts";
import {
  freshest,
  lifecycleOf,
  limitsByKind,
  moment,
  parseEvents,
  statusOf,
  windowPercent,
  windowReset,
} from "./agents/events.ts";
import { launch, plain, ptyEnvironment, squeezed } from "./agents/pty.ts";
import { createScreen } from "./screen.ts";
import type { AgentOptions, PtySession } from "./agents/types.ts";

process.env.WIREAL_API_URL = "https://api.example.com";

const options: AgentOptions = {
  prompt: "Task 7: do the thing",
  cwd: "/repo/.wirealruns/7",
  model: "opus",
  agentName: "Claude 7",
  mcp: {
    name: "wirealrunner",
    command: "/usr/bin/node",
    args: ["--import", "/loader.mjs", "/runner/mcp-stdio.ts"],
    configPath: "/tmp/wireal-mcp.json",
  },
  onLine: () => {},
};

function fakePty() {
  const written: string[] = [];
  const data = new Set<(chunk: string) => void>();
  const exit = new Set<(code: number) => void>();
  const sizes: { columns: number; rows: number }[] = [];
  let running = true;
  const session: PtySession = {
    write: (chunk) => written.push(chunk),
    resize: (columns, rows) => sizes.push({ columns, rows }),
    onData: (listen) => {
      data.add(listen);
      return () => data.delete(listen);
    },
    onExit: (listen) => {
      exit.add(listen);
      return () => exit.delete(listen);
    },
    alive: () => running,
    kill: () => {
      if (!running) return;
      running = false;
      for (const listen of [...exit]) listen(1);
    },
  };
  return {
    session,
    written,
    sizes,
    say: (chunk: string) => {
      for (const listen of [...data]) listen(chunk);
    },
    close: (code: number) => {
      running = false;
      for (const listen of [...exit]) listen(code);
    },
  };
}

const wait = (milliseconds: number) =>
  new Promise((done) => setTimeout(done, milliseconds));

const statusline = (over: Record<string, unknown> = {}) => ({
  session_id: "0499b7e0",
  model: { id: "claude-haiku-4-5-20251001", display_name: "Haiku 4.5" },
  cost: {
    total_cost_usd: 0.0216478,
    total_duration_ms: 6176,
    total_api_duration_ms: 5733,
  },
  rate_limits: {
    five_hour: { used_percentage: 50, resets_at: 1789525800 },
    seven_day: { used_percentage: 43, resets_at: 1789974000 },
  },
  ...over,
});

const jsonl = (entries: { at: string; kind: string; payload: unknown }[]) =>
  entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";

test("the events file yields the latest cost, model and rate limits", () => {
  const events = parseEvents(
    jsonl([
      { at: "2026-09-16T00:00:01Z", kind: "statusline", payload: statusline() },
      {
        at: "2026-09-16T00:00:09Z",
        kind: "statusline",
        payload: statusline({
          cost: { total_cost_usd: 0.09, total_duration_ms: 12000 },
        }),
      },
    ]) + "not json\n{}\n",
  );
  assert.equal(events.length, 2);
  assert.deepEqual(statusOf(events), {
    costUsd: 0.09,
    durationMs: 12000,
    model: "claude-haiku-4-5-20251001",
    rateLimits: {
      five_hour: { used_percentage: 50, resets_at: 1789525800 },
      seven_day: { used_percentage: 43, resets_at: 1789974000 },
      captured_at: "2026-09-16T00:00:09.000Z",
      source: "claude",
    },
  });
  assert.deepEqual(statusOf([]), {});
});

test("lifecycle reads the first stop, the session end and the tools that asked", () => {
  const life = lifecycleOf(
    parseEvents(
      jsonl([
        {
          at: "2026-09-16T00:00:02Z",
          kind: "PermissionRequest",
          payload: {
            tool_name: "Write",
            tool_input: { file_path: "/repo/.wirealruns/7/hello.txt" },
          },
        },
        {
          at: "2026-09-16T00:00:03Z",
          kind: "Stop",
          payload: { last_assistant_message: "Done.  Wrote  hello.txt" },
        },
        {
          at: "2026-09-16T00:00:04Z",
          kind: "Stop",
          payload: { last_assistant_message: "second turn" },
        },
        {
          at: "2026-09-16T00:00:05Z",
          kind: "SessionEnd",
          payload: { reason: "prompt_input_exit" },
        },
      ]),
    ),
  );
  assert.equal(life.stopped, true);
  assert.equal(life.summary, "Done.  Wrote  hello.txt");
  assert.equal(life.ended, true);
  assert.equal(life.reason, "prompt_input_exit");
  assert.equal(life.isError, false);
  assert.deepEqual(life.lines, ["Write /repo/.wirealruns/7/hello.txt"]);

  const failed = lifecycleOf(
    parseEvents(
      jsonl([
        { at: "", kind: "Stop", payload: {} },
        { at: "", kind: "SessionEnd", payload: { reason: "api_error" } },
      ]),
    ),
  );
  assert.equal(failed.isError, true);
});

test("rate limit windows are read whatever shape resets_at takes", () => {
  const limits = {
    five_hour: { used_percentage: 92.4, resets_at: 1789525800 },
    seven_day: { used_percentage: 43, resets_at: 1789525800000 },
    seven_day_opus: { used_percentage: 12, resets_at: "2026-09-16T05:10:00Z" },
    captured_at: "2026-09-16T00:00:09.000Z",
    source: "claude",
  };
  assert.equal(windowPercent(limits, "five_hour"), 92.4);
  assert.equal(windowPercent(limits, "seven_day_opus"), 12);
  assert.equal(windowPercent(limits, "seven_day_sonnet"), undefined);
  assert.equal(windowPercent(undefined, "five_hour"), undefined);
  assert.equal(windowReset(limits, "five_hour"), "2026-09-16T02:30:00.000Z");
  assert.equal(windowReset(limits, "seven_day"), "2026-09-16T02:30:00.000Z");
  assert.equal(
    windowReset(limits, "seven_day_opus"),
    "2026-09-16T05:10:00.000Z",
  );
  assert.equal(moment("nonsense"), undefined);
  assert.equal(moment(undefined), undefined);
});

test("the freshest capture across agents wins", () => {
  const older = { captured_at: "2026-09-16T00:00:01.000Z", source: "claude" };
  const newer = { captured_at: "2026-09-16T00:04:01.000Z", source: "claude" };
  assert.equal(freshest([undefined, older, newer]), newer);
  assert.equal(freshest([newer, older]), newer);
  assert.equal(freshest([undefined, undefined]), undefined);
});

test("the heartbeat keeps one capture per agent kind", () => {
  const claude = { captured_at: "2026-09-16T00:04:01.000Z", source: "claude" };
  const older = { captured_at: "2026-09-16T00:00:01.000Z", source: "claude" };
  const codex = { captured_at: "2026-09-16T00:02:01.000Z", source: "codex" };
  const blob = limitsByKind([
    { kind: "claude", limits: older },
    { kind: "codex", limits: codex },
    { kind: "claude", limits: claude },
    { kind: "codex", limits: undefined },
  ]);
  assert.deepEqual(blob?.by_kind, { claude, codex });
  assert.equal(blob?.captured_at, claude.captured_at);
  assert.equal(limitsByKind([{ kind: "codex", limits: undefined }]), undefined);
  assert.equal(limitsByKind([]), undefined);
});

test("the settings file drives the status line and the three hooks", () => {
  const settings = claudeSettings(
    "PermissionRequest",
    "/usr/local/bin/node",
  ) as {
    statusLine: { type: string; command: string };
    hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
  };
  assert.equal(settings.statusLine.type, "command");
  assert.equal(
    settings.statusLine.command,
    `"/usr/local/bin/node" "${hookScript("statusline.cjs")}"`,
  );
  const windows = claudeSettings(
    "PreToolUse",
    "C:\\Program Files\\nodejs\\node.exe",
    "win32",
  ) as { statusLine: { command: string } };
  assert.equal(
    windows.statusLine.command,
    `"C:\\Program Files\\nodejs\\node.exe" "${hookScript("statusline.cjs")}"`,
  );
  assert.equal(
    settings.hooks.Stop[0].hooks[0].command,
    `"/usr/local/bin/node" "${hookScript("event.cjs")}" Stop`,
  );
  assert.equal(
    settings.hooks.SessionEnd[0].hooks[0].command,
    `"/usr/local/bin/node" "${hookScript("event.cjs")}" SessionEnd`,
  );
  assert.equal(settings.hooks.PermissionRequest[0].matcher, "*");
  assert.equal(
    settings.hooks.PermissionRequest[0].hooks[0].command,
    `"/usr/local/bin/node" "${hookScript("permission.cjs")}"`,
  );
  assert.equal(settings.hooks.PreToolUse, undefined);
  const older = claudeSettings("PreToolUse", "/usr/local/bin/node") as {
    hooks: Record<string, unknown>;
  };
  assert.ok(older.hooks.PreToolUse);
  assert.equal(older.hooks.PermissionRequest, undefined);
});

test("claude starts interactively with the settings file and the runner's MCP server", () => {
  assert.deepEqual(claudeArgs(options, "/runs/settings.json"), [
    "Task 7: do the thing",
    "--settings",
    "/runs/settings.json",
    "--mcp-config",
    "/tmp/wireal-mcp.json",
    "--strict-mcp-config",
    "--model",
    "opus",
  ]);
  assert.equal(
    claudeArgs({ ...options, model: undefined }, "/s.json").includes("--model"),
    false,
  );
});

test("the permission hook allows what stays in the worktree and denies what leaves", () => {
  const require = createRequire(import.meta.url);
  const hook = require(hookScript("permission.cjs")) as {
    decide: (
      payload: unknown,
      worktree: string,
    ) => { allow: boolean; reason: string };
    answer: (
      event: string,
      verdict: { allow: boolean; reason: string },
    ) => Record<string, unknown>;
  };
  const worktree = "/repo/.wirealruns/7";
  assert.equal(
    hook.decide(
      { tool_name: "Write", tool_input: { file_path: `${worktree}/src/a.ts` } },
      worktree,
    ).allow,
    true,
  );
  assert.equal(
    hook.decide(
      { tool_name: "Read", tool_input: { file_path: "src/a.ts" } },
      worktree,
    ).allow,
    true,
  );
  assert.equal(
    hook.decide(
      { tool_name: "Bash", tool_input: { command: "npm test" } },
      worktree,
    ).allow,
    true,
  );
  assert.equal(
    hook.decide(
      {
        tool_name: "Bash",
        tool_input: { command: `cd ${worktree} && npm test` },
      },
      worktree,
    ).allow,
    true,
  );
  assert.equal(
    hook.decide(
      { tool_name: "Read", tool_input: { file_path: "/etc/passwd" } },
      worktree,
    ).allow,
    false,
  );
  assert.equal(
    hook.decide(
      {
        tool_name: "Bash",
        tool_input: { command: "cat /Users/ada/.ssh/id_rsa" },
      },
      worktree,
    ).allow,
    false,
  );
  assert.equal(
    hook.decide(
      { tool_name: "Read", tool_input: { file_path: "~/.ssh/id_rsa" } },
      worktree,
    ).allow,
    false,
  );
  assert.equal(
    hook.decide(
      { tool_name: "Bash", tool_input: { command: "cat ~/.ssh/id_rsa" } },
      worktree,
    ).allow,
    false,
  );
  assert.equal(
    hook.decide(
      {
        tool_name: "Bash",
        tool_input: { command: "cat ../../../.ssh/id_rsa" },
      },
      worktree,
    ).allow,
    false,
  );
  assert.equal(
    hook.decide(
      { tool_name: "Bash", tool_input: { command: "cd .. && rm -rf src" } },
      worktree,
    ).allow,
    false,
  );
  assert.equal(
    hook.decide(
      { tool_name: "Bash", tool_input: { command: "git log main..HEAD" } },
      worktree,
    ).allow,
    true,
  );
  assert.equal(
    hook.decide(
      { tool_name: "Bash", tool_input: { command: "npm test -- --dot" } },
      worktree,
    ).allow,
    true,
  );
  assert.equal(
    hook.decide(
      {
        tool_name: "MultiEdit",
        tool_input: {
          edits: [{ file_path: `${worktree}/a` }, { file_path: "/tmp/b" }],
        },
      },
      worktree,
    ).allow,
    false,
  );
  assert.deepEqual(
    hook.answer("PermissionRequest", { allow: true, reason: "in" }),
    {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    },
  );
  assert.deepEqual(hook.answer("PreToolUse", { allow: false, reason: "out" }), {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "out",
    },
  });
});

test("claude leaves the session on the first stop and closes with the status line numbers", async () => {
  const folder = mkdtempSync(join(tmpdir(), "wireal-claude-"));
  const pty = fakePty();
  const lines: string[] = [];
  let events = "";
  const run = startClaude(
    { ...options, cwd: folder, onLine: (text) => lines.push(text) },
    {
      folder,
      event: "PermissionRequest",
      poll: 10,
      grace: 50,
      answer: 0,
      open: (files) => {
        events = files.events;
        return pty.session;
      },
    },
  );
  assert.ok(events);
  writeFileSync(
    events,
    jsonl([
      { at: "2026-09-16T00:00:01Z", kind: "statusline", payload: statusline() },
      {
        at: "2026-09-16T00:00:02Z",
        kind: "Stop",
        payload: { last_assistant_message: "Wrote the parser." },
      },
    ]),
  );
  await wait(60);
  assert.deepEqual(pty.written, ["/exit", "\r"]);
  pty.close(0);
  const result = await run.done;
  assert.equal(result.ok, true);
  assert.equal(result.summary, "Wrote the parser.");
  assert.equal(result.costUsd, 0.0216478);
  assert.equal(result.durationMs, 6176);
  assert.equal(result.model, "claude-haiku-4-5-20251001");
  assert.equal(result.inputTokens, undefined);
  assert.equal(result.outputTokens, undefined);
  assert.equal(
    (result.rateLimits?.five_hour as { used_percentage: number })
      .used_percentage,
    50,
  );
  assert.equal(result.rateLimits?.source, "claude");
  assert.ok(lines.includes("finished, leaving the session"));
});

test("claude refuses an untrusted folder unless the runner was told to trust it", async () => {
  const folder = mkdtempSync(join(tmpdir(), "wireal-trust-"));
  const shy = fakePty();
  const refused = startClaude(
    { ...options, cwd: folder },
    {
      folder,
      event: "PermissionRequest",
      poll: 10,
      grace: 20,
      open: () => shy.session,
    },
  );
  shy.say(
    "Quick safety check: ... \u001b[4GYes,\u001b[9GI\u001b[11Gtrust\u001b[17Gthis\u001b[22Gfolder",
  );
  const result = await refused.done;
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /--ask-trust/);
  assert.deepEqual(shy.written, []);

  const willing = fakePty();
  const accepted = startClaude(
    { ...options, cwd: folder, trustWorktree: true },
    {
      folder,
      event: "PermissionRequest",
      poll: 10,
      grace: 20,
      answer: 0,
      open: () => willing.session,
    },
  );
  willing.say(`x ${trustQuestion} y`);
  assert.deepEqual(willing.written, ["\u001b[B\r"]);
  willing.close(0);
  await accepted.done;
});

test("a Codex run reports the windows its rollout wrote", async () => {
  const pty = fakePty();
  const seen: (number | undefined)[] = [];
  const asked: { cwd: string; since: number }[] = [];
  let reported = 0;
  const run = startCodex(
    {
      ...options,
      onStatus: (status) =>
        seen.push(windowPercent(status.rateLimits, "five_hour")),
    },
    {
      open: () => pty.session,
      quiet: 30,
      grace: 5000,
      tick: 10,
      answer: 0,
      rollout: (cwd, since) => {
        asked.push({ cwd, since });
        return {
          path: "/rollout.jsonl",
          limits: () =>
            reported++ === 0
              ? undefined
              : {
                  five_hour: { used_percentage: 22 },
                  seven_day: { used_percentage: 99 },
                  captured_at: "2026-09-16T16:37:09.014Z",
                  source: "codex",
                },
        };
      },
    },
  );
  pty.say("Working on it.\n");
  await wait(80);
  pty.close(0);
  const result = await run.done;
  assert.equal(asked[0]?.cwd, options.cwd);
  assert.deepEqual(seen, [22]);
  assert.equal(windowPercent(result.rateLimits, "five_hour"), 22);
  assert.equal(windowPercent(result.rateLimits, "seven_day"), 99);
  assert.equal(result.rateLimits?.source, "codex");
});

test("codex runs interactively in the worktree and leaves once the screen goes quiet", async () => {
  assert.deepEqual(
    codexArgs({ ...options, repo: "/repo" }, ["--approve-for-me"], []),
    [
      "-C",
      "/repo/.wirealruns/7",
      "--approve-for-me",
      "--add-dir",
      join("/repo", ".git"),
      "-c",
      'mcp_servers.wirealrunner.command="/usr/bin/node"',
      "-c",
      'mcp_servers.wirealrunner.args=["--import","/loader.mjs","/runner/mcp-stdio.ts"]',
      "-c",
      'mcp_servers.wirealrunner.env.WIREAL_AGENT_NAME="Claude 7"',
      "-c",
      'mcp_servers.wirealrunner.env.WIREAL_API_URL="https://api.example.com"',
      "-c",
      'mcp_servers.wirealrunner.env.WIREAL_MCP_PROFILE="runner"',
      "--model",
      "opus",
      "Task 7: do the thing",
    ],
  );
  assert.ok(
    !codexArgs(options, [], []).includes("--add-dir"),
    "a run with no repository named asks for nothing extra",
  );

  const pty = fakePty();
  const lines: string[] = [];
  const run = startCodex(
    { ...options, onLine: (text) => lines.push(text) },
    { open: () => pty.session, quiet: 30, grace: 5000, tick: 10, answer: 0 },
  );
  pty.say("\u001b[32m─────\u001b[0m\nI will add the parser.\n");
  pty.say("I will add the parser.\n");
  await wait(80);
  assert.deepEqual(pty.written, ["/quit", "\r"]);
  pty.close(0);
  const result = await run.done;
  assert.equal(result.ok, true);
  assert.equal(result.costUsd, undefined);
  assert.equal(result.rateLimits, undefined);
  assert.equal(result.summary, "I will add the parser.");
  assert.deepEqual(lines, [
    "I will add the parser.",
    "quiet for 20s, leaving the session",
  ]);
});

test("codex lines come from its screen, so a redraw is read once and in order", async () => {
  const pty = fakePty();
  const lines: string[] = [];
  const run = startCodex(
    { ...options, onLine: (text) => lines.push(text) },
    {
      open: () => pty.session,
      screen: () => createScreen(40, 6),
      quiet: 5000,
      grace: 5000,
      tick: 10,
      answer: 0,
    },
  );
  pty.say("Reading the parser\r\n");
  pty.say("\u001b[A\u001b[2KReading the parser file\r\n");
  pty.say("Working 1s");
  pty.say("\rWorking 2s\r\n");
  pty.say("checking the tests\r\n".repeat(6));
  await wait(60);
  assert.deepEqual(lines, [
    "Reading the parser file",
    "Working 2s",
    "checking the tests",
  ]);

  run.pty?.resize(80, 24);
  assert.deepEqual(pty.sizes, [{ columns: 80, rows: 24 }]);
  assert.deepEqual(run.screen?.size(), { columns: 80, rows: 24 });
  pty.close(0);
  assert.equal((await run.done).summary, "checking the tests");
});

test("codex reports the screen above its composer, not the composer itself", () => {
  const drawn = [
    "• Files:",
    "  - notes.txt",
    "  Its last line is: three",
    "─".repeat(110),
    "› Ask Codex to do anything",
    "  gpt-5.6-sol high · /repo · Context 99% left · 5h 78% used",
    "  ⏎ send   ⇧⏎ newline   ⌃T transcript",
  ];
  assert.deepEqual(speech(body(drawn).join("\n")), [
    "• Files:",
    "- notes.txt",
    "Its last line is: three",
  ]);
  assert.deepEqual(body(drawn.slice(0, 3)), drawn.slice(0, 3));
  assert.deepEqual(
    speech("Esc to interrupt\nCtrl+C to quit\nWrote runner/screen.ts"),
    ["Wrote runner/screen.ts"],
  );
});

test("terminal bytes are stripped before they reach the table", () => {
  assert.equal(plain("\u001b[32mgreen\u001b[0m"), "green");
  assert.equal(
    squeezed("\u001b[4GYes,\u001b[9GI\u001b[11Gtrust"),
    "yes,itrust",
  );
  assert.deepEqual(speech("\u001b[2K──── \n ok \nWrote the file\n"), [
    "Wrote the file",
  ]);
});

test("a run cleans up the settings and events files it made", async () => {
  const folder = mkdtempSync(join(tmpdir(), "wireal-clean-"));
  const pty = fakePty();
  let settings = "";
  const run = startClaude(
    { ...options, cwd: folder },
    {
      folder,
      event: "PermissionRequest",
      poll: 10,
      grace: 20,
      open: (files) => {
        settings = files.settings;
        assert.ok(JSON.parse(readFileSync(files.settings, "utf8")).statusLine);
        return pty.session;
      },
    },
  );
  pty.close(1);
  const result = await run.done;
  assert.equal(result.ok, false);
  assert.throws(() => readFileSync(settings, "utf8"));
});

test("the agent's environment carries the events file and drops the host session markers", () => {
  const environment = ptyEnvironment(
    {
      command: "claude",
      args: [],
      cwd: "/repo",
      eventsPath: "/runs/events.jsonl",
      agentName: "Claude 7",
      env: { WIREAL_AGENT_WORKTREE: "/repo" },
    },
    {
      PATH: "/usr/bin",
      CLAUDECODE: "1",
      CLAUDE_CODE_CHILD_SESSION: "yes",
      CLAUDE_CODE_ENTRYPOINT: "cli",
    },
  );
  assert.deepEqual(environment, {
    PATH: "/usr/bin",
    WIREAL_AGENT_WORKTREE: "/repo",
    WIREAL_AGENT_EVENTS: "/runs/events.jsonl",
    WIREAL_AGENT_NAME: "Claude 7",
  });
});

test("a notice with a confirm footer is dismissed, the trust question is not", async () => {
  const notice =
    "Try the new fullscreen renderer?\n1. Yes, try it\n2. Not now\nEnter to confirm \u00b7 Esc to cancel";
  assert.equal(dialogOf("nothing to answer"), "none");
  assert.equal(dialogOf(notice), "notice");
  assert.equal(
    dialogOf("Yes, I trust this folder\nEnter to confirm \u00b7 Esc to cancel"),
    "trust",
  );

  const pty = fakePty();
  const lines: string[] = [];
  const run = startClaude(
    {
      ...options,
      cwd: mkdtempSync(join(tmpdir(), "wireal-notice-")),
      onLine: (text) => lines.push(text),
    },
    {
      folder: mkdtempSync(join(tmpdir(), "wireal-notice-runs-")),
      event: "PermissionRequest",
      poll: 10,
      grace: 5000,
      answer: 0,
      open: () => pty.session,
    },
  );
  pty.say(notice);
  assert.deepEqual(pty.written, ["\u001b"]);
  assert.ok(lines.includes("dismissed a Claude Code notice"));
  pty.close(0);
  await run.done;
});

test("codex stops at its directory question unless the runner was told to trust it", async () => {
  const shy = fakePty();
  const refused = startCodex(
    { ...options },
    { open: () => shy.session, quiet: 5000, grace: 5000, tick: 10, answer: 0 },
  );
  shy.say(`Do you trust the contents of this directory?`);
  const result = await refused.done;
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /--ask-trust/);
  assert.deepEqual(shy.written, []);
  assert.equal(codexTrustQuestion, "doyoutrustthecontentsofthisdirectory");

  const willing = fakePty();
  const accepted = startCodex(
    { ...options, trustWorktree: true },
    {
      open: () => willing.session,
      quiet: 5000,
      grace: 5000,
      tick: 10,
      answer: 0,
    },
  );
  willing.say("Do you trust the contents of this directory?");
  assert.deepEqual(willing.written, ["\r"]);
  willing.close(0);
  assert.equal((await accepted.done).ok, true);
});

test("Codex gets the approval flag its version has", () => {
  assert.deepEqual(
    codexApproval("  --approve-for-me   Let Codex review approvals"),
    ["--approve-for-me"],
  );
  assert.deepEqual(codexApproval("  --full-auto   Low-friction sandboxed"), [
    "--full-auto",
  ]);
  assert.deepEqual(codexApproval(""), []);
});

test("Codex runs unsandboxed on Windows, where its write sandbox refuses the worktree", () => {
  assert.deepEqual(codexSandbox("linux", {}), []);
  assert.deepEqual(codexSandbox("darwin", {}), []);
  assert.deepEqual(codexSandbox("win32", {}), [
    "-c",
    'sandbox_mode="danger-full-access"',
  ]);
  // --sandbox would be refused beside --approve-for-me.
  assert.ok(
    !codexArgs(
      options,
      ["--approve-for-me"],
      codexSandbox("win32", {}),
    ).includes("--sandbox"),
  );
  assert.deepEqual(
    codexSandbox("win32", { WIREAL_CODEX_SANDBOX: "workspace-write" }),
    ["-c", 'sandbox_mode="workspace-write"'],
  );
});

test("the permission hook lets a command name the null device", () => {
  const load = createRequire(import.meta.url);
  const hook = load(hookScript("permission.cjs")) as {
    inside: (worktree: string, value: string) => boolean;
    decide: (payload: unknown, worktree: string) => { allow: boolean };
  };
  assert.equal(hook.inside("/work/48", "/dev/null"), true);
  assert.equal(hook.inside("/work/48", "/etc/passwd"), false);
  assert.equal(
    hook.decide(
      { tool_input: { command: "npm test > /dev/null 2>&1" } },
      "/work/48",
    ).allow,
    true,
  );
});

test("a Codex session that ends badly says what was last on its screen", async () => {
  const pty = fakePty();
  const run = startCodex(
    { ...options },
    { open: () => pty.session, quiet: 5000, grace: 5000, tick: 10, answer: 0 },
  );
  pty.say(
    "You can't use gpt-6.1-sol with a ChatGPT plan. Pick another model.\r\n",
  );
  await new Promise((done) => setTimeout(done, 50));
  pty.session.kill();
  const result = await run.done;
  assert.equal(result.ok, false);
  assert.match(
    result.error ?? "",
    /exited with code 1\. Last on its screen: .*gpt-6\.1-sol/,
  );
});

test("WIREAL_CODEX_PATH picks the Codex the runner starts", () => {
  assert.equal(
    codexProgram({ WIREAL_CODEX_PATH: "C:\\Tools\\codex.exe" }),
    "C:\\Tools\\codex.exe",
  );
  assert.deepEqual(
    launch("C:\\Tools\\codex.cmd", ["--help"], "win32", () => "", "cmd.exe"),
    {
      file: "cmd.exe",
      args: ["/d", "/s", "/c", "C:\\Tools\\codex.cmd", "--help"],
    },
  );
  assert.deepEqual(
    launch("C:\\Tools\\codex.exe", ["-C", "x"], "win32", () => ""),
    {
      file: "C:\\Tools\\codex.exe",
      args: ["-C", "x"],
    },
  );
});
