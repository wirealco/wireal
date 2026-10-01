import assert from "node:assert/strict";
import test from "node:test";
import worker, { type Env } from "./index.ts";

/** Records what the asset worker was asked for, and answers like it would. */
function assetsStub() {
  const seen: string[] = [];
  return {
    seen,
    fetch: async (request: Request) => {
      seen.push(request.url);
      return new Response("<!doctype html><div id=root></div>", {
        headers: { "content-type": "text/html" },
      });
    },
  };
}

function envWith(assets: Env["ASSETS"], mcpPublicUrl?: string): Env {
  return {
    WIREAL_API_URL: "https://api.example.com",
    MCP_PUBLIC_URL: mcpPublicUrl,
    ASSETS: assets,
  };
}

test("the app hostnames are served from static assets", async () => {
  for (const origin of ["https://wireal.co", "https://www.wireal.co"]) {
    const assets = assetsStub();
    const response = await worker.fetch(
      new Request(`${origin}/login`),
      envWith(assets, "https://mcp.wireal.co"),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(assets.seen, [`${origin}/login`]);
  }
});

test("a path the MCP server owns is still the app on the app hostname", async () => {
  const assets = assetsStub();
  const response = await worker.fetch(
    new Request("https://wireal.co/mcp"),
    envWith(assets, "https://mcp.wireal.co"),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(assets.seen, ["https://wireal.co/mcp"]);
});

test("the MCP hostname reaches the MCP server, not the app shell", async () => {
  const assets = assetsStub();
  const response = await worker.fetch(
    new Request("https://mcp.wireal.co/.well-known/oauth-protected-resource"),
    envWith(assets, "https://mcp.wireal.co"),
  );
  assert.equal(response.status, 200);
  const resource = (await response.json()) as { resource: string };
  assert.equal(resource.resource, "https://mcp.wireal.co/");
  assert.deepEqual(assets.seen, [], "assets must not answer for the MCP host");
});

test("the MCP hostname challenges an unauthenticated call rather than serving HTML", async () => {
  const assets = assetsStub();
  const response = await worker.fetch(
    new Request("https://mcp.wireal.co/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    }),
    envWith(assets, "https://mcp.wireal.co"),
  );
  assert.equal(response.status, 401);
  assert.deepEqual(assets.seen, []);
});

test("no MCP hostname configured leaves every request with the app", async () => {
  const assets = assetsStub();
  const response = await worker.fetch(
    new Request("https://mcp.wireal.co/mcp"),
    envWith(assets, undefined),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(assets.seen, ["https://mcp.wireal.co/mcp"]);
});

test("the Host header decides, so a local dev server can reach the MCP server", async () => {
  const assets = assetsStub();
  const response = await worker.fetch(
    new Request("http://127.0.0.1:8787/health", {
      headers: { host: "mcp.wireal.co:8787" },
    }),
    envWith(assets, "https://mcp.wireal.co"),
  );
  assert.equal(await response.text(), "ok");
  assert.deepEqual(assets.seen, []);
});

test("a Host header for the app is served assets even on the MCP port", async () => {
  const assets = assetsStub();
  await worker.fetch(
    new Request("http://127.0.0.1:8787/login", {
      headers: { host: "WIREAL.CO" },
    }),
    envWith(assets, "https://mcp.wireal.co"),
  );
  assert.deepEqual(assets.seen, ["http://127.0.0.1:8787/login"]);
});
