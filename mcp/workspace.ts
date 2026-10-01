import {
  canConnect,
  ensureLabels,
  event,
  formatReport,
  latestReport,
  launchOrder,
  normalizeCommitUrl,
  normalizeProjectPath,
  normalizeRepositoryUrl,
  openReview,
  projectPaths,
  projectRepository,
  workspaceKind,
  removeProject as removeProjectFromWorkspace,
  removeTask as removeTaskFromWorkspace,
  saveLabel,
  deleteLabel as deleteLabelFromWorkspace,
  taskReferenceId,
  taskRepository,
  uid,
  updateTask,
  type ActivityUsage,
  type ActivityKind,
  type LabelDefinition,
  type Report,
  type Project,
  type Status,
  type Task,
  type Workspace,
} from "../src/domain.ts";
import { makeOrb } from "../src/orb-settings.ts";

/** No objective. An agent can rename a task, move it between projects, label it
 *  and change its status, but the objective is what the task was asked for and
 *  it is edited by a person in the app. Leaving it off the type means a future
 *  tool cannot pass it by accident; the schema on update_task omits it too. */
export type TaskPatch = Partial<
  Pick<Task, "name" | "status" | "labels" | "projectIds">
>;

function lookup<T extends { id: string; name: string }>(
  values: T[],
  identifier: string,
  kind: string,
): T {
  const needle = identifier.trim().toLowerCase();
  const exact = values.filter(
    (value) =>
      value.id.toLowerCase() === needle || value.name.toLowerCase() === needle,
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error(`Ambiguous ${kind}: ${identifier}`);
  throw new Error(`Unknown ${kind}: ${identifier}`);
}

export function findProject(state: Workspace, identifier: string): Project {
  return lookup(state.projects, identifier, "project");
}

export function findLabel(
  state: Workspace,
  identifier: string,
): LabelDefinition {
  return lookup(state.labels, identifier, "label");
}

export function findTask(state: Workspace, identifier: string): Task {
  const needle = identifier.trim().toLowerCase();
  const matches = state.tasks.filter(
    (task) =>
      task.id.toLowerCase() === needle ||
      task.referenceId.toLowerCase() === needle ||
      task.name.toLowerCase() === needle,
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Ambiguous task: ${identifier}`);
  throw new Error(`Unknown task: ${identifier}`);
}

function canonicalLabels(state: Workspace, names: string[]): string[] {
  return [
    ...new Set(
      names.map((name) => {
        const label = state.labels.find(
          (candidate) =>
            candidate.name.toLowerCase() === name.trim().toLowerCase(),
        );
        if (!label) throw new Error(`Unknown label: ${name}`);
        return label.name;
      }),
    ),
  ];
}

function appendAudit(task: Task, text: string, agentName: string): Task {
  return {
    ...task,
    activity: [
      event(text, { author: agentName, authorType: "ai" }),
      ...task.activity,
    ],
  };
}

/** Tasks created here are placed on a grid rather than endlessly to the right.
 *  An agent can create dozens in a single run, and a row that long stretches
 *  the map far past what fit view can frame while every arrow crosses the
 *  tasks between its ends. The first free slot is taken, so a new task never
 *  lands on top of one that is already placed. */
const columnWidth = 380;
const rowHeight = 300;
const gridColumns = 6;

function occupied(state: Workspace, x: number, y: number): boolean {
  return state.tasks.some(
    (task) =>
      Math.abs(task.position.x - x) < columnWidth &&
      Math.abs(task.position.y - y) < rowHeight,
  );
}

function placeTask(state: Workspace, parent?: Task): Task["position"] {
  // A subtask stays beside its parent, stepping down past any sibling there.
  if (parent) {
    const x = parent.position.x + columnWidth;
    let y = parent.position.y + rowHeight;
    while (occupied(state, x, y)) y += rowHeight;
    return { x, y };
  }
  if (!state.tasks.length) return { x: 0, y: 0 };
  const originX = Math.min(...state.tasks.map((task) => task.position.x));
  const originY = Math.min(...state.tasks.map((task) => task.position.y));
  // Rows are unbounded, so a free slot always exists below the placed tasks.
  for (let row = 0; ; row++)
    for (let column = 0; column < gridColumns; column++) {
      const x = originX + column * columnWidth;
      const y = originY + row * rowHeight;
      if (!occupied(state, x, y)) return { x, y };
    }
}

export function createTask(
  state: Workspace,
  input: {
    name: string;
    projects: string[];
    objective?: string;
    status?: Status;
    labels?: string[];
    parent?: string;
  },
  agentName: string,
): { state: Workspace; task: Task } {
  const name = input.name.trim();
  if (!name) throw new Error("A task needs a name.");
  if (!input.projects.length) throw new Error("Choose at least one project.");
  const projectIds = [
    ...new Set(input.projects.map((value) => findProject(state, value).id)),
  ];
  const parent = input.parent ? findTask(state, input.parent) : undefined;
  const labels = canonicalLabels(state, input.labels ?? []);
  const position = placeTask(state, parent);
  const task: Task = {
    id: uid(),
    referenceId: taskReferenceId(state.tasks),
    name,
    projectIds,
    commitUrls: [],
    status: input.status ?? "todo",
    objective: input.objective?.trim() ?? "",
    labels,
    parentId: parent?.id ?? null,
    position,
    activity: [
      event("Task created through MCP", {
        author: agentName,
        authorType: "ai",
      }),
    ],
  };
  return { state: { ...state, tasks: [...state.tasks, task] }, task };
}

export type NewTask = {
  /** A name local to one batch, so later items can point at this one. */
  ref?: string;
  name: string;
  objective?: string;
  projects?: string[];
  labels?: string[];
  status?: Status;
  parent?: string;
  dependsOn?: (string | number)[];
};

/**
 * Creates several tasks in one workspace write. `parent` and `dependsOn`
 * accept a ref from this batch or an existing task's number, ID or name. A
 * task with no projects takes its parent's, or the workspace's only project.
 */
export function createTasks(
  state: Workspace,
  items: NewTask[],
  agentName: string,
): { state: Workspace; created: { ref?: string; task: Task }[] } {
  if (!items.length) throw new Error("Give at least one task.");
  const refs = new Map<string, string>();
  for (const item of items) {
    const ref = item.ref?.trim();
    if (!ref) continue;
    if (refs.has(ref)) throw new Error(`Duplicate ref: ${ref}`);
    refs.set(ref, "");
  }
  const resolve = (current: Workspace, value: string | number) => {
    const key = String(value).trim();
    const local = refs.get(key);
    if (local) return local;
    if (local === "")
      throw new Error(`Ref ${key} is used before the task that defines it.`);
    return findTask(current, key).id;
  };
  let next = state;
  const created: { ref?: string; task: Task }[] = [];
  for (const item of items) {
    const parentId = item.parent ? resolve(next, item.parent) : undefined;
    const parent = parentId
      ? next.tasks.find((task) => task.id === parentId)
      : undefined;
    const projects =
      item.projects ??
      parent?.projectIds ??
      (next.projects.length === 1 ? [next.projects[0].id] : undefined);
    if (!projects?.length)
      throw new Error(`Name the projects for ${item.name}.`);
    const made = createTask(
      next,
      {
        name: item.name,
        projects,
        objective: item.objective,
        status: item.status,
        labels: item.labels,
        parent: parentId,
      },
      agentName,
    );
    next = made.state;
    const ref = item.ref?.trim() || undefined;
    if (ref) refs.set(ref, made.task.id);
    created.push({ ...(ref ? { ref } : {}), task: made.task });
  }
  items.forEach((item, index) => {
    for (const dependency of item.dependsOn ?? [])
      next = addDependency(
        next,
        created[index].task.id,
        resolve(next, dependency),
      ).state;
  });
  return {
    state: next,
    created: created.map((entry) => ({
      ...entry,
      task: findTask(next, entry.task.id),
    })),
  };
}

/**
 * An agent's closing word on a task: one "report" entry in the four labelled
 * lines. A full SHA is kept and linked; anything shorter is left out rather
 * than failing the report, and `commitIgnored` says so.
 */
export function reportTask(
  state: Workspace,
  identifier: string,
  input: Report & { commit?: string },
  agentName: string,
): {
  state: Workspace;
  task: Task;
  commitUrl?: string;
  commitIgnored?: boolean;
} {
  if (!input.done?.trim()) throw new Error("Say what was done.");
  const commit = input.commit?.trim().toLowerCase();
  const valid = !!commit && /^[0-9a-f]{40}$/.test(commit);
  const changed = addActivity(
    state,
    identifier,
    {
      kind: "report",
      summary: formatReport(input),
      ...(valid ? { commit } : {}),
    },
    agentName,
  );
  return { ...changed, ...(commit && !valid ? { commitIgnored: true } : {}) };
}

export function patchTask(
  state: Workspace,
  identifier: string,
  patch: TaskPatch,
  agentName: string,
): { state: Workspace; task: Task } {
  const task = findTask(state, identifier);
  const resolved = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as TaskPatch;
  if (patch.projectIds) {
    resolved.projectIds = [
      ...new Set(patch.projectIds.map((value) => findProject(state, value).id)),
    ];
  }
  if (patch.labels) resolved.labels = canonicalLabels(state, patch.labels);
  let next = updateTask(state, task.id, resolved);
  next = {
    ...next,
    tasks: next.tasks.map((candidate) =>
      candidate.id === task.id
        ? appendAudit(candidate, "Task fields updated through MCP", agentName)
        : candidate,
    ),
  };
  return { state: next, task: findTask(next, task.id) };
}

export function deleteTask(
  state: Workspace,
  identifier: string,
): { state: Workspace; task: Task; removedTasks: Task[] } {
  const task = findTask(state, identifier);
  const next = removeTaskFromWorkspace(state, task.id);
  const remaining = new Set(next.tasks.map((candidate) => candidate.id));
  return {
    state: next,
    task,
    removedTasks: state.tasks.filter(
      (candidate) => !remaining.has(candidate.id),
    ),
  };
}

export function setTaskStatus(
  state: Workspace,
  identifier: string,
  status: Status,
  agentName: string,
): { state: Workspace; task: Task } {
  const task = findTask(state, identifier);
  if (task.status === status) return { state, task };
  let next = updateTask(state, task.id, { status });
  next = {
    ...next,
    tasks: next.tasks.map((candidate) =>
      candidate.id === task.id
        ? appendAudit(
            candidate,
            `Status changed from ${task.status} to ${status}`,
            agentName,
          )
        : candidate,
    ),
  };
  return { state: next, task: findTask(next, task.id) };
}

export function commitLinkFor(
  state: Workspace,
  task: Task,
  commit?: string,
): string | undefined {
  if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) return undefined;
  if (workspaceKind(state) === "everyday") return undefined;
  const project = state.projects.find(
    (candidate) =>
      task.projectIds.includes(candidate.id) &&
      projectRepository(state, candidate),
  );
  if (!project) return undefined;
  return normalizeCommitUrl(
    `${projectRepository(state, project)}/commit/${commit.toLowerCase()}`,
  );
}

function withCommitLinked(task: Task, commitUrl?: string): Task {
  if (!commitUrl || task.commitUrls.includes(commitUrl)) return task;
  return { ...task, commitUrls: [...task.commitUrls, commitUrl] };
}

export function addActivity(
  state: Workspace,
  identifier: string,
  input: {
    kind: ActivityKind;
    summary: string;
    commit?: string;
  },
  agentName: string,
): { state: Workspace; task: Task; commitUrl?: string } {
  const task = findTask(state, identifier);
  const summary = input.summary.trim();
  if (!summary) throw new Error("Activity summary is required.");
  const entry = {
    ...event(summary, { author: agentName, authorType: "ai" }),
    kind: input.kind,
    ...(input.commit !== undefined ? { commit: input.commit } : {}),
  };
  const commitUrl = commitLinkFor(state, task, input.commit);
  const next = {
    ...state,
    tasks: state.tasks.map((candidate) =>
      candidate.id === task.id
        ? withCommitLinked(
            { ...candidate, activity: [entry, ...candidate.activity] },
            commitUrl,
          )
        : candidate,
    ),
  };
  return {
    state: next,
    task: findTask(next, task.id),
    ...(commitUrl ? { commitUrl } : {}),
  };
}

function prerequisiteIds(state: Workspace, task: Task): Set<string> {
  return new Set([
    ...state.links
      .filter((link) => link.target === task.id)
      .map((link) => link.source),
    ...(task.parentId ? [task.parentId] : []),
  ]);
}

export function readyTasks(state: Workspace): Task[] {
  const order = launchOrder(state);
  return state.tasks
    .filter(
      (task) =>
        (task.status === "todo" ||
          (task.status === "done" && !!openReview(task))) &&
        [...prerequisiteIds(state, task)].every(
          (id) =>
            state.tasks.find((candidate) => candidate.id === id)?.status ===
            "done",
        ),
    )
    .sort(
      (left, right) =>
        (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
}

/** What an agent needs to start one task: where the code lives and what the
 *  tasks before it reported. Each upstream task carries its latest report
 *  only (see latestReport), never the runner's own closing lines. */
export function taskBrief(state: Workspace, identifier: string) {
  const task = findTask(state, identifier);
  const order = launchOrder(state);
  const upstreamIds = prerequisiteIds(state, task);
  const review = openReview(task);
  return {
    task: {
      id: task.id,
      referenceId: task.referenceId,
      name: task.name,
      status: task.status,
      objective: task.objective,
    },
    repository: taskRepository(state, task),
    ...(review
      ? {
          review: {
            text: review.text,
            by: review.author,
            at: review.at,
            ...(review.to ? { to: review.to } : {}),
          },
        }
      : {}),
    projects: state.projects
      .filter((project) => task.projectIds.includes(project.id))
      .map((project) => ({
        name: project.name,
        repositoryUrl: projectRepository(state, project),
        folders: projectPaths(project),
      })),
    upstream: state.tasks
      .filter((candidate) => upstreamIds.has(candidate.id))
      .sort(
        (left, right) =>
          (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
      )
      .map((candidate) => {
        const latest = latestReport(candidate);
        return {
          referenceId: candidate.referenceId,
          name: candidate.name,
          status: candidate.status,
          ...(latest ? { report: latest.text } : {}),
          /** The latest report as the one entry, for callers that read
           *  activity[0]; empty when no agent has reported yet. */
          activity: latest
            ? [
                {
                  text: latest.text,
                  author: latest.author,
                  kind: latest.kind,
                  commit: latest.commit,
                },
              ]
            : [],
        };
      }),
  };
}

export function proposeTask(
  state: Workspace,
  input: {
    from: string;
    name: string;
    objective: string;
    projectIds?: string[];
  },
  agentName: string,
): { state: Workspace; task: Task } {
  const source = findTask(state, input.from);
  const name = input.name.trim();
  if (!name) throw new Error("A task needs a name.");
  const projectIdentifiers = input.projectIds ?? source.projectIds;
  if (!projectIdentifiers.length)
    throw new Error("Choose at least one project.");
  const projectIds = [
    ...new Set(
      projectIdentifiers.map((identifier) => findProject(state, identifier).id),
    ),
  ];
  const proposedIds = new Set(
    state.tasks
      .filter(
        (task) => task.status === "proposed" && task.proposedBy === agentName,
      )
      .map((task) => task.id),
  );
  const proposalCount = state.links.filter(
    (link) => link.source === source.id && proposedIds.has(link.target),
  ).length;
  if (proposalCount >= 3)
    throw new Error(
      "An agent can propose at most three tasks from one source.",
    );
  const task: Task = {
    id: uid(),
    referenceId: taskReferenceId(state.tasks),
    name,
    projectIds,
    commitUrls: [],
    status: "proposed",
    proposedBy: agentName,
    objective: input.objective.trim(),
    labels: [],
    parentId: null,
    position: { x: source.position.x, y: source.position.y + 270 },
    activity: [],
  };
  const next = {
    ...state,
    tasks: [
      ...state.tasks.map((candidate) =>
        candidate.id === source.id
          ? appendAudit(
              candidate,
              `Proposed ${task.referenceId} ${task.name}`,
              agentName,
            )
          : candidate,
      ),
      task,
    ],
    links: [...state.links, { id: uid(), source: source.id, target: task.id }],
  };
  return { state: next, task };
}

export function closeTask(
  state: Workspace,
  input: {
    task: string;
    outcome: "done" | "blocked" | "abandoned";
    summary: string;
    commit?: string;
    usage?: ActivityUsage;
  },
  agentName: string,
): { state: Workspace; task: Task; commitUrl?: string } {
  const task = findTask(state, input.task);
  const summary = input.summary.trim();
  if (!summary) throw new Error("A closing summary is required.");
  const entry = {
    ...event(summary, { author: agentName, authorType: "ai" }),
    ...(input.outcome === "blocked" ? { kind: "blocker" as const } : {}),
    ...(input.commit !== undefined ? { commit: input.commit } : {}),
    ...(input.usage !== undefined ? { usage: input.usage } : {}),
  };
  /* Abandoning puts unfinished work back in the queue, but a task that was
     sent back was finished once: dropping it to todo would forget that, and
     it is already queued by the review nobody has answered. */
  const status =
    input.outcome === "done"
      ? "done"
      : input.outcome === "abandoned"
        ? task.status === "done" && openReview(task)
          ? "done"
          : "todo"
        : task.status;
  const commitUrl = commitLinkFor(state, task, input.commit);
  const next = {
    ...state,
    tasks: state.tasks.map((candidate) =>
      candidate.id === task.id
        ? withCommitLinked(
            { ...candidate, status, activity: [entry, ...candidate.activity] },
            commitUrl,
          )
        : candidate,
    ),
  };
  return {
    state: next,
    task: findTask(next, task.id),
    ...(commitUrl ? { commitUrl } : {}),
  };
}

function commitForProject(
  state: Workspace,
  project: Project,
  value: string,
): string {
  if (workspaceKind(state) === "everyday")
    throw new Error("GitHub commits are only available in coding workspaces.");
  const repositoryUrl = projectRepository(state, project);
  if (!repositoryUrl) {
    throw new Error(
      `Project ${project.name} does not have a GitHub repository URL.`,
    );
  }
  const commitUrl = /^[a-fA-F0-9]{40}$/.test(value.trim())
    ? normalizeCommitUrl(`${repositoryUrl}/commit/${value.trim()}`)
    : normalizeCommitUrl(value);
  const expected = normalizeRepositoryUrl(repositoryUrl).toLowerCase();
  const actual = commitUrl
    .slice(0, commitUrl.indexOf("/commit/"))
    .toLowerCase();
  if (actual !== expected) {
    throw new Error(`Commit must belong to ${repositoryUrl}.`);
  }
  return commitUrl;
}

export function linkCommit(
  state: Workspace,
  taskIdentifier: string,
  projectIdentifier: string,
  commit: string,
  agentName: string,
): { state: Workspace; task: Task; commitUrl: string } {
  const task = findTask(state, taskIdentifier);
  const project = findProject(state, projectIdentifier);
  if (!task.projectIds.includes(project.id)) {
    throw new Error(`${task.name} does not belong to project ${project.name}.`);
  }
  const commitUrl = commitForProject(state, project, commit);
  if (task.commitUrls.includes(commitUrl)) return { state, task, commitUrl };
  let next = updateTask(state, task.id, {
    commitUrls: [...task.commitUrls, commitUrl],
  });
  next = {
    ...next,
    tasks: next.tasks.map((candidate) =>
      candidate.id === task.id
        ? appendAudit(
            candidate,
            `Linked GitHub commit ${commitUrl.split("/").at(-1)}`,
            agentName,
          )
        : candidate,
    ),
  };
  return { state: next, task: findTask(next, task.id), commitUrl };
}

export function unlinkCommit(
  state: Workspace,
  taskIdentifier: string,
  commit: string,
  agentName: string,
): { state: Workspace; task: Task } {
  const task = findTask(state, taskIdentifier);
  const needle = commit.trim().toLowerCase();
  const commitUrl = task.commitUrls.find(
    (url) =>
      url.toLowerCase() === needle ||
      url.split("/").at(-1)?.toLowerCase() === needle,
  );
  if (!commitUrl) throw new Error("That commit is not linked to the task.");
  let next = updateTask(state, task.id, {
    commitUrls: task.commitUrls.filter((url) => url !== commitUrl),
  });
  next = {
    ...next,
    tasks: next.tasks.map((candidate) =>
      candidate.id === task.id
        ? appendAudit(
            candidate,
            `Unlinked GitHub commit ${commitUrl.split("/").at(-1)}`,
            agentName,
          )
        : candidate,
    ),
  };
  return { state: next, task: findTask(next, task.id) };
}

export function addDependency(
  state: Workspace,
  taskIdentifier: string,
  dependencyIdentifier: string,
): { state: Workspace; task: Task; dependency: Task } {
  const task = findTask(state, taskIdentifier);
  const dependency = findTask(state, dependencyIdentifier);
  if (!canConnect(state, dependency.id, task.id)) {
    throw new Error(
      "That dependency is duplicated, self-referential, or would create a cycle.",
    );
  }
  return {
    state: {
      ...state,
      links: [
        ...state.links,
        { id: uid(), source: dependency.id, target: task.id },
      ],
    },
    task,
    dependency,
  };
}

export function removeDependency(
  state: Workspace,
  taskIdentifier: string,
  dependencyIdentifier: string,
): { state: Workspace; task: Task; dependency: Task } {
  const task = findTask(state, taskIdentifier);
  const dependency = findTask(state, dependencyIdentifier);
  const matches = state.links.filter(
    (link) => link.source === dependency.id && link.target === task.id,
  );
  if (!matches.length) throw new Error("That dependency does not exist.");
  const ids = new Set(matches.map((link) => link.id));
  return {
    state: { ...state, links: state.links.filter((link) => !ids.has(link.id)) },
    task,
    dependency,
  };
}

export function createLabel(state: Workspace, name: string): Workspace {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A label needs a name.");
  if (
    state.labels.some(
      (label) => label.name.toLowerCase() === trimmed.toLowerCase(),
    )
  ) {
    throw new Error(`Label already exists: ${trimmed}`);
  }
  return ensureLabels(state, [trimmed]);
}

export function updateLabel(
  state: Workspace,
  identifier: string,
  input: { name?: string; color?: string },
): { state: Workspace; label: LabelDefinition } {
  const previous = findLabel(state, identifier);
  const name = input.name?.trim() ?? previous.name;
  if (!name) throw new Error("A label needs a name.");
  if (
    state.labels.some(
      (label) =>
        label.id !== previous.id &&
        label.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new Error(`Label already exists: ${name}`);
  }
  if (input.color && !/^#[0-9a-f]{6}$/i.test(input.color))
    throw new Error("Use a six-digit hex color.");
  const label: LabelDefinition = {
    ...previous,
    name,
    ...(input.color ? { color: input.color, orb: makeOrb(input.color) } : {}),
  };
  const next = saveLabel(state, label);
  return { state: next, label: findLabel(next, label.id) };
}

export function deleteLabel(
  state: Workspace,
  identifier: string,
): { state: Workspace; label: LabelDefinition } {
  const label = findLabel(state, identifier);
  return { state: deleteLabelFromWorkspace(state, label.id), label };
}

export function createProject(
  state: Workspace,
  input: {
    name: string;
    repositoryUrl?: string;
    color?: string;
    folders?: string[];
  },
): { state: Workspace; project: Project } {
  if (workspaceKind(state) === "everyday" && input.folders !== undefined)
    throw new Error("Project folders are only available in coding workspaces.");
  if (workspaceKind(state) === "everyday" && input.repositoryUrl)
    throw new Error("Everyday projects do not connect a GitHub repository.");
  const name = input.name.trim();
  if (!name) throw new Error("A project needs a name.");
  if (
    state.projects.some(
      (project) => project.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new Error(`Project already exists: ${name}`);
  }
  const color = input.color ?? "#669df6";
  if (!/^#[0-9a-f]{6}$/i.test(color))
    throw new Error("Use a six-digit hex color.");
  const folders = normalizeProjectFolders(input.folders ?? []);
  const project = setProjectFolders(
    {
      id: uid(),
      name,
      color,
      orb: makeOrb(color),
      repositoryUrl: input.repositoryUrl
        ? normalizeRepositoryUrl(input.repositoryUrl)
        : "",
    },
    folders,
  );
  return {
    state: { ...state, projects: [...state.projects, project] },
    project,
  };
}

export function updateProject(
  state: Workspace,
  identifier: string,
  input: {
    name?: string;
    repositoryUrl?: string;
    color?: string;
    folders?: string[];
  },
): { state: Workspace; project: Project } {
  if (workspaceKind(state) === "everyday" && input.folders !== undefined)
    throw new Error("Project folders are only available in coding workspaces.");
  if (workspaceKind(state) === "everyday" && input.repositoryUrl)
    throw new Error("Everyday projects do not connect a GitHub repository.");
  const previous = findProject(state, identifier);
  const name = input.name?.trim() ?? previous.name;
  if (!name) throw new Error("A project needs a name.");
  if (
    state.projects.some(
      (project) =>
        project.id !== previous.id &&
        project.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new Error(`Project already exists: ${name}`);
  }
  if (input.color && !/^#[0-9a-f]{6}$/i.test(input.color))
    throw new Error("Use a six-digit hex color.");
  let project: Project = {
    ...previous,
    name,
    ...(input.color ? { color: input.color, orb: makeOrb(input.color) } : {}),
    ...(input.repositoryUrl !== undefined
      ? { repositoryUrl: normalizeRepositoryUrl(input.repositoryUrl) }
      : {}),
  };
  if (input.folders !== undefined)
    project = setProjectFolders(
      project,
      normalizeProjectFolders(input.folders),
    );
  return {
    state: {
      ...state,
      projects: state.projects.map((candidate) =>
        candidate.id === project.id ? project : candidate,
      ),
    },
    project,
  };
}

export function deleteProject(
  state: Workspace,
  identifier: string,
): { state: Workspace; project: Project; removedTasks: Task[] } {
  const project = findProject(state, identifier);
  const next = removeProjectFromWorkspace(state, project.id);
  const remaining = new Set(next.tasks.map((task) => task.id));
  return {
    state: next,
    project,
    removedTasks: state.tasks.filter((task) => !remaining.has(task.id)),
  };
}

export function configureProjectRepository(
  state: Workspace,
  identifier: string,
  input: { repositoryUrl?: string },
): { state: Workspace; project: Project } {
  if (workspaceKind(state) === "everyday")
    throw new Error(
      "Repository configuration is only available in coding workspaces.",
    );
  const previous = findProject(state, identifier);
  const project = {
    ...previous,
    ...(input.repositoryUrl !== undefined
      ? { repositoryUrl: normalizeRepositoryUrl(input.repositoryUrl) }
      : {}),
  };
  return {
    state: {
      ...state,
      projects: state.projects.map((p) => (p.id === project.id ? project : p)),
    },
    project,
  };
}

function normalizeProjectFolders(values: string[]): string[] {
  const folders: string[] = [];
  for (const value of values) {
    const folder = normalizeProjectPath(value);
    if (!folder) continue;
    if (folder.length > 200 || folder.split("/").includes(".."))
      throw new Error(
        "Folders are repository-relative paths of up to 200 characters.",
      );
    if (!folders.includes(folder)) folders.push(folder);
  }
  return folders;
}

function setProjectFolders(project: Project, folders: string[]): Project {
  if (folders.length > 50)
    throw new Error("A project can own at most 50 folders.");
  const { paths: _paths, ...withoutPaths } = project;
  return folders.length ? { ...withoutPaths, paths: folders } : withoutPaths;
}

export function configureProjectFolders(
  state: Workspace,
  identifier: string,
  input: { add?: string[]; remove?: string[]; replace?: string[] },
): { state: Workspace; project: Project } {
  if (workspaceKind(state) === "everyday")
    throw new Error("Project folders are only available in coding workspaces.");
  const previous = findProject(state, identifier);
  const folders = normalizeProjectFolders(
    input.replace ?? previous.paths ?? [],
  );
  for (const folder of normalizeProjectFolders(input.add ?? []))
    if (!folders.includes(folder)) folders.push(folder);
  const removed = new Set(normalizeProjectFolders(input.remove ?? []));
  const project = setProjectFolders(
    previous,
    folders.filter((folder) => !removed.has(folder)),
  );
  return {
    state: {
      ...state,
      projects: state.projects.map((candidate) =>
        candidate.id === project.id ? project : candidate,
      ),
    },
    project,
  };
}
