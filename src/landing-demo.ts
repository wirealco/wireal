/** The fictional workspace the landing showcase runs on: Hallalobu, a small
 *  online shop, with three projects, the tasks and dependencies between them,
 *  the roster that works them, the runners two people keep connected, and what
 *  the agents reported while they were on a task. Nothing here is real, nothing
 *  here comes from a signed-in workspace, and nothing here is fetched: every
 *  surface in the showcase is the product's own component, handed this state
 *  instead of a session.
 *
 *  Prose lives in landing-showcase-copy.ts and is referenced by key, so the
 *  showcase speaks both languages. Identifiers — paths, handles, branches,
 *  commits — stay here, because code reads the same in either, and the few
 *  lines of prose that carry one take it as a variable rather than spelling it
 *  out twice. */
import type {
  Activity,
  ActivityKind,
  AgentSettings,
  AgentSpec,
  LabelDefinition,
  Link,
  Project,
  Status,
  Workspace,
} from "./domain";
import type { WorkspaceUser } from "./AuthGate";
import type { Runner, TaskLock } from "./runners";
import { agentLabel, lineBranch } from "./runners";
import type { WorkspaceInfo } from "./store";
import { makeOrb, orbPresets, type OrbSettings } from "./orb-settings";

/** How the showcase reads a string out of `landing.showcase`. */
export type ShowcaseCopy = (
  key: string,
  vars?: Record<string, string>,
) => string;

export const demoRepository = "https://github.com/hallalobu/hallalobu";
/** The workspace id the team panel is asked for. It is never sent anywhere. */
export const demoWorkspaceId = "hallalobu-showcase";

/** Moments, measured from the page opening rather than written down, so the
 *  activity rail reads "3 hours ago" today and still does next year. */
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();
const HOUR = 60;
const DAY = 24 * HOUR;

const projectIds = {
  storefront: "5a0c1d7e-1a6b-4b1f-9a2c-0f6b3f2d51a0",
  checkout: "9b3f2e41-58cd-4f0a-8c19-2d7a4e6b1c33",
  design: "c1e7d940-7f52-4a63-b0d8-6e9a15c8b2f4",
} as const;

type DemoProject = {
  id: string;
  nameKey: string;
  orb: OrbSettings;
};

const projects: DemoProject[] = [
  {
    id: projectIds.storefront,
    nameKey: "projectStorefront",
    orb: orbPresets[1].orb,
  },
  {
    id: projectIds.checkout,
    nameKey: "projectCheckout",
    orb: orbPresets[2].orb,
  },
  {
    id: projectIds.design,
    nameKey: "projectDesign",
    orb: makeOrb("#8b7bff"),
  },
];

/** Labels are user content, so the workspace's owner named them once and they
 *  read the same in either language — which is also what lets the showcase
 *  restate their colours in CSS for a badge that would otherwise look them up
 *  in a signed-in workspace there is none of here. */
export const demoLabels: { name: string; color: string }[] = [
  { name: "Payments", color: "#ef6387" },
  { name: "Checkout", color: "#408cff" },
  { name: "Design", color: "#8b7bff" },
];

/* ---- The roster ---------------------------------------------------------- */

/** Who takes work in this workspace: two agents on the owner's machine and one
 *  on a collaborator's. A handle is what tells two Claudes apart, here and in
 *  everything they sign. */
export const demoRoster: AgentSpec[] = [
  {
    id: "a-sol",
    name: "Sol",
    kind: "claude",
    model: "claude-opus-5",
    enabled: true,
  },
  {
    id: "a-pepper",
    name: "Pepper",
    kind: "codex",
    model: "gpt-5.6-sol",
    enabled: true,
  },
  { id: "a-juno", name: "Juno", kind: "claude", enabled: true },
];

const [sol, pepper, juno] = demoRoster;

export const demoAgentSettings: AgentSettings = {
  mode: "automatic",
  mergePolicy: "merge",
  roster: demoRoster,
  leaseMinutes: 10,
  pauseAbovePercent: 90,
};

type DemoTask = {
  id: string;
  referenceId: string;
  nameKey: string;
  project: keyof typeof projectIds;
  status: Status;
  labels: string[];
  position: { x: number; y: number };
  parent?: string;
  commit?: string;
};

/** Laid out left to right in the order the dependencies run, so the board frames
 *  into the showcase as a plan rather than as a scatter. */
const tasks: DemoTask[] = [
  {
    id: "task-tax",
    referenceId: "3",
    nameKey: "taskTax",
    project: "checkout",
    status: "done",
    labels: ["Payments"],
    position: { x: 0, y: 0 },
    commit: "https://github.com/hallalobu/hallalobu/commit/9f3c1ae7c2b4",
  },
  {
    id: "task-images",
    referenceId: "7",
    nameKey: "taskImages",
    project: "storefront",
    status: "done",
    labels: [],
    position: { x: 0, y: 250 },
    commit: "https://github.com/hallalobu/hallalobu/commit/41bd80c5e7aa",
  },
  {
    id: "task-tokens",
    referenceId: "6",
    nameKey: "taskTokens",
    project: "design",
    status: "todo",
    labels: ["Design"],
    position: { x: 0, y: 500 },
  },
  {
    id: "task-refund",
    referenceId: "1",
    nameKey: "taskRefund",
    project: "checkout",
    status: "doing",
    labels: ["Payments"],
    position: { x: 380, y: 120 },
  },
  {
    id: "task-guest",
    referenceId: "2",
    nameKey: "taskGuest",
    project: "storefront",
    status: "todo",
    labels: ["Checkout"],
    position: { x: 760, y: 0 },
  },
  {
    id: "task-fields",
    referenceId: "4",
    nameKey: "taskFields",
    project: "checkout",
    status: "todo",
    labels: ["Checkout", "Payments"],
    position: { x: 760, y: 270 },
  },
  {
    id: "task-receipts",
    referenceId: "8",
    nameKey: "taskReceipts",
    project: "checkout",
    status: "todo",
    labels: [],
    position: { x: 760, y: 520 },
    parent: "task-refund",
  },
  {
    id: "task-chip",
    referenceId: "5",
    nameKey: "taskChip",
    project: "storefront",
    status: "done",
    labels: ["Design"],
    position: { x: 1140, y: 120 },
    commit: "https://github.com/hallalobu/hallalobu/commit/7a4fd22b1c09",
  },
];

/** The branch the line for a task runs on, named the way the runner names it. */
export const demoBranch = (taskId: string) => {
  const task = tasks.find((entry) => entry.id === taskId);
  return task ? lineBranch(task) : "";
};

/** Dependencies, drawn from the blocker to the task it holds up. */
const links: Link[] = [
  { id: "link-1", source: "task-tax", target: "task-refund" },
  { id: "link-2", source: "task-refund", target: "task-guest" },
  { id: "link-3", source: "task-refund", target: "task-fields" },
  { id: "link-4", source: "task-images", target: "task-guest" },
  { id: "link-5", source: "task-tokens", target: "task-chip" },
  { id: "link-6", source: "task-fields", target: "task-chip" },
];

/** The workspace exactly as the product holds one, so the whiteboard, the list
 *  and the agents panel are the app's own components reading the app's own
 *  shape. */
export function demoWorkspace(t: ShowcaseCopy): Workspace {
  const demoProjects: Project[] = projects.map((project) => ({
    id: project.id,
    name: t(project.nameKey),
    color: project.orb.colors[0],
    repositoryUrl: demoRepository,
    orb: project.orb,
  }));
  const workspaceLabels: LabelDefinition[] = demoLabels.map((label, order) => ({
    id: `label-${order}`,
    name: label.name,
    color: label.color,
    orb: makeOrb(label.color),
  }));
  return {
    version: 9,
    map: {
      kind: "coding",
      name: "Hallalobu",
      repositoryUrl: demoRepository,
      orb: orbPresets[0].orb,
      agents: demoAgentSettings,
    },
    projects: demoProjects,
    labels: workspaceLabels,
    statusOrbs: {
      proposed: makeOrb("#a78bfa"),
      todo: makeOrb("#a1a1aa"),
      doing: makeOrb("#ffb33e"),
      done: makeOrb("#45d797"),
    },
    tasks: tasks.map((task) => ({
      id: task.id,
      referenceId: task.referenceId,
      name: t(task.nameKey),
      projectIds: [projectIds[task.project]],
      commitUrls: task.commit ? [task.commit] : [],
      status: task.status,
      objective: "",
      labels: task.labels,
      parentId: task.parent ?? null,
      position: task.position,
      activity: demoActivity(task.id, t),
    })),
    links,
  };
}

/* ---- What the task remembers --------------------------------------------- */

/** What a line's last entry says once the branch is in. The runner writes it
 *  itself, in one language, so the demo states it the same way. */
export const mergedText = "Merged into main as";

/** Everyone who has written on a task: the three agents by the handle they
 *  sign with, and the two people by their account, because an editor is only
 *  ever an account and never a bare name. */
const voices = {
  sol: { author: agentLabel(sol), authorType: "ai" as const },
  pepper: { author: agentLabel(pepper), authorType: "ai" as const },
  juno: { author: agentLabel(juno), authorType: "ai" as const },
  banana: {
    author: "Mr. Banana",
    authorType: "user" as const,
    authorId: "u-banana",
  },
  hallalobu: {
    author: "Hallalobu H.",
    authorType: "user" as const,
    authorId: "u-hallalobu",
  },
};

type DemoReport = {
  id: string;
  task: string;
  kind: ActivityKind;
  who: keyof typeof voices;
  minutesAgo: number;
  textKey?: string;
  vars?: Record<string, string>;
  /** A line the runner writes rather than an agent: it reads the same in
   *  either language, because the runner only ever writes it one way. */
  text?: string;
  commit?: string;
  to?: string;
};

const demoReports: DemoReport[] = [
  {
    id: "r-refund-brief",
    task: "task-refund",
    kind: "decision",
    who: "banana",
    minutesAgo: 2 * DAY,
    textKey: "reportRefundBrief",
  },
  {
    id: "r-refund-found",
    task: "task-refund",
    kind: "discovery",
    who: "sol",
    minutesAgo: 26,
    textKey: "reportRefundFound",
  },
  {
    id: "r-refund-fix",
    task: "task-refund",
    kind: "change",
    who: "sol",
    minutesAgo: 9,
    textKey: "reportRefundFix",
    vars: { branch: demoBranch("task-refund") },
  },
  {
    id: "r-tax-verify",
    task: "task-tax",
    kind: "verification",
    who: "pepper",
    minutesAgo: 30 * HOUR,
    textKey: "reportTax",
  },
  {
    id: "r-tax-merged",
    task: "task-tax",
    kind: "change",
    who: "pepper",
    minutesAgo: 29 * HOUR,
    text: `${mergedText} 9f3c1ae`,
    commit: "9f3c1ae",
  },
  {
    id: "r-guest",
    task: "task-guest",
    kind: "decision",
    who: "pepper",
    minutesAgo: 2 * DAY,
    textKey: "reportCheckout",
  },
  {
    id: "r-tokens",
    task: "task-tokens",
    kind: "blocker",
    who: "juno",
    minutesAgo: 3 * DAY,
    textKey: "reportTokens",
  },
  {
    id: "r-chip-back",
    task: "task-chip",
    kind: "review",
    who: "hallalobu",
    minutesAgo: 20 * HOUR,
    textKey: "reportChipBack",
  },
  {
    id: "r-chip",
    task: "task-chip",
    kind: "change",
    who: "sol",
    minutesAgo: 4 * DAY,
    textKey: "reportChip",
    commit: "7a4fd22",
  },
  {
    id: "r-images",
    task: "task-images",
    kind: "change",
    who: "pepper",
    minutesAgo: 5 * DAY,
    textKey: "reportImages",
  },
  {
    id: "r-images-merged",
    task: "task-images",
    kind: "change",
    who: "pepper",
    minutesAgo: 5 * DAY - 20,
    text: `${mergedText} 41bd80c`,
    commit: "41bd80c",
  },
];

function demoActivity(taskId: string, t: ShowcaseCopy): Activity[] {
  return demoReports
    .filter((report) => report.task === taskId)
    .map((report) => ({
      id: report.id,
      text: report.text ?? t(report.textKey ?? "", report.vars),
      at: ago(report.minutesAgo),
      kind: report.kind,
      ...voices[report.who],
      ...(report.commit ? { commit: report.commit } : {}),
      ...(report.to ? { to: report.to } : {}),
    }));
}

/* ---- Runners ------------------------------------------------------------- */

/** The two machines this workspace has: the owner's, hosting both CLIs with
 *  one agent on a task and one waiting, and a collaborator's, hosting Claude
 *  alone. A runner is only connected while its heartbeat is recent, so both are
 *  stamped with the same clock the showcase hands its panels — never a clock of
 *  their own, which would go quiet on a page left open. */
export function demoRunners(now: number): Runner[] {
  const back = (minutes: number) =>
    new Date(now - minutes * 60_000).toISOString();
  const forward = (minutes: number) =>
    new Date(now + minutes * 60_000).toISOString();
  const heartbeat = new Date(now).toISOString();
  return [
    {
      runner_id: "r-hallalobu",
      name: "hallalobu",
      host: "banana-mbp",
      owner_id: "u-banana",
      owner_name: "Mr. Banana",
      workspace_id: demoWorkspaceId,
      workspace_name: "Hallalobu",
      hosts: ["claude", "codex"],
      since: back(4 * HOUR),
      last_seen: heartbeat,
      agents: [
        {
          id: sol.id,
          name: sol.name,
          kind: "claude",
          task_id: "task-refund",
          since: back(26),
          waiting: "",
        },
        {
          id: pepper.id,
          name: pepper.name,
          kind: "codex",
          task_id: null,
          since: back(4 * HOUR),
          waiting: "",
        },
      ],
      rate_limits: {
        by_kind: {
          claude: {
            five_hour: { used_percentage: 38, resets_at: now + 2 * 3_600_000 },
            seven_day: { used_percentage: 61, resets_at: now + 3 * 86_400_000 },
          },
          codex: {
            five_hour: { used_percentage: 12, resets_at: now + 4 * 3_600_000 },
            seven_day: { used_percentage: 27, resets_at: now + 5 * 86_400_000 },
          },
        },
        captured_at: back(6),
      },
      cost_usd: 4.82,
      ping_requested_at: null,
      ping_answered_at: null,
      leases: [
        {
          task_id: "task-refund",
          agent: sol.id,
          since: back(26),
          until: forward(9),
        },
      ],
      seats: [
        { agent_id: sol.id, since: back(4 * HOUR) },
        { agent_id: pepper.id, since: back(4 * HOUR) },
      ],
      wanted: [sol.id, pepper.id],
      folder: {
        branch: "main",
        dirty: false,
        ahead: 0,
        behind: 2,
        upstream: "origin/main",
        path: "~/code/hallalobu",
      },
    },
    {
      runner_id: "r-pip",
      name: "pip-air",
      host: "pip-air",
      owner_id: "u-pip",
      owner_name: "Pip Squiggle",
      workspace_id: demoWorkspaceId,
      workspace_name: "Hallalobu",
      hosts: ["claude"],
      since: back(52),
      last_seen: heartbeat,
      agents: [
        {
          id: juno.id,
          name: juno.name,
          kind: "claude",
          task_id: null,
          since: back(52),
          waiting: "",
        },
      ],
      rate_limits: {
        by_kind: {
          claude: {
            five_hour: { used_percentage: 9, resets_at: now + 4 * 3_600_000 },
            seven_day: { used_percentage: 18, resets_at: now + 6 * 86_400_000 },
          },
        },
        captured_at: back(11),
      },
      cost_usd: 0.74,
      ping_requested_at: null,
      ping_answered_at: null,
      leases: [],
      seats: [{ agent_id: juno.id, since: back(52) }],
      wanted: [juno.id],
      folder: {
        branch: "main",
        dirty: false,
        ahead: 0,
        behind: 0,
        upstream: "origin/main",
        path: "~/work/hallalobu",
      },
    },
  ];
}

/** The one task somebody has locked: the owner took it for their own runner,
 *  and named the agent that should have it. */
export function demoLocks(now: number): TaskLock[] {
  return [
    {
      workspace_id: demoWorkspaceId,
      task_id: "task-refund",
      agent: sol.id,
      owner_id: "u-banana",
      owner_name: "Mr. Banana",
      since: new Date(now - 26 * 60_000).toISOString(),
    },
  ];
}

/* ---- Team ---------------------------------------------------------------- */

/** The payload the team panel would otherwise fetch: an owner, two
 *  collaborators, and one invitation still out. People are named the way a
 *  small team writes itself down — a first name and a last initial — and the
 *  mix is the mix Wireal actually has. */
export const demoTeam = {
  role: "owner" as const,
  currentUserId: "u-banana",
  members: [
    {
      id: "u-banana",
      name: "Mr. Banana",
      email: "banana@hallalobu.dev",
      avatarUrl: null,
      role: "owner" as const,
    },
    {
      id: "u-hallalobu",
      name: "Hallalobu H.",
      email: "hallalobu@hallalobu.dev",
      avatarUrl: null,
      role: "collaborator" as const,
    },
    {
      id: "u-pip",
      name: "Pip Squiggle",
      email: "pip@hallalobu.dev",
      avatarUrl: null,
      role: "collaborator" as const,
    },
  ],
  invitations: [
    { id: "inv-tortoise", target: "Wobbly Tortoise", expiresAt: ago(-4 * DAY) },
  ],
};

/** The person the sidebar signs in as: the workspace's owner, the same one the
 *  team panel lists. */
export const demoUser: WorkspaceUser = {
  id: demoTeam.currentUserId,
  name: demoTeam.members[0].name,
  email: demoTeam.members[0].email,
};

/** What the sidebar's workspace switcher reads: this workspace, and one other
 *  so the group is a list rather than a single row. Neither is ever opened. */
export function demoWorkspaces(state: Workspace): WorkspaceInfo[] {
  const other: Workspace = {
    ...state,
    map: { ...state.map, name: "Hallalobu Labs", orb: orbPresets[3].orb },
  };
  return [
    {
      id: demoWorkspaceId,
      name: state.map.name,
      repositoryUrl: demoRepository,
      workspace: state,
      role: "owner",
    },
    {
      id: "hallalobu-labs-showcase",
      name: other.map.name,
      repositoryUrl: demoRepository,
      workspace: other,
      role: "collaborator",
    },
  ];
}
