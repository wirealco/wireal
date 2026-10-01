import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  apiUrl,
  clearSession,
  lockBusyNote,
  lockStaleMs,
  readSession,
  sessionPath,
  withSessionLock,
  writeSession,
} from "./session.ts";

test("stores the session where each platform keeps application data", () => {
  assert.equal(
    sessionPath("darwin", {}, "/Users/ada"),
    "/Users/ada/Library/Application Support/wireal/session.json",
  );
  assert.equal(
    sessionPath(
      "win32",
      { APPDATA: "C:\\Users\\Ada\\AppData\\Roaming" },
      "C:\\Users\\Ada",
    ),
    "C:\\Users\\Ada\\AppData\\Roaming\\wireal\\session.json",
  );
  assert.equal(
    sessionPath("linux", {}, "/home/ada"),
    "/home/ada/.config/wireal/session.json",
  );
  assert.equal(
    sessionPath(
      "linux",
      { XDG_CONFIG_HOME: "/home/ada/.settings" },
      "/home/ada",
    ),
    "/home/ada/.settings/wireal/session.json",
  );
});

test("writes the session for this user only and reads it back", () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "wireal-session-")),
    "session.json",
  );
  assert.equal(readSession(path), null);
  writeSession(
    {
      apiUrl: "https://api.example.com",
      clientId: "client",
      accessToken: "access",
      refreshToken: "refresh",
      savedAt: "2026-09-16T00:00:00.000Z",
    },
    path,
  );
  if (process.platform !== "win32")
    assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readSession(path), {
    apiUrl: "https://api.example.com",
    clientId: "client",
    accessToken: "access",
    refreshToken: "refresh",
    savedAt: "2026-09-16T00:00:00.000Z",
  });
  assert.equal(clearSession(path), true);
  assert.equal(clearSession(path), false);
  assert.equal(readSession(path), null);
});

test("defaults the API origin and honours the environment", () => {
  assert.equal(apiUrl({}), "https://api.wireal.co");
  assert.equal(
    apiUrl({ WIREAL_API_URL: "https://api.example.com/" }),
    "https://api.example.com",
  );
});

test("a session refresh waits for the lock rather than racing another process", async () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "wireal-lock-")),
    "session.json",
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.lock`, "");
  await assert.rejects(
    withSessionLock(async () => "ran", path, 120),
    new RegExp(lockBusyNote),
  );

  const old = new Date(Date.now() - lockStaleMs - 5_000);
  utimesSync(`${path}.lock`, old, old);
  assert.equal(await withSessionLock(async () => "ran", path, 2_000), "ran");
  assert.equal(existsSync(`${path}.lock`), false);
});
