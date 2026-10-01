import assert from "node:assert/strict";
import test from "node:test";
import { WirealClient } from "./client.ts";
import { testWorkspace } from "../src/test-workspace.ts";

test("lists owned workspaces and activates one by exact name", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { path: string; method: string; body: string }[] = [];
  const second = structuredClone(testWorkspace);
  second.map.name = "Product workspace";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = String(init?.body ?? "");
    requests.push({ path: url.pathname, method, body });
    if (url.pathname === "/api/query")
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              data: testWorkspace,
              revision: 3,
              is_active: true,
            },
            {
              id: "22222222-2222-4222-8222-222222222222",
              data: second,
              revision: 7,
              is_active: false,
            },
          ],
          error: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    if (url.pathname.endsWith("/api/commands/set_active_workspace"))
      return new Response(JSON.stringify({ data: true, error: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  };

  try {
    const client = new WirealClient({
      url: "https://api.example.com",
      accessToken: "test-token",
      agentName: "Test agent",
    });
    const workspaces = await client.listWorkspaces();
    assert.deepEqual(
      workspaces.map(({ id, name, revision, isActive }) => ({
        id,
        name,
        revision,
        isActive,
      })),
      [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Workspace",
          revision: 3,
          isActive: true,
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Product workspace",
          revision: 7,
          isActive: false,
        },
      ],
    );

    const activated = await client.setActiveWorkspace("Product workspace");
    assert.equal(activated.id, "22222222-2222-4222-8222-222222222222");
    assert.equal(activated.isActive, true);
    const rpc = requests.find((request) =>
      request.path.endsWith("/commands/set_active_workspace"),
    );
    assert.equal(rpc?.method, "POST");
    assert.deepEqual(JSON.parse(rpc?.body ?? "{}"), {
      target_workspace_id: "22222222-2222-4222-8222-222222222222",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a pinned session reads its own workspace by id and never by is_active", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: string[] = [];
  const second = structuredClone(testWorkspace);
  second.map.name = "Product workspace";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = String(init?.body ?? "");
    bodies.push(body);
    const row = {
      id: "22222222-2222-4222-8222-222222222222",
      data: second,
      revision: 7,
      is_active: false,
    };
    if (url.pathname === "/api/query")
      return new Response(
        JSON.stringify({
          data: JSON.parse(body).single ? row : [row],
          error: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    throw new Error(`Unexpected request: ${url.pathname}`);
  };

  try {
    const client = new WirealClient({
      url: "https://api.example.com",
      accessToken: "test-token",
      agentName: "Test agent",
      workspaceId: "22222222-2222-4222-8222-222222222222",
    });
    const current = await client.read();
    assert.equal(current.workspace.map.name, "Product workspace");
    assert.equal(current.workspaceId, "22222222-2222-4222-8222-222222222222");
    const query = JSON.parse(bodies[0]);
    assert.deepEqual(query.filters, [
      {
        field: "id",
        op: "eq",
        value: "22222222-2222-4222-8222-222222222222",
      },
    ]);
    assert.equal(bodies.join(" ").includes("is_active"), false);

    await assert.rejects(
      () => client.setActiveWorkspace("Workspace"),
      /This session is pinned to workspace Product workspace\./,
    );
    assert.equal(
      bodies.some((body) => body.includes("set_active_workspace")),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a pinned session reports its own workspace as the one in use", async () => {
  const originalFetch = globalThis.fetch;
  const second = structuredClone(testWorkspace);
  second.map.name = "Product workspace";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            data: testWorkspace,
            revision: 3,
            is_active: true,
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            data: second,
            revision: 7,
            is_active: false,
          },
        ],
        error: null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new WirealClient({
      url: "https://api.example.com",
      accessToken: "test-token",
      agentName: "Test agent",
      workspaceId: "22222222-2222-4222-8222-222222222222",
    });
    assert.deepEqual(
      (await client.listWorkspaces()).map((workspace) => workspace.isActive),
      [false, true],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a 409 save is a fault the caller reads, not a concurrency retry", async () => {
  const originalFetch = globalThis.fetch;
  const operations: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const query = JSON.parse(String(init?.body ?? "{}"));
    operations.push(query.operation);
    if (url.pathname !== "/api/query")
      throw new Error(`Unexpected request: ${url.pathname}`);
    if (query.operation === "update")
      return new Response(
        JSON.stringify({ error: { message: "#15 is locked by Grace." } }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    return new Response(
      JSON.stringify({
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          data: testWorkspace,
          revision: 3,
        },
        error: null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const client = new WirealClient({
      url: "https://api.example.com",
      accessToken: "test-token",
      agentName: "Test agent",
    });
    await assert.rejects(
      () =>
        client.mutate((workspace) => {
          const state = structuredClone(workspace);
          state.map.name = "Renamed workspace";
          return { state, value: "ok" };
        }),
      /^ApiError: #15 is locked by Grace\.$/,
    );
    assert.equal(
      operations.filter((operation) => operation === "update").length,
      1,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a save that matched no revision is retried against the fresh workspace", async () => {
  const originalFetch = globalThis.fetch;
  let updates = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const query = JSON.parse(String(init?.body ?? "{}"));
    if (url.pathname !== "/api/query")
      throw new Error(`Unexpected request: ${url.pathname}`);
    if (query.operation === "update") {
      updates += 1;
      return new Response(
        JSON.stringify({
          data: updates === 1 ? null : { revision: 5 },
          error: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          data: testWorkspace,
          revision: updates === 0 ? 3 : 4,
        },
        error: null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const client = new WirealClient({
      url: "https://api.example.com",
      accessToken: "test-token",
      agentName: "Test agent",
    });
    const saved = await client.mutate((workspace) => {
      const state = structuredClone(workspace);
      state.map.name = "Renamed workspace";
      return { state, value: "ok" };
    });
    assert.deepEqual(saved, { value: "ok", revision: 5 });
    assert.equal(updates, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a collaborator's repository or folder change fails before any write", async () => {
  const originalFetch = globalThis.fetch;
  let updates = 0;
  let role = "collaborator";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const query = JSON.parse(String(init?.body ?? "{}"));
    if (url.pathname !== "/api/query")
      throw new Error(`Unexpected request: ${url.pathname}`);
    if (query.operation === "update") {
      updates += 1;
      return new Response(
        JSON.stringify({ data: { revision: 4 }, error: null }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    assert.equal(query.columns, "id,data,revision,role");
    return new Response(
      JSON.stringify({
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          data: testWorkspace,
          revision: 3,
          role,
        },
        error: null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const client = new WirealClient({
      url: "https://api.example.com",
      accessToken: "test-token",
      agentName: "Test agent",
    });
    const retarget = (workspace: typeof testWorkspace) => {
      const state = structuredClone(workspace);
      state.projects[0].repositoryUrl = "https://github.com/someone/private";
      return { state, value: "ok" };
    };
    const folders = (workspace: typeof testWorkspace) => {
      const state = structuredClone(workspace);
      state.projects[0].paths = ["apps/secret"];
      return { state, value: "ok" };
    };
    await assert.rejects(
      () => client.mutate(retarget),
      /Only the workspace owner can change which GitHub repositories/,
    );
    await assert.rejects(
      () => client.mutate(folders),
      /Only the workspace owner can change which GitHub repositories/,
    );
    assert.equal(updates, 0);
    const renamed = await client.mutate((workspace) => {
      const state = structuredClone(workspace);
      state.projects[0].name = "Renamed by a collaborator";
      return { state, value: "ok" };
    });
    assert.deepEqual(renamed, { value: "ok", revision: 4 });
    role = "owner";
    assert.deepEqual(await client.mutate(retarget), {
      value: "ok",
      revision: 4,
    });
    assert.equal(updates, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
