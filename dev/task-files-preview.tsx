import React from "react";
import ReactDOM from "react-dom/client";
import "../src/i18n";
import "../src/styles.css";
import { CommitsView } from "../src/CommitsView";
import type { Task, Workspace } from "../src/domain";
import { defaultStatusOrbs, makeOrb, wholeMapOrb } from "../src/orb-settings";
import {
  commitTasks,
  commitUrls,
  defaultGroupBy,
  groupModes,
  type CommitFile,
  type CommitFilesResult,
  type GroupBy,
} from "../src/task-files";

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.dataset.theme = theme;
document.documentElement.style.colorScheme = theme;

const group = params.get("group");
if (group)
  localStorage.setItem(
    "wireal.commits.groupBy",
    groupModes.includes(group as GroupBy) ? group : defaultGroupBy,
  );
const project = params.get("project");

const appProjectId = "wireal-app";
const apiProjectId = "wireal-api";

const state: Workspace = {
  version: 9,
  map: {
    kind: "coding",
    name: "Wireal",
    repositoryUrl: "https://github.com/wireal/wireal",
    orb: wholeMapOrb,
    repositoryLayout: "monorepo",
  },
  projects: [
    {
      id: appProjectId,
      name: "Wireal App",
      color: "#5b8cff",
      repositoryUrl: "https://github.com/wireal/wireal-app",
      paths: ["wireal-app"],
      orb: makeOrb("#5b8cff"),
    },
    {
      id: apiProjectId,
      name: "Wireal API",
      color: "#3fbf8f",
      repositoryUrl: "https://github.com/wireal/wireal-api",
      paths: ["wireal-api"],
      orb: makeOrb("#3fbf8f"),
    },
  ],
  labels: [],
  statusOrbs: defaultStatusOrbs,
  tasks: [],
  links: [],
};

const sha = (character: string) => character.repeat(40);
const commitUrl = (value: string) =>
  `https://github.com/wireal/wireal/commit/${value}`;
const shaOne = sha("a");
const shaTwo = sha("b");
const shaThree = sha("c");

const file = (
  path: string,
  status: CommitFile["status"],
  additions: number,
  deletions: number,
  previousPath?: string,
): CommitFile => ({
  path,
  status,
  additions,
  deletions,
  ...(previousPath ? { previousPath } : {}),
});

const ref = (value: string) => ({
  url: commitUrl(value),
  owner: "wireal",
  repo: "wireal",
  sha: value,
});

const tasks: Task[] = [
  {
    id: "task-files",
    referenceId: "31",
    name: "Map the files a task changed",
    projectIds: [appProjectId, apiProjectId],
    commitUrls: [commitUrl(shaOne), commitUrl(shaThree)],
    status: "doing",
    objective: "",
    labels: [],
    parentId: null,
    position: { x: 0, y: 0 },
    activity: [],
  },
  {
    id: "task-api",
    referenceId: "32",
    name: "Serve commit file patches through the workspace proxy",
    projectIds: [apiProjectId],
    commitUrls: [commitUrl(shaTwo)],
    status: "doing",
    objective: "",
    labels: [],
    parentId: null,
    position: { x: 0, y: 0 },
    activity: [],
  },
];

const results: CommitFilesResult[] = [
  {
    ref: ref(shaOne),
    committedAt: "2026-09-12T09:24:00Z",
    files: [
      file("wireal-app/src/TaskFilesMap.tsx", "added", 318, 0),
      file("wireal-app/src/task-files.css", "added", 214, 0),
      file("wireal-app/src/TaskInspector.tsx", "modified", 46, 12),
      file("wireal-app/src/i18n.ts", "modified", 62, 0),
      file("wireal-app/src/App.tsx", "modified", 7, 1),
      file("wireal-app/src/styles.css", "modified", 3, 9),
      file("docs/task-files.md", "added", 41, 0),
      file("docs/graph.md", "removed", 0, 96),
    ],
  },
  {
    ref: ref(shaTwo),
    committedAt: "2026-09-15T16:41:00Z",
    files: [
      file("wireal-app/src/TaskFilesMap.tsx", "modified", 24, 6),
      file(
        "wireal-app/src/TaskFiles.tsx",
        "renamed",
        18,
        4,
        "wireal-app/src/FileMap.tsx",
      ),
      file("wireal-api/Controllers/CommitsController.cs", "modified", 33, 8),
      file("wireal-api/Services/ProjectService.cs", "added", 112, 0),
      file("wireal-api/Migrations/20260914_DropKnowledge.cs", "added", 74, 0),
      file("docs/task-files.md", "modified", 11, 3),
    ],
  },
  {
    ref: ref(shaThree),
    error: { kind: "not-found" as const, status: 404 },
  },
];

/** ?bulk=120 stands in for a workspace with a real history behind it: the
 *  rail scrolls, the land fills and the wires stay at one commit's worth. */
const bulk = Number(params.get("bulk")) || 0;
const areas = [
  "wireal-app/src",
  "wireal-app/src/canvas",
  "wireal-app/src/settings",
  "wireal-api/Controllers",
  "wireal-api/Services",
  "wireal-api/Migrations",
  "docs",
  "worker",
  "runner/agents",
];
const bulkTasks: Task[] = [];
const bulkResults: CommitFilesResult[] = [];
for (let index = 0; index < bulk; index += 1) {
  const value = index.toString(16).padStart(40, "0");
  const day = 12 + Math.floor(index / 6);
  bulkResults.push({
    ref: ref(value),
    committedAt: `2026-${String(8 + Math.floor(day / 30)).padStart(2, "0")}-${String((day % 28) + 1).padStart(2, "0")}T0${index % 9}:20:00Z`,
    files: Array.from({ length: 4 + (index % 9) }, (_, slot) => {
      const area = areas[(index + slot) % areas.length];
      return file(
        `${area}/module-${(index * 7 + slot * 13) % 60}.ts`,
        slot % 5 === 0 ? "added" : slot % 7 === 0 ? "removed" : "modified",
        (index * 3 + slot) % 90,
        (index + slot) % 40,
      );
    }),
  });
  bulkTasks.push({
    ...tasks[index % tasks.length],
    id: `bulk-${index}`,
    referenceId: String(100 + index),
    name: `Bulk commit ${index} over ${areas[index % areas.length]}`,
    commitUrls: [commitUrl(value)],
  });
}
const shownTasks = bulk ? bulkTasks : tasks;
const shownResults = bulk ? bulkResults : results;

function Preview() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        padding: "24px",
        boxSizing: "border-box",
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <CommitsView
        state={state}
        urls={commitUrls(shownTasks)}
        label={state.map.name}
        owners={commitTasks(shownTasks)}
        results={shownResults}
        projectId={project}
        zoom="dock"
        onOpenTask={(id) => alert(id)}
        onOpenWorkspaceSettings={() => alert("workspace settings")}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
