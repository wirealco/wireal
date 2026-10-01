import assert from "node:assert/strict";
import test from "node:test";
import worker, { type WorkerEnv } from "./worker.ts";
import { testWorkspace } from "../src/test-workspace.ts";

const env: WorkerEnv = {
  WIREAL_API_URL: "https://api.example.com",
  MCP_PUBLIC_URL: "https://mcp.wireal.co",
};

test("remote MCP advertises the .NET OAuth server", async () => {
  const resourceResponse = await worker.fetch(
    new Request("https://mcp.wireal.co/.well-known/oauth-protected-resource"),
    env,
  );
  assert.equal(resourceResponse.status, 200);
  const resource = (await resourceResponse.json()) as {
    resource: string;
    authorization_servers: string[];
    scopes_supported: string[];
  };
  assert.equal(resource.resource, "https://mcp.wireal.co/");
  assert.deepEqual(resource.authorization_servers, [
    "https://api.example.com/oauth",
  ]);
  // offline_access is advertised here as well as on the authorization server:
  // a client that reads its scopes from the resource has to be able to ask for
  // a refresh token, or it drops off when the access token expires.
  assert.deepEqual(resource.scopes_supported, ["wireal", "offline_access"]);

  const metadataResponse = await worker.fetch(
    new Request("https://mcp.wireal.co/.well-known/oauth-authorization-server"),
    env,
  );
  assert.equal(metadataResponse.status, 200);
  const metadata = (await metadataResponse.json()) as {
    issuer: string;
    authorization_response_iss_parameter_supported: boolean;
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint: string;
    code_challenge_methods_supported: string[];
  };
  assert.equal(metadata.issuer, resource.authorization_servers[0]);
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);
  assert.equal(
    metadata.authorization_endpoint,
    "https://api.example.com/oauth/authorize",
  );
  assert.equal(metadata.token_endpoint, "https://api.example.com/oauth/token");
  assert.equal(
    metadata.registration_endpoint,
    "https://api.example.com/oauth/register",
  );
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
});

test("remote MCP challenges requests without a bearer token", async () => {
  const response = await worker.fetch(
    new Request("https://mcp.wireal.co", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }),
    }),
    env,
  );
  assert.equal(response.status, 401);
  assert.match(
    response.headers.get("www-authenticate") || "",
    /resource_metadata="https:\/\/mcp\.wireal\.co\/\.well-known\/oauth-protected-resource"/,
  );
});

test("remote MCP refuses a valid browser token that has no MCP grant", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ id: "user", client_id: null, resource: null }),
      { status: 200 },
    );
  try {
    const response = await worker.fetch(
      new Request("https://mcp.wireal.co/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer browser-token",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      env,
    );
    assert.equal(response.status, 401);
  } finally {
    globalThis.fetch = original;
  }
});

test("remote MCP attributes stateless legacy writes to the OAuth client", async () => {
  const original = globalThis.fetch;
  let updatedWorkspace: typeof testWorkspace | undefined;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/me")
      return new Response(
        JSON.stringify({
          id: "user",
          client_id: "codex-registration",
          client_name: "Codex CLI",
          resource: "https://mcp.wireal.co",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    if (url.pathname === "/api/query") {
      const query = JSON.parse(String(init?.body)) as {
        operation: string;
        values?: { data?: typeof testWorkspace };
      };
      if (query.operation === "select")
        return new Response(
          JSON.stringify({
            data: {
              id: "11111111-1111-4111-8111-111111111111",
              data: testWorkspace,
              revision: 1,
            },
            error: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      if (query.operation === "update") {
        updatedWorkspace = query.values?.data;
        return new Response(
          JSON.stringify({ data: { revision: 2 }, error: null }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
    }
    throw new Error(
      `Unexpected request: ${init?.method ?? "GET"} ${url.pathname}`,
    );
  };

  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 3600,
      scope: "wireal",
    }),
  ).toString("base64url");
  const token = `header.${payload}.signature`;
  const post = async (body: unknown) => {
    const response = await worker.fetch(
      new Request("https://mcp.wireal.co/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "user-agent": "stateless-test-client/1.0",
        },
        body: JSON.stringify(body),
      }),
      env,
    );
    await response.text();
    assert.equal(response.status, 200);
  };

  try {
    // The handshake identity does not survive a stateless request, so the
    // OAuth grant is what names the caller.
    await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        clientInfo: { name: "codex-mcp-client", version: "0.1" },
        capabilities: {},
      },
    });
    await post({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "add_task_activity",
        arguments: {
          task: testWorkspace.tasks[0].id,
          kind: "verification",
          summary: "legacy identity regression",
        },
      },
    });

    const activity = updatedWorkspace?.tasks[0].activity[0];
    assert.equal(activity?.author, "Codex");
    assert.notEqual(activity?.author, "Agent");
  } finally {
    globalThis.fetch = original;
  }
});

test("remote MCP says a CLI session is live, and ends it when the session closes", async () => {
  const original = globalThis.fetch;
  const commands: { name: string; args: Record<string, unknown> }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    if (url.pathname === "/auth/me")
      return json({
        id: "user-1",
        client_id: "claude-code-registration",
        client_name: "Claude Code",
        resource: "https://mcp.wireal.co",
      });
    if (url.pathname.startsWith("/api/commands/")) {
      const name = url.pathname.split("/").at(-1)!;
      commands.push({ name, args: JSON.parse(String(init?.body)) });
      return json({
        data: name === "list_presence" ? { presence: [] } : { ok: true },
        error: null,
      });
    }
    if (url.pathname === "/api/query")
      return json({
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          data: testWorkspace,
          revision: 1,
        },
        error: null,
      });
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  const waited: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => waited.push(promise),
  };
  const send = (method: string, body?: unknown) =>
    worker.fetch(
      new Request("https://mcp.wireal.co/mcp", {
        method,
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer header.${payload}.signature`,
          "content-type": "application/json",
          "mcp-session-id": "cli-session-42",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
      ctx,
    );

  try {
    const response = await send("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_tasks", arguments: {} },
    });
    await response.text();
    await Promise.all(waited);
    const touch = commands.find((command) => command.name === "touch_presence");
    assert.deepEqual(touch?.args, {
      workspace_id: "11111111-1111-4111-8111-111111111111",
      session: "cli-session-42",
      client: "Claude Code",
    });
    assert.ok(commands.some((command) => command.name === "list_presence"));

    await (await send("DELETE")).text();
    await Promise.all(waited);
    assert.deepEqual(commands.at(-1), {
      name: "end_presence",
      args: {
        workspace_id: "11111111-1111-4111-8111-111111111111",
        session: "cli-session-42",
      },
    });
  } finally {
    globalThis.fetch = original;
  }
});
