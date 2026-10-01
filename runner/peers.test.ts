import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { claudeSettings, hookScript } from "./agents/claude.ts";
import { activityOf, stepOf, type AgentEvent } from "./agents/events.ts";
import {
  excludePeers,
  noticeLines,
  peersText,
  publishPeers,
  type Self,
  type World,
} from "./peers.ts";

const self: Self = {
  agent: "Ada",
  taskId: "t7",
  projects: ["Web"],
  upstream: ["6"],
  files: ["src/api.ts", "src/app.tsx"],
};

const world = (patch: Partial<World> = {}): World => ({
  agents: [
    {
      agent: "Ada",
      kind: "claude",
      taskId: "t7",
      reference: "7",
      projects: ["Web"],
      step: "editing src/api.ts",
      files: ["src/api.ts"],
    },
    {
      agent: "Bob",
      kind: "codex",
      taskId: "t8",
      reference: "8",
      projects: ["Docs"],
      step: "editing docs/index.md",
      files: ["docs/index.md"],
    },
  ],
  humans: [],
  merged: [],
  ...patch,
});

test("peers.md names every other agent and person, their task and files, and the merges", () => {
  const text = peersText(
    self,
    world({
      humans: [
        {
          name: "Grace",
          client: "Claude Code",
          taskId: "t9",
          reference: "9",
          projects: ["Billing"],
          note: "fixing the webhook",
        },
      ],
      merged: [
        { reference: "6", name: "API", base: "main", commit: "abcdef1234567" },
      ],
    }),
  );
  assert.doesNotMatch(text, /Ada/);
  assert.match(
    text,
    /- Bob \[codex\]: WRL·8 in Docs; editing docs\/index\.md; files docs\/index\.md/,
  );
  assert.match(
    text,
    /- Grace \(person, Claude Code\): WRL·9 in Billing; fixing the webhook/,
  );
  assert.match(text, /- merged WRL·6 API into main as abcdef1/);
  assert.ok(text.split("\n").length <= 6);
  assert.match(peersText(self, world({ agents: [] })), /- nobody else/);
});

test("the notice carries only what concerns this agent", () => {
  assert.deepEqual(noticeLines(self, world()), []);
  const sharing = world({
    agents: [
      ...world().agents,
      {
        agent: "Cy",
        runner: "studio",
        taskId: "t10",
        reference: "10",
        projects: ["Api"],
        files: ["src/api.ts", "README.md"],
      },
    ],
  });
  assert.deepEqual(noticeLines(self, sharing), [
    "Wireal: Cy (WRL·10) is also changing src/api.ts; see .wireal/peers.md.",
  ]);
  const inProject = world({
    humans: [
      {
        name: "Grace",
        client: "Codex",
        taskId: "t11",
        reference: "11",
        projects: ["Web"],
      },
    ],
    merged: [
      { reference: "6", name: "API", base: "main", commit: "abcdef1234567" },
      { reference: "5", name: "Other", base: "main", commit: "1111111" },
    ],
  });
  assert.deepEqual(noticeLines(self, inProject), [
    "Wireal: Grace (person, Codex) is on WRL·11 in Web.",
    "Wireal: prerequisite WRL·6 merged into main as abcdef1.",
  ]);
  const crowded = world({
    agents: ["P", "Q", "R", "S"].map((agent, index) => ({
      agent,
      taskId: `x${index}`,
      reference: String(20 + index),
      projects: ["Web"],
      files: [],
    })),
  });
  assert.equal(noticeLines(self, crowded).length, 3);
});

function fakeWorktree(): { worktree: string; common: string } {
  const root = mkdtempSync(join(tmpdir(), "wireal-peers-"));
  const common = join(root, "repo", ".git");
  const gitDir = join(common, "worktrees", "7");
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(gitDir, "commondir"), "../..\n");
  const worktree = join(root, "wt");
  mkdirSync(worktree);
  writeFileSync(join(worktree, ".git"), `gitdir: ${gitDir}\n`);
  return { worktree, common };
}

test("the peers folder never reaches a commit", () => {
  const { worktree, common } = fakeWorktree();
  mkdirSync(join(common, "info"), { recursive: true });
  writeFileSync(join(common, "info", "exclude"), "# local\n*.log");
  excludePeers(worktree);
  excludePeers(worktree);
  assert.equal(
    readFileSync(join(common, "info", "exclude"), "utf8"),
    "# local\n*.log\n/.wireal/\n",
  );
  assert.equal(
    readFileSync(join(worktree, ".wireal", ".gitignore"), "utf8"),
    "*\n",
  );
});

test("the runner rewrites the notice only when it changed", () => {
  const { worktree } = fakeWorktree();
  const written = new Map<string, string>();
  assert.equal(publishPeers(worktree, self, world(), written), true);
  assert.match(
    readFileSync(join(worktree, ".wireal", "peers.md"), "utf8"),
    /Bob \[codex\]/,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(worktree, ".wireal", "notice.json"), "utf8")),
    { lines: [] },
  );
  assert.equal(publishPeers(worktree, self, world(), written), false);
  const merged = world({
    merged: [{ reference: "6", name: "API", base: "main", commit: "abc1234" }],
  });
  assert.equal(publishPeers(worktree, self, merged, written), true);
  assert.equal(publishPeers("", self, merged, written), false);
});

type PeersHook = {
  fresh: (worktree: string | undefined) => string[];
  answer: (event: string, unseen: string[]) => string;
};

test("the Claude hook injects a fact once and stays silent otherwise", () => {
  const hook = createRequire(import.meta.url)(
    hookScript("peers.cjs"),
  ) as PeersHook;
  const { worktree } = fakeWorktree();
  assert.deepEqual(hook.fresh(worktree), []);
  assert.deepEqual(hook.fresh(undefined), []);
  assert.equal(hook.answer("PostToolUse", []), "");
  const written = new Map<string, string>();
  publishPeers(worktree, self, world(), written);
  assert.deepEqual(hook.fresh(worktree), []);
  const merged = world({
    merged: [{ reference: "6", name: "API", base: "main", commit: "abc1234" }],
  });
  publishPeers(worktree, self, merged, written);
  const unseen = hook.fresh(worktree);
  assert.deepEqual(unseen, [
    "Wireal: prerequisite WRL·6 merged into main as abc1234.",
  ]);
  assert.deepEqual(JSON.parse(hook.answer("PostToolUse", unseen)), {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        "Wireal: prerequisite WRL·6 merged into main as abc1234.",
    },
  });
  assert.deepEqual(hook.fresh(worktree), []);
  publishPeers(
    worktree,
    self,
    {
      ...merged,
      humans: [
        {
          name: "Grace",
          client: "Codex",
          taskId: "t7",
          reference: "7",
          projects: ["Web"],
        },
      ],
    },
    written,
  );
  assert.deepEqual(hook.fresh(worktree), [
    "Wireal: Grace (person, Codex) is on this task.",
  ]);
});

test("Claude runs the peers hook after every tool and on the prompt", () => {
  const settings = claudeSettings("PermissionRequest", "/usr/bin/node") as {
    hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
  };
  assert.equal(settings.hooks.PostToolUse[0].matcher, "*");
  assert.equal(
    settings.hooks.PostToolUse[0].hooks[0].command,
    `"/usr/bin/node" "${hookScript("peers.cjs")}" PostToolUse`,
  );
  assert.equal(
    settings.hooks.UserPromptSubmit[0].hooks[0].command,
    `"/usr/bin/node" "${hookScript("peers.cjs")}" UserPromptSubmit`,
  );
});

test("the step and the files come from the hook events, not the model", () => {
  const event = (kind: string, name: string, input: object): AgentEvent => ({
    at: "",
    kind,
    payload: { tool_name: name, tool_input: input },
  });
  const activity = activityOf(
    [
      event("PostToolUse", "Read", { file_path: "/w/7/src/app.tsx" }),
      event("PermissionRequest", "Edit", { file_path: "/w/7/src/api.ts" }),
      event("PostToolUse", "Edit", { file_path: "/w/7/src/api.ts" }),
      event("PostToolUse", "Write", { file_path: "/elsewhere/x.ts" }),
      event("PostToolUse", "Bash", { command: "npm test" }),
      event("Stop", "Edit", { file_path: "/w/7/ignored.ts" }),
    ],
    "/w/7",
  );
  assert.deepEqual(activity, {
    step: "running npm test",
    edited: ["src/api.ts"],
    read: ["src/app.tsx"],
  });
  assert.equal(stepOf("mcp__wirealrunner__report", {}), "calling report");
  assert.equal(stepOf("Grep", { pattern: "TODO" }), "searching TODO");
});
