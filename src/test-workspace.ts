import type { Task, Workspace } from "./domain";
import { defaultStatusOrbs, makeOrb, wholeMapOrb } from "./orb-settings";

const names = [
  "Map the experience",
  "Design the interface",
  "Build the workspace",
  "Create task nodes",
  "Connect the flow",
  "Ship the first version",
  "Set up authentication",
  "Prototype movement",
];
const positions = [
  { x: 0, y: 160 },
  { x: 330, y: 50 },
  { x: 660, y: 160 },
  { x: 330, y: 310 },
  { x: 660, y: 420 },
  { x: 990, y: 160 },
  { x: 0, y: 600 },
  { x: 330, y: 600 },
];

export const testWorkspace: Workspace = {
  version: 9,
  map: { name: "Workspace", repositoryUrl: "", orb: wholeMapOrb },
  labels: [],
  statusOrbs: defaultStatusOrbs,
  projects: [
    {
      id: "launchpad",
      name: "Launchpad",
      color: "#54b98c",
      orb: makeOrb("#54b98c"),
      repositoryUrl: "",
    },
    {
      id: "core-api",
      name: "Core API",
      color: "#669df6",
      orb: makeOrb("#669df6"),
      repositoryUrl: "",
    },
    {
      id: "sidequest",
      name: "Sidequest",
      color: "#e8b35a",
      orb: makeOrb("#e8b35a"),
      repositoryUrl: "",
    },
  ],
  tasks: names.map((name, index): Task => ({
    id: `fixture-task-${index + 1}`,
    referenceId: String(index + 1),
    name,
    projectIds:
      index < 6
        ? ["launchpad"]
        : index === 6
          ? ["core-api", "sidequest"]
          : ["sidequest"],
    commitUrls: [],
    status:
      index === 0 ? "done" : index === 1 || index === 2 ? "doing" : "todo",
    objective: "",
    labels: [],
    parentId: index === 3 ? "fixture-task-3" : null,
    position: positions[index],
    activity: [],
  })),
  links: [
    { id: "flow-1", source: "fixture-task-1", target: "fixture-task-2" },
    { id: "flow-2", source: "fixture-task-2", target: "fixture-task-3" },
    { id: "flow-3", source: "fixture-task-3", target: "fixture-task-5" },
    { id: "flow-4", source: "fixture-task-5", target: "fixture-task-6" },
    { id: "flow-5", source: "fixture-task-7", target: "fixture-task-8" },
    { id: "flow-6", source: "fixture-task-7", target: "fixture-task-3" },
  ],
};
