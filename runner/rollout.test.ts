import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { windowPercent } from "./agents/events.ts";
import {
  dayPath,
  latestLimits,
  firstLine,
  dayPaths,
  findRollout,
  limitsOf,
  openRollout,
  sessionCwd,
  sessionsDirectory,
  windowsOf,
} from "./agents/rollout.ts";

const meta = (cwd: string) =>
  JSON.stringify({
    timestamp: "2026-09-16T16:36:59.410Z",
    type: "session_meta",
    payload: { session_id: "01a0", cwd, originator: "codex-tui" },
  });

const counted = (primary: number, secondary: number, at: string) =>
  JSON.stringify({
    timestamp: at,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: { total_tokens: 27_540 } },
      rate_limits: {
        limit_id: "codex",
        primary: {
          used_percent: primary,
          window_minutes: 300,
          resets_at: 1_789_578_996,
        },
        secondary: {
          used_percent: secondary,
          window_minutes: 10_080,
          resets_at: 1_789_806_296,
        },
        plan_type: "plus",
      },
    },
  });

test("the five-hour and weekly windows come off the token count Codex writes", () => {
  const limits = limitsOf(
    [
      meta("/repo"),
      counted(11, 40, "2026-09-16T16:30:00.000Z"),
      JSON.stringify({ type: "event_msg", payload: { type: "agent_message" } }),
      counted(22, 99, "2026-09-16T16:37:09.014Z"),
    ].join("\n"),
  );
  assert.equal(limits?.source, "codex");
  assert.equal(limits?.captured_at, "2026-09-16T16:37:09.014Z");
  assert.deepEqual(limits?.five_hour, {
    used_percentage: 22,
    window_minutes: 300,
    resets_at: 1_789_578_996,
  });
  assert.deepEqual(limits?.seven_day, {
    used_percentage: 99,
    window_minutes: 10_080,
    resets_at: 1_789_806_296,
  });
  assert.equal(limitsOf(meta("/repo")), undefined);
  assert.equal(limitsOf("not json at all"), undefined);
});

test("a window is named by its length, not by the slot Codex put it in", () => {
  assert.deepEqual(
    windowsOf({
      primary: { used_percent: 5, window_minutes: 10_080 },
      secondary: { used_percent: 6, window_minutes: 60 },
    }),
    {
      seven_day: { used_percentage: 5, window_minutes: 10_080 },
      five_hour: { used_percentage: 6, window_minutes: 60 },
    },
  );
  assert.deepEqual(windowsOf({ primary: { window_minutes: 300 } }), {});
});

test("the rollout is the newest one this worktree opened", () => {
  const home = mkdtempSync(join(tmpdir(), "codex-home-"));
  const directory = sessionsDirectory({ CODEX_HOME: home }, "/nowhere");
  const since = Date.now();
  const day = join(directory, dayPath(new Date(since)));
  mkdirSync(day, { recursive: true });
  const mine = join(day, "rollout-2026-09-16T19-36-59-01a0.jsonl");
  const other = join(day, "rollout-2026-09-16T19-30-00-01a1.jsonl");
  writeFileSync(other, meta("/somewhere/else") + "\n");
  writeFileSync(mine, meta("/repo/worktree") + "\n");

  assert.equal(findRollout(directory, "/repo/worktree", since), mine);
  assert.equal(findRollout(directory, "/repo/other", since), undefined);
  assert.equal(
    findRollout(directory, "/repo/worktree", since + 600_000),
    undefined,
  );

  const rollout = openRollout(mine);
  assert.equal(rollout.limits(), undefined);
  writeFileSync(
    mine,
    [meta("/repo/worktree"), counted(22, 99, "2026-09-16T16:37:09.014Z")].join(
      "\n",
    ) + "\n",
  );
  assert.equal(windowPercent(rollout.limits(), "five_hour"), 22);
  assert.equal(windowPercent(rollout.limits(), "seven_day"), 99);
});

test("the last limits Codex wrote are found without naming a folder", () => {
  const home = mkdtempSync(join(tmpdir(), "codex-home-"));
  const directory = sessionsDirectory({ CODEX_HOME: home }, "/nowhere");
  assert.equal(latestLimits(directory), undefined);
  const now = Date.now();
  const day = join(directory, dayPath(new Date(now)));
  mkdirSync(day, { recursive: true });
  const older = join(day, "rollout-2026-09-16T10-00-00-01b0.jsonl");
  const newer = join(day, "rollout-2026-09-16T19-00-00-01b1.jsonl");
  writeFileSync(
    older,
    [meta("/repo/one"), counted(10, 20, "2026-09-16T10:00:09.000Z")].join("\n"),
  );
  writeFileSync(
    newer,
    [meta("/repo/two"), counted(22, 99, "2026-09-16T16:37:09.014Z")].join("\n"),
  );
  const limits = latestLimits(directory, now);
  assert.equal(limits?.captured_at, "2026-09-16T16:37:09.014Z");
  assert.equal(windowPercent(limits, "five_hour"), 22);
});

test("a session header longer than one read still names its folder", () => {
  const home = mkdtempSync(join(tmpdir(), "codex-home-"));
  const directory = sessionsDirectory({ CODEX_HOME: home }, "/nowhere");
  const since = Date.now();
  const day = join(directory, dayPath(new Date(since)));
  mkdirSync(day, { recursive: true });
  const path = join(day, "rollout-2026-09-16T19-36-59-01a2.jsonl");
  const wordy = JSON.stringify({
    timestamp: "2026-09-16T16:36:59.410Z",
    type: "session_meta",
    payload: { cwd: "/repo/worktree", base_instructions: "x".repeat(200_000) },
  });
  writeFileSync(
    path,
    [wordy, counted(3, 4, "2026-09-16T16:37:09.014Z")].join("\n"),
  );
  assert.equal(firstLine(path).length, wordy.length);
  assert.equal(findRollout(directory, "/repo/worktree", since), path);
});

test("the session header names the folder, and anything else is ignored", () => {
  assert.equal(sessionCwd(meta("/repo")), "/repo");
  assert.equal(sessionCwd('{"type":"event_msg","payload":{}}'), undefined);
  assert.equal(sessionCwd("half a line"), undefined);
  assert.equal(sessionCwd(""), undefined);
  const at = Date.parse("2026-09-16T10:00:00Z");
  assert.ok(dayPaths(at - 30 * 3_600_000, at).length >= 2);
  assert.deepEqual(dayPaths(at, at), [dayPath(new Date(at))]);
  assert.equal(
    sessionsDirectory({}, "/home/ada"),
    join("/home/ada", ".codex", "sessions"),
  );
});
