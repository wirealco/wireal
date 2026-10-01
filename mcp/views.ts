import type { Presence, RunnerRow } from "./client.ts";
import {
  agentSettings,
  latestReport,
  openReview,
  projectPaths,
  projectRepository,
  type Activity,
  type Project,
  workspaceKind,
  type Status,
  type Task,
  type Workspace,
} from "../src/domain.ts";

/* Everything here is read by a model on every call, so a view carries what
   the next step needs and nothing it can ask for: tasks are named by number,
   empty fields are left out, and repository detail stays with projects. */

export function projectView(state: Workspace, project: Project) {
  const repositoryUrl = projectRepository(state, project);
  const folders = projectPaths(project);
  return {
    id: project.id,
    name: project.name,
    ...(repositoryUrl ? { repositoryUrl } : {}),
    ...(folders.length ? { folders } : {}),
  };
}

function numbers(state: Workspace, ids: Iterable<string>): string[] {
  const wanted = new Set(ids);
  return state.tasks
    .filter((task) => wanted.has(task.id))
    .map((task) => task.referenceId);
}

function prerequisites(state: Workspace, task: Task): Set<string> {
  return new Set([
    ...state.links
      .filter((link) => link.target === task.id)
      .map((link) => link.source),
    ...(task.parentId ? [task.parentId] : []),
  ]);
}

function blockers(state: Workspace, task: Task): string[] {
  const ids = prerequisites(state, task);
  return state.tasks
    .filter((candidate) => ids.has(candidate.id) && candidate.status !== "done")
    .map((candidate) => candidate.referenceId);
}

function projectNames(state: Workspace, task: Task): string[] {
  return state.projects
    .filter((project) => task.projectIds.includes(project.id))
    .map((project) => project.name);
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

/** One line of a task list. `busy` names who is on it from their own CLI. */
export function taskRow(state: Workspace, task: Task, busy?: string) {
  const blockedBy = blockers(state, task);
  const objective = clip(task.objective, 100);
  return {
    n: task.referenceId,
    id: task.id,
    name: task.name,
    status: task.status,
    projects: projectNames(state, task),
    ...(objective ? { objective } : {}),
    ...(blockedBy.length ? { blockedBy } : {}),
    ...(openReview(task) ? { sentBack: true } : {}),
    ...(task.proposedBy ? { proposedBy: task.proposedBy } : {}),
    ...(busy ? { busy } : {}),
  };
}

/** Activity as one short line each: kind · author · time · commit: text. */
export function activityLine(entry: Activity): string {
  const at = new Date(entry.at).toISOString().slice(0, 16) + "Z";
  const commit = entry.commit ? ` · ${entry.commit.slice(0, 7)}` : "";
  return `${entry.kind ?? "note"} · ${entry.author} · ${at}${commit}: ${entry.text}`;
}

/** Entries a reader wants: anything an agent tagged, and anything a person
 *  wrote. Automatic audit lines ("Status changed…") are left out. */
export function meaningfulActivity(task: Task): Activity[] {
  return task.activity
    .filter((entry) => entry.kind !== undefined || entry.authorType === "user")
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
}

export function taskDetail(
  state: Workspace,
  task: Task,
  options: { activity?: number; busy?: string } = {},
) {
  const dependsOn = numbers(
    state,
    state.links
      .filter((link) => link.target === task.id)
      .map((link) => link.source),
  );
  const unblocks = numbers(
    state,
    state.links
      .filter((link) => link.source === task.id)
      .map((link) => link.target),
  );
  const blockedBy = blockers(state, task);
  const review = openReview(task);
  const latest = latestReport(task);
  const parent = task.parentId
    ? state.tasks.find((candidate) => candidate.id === task.parentId)
    : undefined;
  const workflows = task.workflowIds?.length
    ? (state.workflows ?? [])
        .filter((workflow) => task.workflowIds!.includes(workflow.id))
        .map((workflow) => workflow.name)
    : [];
  const commits = workspaceKind(state) === "everyday" ? [] : task.commitUrls;
  return {
    n: task.referenceId,
    id: task.id,
    name: task.name,
    status: task.status,
    objective: task.objective,
    projects: projectNames(state, task),
    ...(task.labels.length ? { labels: task.labels } : {}),
    ...(workflows.length ? { workflows } : {}),
    ...(parent ? { parent: parent.referenceId } : {}),
    ...(dependsOn.length ? { dependsOn } : {}),
    ...(blockedBy.length ? { blockedBy } : {}),
    ...(unblocks.length ? { unblocks } : {}),
    ...(task.proposedBy ? { proposedBy: task.proposedBy } : {}),
    ...(review
      ? {
          sentBack: {
            text: review.text,
            by: review.author,
            ...(review.to ? { to: review.to } : {}),
          },
        }
      : {}),
    ...(commits.length ? { commits } : {}),
    ...(options.busy ? { busy: options.busy } : {}),
    ...(latest ? { latest: latest.text } : {}),
    ...(options.activity
      ? {
          activity: meaningfulActivity(task)
            .slice(0, options.activity)
            .map(activityLine),
        }
      : {}),
  };
}

/** A runner counts as online this long after its last heartbeat, as the
 *  app's Agents panel has it. */
export const runnerOnlineMs = 120_000;

/** The orchestrator at a glance: the mode, each runner with its agents
 *  (kind as a tag, task by number) and the people on a task in their own
 *  CLI. An offline runner is listed without its agents, which are stale. */
export function runnerStatus(
  state: Workspace,
  runners: readonly RunnerRow[],
  presence: readonly Presence[],
  now = Date.now(),
) {
  const number = new Map(
    state.tasks.map((task) => [task.id, task.referenceId]),
  );
  const settings = agentSettings(state);
  return {
    mode: settings.mode,
    runners: runners.map((row) => {
      const seen = Date.parse(row.last_seen);
      const online = Number.isFinite(seen) && now - seen <= runnerOnlineMs;
      return {
        name: row.name,
        online,
        ...(online
          ? {
              agents: (row.agents ?? []).map((agent) => {
                const task = agent.task_id
                  ? (number.get(agent.task_id) ?? agent.task_id)
                  : "";
                return {
                  name: agent.name || agent.id,
                  ...(agent.kind ? { kind: agent.kind } : {}),
                  state: task ? "working" : agent.waiting ? "waiting" : "idle",
                  ...(task ? { task } : {}),
                  ...(task && agent.step ? { step: clip(agent.step, 80) } : {}),
                  ...(!task && agent.waiting
                    ? { waiting: clip(agent.waiting, 80) }
                    : {}),
                };
              }),
            }
          : {}),
      };
    }),
    people: presence.map((row) => ({
      name: row.user_name || row.handle || "someone",
      client: row.client,
      ...(row.task_id ? { task: number.get(row.task_id) ?? row.task_id } : {}),
      ...(row.note ? { note: clip(row.note, 80) } : {}),
    })),
  };
}

/** Counts by status, leaving out the statuses no task has. */
export function statusCounts(tasks: Task[]): Partial<Record<Status, number>> {
  const counts: Partial<Record<Status, number>> = {};
  for (const status of ["proposed", "todo", "doing", "done"] as const) {
    const count = tasks.filter((task) => task.status === status).length;
    if (count) counts[status] = count;
  }
  return counts;
}
