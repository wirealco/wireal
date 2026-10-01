import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  authorizeUrl,
  browserCommand,
  createPkce,
  openBrowser,
} from "./login.ts";

test("derives an S256 challenge the Wireal authorize endpoint accepts", () => {
  const pkce = createPkce(Buffer.alloc(32, 7));
  assert.match(pkce.verifier, /^[A-Za-z0-9._~-]{43,128}$/);
  assert.match(pkce.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    pkce.challenge,
    createHash("sha256").update(pkce.verifier, "ascii").digest("base64url"),
  );
  assert.notEqual(createPkce().verifier, createPkce().verifier);
});

test("asks for the MCP resource and an offline grant", () => {
  const url = new URL(
    authorizeUrl({
      api: "https://api.example.com",
      clientId: "client",
      redirectUri: "http://127.0.0.1:4711/callback",
      challenge: "a".repeat(43),
      state: "state",
      resource: "https://mcp.wireal.co",
    }),
  );
  assert.equal(
    url.origin + url.pathname,
    "https://api.example.com/oauth/authorize",
  );
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    response_type: "code",
    client_id: "client",
    redirect_uri: "http://127.0.0.1:4711/callback",
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
    state: "state",
    scope: "wireal offline_access",
    resource: "https://mcp.wireal.co",
  });
});

test("the authorize URL survives cmd.exe, where & would end the command", () => {
  const url =
    "https://api.wireal.co/oauth/authorize?response_type=code&client_id=abc&state=xyz";
  const windows = browserCommand(url, "win32");
  assert.equal(windows.command, "cmd");
  assert.deepEqual(windows.args, ["/c", "start", '""', `"${url}"`]);
  assert.equal(windows.verbatim, true);
  assert.deepEqual(browserCommand(url, "darwin"), {
    command: "open",
    args: [url],
    verbatim: false,
  });
  assert.deepEqual(browserCommand(url, "linux"), {
    command: "xdg-open",
    args: [url],
    verbatim: false,
  });

  const asked: { args: string[]; options: Record<string, unknown> }[] = [];
  openBrowser(url, "win32", ((
    _command: string,
    args: string[],
    options: Record<string, unknown>,
  ) => {
    asked.push({ args, options });
    return { unref: () => {} };
  }) as never);
  assert.equal(asked[0].options.windowsVerbatimArguments, true);
  assert.ok(asked[0].args.at(-1)?.includes("&client_id=abc"));
});
