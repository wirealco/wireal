import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "../src/i18n";
import "../src/styles.css";
import { CrewPill, type AgentsSection } from "../src/CrewPill";
import { CrewWindow } from "../src/CrewWindow";
import type { Task, Workspace } from "../src/domain";
import { defaultStatusOrbs, wholeMapOrb } from "../src/orb-settings";
import { repository } from "../src/store";
import { parseRunner, type Runner } from "../src/runners";

/* The crew's pill and window against a made-up fleet, for looking at them
   without a backend. ?scene= picks what opens: window (the default), rules,
   empty (no runner yet), arrive (a runner connects after two seconds) or pill
   (the board's corner, with nothing open). ?theme=dark flips the theme. */
const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
const scene = params.get("scene") ?? "window";
document.documentElement.dataset.theme = theme;
document.documentElement.style.colorScheme = theme;

const now = Date.now();
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

const task = (id: string, referenceId: string, name: string): Task => ({
  id,
  referenceId,
  name,
  projectIds: [],
  commitUrls: [],
  status: "doing",
  objective: "",
  labels: [],
  parentId: null,
  position: { x: 0, y: 0 },
  activity: [],
});

const tasks: Task[] = [
  task("task-19", "19", "Runners roster rework"),
  task("task-42", "42", "Refund flow for annual plans"),
];

const state: Workspace = {
  version: 9,
  map: {
    kind: "coding",
    name: "Wireal",
    repositoryUrl: "https://github.com/example/repo",
    orb: wholeMapOrb,
    repositoryLayout: "monorepo",
    agents: {
      mode: "directed",
      leaseMinutes: 10,
      mergePolicy: "merge",
      roster: [
        {
          id: "ada",
          name: "Studio 1",
          kind: "claude",
          enabled: true,
          runner: "runner-1",
        },
        {
          id: "rex",
          name: "Studio 2",
          kind: "codex",
          enabled: true,
          runner: "runner-1",
        },
        {
          id: "kit",
          name: "Air 1",
          kind: "claude",
          enabled: true,
          runner: "runner-3",
        },
        {
          id: "old",
          name: "Tower 1",
          kind: "claude",
          enabled: true,
          runner: "runner-4",
        },
        { id: "nil", name: "Nil", kind: "codex", enabled: true },
      ],
    },
  },
  projects: [],
  labels: [],
  statusOrbs: defaultStatusOrbs,
  tasks,
  links: [],
};

repository.commit(() => state);
const workspaceId = repository.getActiveWorkspaceId();

const fleet: Runner[] = [
  parseRunner({
    runner_id: "runner-1",
    name: "Studio",
    host: "mac-studio.local",
    owner_id: "owner-1",
    owner_name: "Grace",
    workspace_id: workspaceId,
    workspace_name: "Wireal",
    hosts: ["claude", "codex"],
    since: ago(3600),
    last_seen: ago(4),
    agents: [
      {
        id: "ada",
        name: "Studio 1",
        kind: "claude",
        task_id: "task-19",
        since: ago(754),
        step: "editing src/CrewWindow.tsx",
        files: ["src/CrewWindow.tsx", "src/crew.css"],
      },
      {
        id: "rex",
        name: "Studio 2",
        kind: "codex",
        task_id: "task-42",
        since: ago(95),
        step: "running npm test",
      },
    ],
    rate_limits: {
      captured_at: ago(40),
      by_kind: {
        claude: {
          five_hour: {
            used_percentage: 38,
            resets_at: (now + 5_400_000) / 1000,
          },
          seven_day: {
            used_percentage: 71,
            resets_at: (now + 300_000_000) / 1000,
          },
        },
        codex: {
          five_hour: {
            used_percentage: 12,
            resets_at: (now + 9_000_000) / 1000,
          },
          seven_day: {
            used_percentage: 27,
            resets_at: (now + 400_000_000) / 1000,
          },
        },
      },
    },
    cost_usd: 12.4,
    leases: [],
    seats: [
      { agent_id: "ada", since: ago(3600) },
      { agent_id: "rex", since: ago(3600) },
    ],
    folder: {
      branch: "main",
      dirty: false,
      ahead: 0,
      behind: 2,
      upstream: "origin/main",
      path: "~/code/wireal",
    },
  }),
  parseRunner({
    runner_id: "runner-3",
    name: "Air",
    host: "pip-air",
    owner_id: "owner-2",
    owner_name: "Pip",
    workspace_id: workspaceId,
    workspace_name: "Wireal",
    hosts: ["claude"],
    since: ago(3000),
    last_seen: ago(8),
    agents: [
      {
        id: "kit",
        name: "Air 1",
        kind: "claude",
        task_id: null,
        since: ago(3000),
        waiting: "",
      },
    ],
    rate_limits: {
      source: "claude",
      captured_at: ago(60),
      five_hour: { used_percentage: 88, resets_at: (now + 1_800_000) / 1000 },
      seven_day: { used_percentage: 52, resets_at: (now + 200_000_000) / 1000 },
    },
    cost_usd: 0.74,
    seats: [{ agent_id: "kit", since: ago(3000) }],
    folder: {
      branch: "main",
      dirty: true,
      ahead: 0,
      behind: 0,
      upstream: "origin/main",
      path: "~/work/wireal",
    },
  }),
  parseRunner({
    runner_id: "runner-4",
    name: "Tower",
    host: "tower",
    owner_id: "owner-1",
    owner_name: "Grace",
    workspace_id: workspaceId,
    workspace_name: "Wireal",
    hosts: ["claude"],
    since: ago(90_000),
    last_seen: ago(11_000),
    agents: [],
    rate_limits: null,
    cost_usd: 3.1,
  }),
  parseRunner({
    runner_id: "runner-2",
    name: "Laptop",
    host: "studio-air",
    owner_id: "owner-1",
    owner_name: "Grace",
    workspace_id: "other",
    workspace_name: "Side project",
    hosts: ["codex"],
    since: ago(90_000),
    last_seen: ago(20),
    agents: [
      {
        id: "zed",
        name: "Laptop 1",
        kind: "codex",
        task_id: "task-elsewhere",
        since: ago(420),
      },
    ],
    rate_limits: null,
    cost_usd: 0,
  }),
];

function Preview() {
  const [runners, setRunners] = useState<Runner[]>(
    scene === "empty" || scene === "arrive" ? [] : fleet,
  );
  const [open, setOpen] = useState<AgentsSection | null>(
    scene === "pill" ? null : scene === "rules" ? "settings" : "runners",
  );
  useEffect(() => {
    if (scene !== "arrive") return;
    const timer = setTimeout(
      () => setRunners([{ ...fleet[0], last_seen: new Date().toISOString() }]),
      2000,
    );
    return () => clearTimeout(timer);
  }, []);
  return (
    <div
      style={{
        height: "100dvh",
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <CrewPill
        runners={runners}
        locks={[]}
        now={now}
        userId="owner-1"
        onOpenCrew={setOpen}
        onOpenTask={() => {}}
      />
      {!!open && (
        <CrewWindow
          runners={runners}
          now={Date.now()}
          workspaceId={workspaceId}
          userId="owner-1"
          workspaceOwner
          section={open}
          onClose={() => setOpen(null)}
          onRefresh={() => {}}
          onOpenTask={() => setOpen(null)}
        />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
