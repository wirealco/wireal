import {
  defaultStatusOrbs,
  makeOrb,
  validOrb,
  wholeMapOrb,
  type OrbSettings,
} from "./orb-settings";
export type Status = "proposed" | "todo" | "doing" | "done";
export const statuses: Record<Status, string> = {
  proposed: "Proposed",
  todo: "To do",
  doing: "Doing",
  done: "Done",
};
export type Project = {
  id: string;
  name: string;
  color: string;
  repositoryUrl: string;
  paths?: string[];
  orb: OrbSettings;
};
export function normalizeProjectPath(input: string): string {
  let path = input.trim().replace(/\/{2,}/g, "/");
  while (path.startsWith("./") || path.startsWith("/"))
    path = path.startsWith("./") ? path.slice(2) : path.slice(1);
  return path.replace(/\/+$/g, "");
}
export function projectPaths(project: Pick<Project, "paths">): string[] {
  return [
    ...new Set((project.paths ?? []).map(normalizeProjectPath).filter(Boolean)),
  ];
}
export type LabelDefinition = {
  id: string;
  name: string;
  orb: OrbSettings;
  color?: string;
};
export const activityKinds = [
  "change",
  "discovery",
  "decision",
  "verification",
  "blocker",
  "review",
  "report",
] as const;
export type ActivityKind = (typeof activityKinds)[number];
export const reportedKinds = [
  "change",
  "discovery",
  "decision",
  "verification",
  "blocker",
  "report",
] as const satisfies readonly ActivityKind[];
/** An agent's closing report is one entry of kind "report" in four labelled
 *  lines, so a person coming back reads the same shape on every task. */
export const reportFields = ["done", "where", "next", "blocked"] as const;
export type ReportField = (typeof reportFields)[number];
export type Report = Partial<Record<ReportField, string>>;
const reportLabels: Record<ReportField, string> = {
  done: "Done",
  where: "Where",
  next: "Next",
  blocked: "Blocked",
};
export function formatReport(report: Report): string {
  return reportFields
    .filter((field) => report[field]?.trim())
    .map((field) => `${reportLabels[field]}: ${report[field]!.trim()}`)
    .join("\n");
}
export function parseReport(text: string): Report {
  const report: Report = {};
  let current: ReportField | null = null;
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(done|where|next|blocked)\s*:\s*(.*)$/i.exec(line);
    if (match) {
      current = match[1].toLowerCase() as ReportField;
      report[current] = match[2].trim();
    } else if (current && line.trim())
      report[current] = `${report[current]} ${line.trim()}`.trim();
  }
  return report;
}
export type UsageWindow = { start?: number; end?: number };
export type ActivityUsage = {
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  durationMs?: number;
  windows?: { fiveHour?: UsageWindow; sevenDay?: UsageWindow };
};
export type Activity = {
  id: string;
  text: string;
  at: string;
  author: string;
  authorType: "user" | "ai";
  authorId?: string;
  kind?: ActivityKind;
  to?: string;
  commit?: string;
  usage?: ActivityUsage;
};
export type Task = {
  id: string;
  referenceId: string;
  name: string;
  projectIds: string[];
  commitUrls: string[];
  status: Status;
  proposedBy?: string;
  objective: string;
  labels: string[];
  parentId: string | null;
  position: { x: number; y: number };
  activity: Activity[];
  /** The workflows this task belongs to, by id. Left out when it is in none. */
  workflowIds?: string[];
};
/** The review a done task is still waiting on, if it has one. A review is
 *  answered by the next thing an agent says on the task, so a task carries at
 *  most one open review and a person's own notes never close it. Two entries
 *  written in the same millisecond are ordered by where they sit in the list,
 *  which is newest first everywhere an entry is written. */
export function openReview(task: Pick<Task, "activity">): Activity | undefined {
  const at = (entry: Activity) => Date.parse(entry.at) || 0;
  const place = new Map(task.activity.map((entry, index) => [entry, index]));
  const newer = (left: Activity, right: Activity) =>
    at(left) === at(right)
      ? (place.get(left) ?? 0) < (place.get(right) ?? 0)
      : at(left) > at(right);
  const review = task.activity
    .filter((entry) => entry.kind === "review")
    .reduce<Activity | undefined>(
      (newest, entry) => (!newest || newer(entry, newest) ? entry : newest),
      undefined,
    );
  if (!review) return undefined;
  const answered = task.activity.some(
    (entry) =>
      entry.authorType === "ai" &&
      entry.kind !== "review" &&
      newer(entry, review),
  );
  return answered ? undefined : review;
}
/** What the last agent said it did, for the next agent and for a person
 *  coming back: the newest report, or failing that the newest change note an
 *  agent wrote. The runner's own closing lines ("Done in 4 min…", "Merged
 *  into main…") carry no kind and are never picked. */
export function latestReport(
  task: Pick<Task, "activity">,
): Activity | undefined {
  const newest = (kind: ActivityKind) =>
    task.activity
      .filter((entry) => entry.authorType === "ai" && entry.kind === kind)
      .reduce<Activity | undefined>(
        (best, entry) =>
          !best || (Date.parse(entry.at) || 0) > (Date.parse(best.at) || 0)
            ? entry
            : best,
        undefined,
      );
  return newest("report") ?? newest("change");
}
export function sendBack(
  state: Workspace,
  taskId: string,
  input: { text: string; to?: string },
  author: Pick<Activity, "author" | "authorType" | "authorId">,
): Workspace {
  const text = input.text.trim();
  if (!text) throw new Error("Write what is wrong with the work.");
  const to = input.to?.trim();
  const entry: Activity = {
    ...event(text, author),
    kind: "review",
    ...(to ? { to } : {}),
  };
  return {
    ...state,
    tasks: state.tasks.map((task) =>
      task.id === taskId
        ? { ...task, activity: [entry, ...task.activity] }
        : task,
    ),
  };
}
export type Link = {
  id: string;
  source: string;
  target: string;
};
/** A named group of tasks that cuts across the board, the way an epic does in
 *  other trackers. Its members glow in its colour on the canvas, it can filter
 *  the board down to itself, and an agent dropped on it takes its open tasks. */
export type Workflow = {
  id: string;
  name: string;
  color: string;
};
/** How the workspace's projects relate to GitHub. In a monorepo every project
 *  is a subfolder of one repository and declares which folders it owns; in a
 *  multirepo each project carries its own repository. Older workspaces have no
 *  setting: a workspace repository means monorepo, and its absence means each
 *  project brought its own, which is what the two branches already did. */
export type RepositoryLayout = "monorepo" | "multirepo";
export const repositoryLayouts: RepositoryLayout[] = ["monorepo", "multirepo"];
export type WorkspaceKind = "coding" | "everyday";
export function workspaceKind(state: Workspace): WorkspaceKind {
  return state.map.kind ?? "coding";
}
export type AgentMode = "paused" | "directed" | "automatic";
export type AgentKind = "claude" | "codex";
/** An agent on the workspace's list. A runner writes its own: one per CLI it
 *  finds, named after itself and marked with its id in `runner`. Entries
 *  without `runner` were made by hand before that and still work. `model` and
 *  `brief` are read from older entries but nothing needs them. */
export type AgentSpec = {
  id: string;
  name: string;
  kind: AgentKind;
  model?: string;
  brief?: string;
  pauseAbovePercent?: number;
  enabled: boolean;
  /** The runner that provisioned this agent and seats it on itself. */
  runner?: string;
};
/** A name that already says its brand, as runners' agents did before they
 *  were numbered ("Studio · Claude"), is shown as it is rather than behind the
 *  brand again. */
export function namesBrand(name: string, brand: string): boolean {
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${brand}($|[^\\p{L}\\p{N}])`,
    "iu",
  ).test(name);
}
export type MergePolicy = "merge" | "branch";
export type AgentSettings = {
  mode: AgentMode;
  mergePolicy?: MergePolicy;
  agentBranch?: string;
  roster?: AgentSpec[];
  leaseMinutes: number;
  pauseAbovePercent?: number;
  /** The mode a pause from someone's own CLI (the MCP `runner` tool)
   *  interrupted, which its `resume` goes back to. */
  pausedFrom?: AgentMode;
};
export const defaultAgentSettings: AgentSettings = {
  mode: "automatic",
  leaseMinutes: 5,
};
export function agentSettings(state: Workspace): AgentSettings {
  return { ...defaultAgentSettings, ...(state.map.agents ?? {}) };
}
export function mergePolicyOf(settings: AgentSettings): MergePolicy {
  return settings.mergePolicy && settings.mergePolicy !== "merge"
    ? "branch"
    : "merge";
}
export function agentBranchOf(settings: AgentSettings): string {
  const name = (settings.agentBranch ?? "").trim();
  if (!name || name.length > 200) return "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)) return "";
  if (name.includes("..") || name.includes("//") || name.endsWith(".lock"))
    return "";
  return name;
}
export type MapSettings = {
  kind?: WorkspaceKind;
  name: string;
  repositoryUrl: string;
  orb: OrbSettings;
  repositoryLayout?: RepositoryLayout;
  agents?: AgentSettings;
};
export type Workspace = {
  version: 9;
  map: MapSettings;
  projects: Project[];
  labels: LabelDefinition[];
  statusOrbs: Record<Status, OrbSettings>;
  tasks: Task[];
  links: Link[];
  /** Optional so every workspace written before workflows still reads. */
  workflows?: Workflow[];
};
export const uid = () => crypto.randomUUID();
/** Tasks are numbered 1, 2, 3 within a workspace. A random WRL-XXXX-XXXX-XXXX
 *  was unique across every workspace at once, which nothing needed and nobody
 *  could hold in their head or say out loud. Numbering is per workspace, so two
 *  workspaces both have a 1 — the workspace is already the context. */
export const taskReferenceId = (
  tasks: readonly { referenceId: string }[] = [],
) => {
  const highest = tasks.reduce((top, task) => {
    const value = Number(task.referenceId);
    return Number.isSafeInteger(value) && value > top ? value : top;
  }, 0);
  // Highest rather than count, so deleting task 3 of 3 does not hand its number
  // to the next one and leave two tasks that were both ever called 3.
  return String(highest + 1);
};
export function taskIdLabel(referenceId: string): string {
  return `WRL·${referenceId}`;
}

const validReferenceId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,8}$/.test(value);
export const event = (
  text: string,
  author: Pick<Activity, "author" | "authorType" | "authorId"> = {
    author: "Wireal AI",
    authorType: "ai",
  },
): Activity => ({
  id: uid(),
  text,
  at: new Date().toISOString(),
  ...author,
});
export function canConnect(
  state: Workspace,
  source: string,
  target: string,
): boolean {
  const a = state.tasks.find((t) => t.id === source),
    b = state.tasks.find((t) => t.id === target);
  if (!a || !b || source === target) return false;
  const edges = [
    ...state.links,
    ...state.tasks
      .filter((t) => t.parentId)
      .map((t) => ({ source: t.parentId!, target: t.id })),
  ];
  if (edges.some((e) => e.source === source && e.target === target))
    return false;
  const visited = new Set<string>();
  const reaches = (id: string): boolean => {
    if (id === source) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return edges.filter((e) => e.source === id).some((e) => reaches(e.target));
  };
  return !reaches(target);
}
/** The two kinds of connection a board draws. A dependency is a row in
 *  `links`; a subtask is the child's `parentId`, so its edge id is derived and
 *  not stored anywhere. */
export type ConnectionKind = "dependency" | "subtask";
const subtaskEdgePrefix = "parent-";

export function connectionKind(
  state: Workspace,
  edgeId: string,
): ConnectionKind | null {
  if (edgeId.startsWith(subtaskEdgePrefix)) {
    const childId = edgeId.slice(subtaskEdgePrefix.length);
    return state.tasks.some((task) => task.id === childId && task.parentId)
      ? "subtask"
      : null;
  }
  return state.links.some((link) => link.id === edgeId) ? "dependency" : null;
}

/**
 * Turn one connection into the other kind, in place, keeping the same two tasks
 * and the same direction. Converting can never create a cycle: the pair being
 * connected does not change, so the graph keeps the shape it already passed
 * `canConnect` with — and adopting a task that already had a parent removes an
 * edge rather than adding one.
 */
export function setConnectionKind(
  state: Workspace,
  edgeId: string,
  kind: ConnectionKind,
  author?: Pick<Activity, "author" | "authorType" | "authorId">,
): Workspace {
  const current = connectionKind(state, edgeId);
  if (!current) throw new Error("That connection no longer exists.");
  if (current === kind) return state;

  const note = (taskId: string, text: string) => (tasks: Task[]) =>
    tasks.map((task) =>
      task.id === taskId
        ? { ...task, activity: [event(text, author), ...task.activity] }
        : task,
    );

  if (current === "dependency") {
    const link = state.links.find((item) => item.id === edgeId)!;
    return {
      ...state,
      links: state.links.filter((item) => item.id !== edgeId),
      tasks: note(
        link.target,
        "Changed connection from dependency to subtask",
      )(
        state.tasks.map((task) =>
          task.id === link.target ? { ...task, parentId: link.source } : task,
        ),
      ),
    };
  }

  const childId = edgeId.slice(subtaskEdgePrefix.length);
  const child = state.tasks.find((task) => task.id === childId)!;
  return {
    ...state,
    links: [
      ...state.links,
      { id: uid(), source: child.parentId!, target: child.id },
    ],
    tasks: note(
      child.id,
      "Changed connection from subtask to dependency",
    )(
      state.tasks.map((task) =>
        task.id === child.id ? { ...task, parentId: null } : task,
      ),
    ),
  };
}

export function updateTask(
  state: Workspace,
  id: string,
  patch: Partial<
    Pick<
      Task,
      "name" | "objective" | "status" | "labels" | "projectIds" | "commitUrls"
    >
  >,
  /** What was done, written as the activity entry the task keeps. Left out,
   *  the edit is silent — the MCP helpers write their own attributed audit. */
  message?: string,
  /** Who did it. The entry is what a card reads to say who has worked on the
   *  task, so an edit made in the app carries the signed-in person. */
  author?: Pick<Activity, "author" | "authorType" | "authorId">,
): Workspace {
  if (patch.name !== undefined && !patch.name.trim())
    throw new Error("A task needs a name.");
  if (
    patch.projectIds &&
    (!patch.projectIds.length ||
      patch.projectIds.some((id) => !state.projects.some((p) => p.id === id)))
  )
    throw new Error("Choose at least one project.");
  if (patch.commitUrls)
    patch = {
      ...patch,
      commitUrls: [...new Set(patch.commitUrls.map(normalizeCommitUrl))],
    };
  return {
    ...state,
    tasks: state.tasks.map((t) =>
      t.id === id
        ? {
            ...t,
            ...patch,
            activity: message
              ? [event(message, author), ...t.activity]
              : t.activity,
          }
        : t,
    ),
  };
}
export function removeTask(state: Workspace, id: string): Workspace {
  const removed = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of state.tasks)
      if (
        task.parentId &&
        removed.has(task.parentId) &&
        !removed.has(task.id)
      ) {
        removed.add(task.id);
        changed = true;
      }
  }
  return {
    ...state,
    tasks: state.tasks.filter((t) => !removed.has(t.id)),
    links: state.links.filter(
      (e) => !removed.has(e.source) && !removed.has(e.target),
    ),
  };
}
export function launchOrder(state: Workspace): Map<string, number> {
  const tasks = [...state.tasks];
  const byPosition = (a: Task, b: Task) =>
    a.position.x - b.position.x ||
    a.position.y - b.position.y ||
    Number(a.referenceId) - Number(b.referenceId);
  const inbound = new Map(tasks.map((task) => [task.id, 0]));
  const outgoing = new Map(tasks.map((task) => [task.id, [] as string[]]));
  const seen = new Set<string>();
  const connections = [
    ...state.links,
    ...tasks
      .filter((task) => task.parentId)
      .map((task) => ({ source: task.parentId!, target: task.id })),
  ];
  for (const connection of connections) {
    const key = `${connection.source}:${connection.target}`;
    if (
      !inbound.has(connection.source) ||
      !inbound.has(connection.target) ||
      seen.has(key)
    )
      continue;
    seen.add(key);
    outgoing.get(connection.source)!.push(connection.target);
    inbound.set(connection.target, inbound.get(connection.target)! + 1);
  }
  const ready = tasks
    .filter((task) => inbound.get(task.id) === 0)
    .sort(byPosition);
  const order = new Map<string, number>();
  while (ready.length) {
    const task = ready.shift()!;
    order.set(task.id, order.size + 1);
    for (const target of outgoing.get(task.id) ?? []) {
      const remaining = inbound.get(target)! - 1;
      inbound.set(target, remaining);
      if (remaining === 0) {
        ready.push(tasks.find((item) => item.id === target)!);
        ready.sort(byPosition);
      }
    }
  }
  return order;
}
function normalizeUsage(value: unknown): ActivityUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as ActivityUsage;
  const usage: ActivityUsage = {};
  for (const key of [
    "costUsd",
    "inputTokens",
    "outputTokens",
    "durationMs",
  ] as const)
    if (Number.isFinite(raw[key])) usage[key] = raw[key];
  if (typeof raw.model === "string" && raw.model.trim())
    usage.model = raw.model;
  const windows = normalizeWindows(raw.windows);
  if (windows) usage.windows = windows;
  return Object.keys(usage).length ? usage : undefined;
}
function normalizeWindows(
  value: unknown,
): NonNullable<ActivityUsage["windows"]> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const windows: NonNullable<ActivityUsage["windows"]> = {};
  for (const key of ["fiveHour", "sevenDay"] as const) {
    const window = raw[key];
    if (!window || typeof window !== "object") continue;
    const clean: UsageWindow = {};
    for (const edge of ["start", "end"] as const) {
      const percent = (window as Record<string, unknown>)[edge];
      if (typeof percent === "number" && Number.isFinite(percent))
        clean[edge] = percent;
    }
    if (Object.keys(clean).length) windows[key] = clean;
  }
  return Object.keys(windows).length ? windows : undefined;
}
function normalizeActivity(entry: Activity): Activity {
  const { id, text, at, author, authorType, authorId } = entry;
  const clean: Activity = { id, text, at, author, authorType };
  if (authorId !== undefined) clean.authorId = authorId;
  if (entry.kind && activityKinds.includes(entry.kind)) clean.kind = entry.kind;
  if (typeof entry.to === "string" && entry.to.trim())
    clean.to = entry.to.trim().slice(0, 200);
  if (typeof entry.commit === "string" && /^[0-9a-f]{7,40}$/.test(entry.commit))
    clean.commit = entry.commit;
  const usage = normalizeUsage(entry.usage);
  if (usage) clean.usage = usage;
  return clean;
}
export function parseWorkspace(raw: unknown): Workspace {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (
    parsed?.version === 1 &&
    Array.isArray(parsed.projects) &&
    Array.isArray(parsed.tasks)
  ) {
    parsed.version = 2;
    parsed.projects = parsed.projects.map((p: Project) => ({
      ...p,
      repositoryUrl: "",
    }));
    parsed.tasks = parsed.tasks.map((t: Task & { projectId: string }) => {
      const { projectId, ...rest } = t;
      return { ...rest, projectIds: [projectId], commitUrls: [] };
    });
  }
  const value = parsed as Workspace;
  if (
    parsed?.version === 2 &&
    Array.isArray(parsed.projects) &&
    Array.isArray(parsed.tasks)
  ) {
    parsed.version = 3;
    parsed.projects = parsed.projects.map(
      (p: Project & { category?: string }) => {
        const { category: _, ...project } = p;
        return { ...project, orb: makeOrb(p.color) };
      },
    );
    const names = [
      ...new Set([
        "Bug",
        "Improvement",
        "New feature",
        ...parsed.tasks.flatMap((t: Task) => t.labels),
      ]),
    ];
    parsed.labels = names.map((name, index) => ({
      id: `label-${index}`,
      name,
      orb: makeOrb(["#ef6387", "#408cff", "#45d797", "#ffb33e"][index % 4]),
    }));
    parsed.statusOrbs = structuredClone(defaultStatusOrbs);
  }
  if (parsed?.version === 3) {
    parsed.version = 4;
    parsed.map = { name: "Map", orb: structuredClone(wholeMapOrb) };
  }
  if (parsed?.version === 4 && Array.isArray(parsed.tasks)) {
    parsed.version = 5;
    parsed.tasks = parsed.tasks.map((task: Task) => ({
      ...task,
      referenceId: task.referenceId,
    }));
  }
  if (parsed?.version === 5 && Array.isArray(parsed.tasks)) {
    parsed.version = 6;
    parsed.tasks = parsed.tasks.map((task: Task) => ({
      ...task,
      objective: typeof task.objective === "string" ? task.objective : "",
      activity: Array.isArray(task.activity)
        ? task.activity.map((item: Activity) => ({
            ...item,
            author:
              typeof item.author === "string" && item.author.trim()
                ? item.author
                : "Wireal AI",
            authorType: item.authorType === "user" ? "user" : "ai",
          }))
        : [],
    }));
  }
  if (parsed?.version === 6 && parsed.map) {
    parsed.version = 7;
    parsed.map = { ...parsed.map, repositoryUrl: "" };
  }
  if (parsed?.version === 7 && Array.isArray(parsed.tasks)) {
    parsed.version = 8;
    // Renumbered in the order they sit on the board, so the numbers read the
    // way the workspace already reads. Every task is renumbered, including any
    // that already looked like a number, so no two end up sharing one.
    const ordered = [...parsed.tasks].sort(
      (a: Task, b: Task) =>
        a.position.x - b.position.x ||
        a.position.y - b.position.y ||
        String(a.referenceId).localeCompare(String(b.referenceId)),
    );
    const numbers = new Map(
      ordered.map((task: Task, index: number) => [task.id, String(index + 1)]),
    );
    parsed.tasks = parsed.tasks.map((task: Task) => ({
      ...task,
      referenceId: numbers.get(task.id)!,
    }));
  }
  if (parsed?.version === 8) {
    parsed.version = 9;
    parsed.statusOrbs = {
      ...parsed.statusOrbs,
      proposed:
        parsed.statusOrbs?.proposed ??
        structuredClone(defaultStatusOrbs.proposed),
    };
  }
  if (parsed?.statusOrbs && typeof parsed.statusOrbs === "object") {
    for (const status of Object.keys(statuses) as Status[])
      parsed.statusOrbs[status] ??= structuredClone(defaultStatusOrbs[status]);
  }
  // Older saved workspaces used HeroUI variant names for label colors. Swatches
  // require a real CSS color, so repair those values while loading the backup.
  if (Array.isArray(parsed?.labels)) {
    parsed.labels = parsed.labels.map((label: LabelDefinition) => ({
      ...label,
      color:
        typeof label.color === "string" && /^#[0-9a-f]{6}$/i.test(label.color)
          ? label.color
          : "#a1a1aa",
    }));
  }
  const validString = (v: unknown): v is string =>
    typeof v === "string" && v.trim().length > 0;
  if (
    value?.version !== 9 ||
    !Array.isArray(value.projects) ||
    !Array.isArray(value.tasks) ||
    !Array.isArray(value.links)
  )
    throw new Error("Invalid Wireal backup.");
  if (
    !value.map ||
    !validString(value.map.name) ||
    typeof value.map.repositoryUrl !== "string" ||
    (value.map.kind !== undefined &&
      !["coding", "everyday"].includes(value.map.kind)) ||
    (value.map.repositoryUrl && !isValidRepository(value.map.repositoryUrl)) ||
    (value.map.repositoryLayout !== undefined &&
      !repositoryLayouts.includes(value.map.repositoryLayout)) ||
    !validOrb(value.map.orb)
  )
    throw new Error("Invalid workspace settings.");
  if (
    !value.projects.every(
      (p) =>
        p &&
        validString(p.id) &&
        validString(p.name) &&
        /^#[0-9a-f]{6}$/i.test(p.color) &&
        typeof p.repositoryUrl === "string" &&
        (p.paths === undefined ||
          (Array.isArray(p.paths) &&
            p.paths.length <= 50 &&
            p.paths.every(
              (path) =>
                typeof path === "string" &&
                path.trim().length >= 1 &&
                path.trim().length <= 200 &&
                !path.trim().split("/").includes(".."),
            ))) &&
        validOrb(p.orb) &&
        (!p.repositoryUrl || isValidRepository(p.repositoryUrl)),
    )
  )
    throw new Error("Invalid project data.");
  if (
    !Array.isArray(value.labels) ||
    !value.labels.every(
      (l) =>
        l &&
        validString(l.id) &&
        validString(l.name) &&
        validOrb(l.orb) &&
        typeof l.color === "string" &&
        /^#[0-9a-f]{6}$/i.test(l.color),
    ) ||
    new Set(value.labels.map((l) => l.id)).size !== value.labels.length ||
    new Set(value.labels.map((l) => l.name.toLowerCase())).size !==
      value.labels.length
  )
    throw new Error("Invalid label data.");
  if (
    !value.statusOrbs ||
    !Object.keys(statuses).every((s) => validOrb(value.statusOrbs[s as Status]))
  )
    throw new Error("Invalid status colors.");
  const projects = new Set(value.projects.map((p) => p.id)),
    tasks = new Set(value.tasks.map((t) => t?.id));
  if (
    projects.size !== value.projects.length ||
    tasks.size !== value.tasks.length ||
    new Set(value.tasks.map((task) => task.referenceId)).size !==
      value.tasks.length
  )
    throw new Error("Duplicate IDs in backup.");
  if (
    !value.tasks.every(
      (t) =>
        t &&
        validString(t.id) &&
        validReferenceId(t.referenceId) &&
        validString(t.name) &&
        typeof t.objective === "string" &&
        Array.isArray(t.projectIds) &&
        t.projectIds.length > 0 &&
        new Set(t.projectIds).size === t.projectIds.length &&
        t.projectIds.every((id) => projects.has(id)) &&
        Array.isArray(t.commitUrls) &&
        t.commitUrls.every(isValidCommit) &&
        Object.hasOwn(statuses, t.status) &&
        Array.isArray(t.labels) &&
        t.labels.every(validString) &&
        t.labels.every((name) => value.labels.some((l) => l.name === name)) &&
        (t.parentId === null || tasks.has(t.parentId)) &&
        Number.isFinite(t.position?.x) &&
        Number.isFinite(t.position?.y) &&
        Array.isArray(t.activity) &&
        t.activity.every(
          (a) =>
            a &&
            validString(a.id) &&
            validString(a.text) &&
            validString(a.author) &&
            (a.authorType === "user" || a.authorType === "ai") &&
            Number.isFinite(Date.parse(a.at)),
        ),
    )
  )
    throw new Error("Invalid task data.");
  value.tasks = value.tasks.map((task) => ({
    ...task,
    activity: task.activity.map(normalizeActivity),
  }));
  const graph: Workspace = {
    ...value,
    links: [],
    tasks: value.tasks.map((t) => ({ ...t, parentId: null })),
  };
  for (const t of value.tasks)
    if (t.parentId) {
      if (!canConnect(graph, t.parentId, t.id))
        throw new Error("Invalid subtask hierarchy.");
      graph.tasks = graph.tasks.map((n) =>
        n.id === t.id ? { ...n, parentId: t.parentId } : n,
      );
    }
  const linkIds = new Set<string>();
  for (const e of value.links) {
    const legacy = e as Link & {
      sourceHandle?: unknown;
      targetHandle?: unknown;
    };
    const legacyHandle = (handle: unknown) =>
      handle === undefined ||
      (typeof handle === "string" &&
        ["left", "right", "top", "bottom"].includes(handle));
    if (
      !e ||
      !validString(e.id) ||
      linkIds.has(e.id) ||
      !legacyHandle(legacy.sourceHandle) ||
      !legacyHandle(legacy.targetHandle) ||
      !canConnect(graph, e.source, e.target)
    )
      throw new Error("Invalid task connections.");
    linkIds.add(e.id);
    const {
      sourceHandle: _sourceHandle,
      targetHandle: _targetHandle,
      ...dependency
    } = legacy;
    graph.links.push(dependency);
  }
  // Connection direction defines launch order. Handle geometry from the
  // short-lived four-sided UI is deliberately not part of workspace data.
  value.links = graph.links;
  value.projects = value.projects.map((project) => {
    const legacy = project as Project & { category?: string };
    const { category: _category, ...clean } = legacy;
    return clean;
  });
  return normalizeWorkflows(value);
}

/** Workflows are an overlay on the board, so a malformed one is dropped rather
 *  than refusing the whole workspace, and a task keeps only the workflow ids
 *  that still exist. */
export function normalizeWorkflows(value: Workspace): Workspace {
  const seen = new Set<string>();
  const workflows: Workflow[] = [];
  for (const raw of Array.isArray(value.workflows) ? value.workflows : []) {
    const item = raw as Partial<Workflow> | null;
    if (
      !item ||
      typeof item.id !== "string" ||
      !item.id.trim() ||
      seen.has(item.id) ||
      typeof item.name !== "string" ||
      !item.name.trim()
    )
      continue;
    seen.add(item.id);
    workflows.push({
      id: item.id,
      name: item.name.trim().slice(0, 60),
      color:
        typeof item.color === "string" && /^#[0-9a-f]{6}$/i.test(item.color)
          ? item.color
          : "#a1a1aa",
    });
  }
  const tasks = value.tasks.map((task) => {
    if (task.workflowIds === undefined) return task;
    const { workflowIds, ...rest } = task;
    const kept = Array.isArray(workflowIds)
      ? [...new Set(workflowIds)].filter(
          (id) => typeof id === "string" && seen.has(id),
        )
      : [];
    return kept.length ? { ...rest, workflowIds: kept } : rest;
  });
  const { workflows: _workflows, ...rest } = value;
  return workflows.length ? { ...rest, tasks, workflows } : { ...rest, tasks };
}

export function ensureLabels(state: Workspace, names: string[]): Workspace {
  const missing = [
    ...new Set(names.map((n) => n.trim()).filter(Boolean)),
  ].filter(
    (name) =>
      !state.labels.some((l) => l.name.toLowerCase() === name.toLowerCase()),
  );
  return {
    ...state,
    labels: [
      ...state.labels,
      ...missing.map((name) => ({
        id: uid(),
        name,
        orb: makeOrb("#669df6"),
        color: "#669df6",
      })),
    ],
  };
}
export function saveLabel(state: Workspace, label: LabelDefinition): Workspace {
  if (
    !label.name.trim() ||
    state.labels.some(
      (l) =>
        l.id !== label.id &&
        l.name.toLowerCase() === label.name.trim().toLowerCase(),
    )
  )
    throw new Error("Use a unique label name.");
  if (!validOrb(label.orb)) throw new Error("Invalid orb settings.");
  if (label.color && !/^#[0-9a-f]{6}$/i.test(label.color))
    throw new Error("Use a valid color.");
  const previous = state.labels.find((l) => l.id === label.id);
  const next = { ...label, name: label.name.trim() };
  return {
    ...state,
    labels: previous
      ? state.labels.map((l) => (l.id === label.id ? next : l))
      : [...state.labels, next],
    tasks: previous
      ? state.tasks.map((t) => ({
          ...t,
          labels: t.labels.map((name) =>
            name === previous.name ? next.name : name,
          ),
        }))
      : state.tasks,
  };
}
export function deleteLabel(state: Workspace, id: string): Workspace {
  const label = state.labels.find((l) => l.id === id);
  return {
    ...state,
    labels: state.labels.filter((l) => l.id !== id),
    tasks: state.tasks.map((t) => ({
      ...t,
      labels: t.labels.filter((name) => name !== label?.name),
    })),
  };
}

export function normalizeRepositoryUrl(input: string): string {
  if (!input.trim()) return "";
  const url = new URL(input.trim());
  const match = url.pathname.match(/^\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9._-]+)\/?$/);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    !match ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use a GitHub repository URL: https://github.com/owner/repository",
    );
  return `https://github.com/${match[1]}/${match[2].replace(/\.git$/i, "")}`;
}
export function repositoryLayout(state: Workspace): RepositoryLayout {
  return (
    state.map.repositoryLayout ??
    (state.map.repositoryUrl ? "monorepo" : "multirepo")
  );
}
export function projectRepository(state: Workspace, project: Project): string {
  if (workspaceKind(state) === "everyday") return "";
  // In a monorepo the workspace repository is the answer for every project; the
  // fallback covers a workspace set to monorepo before its repository was
  // filled in, which would otherwise report no repository at all.
  return repositoryLayout(state) === "monorepo"
    ? state.map.repositoryUrl || project.repositoryUrl
    : project.repositoryUrl;
}
export function taskRepository(state: Workspace, task: Task): string {
  for (const id of task.projectIds) {
    const project = state.projects.find((item) => item.id === id);
    const repository = project ? projectRepository(state, project) : "";
    if (repository) return repository;
  }
  return "";
}
export function normalizeCommitUrl(input: string): string {
  const url = new URL(input.trim());
  const match = url.pathname.match(
    /^\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9._-]+)\/commit\/([a-fA-F0-9]{40})\/?$/,
  );
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    !match ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use an exact GitHub commit URL with the full 40-character SHA.",
    );
  return `https://github.com/${match[1]}/${match[2]}/commit/${match[3].toLowerCase()}`;
}
export function isValidRepository(input: unknown): boolean {
  try {
    return typeof input === "string" && !!normalizeRepositoryUrl(input);
  } catch {
    return false;
  }
}
export function isValidCommit(input: unknown): boolean {
  try {
    return typeof input === "string" && !!normalizeCommitUrl(input);
  } catch {
    return false;
  }
}
export function projectScope(
  state: Workspace,
  projectId: string,
  withRelations = true,
): Task[] {
  if (projectId === "all") return state.tasks;
  const ids = new Set(
    state.tasks
      .filter((t) => t.projectIds.includes(projectId))
      .map((t) => t.id),
  );
  if (withRelations) {
    const relations = [
      ...state.links,
      ...state.tasks
        .filter((t) => t.parentId)
        .map((t) => ({ source: t.parentId!, target: t.id })),
    ];
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of relations)
        if (ids.has(edge.source) || ids.has(edge.target)) {
          if (!ids.has(edge.source) || !ids.has(edge.target)) changed = true;
          ids.add(edge.source);
          ids.add(edge.target);
        }
    }
  }
  return state.tasks.filter((t) => ids.has(t.id));
}
/** Projects are ordered by their position in `projects`; there is no rank
 *  field. Reordering is therefore a permutation of that array, and it shows
 *  up everywhere projects are listed — sidebar, pickers, list grouping.
 *  Ids the workspace does not know are ignored, and projects the caller left
 *  out keep their relative order at the end. */
export function reorderProjects(
  state: Workspace,
  orderedIds: string[],
): Workspace {
  const byId = new Map(state.projects.map((project) => [project.id, project]));
  const seen = new Set<string>();
  const moved = orderedIds.flatMap((id) => {
    const project = byId.get(id);
    if (!project || seen.has(id)) return [];
    seen.add(id);
    return [project];
  });
  return {
    ...state,
    projects: [
      ...moved,
      ...state.projects.filter((project) => !seen.has(project.id)),
    ],
  };
}
export function removeProject(state: Workspace, id: string): Workspace {
  const tasks = state.tasks
    .map((t) => ({ ...t, projectIds: t.projectIds.filter((p) => p !== id) }))
    .filter((t) => t.projectIds.length);
  const ids = new Set(tasks.map((t) => t.id));
  return {
    ...state,
    projects: state.projects.filter((p) => p.id !== id),
    tasks: tasks.map((t) => ({
      ...t,
      parentId: t.parentId && ids.has(t.parentId) ? t.parentId : null,
    })),
    links: state.links.filter((e) => ids.has(e.source) && ids.has(e.target)),
  };
}
