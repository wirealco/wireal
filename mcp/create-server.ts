import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { agentDisplayName } from "../src/agent-identity.ts";
import {
  agentSettings,
  launchOrder,
  reportedKinds,
  repositoryLayout,
  workspaceKind,
} from "../src/domain.ts";
import { mcpServer, version } from "../src/version.ts";
import type { Presence, WirealClient } from "./client.ts";
import { mcpCallerName, mcpClientLabel } from "./identity.ts";
import {
  clip,
  projectView,
  runnerStatus,
  statusCounts,
  taskDetail,
  taskRow,
} from "./views.ts";
import {
  addActivity,
  addDependency,
  configureProjectFolders,
  createLabel,
  createProject,
  createTasks,
  deleteLabel,
  deleteProject,
  deleteTask,
  findProject,
  findTask,
  linkCommit,
  patchTask,
  proposeTask,
  readyTasks,
  removeDependency,
  reportTask,
  setTaskStatus,
  taskBrief,
  unlinkCommit,
  updateLabel,
  updateProject,
} from "./workspace.ts";

/**
 * "full" is every tool, for a person's own CLI or chat client. "runner" is the
 * four a runner-started agent needs for its one task: nothing to browse,
 * nothing to re-plan, and no presence (the runner's heartbeat reports it).
 */
export type WirealProfile = "full" | "runner";

export type WirealServerOptions = {
  profile?: WirealProfile;
  /**
   * Set on the hosted HTTP path: every tool call then says this session is
   * live (touch_presence), at most once a minute per workspace. `waitUntil`
   * keeps that request alive past the response where a runtime would cut it.
   */
  presence?: {
    session: string;
    waitUntil?: (promise: Promise<unknown>) => void;
  };
};

/** WIREAL_MCP_PROFILE=runner selects the runner profile; anything else is full. */
export function profileFromEnv(env: {
  WIREAL_MCP_PROFILE?: string;
}): WirealProfile {
  return env.WIREAL_MCP_PROFILE?.trim().toLowerCase() === "runner"
    ? "runner"
    : "full";
}

export const runnerTools = [
  "task_brief",
  "report",
  "add_task_activity",
  "propose_task",
] as const;

const fullInstructions = [
  "Wireal holds the tasks. Name a task by number (WRL·12 is 12), ID or exact name.",
  "Read with list_tasks (board order, prerequisites first; ready:true for what can start now) and get_task.",
  "Create tasks with one create_tasks call; parent and dependsOn may use refs from that call.",
  "Pass the same agent handle on every write. Call working_on when you start a task.",
  "When you finish, send exactly one report (done, where, next, blocked, full commit SHA). Use add_task_activity only for a blocker or discovery mid-work. Do not narrate.",
  "Change status with update_task only when a person asks. For separate work, propose_task.",
].join(" ");

const runnerInstructions =
  "Read your task with task_brief. Finish with exactly one report. Use add_task_activity only for a blocker or discovery. Separate work: propose_task.";

/** The SDK stamps every input schema with a `$schema` URL that no client
 *  reads and every turn resends, so it is left out. */
function lean<T extends z.ZodType>(schema: T): T {
  const standard = schema["~standard"] as unknown as {
    jsonSchema?: {
      input: (options: unknown) => Record<string, unknown>;
      output: (options: unknown) => Record<string, unknown>;
    };
  };
  const convert = standard.jsonSchema;
  if (!convert) return schema;
  const strip = (json: Record<string, unknown>) => {
    const { $schema: _dropped, ...rest } = json;
    return rest;
  };
  const wrapped = Object.create(schema) as T;
  Object.defineProperty(wrapped, "~standard", {
    value: {
      ...standard,
      jsonSchema: {
        input: (options: unknown) => strip(convert.input(options)),
        output: (options: unknown) => strip(convert.output(options)),
      },
    },
  });
  return wrapped;
}

/** Compact JSON as the one content block. No structuredContent: clients
 *  hand both to the model, which then reads every answer twice. */
const answer = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

function failure(error: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  };
}

const statusSchema = z.enum(["proposed", "todo", "doing", "done"]);
const taskSchema = z.string().min(1).describe("Number, ID or name");
const agentSchema = z
  .string()
  .max(60)
  .optional()
  .describe("Your session handle, same every call");
const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .optional();
const taskRefSchema = z.union([z.string().min(1), z.number()]);
const readOnly = { readOnlyHint: true };
const write = { readOnlyHint: false, destructiveHint: false };
const destructive = { readOnlyHint: false, destructiveHint: true };

const newTaskSchema = z.object({
  ref: z.string().optional().describe("Local name for this call"),
  name: z.string().min(1),
  objective: z.string().optional(),
  projects: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  status: statusSchema.optional(),
  parent: taskRefSchema.optional(),
  dependsOn: z.array(taskRefSchema).optional(),
});

/** Presence rows this process wrote, by workspace and session, so stateless
 *  requests neither rewrite a row on every call nor forget the task a person
 *  said they are on. */
type Remembered = { at: number; taskId?: string; note?: string };
const presenceMemory = new Map<string, Remembered>();
const presenceInterval = 60_000;

function remember(key: string, value: Remembered) {
  presenceMemory.delete(key);
  presenceMemory.set(key, value);
  if (presenceMemory.size > 1000)
    presenceMemory.delete(presenceMemory.keys().next().value!);
}

/** "WRL·12", "wrl-12" and "12" all name task 12. */
export function taskNumber(value: string): string {
  const match = /^\s*wrl\s*[·.\-#]?\s*(\d+)\s*$/i.exec(value);
  return match ? match[1] : value;
}

/** A short stable digest (cyrb53), for session keys made of request identity. */
export function digest(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, "0") +
    (h1 >>> 0).toString(16).padStart(8, "0")
  );
}

/**
 * The Wireal tools, over any transport. The caller supplies the client, which
 * is what differs between the entry points: the runner's stdio proxy builds
 * one from the machine's saved session, the Worker builds one per request from
 * the caller's own bearer token.
 */
export function createWirealServer(
  client: WirealClient,
  options: WirealServerOptions = {},
) {
  const runner = options.profile === "runner";
  const full = !runner;
  const server = new McpServer(
    { name: mcpServer, version },
    { instructions: runner ? runnerInstructions : fullInstructions },
  );
  const identity = () => ({
    clientInfoName: server.server.getClientVersion()?.name,
    registeredClientName: client.registeredClientName,
    userAgent: client.userAgent,
    fallback: client.agentName,
  });
  /* A runner names each agent it starts ("Claude · studio 1") and passes that
     in; it is more specific than anything the handshake can say. */
  const runnerName = client.agentName?.trim();
  const namedByRunner =
    runner && !!runnerName && !/^(agent|wireal runner)$/i.test(runnerName);
  let handle: string | undefined;
  const callerName = () =>
    namedByRunner
      ? agentDisplayName(runnerName)
      : mcpCallerName({ ...identity(), handle });

  const presenceSession = () =>
    options.presence?.session ??
    `local-${digest(`${client.agentName}|${identity().clientInfoName ?? ""}`)}`;

  async function touch(explicit?: { taskId?: string; note?: string }) {
    const session = presenceSession();
    const workspaceId = await client.currentWorkspaceId();
    const key = `${workspaceId}|${session}`;
    const memory = presenceMemory.get(key);
    const now = Date.now();
    if (!explicit && memory && now - memory.at < presenceInterval) return;
    const next: Remembered = explicit
      ? { at: now, ...explicit }
      : { at: now, taskId: memory?.taskId, note: memory?.note };
    remember(key, next);
    await client.touchPresence({
      session,
      client: mcpClientLabel(identity()),
      handle,
      taskId: next.taskId,
      note: next.note,
    });
  }

  /** Presence never fails or slows a tool call. */
  function touchInBackground() {
    if (runner || !options.presence) return;
    const pending = (async () => touch())().catch(() => undefined);
    options.presence.waitUntil?.(pending);
  }

  /** Other people's live CLI sessions that named a task. */
  async function livePresence(workspaceId?: string): Promise<Presence[]> {
    if (runner) return [];
    try {
      const own = presenceSession();
      return (await client.listPresence(workspaceId)).filter(
        (entry) => entry.session !== own && entry.task_id,
      );
    } catch {
      return [];
    }
  }

  function busyByTask(presence: Presence[]): Map<string, string> {
    const busy = new Map<string, string>();
    for (const entry of presence) {
      const who = `${entry.user_name} · ${entry.client}`;
      const before = busy.get(entry.task_id!);
      busy.set(entry.task_id!, before ? `${before}, ${who}` : who);
    }
    return busy;
  }

  function run<T extends Record<string, unknown>>(
    handler: (input: T, callerName: string) => Promise<unknown>,
  ) {
    return async (input: T): Promise<CallToolResult> => {
      if (typeof input.agent === "string" && input.agent.trim())
        handle = input.agent.trim();
      try {
        return answer(await handler(input, callerName()));
      } catch (error) {
        return failure(error);
      } finally {
        touchInBackground();
      }
    };
  }

  if (full)
    server.registerTool(
      "workspaces",
      {
        description: "List your workspaces; `use` switches the active one.",
        inputSchema: lean(
          z.object({
            use: z.string().min(1).optional().describe("ID or exact name"),
          }),
        ),
        annotations: write,
      },
      run(async ({ use }) => {
        if (use) await client.setActiveWorkspace(use);
        return (await client.listWorkspaces()).map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          ...(workspace.kind === "everyday" ? { kind: "everyday" } : {}),
          ...(workspace.isActive ? { active: true } : {}),
        }));
      }),
    );

  if (full)
    server.registerTool(
      "list_projects",
      {
        description:
          "Projects with repository, folders and task counts; labels.",
        inputSchema: lean(z.object({})),
        annotations: readOnly,
      },
      run(async () => {
        const { workspace, workspaceId } = await client.read();
        const presence = await livePresence(workspaceId);
        return {
          workspace: workspace.map.name,
          kind: workspaceKind(workspace),
          ...(workspaceKind(workspace) === "coding"
            ? { layout: repositoryLayout(workspace) }
            : {}),
          labels: workspace.labels.map((label) => label.name),
          projects: workspace.projects.map((project) => {
            const tasks = workspace.tasks.filter((task) =>
              task.projectIds.includes(project.id),
            );
            const busy = presence
              .filter((entry) =>
                tasks.some((task) => task.id === entry.task_id),
              )
              .map((entry) => `${entry.user_name} · ${entry.client}`);
            return {
              ...projectView(workspace, project),
              tasks: statusCounts(tasks),
              ...(busy.length ? { busy: busy.join(", ") } : {}),
            };
          }),
        };
      }),
    );

  if (full)
    server.registerTool(
      "project",
      {
        description:
          "Create, update or delete a project. Only the workspace owner can set repositoryUrl or folders.",
        inputSchema: lean(
          z.object({
            action: z.enum(["create", "update", "delete"]),
            project: z.string().optional().describe("ID or name"),
            name: z.string().min(1).optional(),
            color: colorSchema,
            repositoryUrl: z.string().optional().describe("GitHub URL"),
            folders: z
              .array(z.string())
              .optional()
              .describe("Repo-relative; replaces all"),
            addFolders: z.array(z.string()).optional(),
            removeFolders: z.array(z.string()).optional(),
          }),
        ),
        annotations: destructive,
      },
      run(async (input) => {
        const { action, project, name, color, repositoryUrl, folders } = input;
        const { addFolders, removeFolders } = input;
        if (action === "create") {
          if (!name) throw new Error("A new project needs a name.");
          const result = await client.mutate((workspace) => {
            const changed = createProject(workspace, {
              name,
              color,
              repositoryUrl: repositoryUrl || undefined,
              folders: folders ?? addFolders,
            });
            return {
              state: changed.state,
              value: projectView(changed.state, changed.project),
            };
          });
          return result.value;
        }
        if (!project) throw new Error("Name the project.");
        if (action === "delete") {
          const result = await client.mutate((workspace) => {
            const removed = deleteProject(workspace, project);
            return {
              state: removed.state,
              value: {
                deleted: removed.project.name,
                removedTasks: removed.removedTasks.map(
                  (candidate) => candidate.referenceId,
                ),
              },
            };
          });
          return result.value;
        }
        if (
          [
            name,
            color,
            repositoryUrl,
            folders,
            addFolders,
            removeFolders,
          ].every((value) => value === undefined)
        )
          throw new Error("Provide at least one field to update.");
        const result = await client.mutate((workspace) => {
          let changed = updateProject(workspace, project, {
            name,
            color,
            repositoryUrl,
            folders,
          });
          if (addFolders || removeFolders)
            changed = configureProjectFolders(
              changed.state,
              changed.project.id,
              { add: addFolders, remove: removeFolders },
            );
          return {
            state: changed.state,
            value: projectView(changed.state, changed.project),
          };
        });
        return result.value;
      }),
    );

  if (full)
    server.registerTool(
      "label",
      {
        description: "Create, rename, recolor or delete a task label.",
        inputSchema: lean(
          z.object({
            action: z.enum(["create", "update", "delete"]),
            label: z.string().optional().describe("ID or name"),
            name: z.string().min(1).optional(),
            color: colorSchema,
          }),
        ),
        annotations: destructive,
      },
      run(async ({ action, label, name, color }) => {
        const result = await client.mutate<object>((workspace) => {
          if (action === "create") {
            if (!name) throw new Error("A new label needs a name.");
            let state = createLabel(workspace, name);
            const made = state.labels.find(
              (candidate) =>
                candidate.name.toLowerCase() === name.trim().toLowerCase(),
            )!;
            if (color) state = updateLabel(state, made.id, { color }).state;
            return { state, value: { name: made.name } };
          }
          if (!label) throw new Error("Name the label.");
          if (action === "delete") {
            const removed = deleteLabel(workspace, label);
            return {
              state: removed.state,
              value: { deleted: removed.label.name },
            };
          }
          if (name === undefined && color === undefined)
            throw new Error("Provide a name or color to update.");
          const changed = updateLabel(workspace, label, { name, color });
          return {
            state: changed.state,
            value: { name: changed.label.name, color: changed.label.color },
          };
        });
        return result.value;
      }),
    );

  if (full)
    server.registerTool(
      "list_tasks",
      {
        description:
          "Tasks in board order. ready: todo tasks whose prerequisites are done, and sent-back ones.",
        inputSchema: lean(
          z.object({
            project: z.string().optional(),
            statuses: z.array(statusSchema).optional(),
            query: z.string().optional().describe("Text in name or objective"),
            ready: z.boolean().optional(),
          }),
        ),
        annotations: readOnly,
      },
      run(async ({ project, statuses, query, ready }) => {
        const { workspace, workspaceId } = await client.read();
        const selected = project ? findProject(workspace, project) : undefined;
        const needle = query?.trim().toLowerCase();
        const order = launchOrder(workspace);
        const pool = ready
          ? readyTasks(workspace)
          : [...workspace.tasks].sort(
              (left, right) =>
                (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
                (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
            );
        const tasks = pool.filter(
          (candidate) =>
            (!selected || candidate.projectIds.includes(selected.id)) &&
            (!statuses?.length || statuses.includes(candidate.status)) &&
            (!needle ||
              candidate.name.toLowerCase().includes(needle) ||
              candidate.referenceId.toLowerCase() === needle ||
              candidate.objective.toLowerCase().includes(needle)),
        );
        const busy = busyByTask(await livePresence(workspaceId));
        return {
          count: tasks.length,
          tasks: tasks.map((candidate) =>
            taskRow(workspace, candidate, busy.get(candidate.id)),
          ),
        };
      }),
    );

  if (full)
    server.registerTool(
      "get_task",
      {
        description:
          "One task in full with its latest report; include activity for the log.",
        inputSchema: lean(
          z.object({
            task: taskSchema,
            include: z.array(z.enum(["activity"])).optional(),
            limit: z.number().int().min(1).max(50).optional(),
          }),
        ),
        annotations: readOnly,
      },
      run(async ({ task, include, limit }) => {
        const { workspace, workspaceId } = await client.read();
        const found = findTask(workspace, task);
        const busy = busyByTask(await livePresence(workspaceId));
        return taskDetail(workspace, found, {
          activity: include?.includes("activity") ? (limit ?? 10) : undefined,
          busy: busy.get(found.id),
        });
      }),
    );

  server.registerTool(
    "task_brief",
    {
      description:
        "A task with its repository, project folders and what the tasks before it reported.",
      inputSchema: lean(z.object({ task: taskSchema })),
      annotations: readOnly,
    },
    run(async ({ task }) => {
      const { workspace } = await client.read();
      const brief = taskBrief(workspace, task);
      return {
        n: brief.task.referenceId,
        id: brief.task.id,
        name: brief.task.name,
        status: brief.task.status,
        objective: brief.task.objective,
        ...(brief.repository ? { repository: brief.repository } : {}),
        ...(brief.review ? { sentBack: brief.review } : {}),
        projects: brief.projects.map((project) => ({
          name: project.name,
          ...(project.repositoryUrl
            ? { repositoryUrl: project.repositoryUrl }
            : {}),
          ...(project.folders.length ? { folders: project.folders } : {}),
        })),
        upstream: brief.upstream.map((upstream) => ({
          n: upstream.referenceId,
          name: upstream.name,
          status: upstream.status,
          ...(upstream.report ? { report: clip(upstream.report, 400) } : {}),
        })),
      };
    }),
  );

  if (full)
    server.registerTool(
      "create_tasks",
      {
        description:
          "Create tasks in one write. parent and dependsOn take a ref from this call or a task number or ID. projects defaults to the parent's, or the only project.",
        inputSchema: lean(
          z.object({
            tasks: z.array(newTaskSchema).min(1).max(50),
            agent: agentSchema,
          }),
        ),
        annotations: write,
      },
      run(async ({ tasks }, agentName) => {
        const result = await client.mutate((workspace) => {
          const made = createTasks(
            workspace,
            tasks.map((item) => ({
              ...item,
              parent:
                item.parent === undefined ? undefined : String(item.parent),
            })),
            agentName,
          );
          return {
            state: made.state,
            value: made.created.map(({ ref, task }) => ({
              ...(ref ? { ref } : {}),
              id: task.id,
              number: task.referenceId,
            })),
          };
        });
        return result.value;
      }),
    );

  if (full)
    server.registerTool(
      "update_task",
      {
        description:
          "Change a task's name, projects, labels, dependencies, linked commits or status (status only when a person asks). The objective is edited in the app.",
        inputSchema: lean(
          z.object({
            task: taskSchema,
            name: z.string().min(1).optional(),
            projects: z.array(z.string()).min(1).optional(),
            labels: z.array(z.string()).optional(),
            status: statusSchema.optional(),
            addDependsOn: z.array(taskRefSchema).optional(),
            removeDependsOn: z.array(taskRefSchema).optional(),
            linkCommit: z.string().optional().describe("Full SHA or URL"),
            unlinkCommit: z.string().optional(),
            agent: agentSchema,
          }),
        ),
        annotations: write,
      },
      run(async (input, agentName) => {
        const { task, name, projects, labels, status } = input;
        const { addDependsOn, removeDependsOn } = input;
        if (
          [
            name,
            projects,
            labels,
            status,
            addDependsOn,
            removeDependsOn,
            input.linkCommit,
            input.unlinkCommit,
          ].every((value) => value === undefined)
        )
          throw new Error("Provide at least one field to update.");
        const result = await client.mutate((workspace) => {
          const target = findTask(workspace, task);
          let state = workspace;
          // No objective here, deliberately. An agent that can rewrite the
          // objective can quietly redefine the work it was measured against.
          if (name !== undefined || projects || labels)
            state = patchTask(
              state,
              target.id,
              { name, projectIds: projects, labels },
              agentName,
            ).state;
          for (const dependency of addDependsOn ?? [])
            state = addDependency(state, target.id, String(dependency)).state;
          for (const dependency of removeDependsOn ?? [])
            state = removeDependency(
              state,
              target.id,
              String(dependency),
            ).state;
          let commitUrl: string | undefined;
          if (input.linkCommit) {
            // Whichever of the task's projects the commit belongs to.
            let refusal: unknown = new Error(
              "None of this task's projects has that repository.",
            );
            for (const projectId of findTask(state, target.id).projectIds) {
              try {
                const linked = linkCommit(
                  state,
                  target.id,
                  projectId,
                  input.linkCommit,
                  agentName,
                );
                state = linked.state;
                commitUrl = linked.commitUrl;
                break;
              } catch (error) {
                refusal = error;
              }
            }
            if (!commitUrl) throw refusal;
          }
          if (input.unlinkCommit)
            state = unlinkCommit(
              state,
              target.id,
              input.unlinkCommit,
              agentName,
            ).state;
          if (status)
            state = setTaskStatus(state, target.id, status, agentName).state;
          const updated = findTask(state, target.id);
          return {
            state,
            value: {
              id: updated.id,
              number: updated.referenceId,
              status: updated.status,
              ...(commitUrl ? { commitUrl } : {}),
            },
          };
        });
        return result.value;
      }),
    );

  if (full)
    server.registerTool(
      "delete_task",
      {
        description:
          "Delete a task with its subtasks and links. A locked task cannot be deleted.",
        inputSchema: lean(z.object({ task: taskSchema })),
        annotations: destructive,
      },
      run(async ({ task }) => {
        const result = await client.mutate((workspace) => {
          const removed = deleteTask(workspace, task);
          return {
            state: removed.state,
            value: {
              removed: removed.removedTasks.map(
                (candidate) => candidate.referenceId,
              ),
            },
          };
        });
        return result.value;
      }),
    );

  server.registerTool(
    "report",
    {
      description:
        "Your one closing report on a task: what is done, where, what comes next, what blocks it.",
      inputSchema: lean(
        z.object({
          task: taskSchema,
          done: z.string().min(1).max(400),
          where: z.string().max(300).optional().describe("Files, branch, PR"),
          next: z.string().max(300).optional(),
          blocked: z.string().max(300).optional(),
          commit: z.string().optional().describe("Full SHA of HEAD"),
          ...(full ? { agent: agentSchema } : {}),
        }),
      ),
      annotations: write,
    },
    run(async ({ task, done, where, next, blocked, commit }, agentName) => {
      const result = await client.mutate((workspace) => {
        const changed = reportTask(
          workspace,
          task,
          { done, where, next, blocked, commit },
          agentName,
        );
        return {
          state: changed.state,
          value: {
            id: changed.task.id,
            number: changed.task.referenceId,
            ...(changed.commitUrl ? { commitUrl: changed.commitUrl } : {}),
            ...(changed.commitIgnored
              ? { note: "Commit left out: give the full 40-character SHA." }
              : {}),
          },
        };
      });
      return result.value;
    }),
  );

  server.registerTool(
    "add_task_activity",
    {
      description:
        "Note a blocker, discovery or decision mid-work. Finish with report instead.",
      inputSchema: lean(
        z.object({
          task: taskSchema,
          kind: z.enum(reportedKinds),
          summary: z.string().trim().min(1).max(500),
          commit: z
            .string()
            .regex(/^[0-9a-f]{40}$/, "Use the full 40-character SHA.")
            .optional(),
          ...(full ? { agent: agentSchema } : {}),
        }),
      ),
      annotations: write,
    },
    run(async ({ task, kind, summary, commit }, agentName) => {
      const result = await client.mutate((workspace) => {
        const changed = addActivity(
          workspace,
          task,
          { kind, summary, commit },
          agentName,
        );
        return {
          state: changed.state,
          value: {
            id: changed.task.id,
            number: changed.task.referenceId,
            ...(changed.commitUrl ? { commitUrl: changed.commitUrl } : {}),
          },
        };
      });
      return result.value;
    }),
  );

  server.registerTool(
    "propose_task",
    {
      description:
        "Propose separate follow-up work for a person to accept, instead of doing it.",
      inputSchema: lean(
        z.object({
          from: taskSchema,
          name: z.string().trim().min(1),
          objective: z.string(),
          projects: z.array(z.string()).min(1).optional(),
          ...(full ? { agent: agentSchema } : {}),
        }),
      ),
      annotations: write,
    },
    run(async ({ from, name, objective, projects }, agentName) => {
      const result = await client.mutate((workspace) => {
        const proposed = proposeTask(
          workspace,
          { from, name, objective, projectIds: projects },
          agentName,
        );
        return {
          state: proposed.state,
          value: { id: proposed.task.id, number: proposed.task.referenceId },
        };
      });
      return result.value;
    }),
  );

  if (full)
    server.registerTool(
      "working_on",
      {
        description:
          "Show others which task you are on; no task clears it. Lasts 10 minutes, renewed by any call.",
        inputSchema: lean(
          z.object({
            task: taskSchema.optional(),
            note: z.string().max(200).optional(),
            agent: agentSchema,
          }),
        ),
        annotations: write,
      },
      run(async ({ task, note }) => {
        let taskId: string | undefined;
        if (task) {
          const { workspace } = await client.read();
          taskId = findTask(workspace, task).id;
        }
        await touch({ taskId, note: note?.trim() || undefined });
        return { ok: true };
      }),
    );

  /* The orchestrator, steered from a person's own session. hands_off marks
     the task as theirs (presence, which every runner treats as busy) and
     unlocks it, which stops an agent on it; its work stays on its branch. */
  if (full)
    server.registerTool(
      "runner",
      {
        description:
          "Steer the runners' agents: hands_off (you take a task), release it, stop agents on a task, pause/resume all agents, status.",
        inputSchema: lean(
          z.object({
            action: z.enum([
              "hands_off",
              "release",
              "stop",
              "pause",
              "resume",
              "status",
            ]),
            task: taskSchema.optional(),
            note: z.string().max(200).optional(),
            agent: agentSchema,
          }),
        ),
        annotations: write,
      },
      run(async ({ action, task, note }) => {
        const named = async () => {
          if (!task) throw new Error(`${action} needs a task.`);
          const { workspace } = await client.read();
          return findTask(workspace, taskNumber(task));
        };
        if (action === "hands_off") {
          const target = await named();
          await touch({ taskId: target.id, note: note?.trim() || undefined });
          const stopped = await client
            .unlockTask(target.id)
            .then((ids) => ({ stopped: ids.length > 0 }))
            .catch((error: unknown) => ({
              stopped: false,
              unlock: error instanceof Error ? error.message : String(error),
            }));
          return { task: target.referenceId, yours: true, ...stopped };
        }
        if (action === "release") {
          await touch({});
          return { released: true };
        }
        if (action === "stop") {
          const target = await named();
          const ids = await client.unlockTask(target.id);
          return { task: target.referenceId, stopped: ids.length > 0 };
        }
        if (action === "pause" || action === "resume") {
          const result = await client.mutate((workspace) => {
            const settings = agentSettings(workspace);
            const paused = settings.mode === "paused";
            if (action === "pause" ? paused : !paused)
              return { state: workspace, value: { mode: settings.mode } };
            const { pausedFrom, ...rest } = settings;
            const mode =
              action === "pause" ? "paused" : (pausedFrom ?? "automatic");
            const agents =
              action === "pause"
                ? { ...rest, mode, pausedFrom: settings.mode }
                : { ...rest, mode };
            return {
              state: { ...workspace, map: { ...workspace.map, agents } },
              value: { mode },
            };
          });
          return result.value;
        }
        const { workspace, workspaceId } = await client.read();
        const [runners, presence] = await Promise.all([
          client.listRunners(workspaceId).catch(() => []),
          client.listPresence(workspaceId).catch(() => []),
        ]);
        return runnerStatus(workspace, runners, presence);
      }),
    );

  return server;
}
