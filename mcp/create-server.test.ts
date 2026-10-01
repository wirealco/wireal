import assert from "node:assert/strict";
import test from "node:test";
import {
  createMcpHandler,
  InMemoryTransport,
} from "@modelcontextprotocol/server";
import {
  createWirealServer,
  profileFromEnv,
  runnerTools,
  type WirealServerOptions,
} from "./create-server.ts";
import type { PresenceTouch, WirealClient } from "./client.ts";
import { testWorkspace } from "../src/test-workspace.ts";
import type { Workspace } from "../src/domain.ts";

type Result = {
  content?: { type: string; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
};

/** A client over one in-memory workspace, recording presence calls. */
function fakeClient(
  seed: Workspace = structuredClone(testWorkspace),
  extra: Partial<Record<keyof WirealClient, unknown>> = {},
) {
  const state = { workspace: seed, revision: 1 };
  const touches: PresenceTouch[] = [];
  const client = {
    agentName: "Test agent",
    read: async () => ({
      workspace: state.workspace,
      revision: state.revision,
      workspaceId: "workspace-one",
    }),
    currentWorkspaceId: async () => "workspace-one",
    touchPresence: async (presence: PresenceTouch) => {
      touches.push(presence);
    },
    listPresence: async () => [],
    listWorkspaces: async () => [
      {
        id: "workspace-one",
        name: state.workspace.map.name,
        repositoryUrl: "",
        revision: state.revision,
        isActive: true,
      },
    ],
    setActiveWorkspace: async () => ({}),
    mutate: async (
      change: (current: Workspace) => { state: Workspace; value: unknown },
    ) => {
      const changed = change(state.workspace);
      state.workspace = changed.state;
      state.revision += 1;
      return { value: changed.value, revision: state.revision };
    },
    ...extra,
  } as unknown as WirealClient;
  return { client, state, touches };
}

async function connect(
  client: WirealClient,
  options?: WirealServerOptions,
  clientName = "test",
) {
  const server = createWirealServer(client, options);
  const [local, remote] = InMemoryTransport.createLinkedPair();
  const pending = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (reason: Error) => void;
    }
  >();
  let sequence = 0;
  local.onmessage = (message) => {
    if (!("id" in message) || typeof message.id !== "number") return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if ("result" in message) waiter.resolve(message.result);
    else if ("error" in message)
      waiter.reject(new Error(message.error.message));
  };
  const rpc = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      void local.send({ jsonrpc: "2.0", id, method, params }).catch(reject);
    });
  await server.connect(remote);
  await local.start();
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    clientInfo: { name: clientName, version: "1" },
    capabilities: {},
  });
  await local.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await rpc("tools/call", { name, arguments: args })) as Result;
  /** The one text block, parsed; failures throw with their message. */
  const json = async <T = Record<string, unknown>>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    const result = await call(name, args);
    const text = result.content?.[0]?.text ?? "";
    if (result.isError) throw new Error(`${name}: ${text}`);
    assert.equal(result.structuredContent, undefined);
    assert.doesNotMatch(text, /\n {2}/, "answers are not pretty-printed");
    return JSON.parse(text) as T;
  };
  const tools = async () =>
    (await rpc("tools/list")).tools as {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }[];
  const close = async () => {
    await server.close();
    await local.close();
  };
  return { rpc, call, json, tools, close, initialized };
}

const fullTools = [
  "workspaces",
  "list_projects",
  "project",
  "label",
  "list_tasks",
  "get_task",
  "task_brief",
  "create_tasks",
  "update_task",
  "delete_task",
  "report",
  "add_task_activity",
  "propose_task",
  "working_on",
  "runner",
];

test("the full profile is fifteen lean tools with short, consistent instructions", async () => {
  const { client } = fakeClient();
  const session = await connect(client);
  try {
    const instructions = session.initialized.instructions as string;
    assert.match(instructions, /exactly one report/);
    assert.match(instructions, /create_tasks/);
    assert.match(instructions, /only when a person asks/);
    assert.doesNotMatch(instructions, /close_task|set_task_status/);
    assert.ok(instructions.length < 700, `${instructions.length} chars`);

    const tools = await session.tools();
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      [...fullTools].sort(),
    );
    for (const tool of tools) {
      assert.equal("$schema" in tool.inputSchema, false, tool.name);
      assert.ok(tool.description.length <= 160, tool.name);
    }
    const agent = (
      tools.find((tool) => tool.name === "report")!.inputSchema.properties as {
        agent: { description: string };
      }
    ).agent;
    assert.ok(agent.description.length <= 40);
    const project = tools.find((tool) => tool.name === "project")!;
    assert.match(project.description, /Only the workspace owner/);
  } finally {
    await session.close();
  }
});

test("the runner profile has four tools, tiny instructions, the runner's name and no presence", async () => {
  const { client, state, touches } = fakeClient(undefined, {
    agentName: "Claude · studio 1",
  });
  let listed = 0;
  (client as unknown as { listPresence: () => Promise<[]> }).listPresence =
    async () => {
      listed += 1;
      return [];
    };
  const session = await connect(
    client,
    { profile: "runner", presence: { session: "s" } },
    "claude-code",
  );
  try {
    assert.ok((session.initialized.instructions as string).length < 200);
    assert.deepEqual(
      (await session.tools()).map((tool) => tool.name).sort(),
      [...runnerTools].sort(),
    );
    for (const tool of await session.tools())
      assert.equal(
        "agent" in (tool.inputSchema.properties as object),
        false,
        tool.name,
      );

    const reported = await session.json("report", {
      task: "7",
      done: "Set up authentication",
      next: "Rotate keys",
    });
    assert.deepEqual(reported, { id: "fixture-task-7", number: "7" });
    const entry = state.workspace.tasks[6].activity[0];
    assert.equal(entry.kind, "report");
    assert.equal(entry.author, "Claude · studio 1");
    assert.equal(entry.text, "Done: Set up authentication\nNext: Rotate keys");

    await session.json("task_brief", { task: "3" });
    assert.deepEqual(touches, []);
    assert.equal(listed, 0);
    const missing = await session
      .call("list_tasks")
      .catch((): Result => ({ isError: true }));
    assert.equal(missing.isError, true);
  } finally {
    await session.close();
  }
});

test("profileFromEnv reads WIREAL_MCP_PROFILE", () => {
  assert.equal(profileFromEnv({ WIREAL_MCP_PROFILE: "runner" }), "runner");
  assert.equal(profileFromEnv({ WIREAL_MCP_PROFILE: " Runner " }), "runner");
  assert.equal(profileFromEnv({}), "full");
  assert.equal(profileFromEnv({ WIREAL_MCP_PROFILE: "other" }), "full");
});

test("reads are compact, writes answer with ids, and batches wire dependencies", async () => {
  const seed = structuredClone(testWorkspace);
  seed.tasks[0].objective = "x".repeat(200);
  seed.tasks[1].objective = "Ship the login flow";
  seed.projects[0].repositoryUrl = "https://github.com/example/wireal";
  seed.projects[0].paths = ["apps/web"];
  const { client, state } = fakeClient(seed);
  const session = await connect(client);
  try {
    const listed = await session.json<{
      count: number;
      tasks: Record<string, unknown>[];
    }>("list_tasks");
    assert.equal(listed.count, 8);
    const first = listed.tasks.find((task) => task.id === "fixture-task-1")!;
    assert.equal(first.objective, `${"x".repeat(100)}…`);
    assert.deepEqual(first.projects, ["Launchpad"]);
    assert.deepEqual(
      listed.tasks.find((task) => task.id === "fixture-task-3")!.blockedBy,
      ["2", "7"],
    );
    assert.doesNotMatch(
      JSON.stringify(listed),
      /github\.com|apps\/web|launchOrder|repositoryUrl/,
    );

    const ready = await session.json<{ tasks: { id: string }[] }>(
      "list_tasks",
      { ready: true },
    );
    assert.deepEqual(
      ready.tasks.map((task) => task.id),
      ["fixture-task-7"],
    );

    const brief = await session.json<{
      repository: string;
      projects: { folders: string[] }[];
      upstream: { n: string }[];
    }>("task_brief", { task: "fixture-task-3" });
    assert.deepEqual(
      brief.upstream.map((task) => task.n),
      ["7", "2"],
    );
    assert.deepEqual(brief.projects[0].folders, ["apps/web"]);

    const created = await session.json<
      { ref?: string; id: string; number: string }[]
    >("create_tasks", {
      tasks: [
        { ref: "a", name: "New A", projects: ["Launchpad"] },
        { ref: "b", name: "New B", projects: ["Launchpad"], dependsOn: ["a"] },
        { name: "New C", parent: "b", dependsOn: [7] },
      ],
      agent: "abc1234",
    });
    assert.deepEqual(
      created.map(({ ref, number }) => [ref, number]),
      [
        ["a", "9"],
        ["b", "10"],
        [undefined, "11"],
      ],
    );
    const newB = state.workspace.tasks.find(
      (task) => task.referenceId === "10",
    )!;
    assert.ok(
      state.workspace.links.some(
        (link) => link.source === created[0].id && link.target === newB.id,
      ),
    );
    assert.equal(
      state.workspace.tasks.find((task) => task.referenceId === "11")!
        .activity[0].author,
      "test · abc1234",
    );

    const detail = await session.json<{
      dependsOn: string[];
      blockedBy: string[];
      activity?: string[];
    }>("get_task", { task: "10" });
    assert.deepEqual(detail.dependsOn, ["9"]);
    assert.deepEqual(detail.blockedBy, ["9"]);
    assert.equal(detail.activity, undefined);

    const updated = await session.json("update_task", {
      task: "10",
      status: "doing",
      removeDependsOn: ["9"],
      addDependsOn: [1],
      linkCommit: "68af5a14311fbd9d411d7b0e7df3c989ce6f7b96",
    });
    assert.deepEqual(updated, {
      id: newB.id,
      number: "10",
      status: "doing",
      commitUrl:
        "https://github.com/example/wireal/commit/68af5a14311fbd9d411d7b0e7df3c989ce6f7b96",
    });
    assert.equal(
      (await session.call("update_task", { task: "10" })).isError,
      true,
    );

    const reported = await session.json("report", {
      task: "10",
      done: "Built B",
      where: "src/b.ts",
      commit: "68af5a1",
    });
    assert.deepEqual(reported, {
      id: newB.id,
      number: "10",
      note: "Commit left out: give the full 40-character SHA.",
    });
    const withLog = await session.json<{ latest: string; activity: string[] }>(
      "get_task",
      { task: "10", include: ["activity"], limit: 1 },
    );
    assert.equal(withLog.latest, "Done: Built B\nWhere: src/b.ts");
    assert.equal(withLog.activity.length, 1);
    // The handle given once sticks for the rest of the session.
    assert.match(
      withLog.activity[0],
      /^report · test · abc1234 · \S+: Done: Built B/,
    );

    const proposed = await session.json<{ id: string; number: string }>(
      "propose_task",
      {
        from: "fixture-task-1",
        name: "Follow-up from the agent",
        objective: "Keep separate work out of the current task",
      },
    );
    assert.equal(
      state.workspace.tasks.find((task) => task.id === proposed.id)?.status,
      "proposed",
    );

    const configured = await session.json<{ folders: string[] }>("project", {
      action: "update",
      project: "Launchpad",
      folders: ["./apps/web/", "services/api"],
      removeFolders: ["services/api"],
      addFolders: ["packages/ui"],
    });
    assert.deepEqual(configured.folders, ["apps/web", "packages/ui"]);

    const label = await session.json("label", {
      action: "create",
      name: "Backend",
      color: "#112233",
    });
    assert.deepEqual(label, { name: "Backend" });
    assert.equal(state.workspace.labels[0].color, "#112233");

    const projects = await session.json<{
      labels: string[];
      projects: { name: string; repositoryUrl?: string }[];
    }>("list_projects");
    assert.deepEqual(projects.labels, ["Backend"]);
    assert.equal(
      projects.projects[0].repositoryUrl,
      "https://github.com/example/wireal",
    );

    const deleted = await session.json("delete_task", {
      task: "fixture-task-3",
    });
    assert.deepEqual(deleted, { removed: ["3", "4"] });
  } finally {
    await session.close();
  }
});

test("presence: tool calls touch once a minute, working_on names the task, others show as busy", async () => {
  const { client, touches } = fakeClient();
  (
    client as unknown as { listPresence: () => Promise<unknown[]> }
  ).listPresence = async () => [
    {
      workspace_id: "workspace-one",
      session: "someone-else",
      user_id: "u2",
      user_name: "Ada",
      client: "Codex",
      handle: null,
      task_id: "fixture-task-2",
      note: null,
      last_seen: new Date().toISOString(),
    },
    {
      workspace_id: "workspace-one",
      session: "me",
      user_id: "u1",
      user_name: "Grace",
      client: "Claude Code",
      handle: null,
      task_id: "fixture-task-5",
      note: null,
      last_seen: new Date().toISOString(),
    },
  ];
  const waited: Promise<unknown>[] = [];
  const session = await connect(
    client,
    { presence: { session: "me", waitUntil: (p) => waited.push(p) } },
    "claude-code",
  );
  try {
    const listed = await session.json<{
      tasks: { id: string; busy?: string }[];
    }>("list_tasks");
    await Promise.all(waited);
    assert.equal(
      listed.tasks.find((task) => task.id === "fixture-task-2")?.busy,
      "Ada · Codex",
    );
    // A person's own session is not "someone else" on their task.
    assert.equal(
      listed.tasks.find((task) => task.id === "fixture-task-5")?.busy,
      undefined,
    );
    await session.json("get_task", { task: "1" });
    await Promise.all(waited);
    assert.equal(touches.length, 1);
    assert.deepEqual(touches[0], {
      session: "me",
      client: "Claude Code",
      handle: undefined,
      taskId: undefined,
      note: undefined,
    });

    assert.deepEqual(
      await session.json("working_on", {
        task: "3",
        note: "fixing the flow",
        agent: "a1b2c3d",
      }),
      { ok: true },
    );
    await Promise.all(waited);
    assert.equal(touches.length, 2);
    assert.deepEqual(touches[1], {
      session: "me",
      client: "Claude Code",
      handle: "a1b2c3d",
      taskId: "fixture-task-3",
      note: "fixing the flow",
    });
  } finally {
    await session.close();
  }
});

test("presence failures never fail a tool call", async () => {
  const { client } = fakeClient(undefined, {
    touchPresence: async () => {
      throw new Error("no such command");
    },
    listPresence: async () => {
      throw new Error("no such command");
    },
  });
  const session = await connect(client, {
    presence: { session: "flaky-session" },
  });
  try {
    const listed = await session.json<{ count: number }>("list_tasks");
    assert.equal(listed.count, 8);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const created = await session.json<unknown[]>("create_tasks", {
      tasks: [{ name: "Still works", projects: ["Launchpad"] }],
    });
    assert.equal(created.length, 1);
  } finally {
    await session.close();
  }
});

test("legacy stateless calls use the registered OAuth client identity", async () => {
  const { client, state } = fakeClient(undefined, {
    agentName: "Agent",
    registeredClientName: "chatgpt.com",
  });
  const handler = createMcpHandler(() => createWirealServer(client));
  const post = async (body: unknown) => {
    const response = await handler.fetch(
      new Request("https://mcp.example/", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
    await response.text();
    assert.equal(response.status, 200);
  };

  try {
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

    const task = state.workspace.tasks[0];
    await post({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "add_task_activity",
        arguments: {
          task: task.id,
          kind: "verification",
          summary: "legacy identity regression",
        },
      },
    });

    const activity = state.workspace.tasks.find(
      (candidate) => candidate.id === task.id,
    )?.activity?.[0];
    assert.equal(activity?.author, "ChatGPT");
  } finally {
    await handler.close();
  }
});

test("workspaces answers with an error when the session is pinned", async () => {
  const { client } = fakeClient(undefined, {
    setActiveWorkspace: async () => {
      throw new Error("This session is pinned to workspace Workspace.");
    },
  });
  const session = await connect(client);
  try {
    const refused = await session.call("workspaces", {
      use: "Product workspace",
    });
    assert.equal(refused.isError, true);
    assert.equal(
      refused.content?.[0].text,
      "This session is pinned to workspace Workspace.",
    );
    assert.deepEqual(await session.json("workspaces"), [
      { id: "workspace-one", name: "Workspace", active: true },
    ]);
  } finally {
    await session.close();
  }
});

test("add_task_activity turns an abbreviated SHA away and hands back the link it made", async () => {
  const seed = structuredClone(testWorkspace);
  seed.projects[0].repositoryUrl = "https://github.com/example/repo";
  seed.tasks[0].projectIds = [seed.projects[0].id];
  const { client, state } = fakeClient(seed);
  const session = await connect(client);
  try {
    const short = await session.call("add_task_activity", {
      task: seed.tasks[0].id,
      kind: "change",
      summary: "Committed the helper",
      commit: "68af5a1",
    });
    assert.equal(short.isError, true);
    assert.deepEqual(state.workspace.tasks[0].commitUrls, []);

    const full = await session.json<{ commitUrl?: string }>(
      "add_task_activity",
      {
        task: seed.tasks[0].id,
        kind: "change",
        summary: "Committed the helper",
        commit: "68af5a14311fbd9d411d7b0e7df3c989ce6f7b96",
      },
    );
    assert.equal(
      full.commitUrl,
      "https://github.com/example/repo/commit/68af5a14311fbd9d411d7b0e7df3c989ce6f7b96",
    );
    assert.deepEqual(state.workspace.tasks[0].commitUrls, [full.commitUrl]);
  } finally {
    await session.close();
  }
});

test("two Claudes on one workspace sign their entries apart", async () => {
  const { client, state } = fakeClient(undefined, { agentName: "Agent" });
  const session = await connect(client, undefined, "claude-code");
  const note = (handle: string | undefined, summary: string) =>
    session.call("add_task_activity", {
      task: state.workspace.tasks[0].id,
      kind: "verification",
      summary,
      ...(handle === undefined ? {} : { agent: handle }),
    });
  try {
    assert.notEqual((await note("6a798ba", "read the roster")).isError, true);
    assert.notEqual((await note("4f21c0e", "read it too")).isError, true);

    const authors = state.workspace.tasks[0].activity
      .slice(0, 2)
      .map((entry) => entry.author);
    assert.deepEqual(authors, ["Claude · 4f21c0e", "Claude · 6a798ba"]);
    assert.equal(state.workspace.tasks[0].activity[1].text, "read the roster");
  } finally {
    await session.close();
  }
});

/** A client whose runners, presence and unlocks the test controls. */
function orchestrated(unlock: (taskId: string) => Promise<string[]>) {
  const unlocked: string[] = [];
  const seen = new Date().toISOString();
  const faked = fakeClient(undefined, {
    unlockTask: async (taskId: string) => {
      unlocked.push(taskId);
      return unlock(taskId);
    },
    listRunners: async () => [
      {
        runner_id: "r1",
        name: "Studio",
        last_seen: seen,
        agents: [
          {
            id: "a1",
            name: "Studio 1",
            kind: "claude",
            task_id: "fixture-task-3",
            step: "running npm test",
          },
          { id: "a2", name: "Studio 2", kind: "codex", task_id: null },
          {
            id: "a3",
            name: "Studio 3",
            kind: "claude",
            task_id: null,
            waiting: "Paused on its runner",
          },
        ],
      },
      {
        runner_id: "r2",
        name: "Laptop",
        last_seen: "2026-01-01T00:00:00Z",
        agents: [{ id: "b1", name: "Laptop 1", task_id: "fixture-task-2" }],
      },
    ],
    listPresence: async () => [
      {
        workspace_id: "workspace-one",
        session: "someone-else",
        user_id: "u2",
        user_name: "Ada",
        client: "Codex",
        handle: null,
        task_id: "fixture-task-5",
        note: "on it",
        last_seen: seen,
      },
    ],
  });
  return { ...faked, unlocked };
}

test("runner: hands_off takes a task from the agents, release gives it back", async () => {
  const { client, touches, unlocked } = orchestrated(async (id) => [id]);
  const session = await connect(client, { presence: { session: "me" } });
  try {
    assert.deepEqual(
      await session.json("runner", {
        action: "hands_off",
        task: "WRL·3",
        note: "fixing it myself",
      }),
      { task: "3", yours: true, stopped: true },
    );
    assert.deepEqual(unlocked, ["fixture-task-3"]);
    assert.equal(touches.at(-1)?.taskId, "fixture-task-3");
    assert.equal(touches.at(-1)?.note, "fixing it myself");

    assert.deepEqual(await session.json("runner", { action: "release" }), {
      released: true,
    });
    assert.equal(touches.at(-1)?.taskId, undefined);

    assert.deepEqual(
      await session.json("runner", { action: "stop", task: "wrl-2" }),
      { task: "2", stopped: true },
    );
    assert.deepEqual(unlocked, ["fixture-task-3", "fixture-task-2"]);

    const missing = await session.call("runner", { action: "stop" });
    assert.equal(missing.isError, true);
  } finally {
    await session.close();
  }
});

test("runner: hands_off still marks the task when the unlock is refused", async () => {
  const { client, touches } = orchestrated(async () => {
    throw new Error("Only the lock owner or the workspace owner can unlock.");
  });
  const session = await connect(client, { presence: { session: "me" } });
  try {
    assert.deepEqual(
      await session.json("runner", { action: "hands_off", task: "3" }),
      {
        task: "3",
        yours: true,
        stopped: false,
        unlock: "Only the lock owner or the workspace owner can unlock.",
      },
    );
    assert.equal(touches.at(-1)?.taskId, "fixture-task-3");
  } finally {
    await session.close();
  }
});

test("runner: pause and resume go back to the mode the pause interrupted", async () => {
  const { client, state } = orchestrated(async () => []);
  state.workspace.map.agents = {
    ...(state.workspace.map.agents ?? { leaseMinutes: 5 }),
    mode: "directed",
  };
  const session = await connect(client);
  try {
    assert.deepEqual(await session.json("runner", { action: "pause" }), {
      mode: "paused",
    });
    assert.equal(state.workspace.map.agents?.mode, "paused");
    assert.equal(state.workspace.map.agents?.pausedFrom, "directed");
    assert.deepEqual(await session.json("runner", { action: "pause" }), {
      mode: "paused",
    });
    assert.deepEqual(await session.json("runner", { action: "resume" }), {
      mode: "directed",
    });
    assert.equal(state.workspace.map.agents?.pausedFrom, undefined);
    assert.deepEqual(await session.json("runner", { action: "resume" }), {
      mode: "directed",
    });
  } finally {
    await session.close();
  }
});

test("runner: status is each runner's agents, the people on tasks and the mode", async () => {
  const { client } = orchestrated(async () => []);
  const session = await connect(client);
  try {
    const status = await session.json("runner", { action: "status" });
    assert.deepEqual(status, {
      mode: "automatic",
      runners: [
        {
          name: "Studio",
          online: true,
          agents: [
            {
              name: "Studio 1",
              kind: "claude",
              state: "working",
              task: "3",
              step: "running npm test",
            },
            { name: "Studio 2", kind: "codex", state: "idle" },
            {
              name: "Studio 3",
              kind: "claude",
              state: "waiting",
              waiting: "Paused on its runner",
            },
          ],
        },
        { name: "Laptop", online: false },
      ],
      people: [{ name: "Ada", client: "Codex", task: "5", note: "on it" }],
    });
  } finally {
    await session.close();
  }
});
