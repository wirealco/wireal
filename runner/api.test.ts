import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  RunnerSession,
  revoked,
  signedOut,
  signedOutNote,
  tokenExpiry,
} from "./api.ts";
import { readSession, writeSession, type Session } from "./session.ts";

const origin = "https://api.example.test";

function saved(path: string, refreshToken: string, accessToken: string) {
  const session: Session = {
    apiUrl: origin,
    clientId: "client-1",
    accessToken,
    refreshToken,
    savedAt: "2026-09-16T00:00:00.000Z",
  };
  writeSession(session, path);
  return session;
}

function stubbed(
  replies: (request: { url: string; token: string }) => {
    status: number;
    body: unknown;
  },
) {
  const calls: { url: string; token: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const token = (headers.get("Authorization") ?? "").replace("Bearer ", "");
    const call = { url, token };
    calls.push(call);
    const reply = replies(call);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("a second process adopts the token another already rotated", async () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "wireal-session-")),
    "session.json",
  );
  const session = saved(path, "refresh-1", "access-1");
  const runner = new RunnerSession(session, path);
  saved(path, "refresh-2", "access-2");
  const stub = stubbed(({ url, token }) => {
    if (url.includes("/oauth/token"))
      return { status: 200, body: { access_token: "no", refresh_token: "no" } };
    return token === "access-2"
      ? { status: 200, body: { ok: true } }
      : { status: 401, body: { error: "unauthorized" } };
  });
  try {
    assert.deepEqual(await runner.data.request("/runners"), { ok: true });
  } finally {
    stub.restore();
  }
  assert.equal(
    stub.calls.filter((call) => call.url.includes("/oauth/token")).length,
    0,
  );
  assert.equal(readSession(path)?.refreshToken, "refresh-2");
});

test("the only holder of the token rotates it and saves what it was issued", async () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "wireal-session-")),
    "session.json",
  );
  const session = saved(path, "refresh-1", "access-1");
  const runner = new RunnerSession(session, path);
  const stub = stubbed(({ url, token }) => {
    if (url.includes("/oauth/token"))
      return {
        status: 200,
        body: { access_token: "access-2", refresh_token: "refresh-2" },
      };
    return token === "access-2"
      ? { status: 200, body: { ok: true } }
      : { status: 401, body: { error: "unauthorized" } };
  });
  try {
    assert.deepEqual(await runner.data.request("/runners"), { ok: true });
  } finally {
    stub.restore();
  }
  assert.equal(
    stub.calls.filter((call) => call.url.includes("/oauth/token")).length,
    1,
  );
  assert.equal(readSession(path)?.refreshToken, "refresh-2");
});

test("a revoked session says to sign in again instead of repeating the server", async () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "wireal-session-")),
    "session.json",
  );
  const session = saved(path, "refresh-1", "access-1");
  const runner = new RunnerSession(session, path);
  const stub = stubbed(({ url }) =>
    url.includes("/oauth/token")
      ? {
          status: 400,
          body: {
            error: "invalid_grant",
            error_description: "Expired or revoked refresh token.",
          },
        }
      : { status: 401, body: { error: "unauthorized" } },
  );
  try {
    await assert.rejects(runner.data.request("/runners"), /wireal-run login/);
  } finally {
    stub.restore();
  }
  assert.equal(revoked(new Error("Expired or revoked refresh token.")), true);
  assert.equal(revoked(new Error("Request failed (502)")), false);
});

const jwt = (secondsFromNow: number) =>
  "head." +
  Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow }),
  ).toString("base64url") +
  ".sig";

test("an access token near its end is rotated before the next call, not after a 401", async () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "wireal-session-")),
    "session.json",
  );
  const session = saved(path, "refresh-1", jwt(20));
  const runner = new RunnerSession(session, path);
  const stub = stubbed(({ url }) =>
    url.includes("/oauth/token")
      ? {
          status: 200,
          body: { access_token: jwt(600), refresh_token: "refresh-2" },
        }
      : { status: 200, body: [] },
  );
  try {
    await runner.data.from("runners").select("*");
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls[0].url.includes("/oauth/token"), true);
  assert.equal(stub.calls.length, 2);
  assert.equal(readSession(path)?.refreshToken, "refresh-2");
  assert.equal(runner.fresh(), true);
});

test("a token with plenty of life left is used as it is", async () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "wireal-session-")),
    "session.json",
  );
  const runner = new RunnerSession(saved(path, "refresh-1", jwt(900)), path);
  const stub = stubbed(() => ({ status: 200, body: [] }));
  try {
    await runner.data.from("runners").select("*");
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls.length, 1);
  assert.doesNotMatch(stub.calls[0].url, /oauth\/token/);
});

test("a rotate that never answers takes the token another process wrote", async () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "wireal-session-")),
    "session.json",
  );
  const runner = new RunnerSession(saved(path, "refresh-1", "access-1"), path);
  const stub = stubbed(({ url }) => {
    if (url.includes("/oauth/token")) {
      saved(path, "refresh-9", "access-9");
      return { status: 500, body: { error: "gateway" } };
    }
    return { status: 200, body: [] };
  });
  try {
    assert.deepEqual(await runner.refresh(), {
      accessToken: "access-9",
      refreshToken: "refresh-9",
    });
  } finally {
    stub.restore();
  }
});

test("a revoked session is named as one, whatever words it arrives in", () => {
  assert.equal(revoked(new Error("Expired or revoked refresh token.")), true);
  assert.equal(signedOut(new Error("Expired or revoked refresh token.")), true);
  assert.equal(signedOut(new Error(signedOutNote)), true);
  assert.equal(signedOut(new Error("heartbeat timed out")), false);
  assert.equal(tokenExpiry(jwt(60)) > Date.now(), true);
  assert.equal(tokenExpiry("not-a-token"), 0);
  assert.equal(tokenExpiry("a.!!.c"), 0);
});
