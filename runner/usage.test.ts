import assert from "node:assert/strict";
import test from "node:test";
import { windowPercent, windowReset } from "./agents/events.ts";
import {
  claudeCredential,
  claudeUsageUrl,
  claudeWindows,
  codexCredential,
  codexUsageUrl,
  codexWindows,
  fileLimits,
  readUsage,
  untilText,
  usageLine,
  usagePath,
  waitFrom,
  type UsageParts,
} from "./agents/usage.ts";

const at = new Date("2026-09-17T10:09:57.000Z");

const claudeBody = {
  five_hour: {
    utilization: 1,
    resets_at: "2026-09-17T15:00:00.250015+00:00",
  },
  seven_day: {
    utilization: 58,
    resets_at: "2026-09-21T07:00:00.250042+00:00",
  },
  seven_day_opus: null,
};

const codexBody = {
  plan_type: "plus",
  rate_limit: {
    primary_window: {
      used_percent: 0,
      limit_window_seconds: 18_000,
      reset_at: 1_789_657_802,
    },
    secondary_window: {
      used_percent: 99,
      limit_window_seconds: 604_800,
      reset_at: 1_789_806_297,
    },
  },
};

const files = (entries: Record<string, unknown>): UsageParts["read"] => {
  const slashed = (path: string) => path.replace(/\\/g, "/");
  const kept = new Map(
    Object.entries(entries).map(([path, body]) => [slashed(path), body]),
  );
  return (path: string) => {
    const body = kept.get(slashed(path));
    if (body === undefined) throw new Error(`no such file: ${path}`);
    return typeof body === "string" ? body : JSON.stringify(body);
  };
};

const answering = (
  status: number,
  body: unknown,
  seen: { url?: string; headers?: Record<string, string> } = {},
  sent: Record<string, string> = {},
): UsageParts["call"] =>
  (async (url: string, init: RequestInit) => {
    seen.url = String(url);
    seen.headers = init.headers as Record<string, string>;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => sent[name] ?? null },
      json: async () => body,
    } as unknown as Response;
  }) as unknown as UsageParts["call"];

const store = (entries: Record<string, unknown> = {}) => {
  const written: Record<string, string> = {};
  const parts: UsageParts = {
    env: {},
    home: "/home",
    platform: "linux",
    directory: "/state",
    rollout: () => undefined,
    read: files({ ...entries }),
    write: (path, body) => {
      written[path] = body;
    },
  };
  return { parts, written };
};

test("Claude's usage answer becomes the rate limit shape the board knows", () => {
  const limits = claudeWindows(claudeBody, at);
  assert.equal(windowPercent(limits, "five_hour"), 1);
  assert.equal(windowPercent(limits, "seven_day"), 58);
  assert.equal(windowReset(limits, "five_hour"), "2026-09-17T15:00:00.250Z");
  assert.equal(limits?.source, "claude");
  assert.equal(limits?.captured_at, at.toISOString());
});

test("Codex's usage answer keeps its windows in minutes", () => {
  const limits = codexWindows(codexBody, at);
  assert.equal(windowPercent(limits, "five_hour"), 0);
  assert.equal(windowPercent(limits, "seven_day"), 99);
  assert.deepEqual(limits?.five_hour, {
    used_percentage: 0,
    window_minutes: 300,
    resets_at: 1_789_657_802,
  });
  assert.equal(
    (limits?.seven_day as Record<string, unknown>).window_minutes,
    10_080,
  );
  assert.equal(limits?.source, "codex");
});

test("an answer with no window at all reads as nothing", () => {
  assert.equal(claudeWindows({ five_hour: null }, at), undefined);
  assert.equal(codexWindows({ rate_limit: {} }, at), undefined);
  assert.equal(codexWindows({}, at), undefined);
});

test("the credentials come off each CLI's own home", () => {
  const parts: UsageParts = {
    env: { CLAUDE_CONFIG_DIR: "/home/.claude", CODEX_HOME: "/home/.codex" },
    home: "/home",
    platform: "linux",
    read: files({
      "/home/.claude/.credentials.json": {
        claudeAiOauth: { accessToken: "sk-ant-oat01-token" },
      },
      "/home/.codex/auth.json": {
        tokens: { access_token: "codex-token", account_id: "account-1" },
      },
    }),
  };
  assert.deepEqual(claudeCredential(parts), { token: "sk-ant-oat01-token" });
  assert.deepEqual(codexCredential(parts), {
    token: "codex-token",
    accountId: "account-1",
  });
});

test("Claude falls back to the keychain when the file holds nothing", () => {
  const parts: UsageParts = {
    env: {},
    home: "/home",
    platform: "darwin",
    read: files({}),
    keychain: () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "from-keychain" } }),
  };
  assert.deepEqual(claudeCredential(parts), { token: "from-keychain" });
  assert.equal(claudeCredential({ ...parts, platform: "linux" }), undefined);
});

test("reading Claude's usage asks the OAuth endpoint and keeps the answer", async () => {
  const seen: { url?: string; headers?: Record<string, string> } = {};
  const { parts, written } = store({
    "/home/.claude/.credentials.json": {
      claudeAiOauth: { accessToken: "token-1" },
    },
  });
  const read = await readUsage("claude", {
    ...parts,
    now: () => at,
    call: answering(200, claudeBody, seen),
  });
  assert.equal(seen.url, claudeUsageUrl);
  assert.equal(seen.headers?.authorization, "Bearer token-1");
  assert.equal(windowPercent(read.limits, "seven_day"), 58);
  assert.equal(read.error, undefined);
  assert.equal(read.stale, undefined);
  assert.deepEqual(JSON.parse(written[usagePath(parts)]).claude, read.limits);
});

test("reading Codex's usage names the account it asks about", async () => {
  const seen: { url?: string; headers?: Record<string, string> } = {};
  const { parts } = store({
    "/home/.codex/auth.json": {
      tokens: { access_token: "token-2", account_id: "account-2" },
    },
  });
  const read = await readUsage("codex", {
    ...parts,
    now: () => at,
    call: answering(200, codexBody, seen),
  });
  assert.equal(seen.url, codexUsageUrl);
  assert.equal(seen.headers?.["chatgpt-account-id"], "account-2");
  assert.equal(windowPercent(read.limits, "seven_day"), 99);
});

test("a signed-out machine and a stale token each say so", async () => {
  const empty = await readUsage("codex", {
    ...store().parts,
    call: answering(200, codexBody),
  });
  assert.equal(empty.limits, undefined);
  assert.match(empty.error ?? "", /Codex is not signed in/);
  const expired = await readUsage("claude", {
    ...store({
      "/home/.claude/.credentials.json": {
        claudeAiOauth: { accessToken: "token-3" },
      },
    }).parts,
    call: answering(401, {}),
  });
  assert.equal(expired.limits, undefined);
  assert.match(expired.error ?? "", /sign-in has expired/);
});

test("a rate limited answer keeps the last read and says when to ask again", async () => {
  const last = claudeWindows(claudeBody, at);
  const { parts } = store({
    "/home/.claude/.credentials.json": {
      claudeAiOauth: { accessToken: "token-5" },
    },
    "/state/usage.json": { claude: last },
  });
  const read = await readUsage("claude", {
    ...parts,
    call: answering(429, {}, {}, { "retry-after": "3517" }),
  });
  assert.deepEqual(read.limits, last);
  assert.equal(read.stale, true);
  assert.equal(read.waitMs, 3_517_000);
  assert.match(
    read.error ?? "",
    /holding off on its limits, so these are the last/,
  );
});

test("Codex falls back to the limits its own rollout wrote", async () => {
  const rolled = codexWindows(codexBody, at);
  const { parts } = store({
    "/home/.codex/auth.json": { tokens: { access_token: "token-6" } },
  });
  const read = await readUsage("codex", {
    ...parts,
    rollout: () => rolled,
    call: answering(500, {}),
  });
  assert.deepEqual(read.limits, rolled);
  assert.equal(read.stale, true);
  assert.equal(read.waitMs, undefined);
});

test("the newer of the kept file and the rollout is the one that stands", () => {
  const older = codexWindows(codexBody, new Date("2026-09-17T08:00:00.000Z"));
  const newer = codexWindows(codexBody, new Date("2026-09-17T09:00:00.000Z"));
  const { parts } = store({ "/state/usage.json": { codex: older } });
  assert.deepEqual(
    fileLimits("codex", { ...parts, rollout: () => newer }),
    newer,
  );
  assert.deepEqual(
    fileLimits("codex", { ...parts, rollout: () => undefined }),
    older,
  );
});

test("a wait comes off the header, within an hour's reach of sense", () => {
  assert.equal(waitFrom("3517", 60_000), 3_517_000);
  assert.equal(waitFrom("1", 60_000), 60_000);
  assert.equal(waitFrom("999999", 60_000), 6 * 3_600_000);
  assert.equal(waitFrom(null, 300_000), 300_000);
  assert.equal(waitFrom("not a number", 300_000), 300_000);
});

test("a call that throws is reported, not raised", async () => {
  const read = await readUsage("claude", {
    ...store({
      "/home/.claude/.credentials.json": {
        claudeAiOauth: { accessToken: "token-4" },
      },
    }).parts,
    call: (async () => {
      throw new Error("network down");
    }) as unknown as UsageParts["call"],
  });
  assert.match(read.error ?? "", /network down/);
});

test("the printed line names both windows and when they reset", () => {
  const now = Date.parse("2026-09-17T10:09:57.000Z");
  assert.equal(untilText(0), "now");
  assert.equal(untilText(45 * 60_000), "45m");
  assert.equal(untilText(3 * 3_600_000 + 30 * 60_000), "3h 30m");
  assert.equal(untilText(50 * 3_600_000), "2d 2h");
  assert.equal(
    usageLine("claude", { limits: claudeWindows(claudeBody, at) }, now),
    "Claude  5-hour 1% (resets in 4h 50m)   7-day 58% (resets in 3d 20h)",
  );
  assert.equal(
    usageLine("codex", { error: "Codex is not signed in on this machine" }),
    "Codex   Codex is not signed in on this machine",
  );
  assert.equal(
    usageLine(
      "codex",
      { limits: codexWindows(codexBody, at), stale: true },
      now + 3_600_000,
    ),
    "Codex   5-hour 0% (resets in 4h 0m)   7-day 99% (resets in 1d 21h)   read 1h 0m ago",
  );
});
