import type { Workspace } from "./domain";
import { defaultStatusOrbs, wholeMapOrb } from "./orb-settings";

const legacyDemoTaskIds = new Set(
  Array.from({ length: 8 }, (_, index) => `task-${index + 1}`),
);
const legacyDemoProjectIds = new Set(["launchpad", "core-api", "sidequest"]);

export const emptyWorkspace = (): Workspace => ({
  version: 9,
  map: { name: "Workspace", repositoryUrl: "", orb: structuredClone(wholeMapOrb) },
  labels: [],
  statusOrbs: structuredClone(defaultStatusOrbs),
  projects: [],
  tasks: [],
  links: [],
});

/** The whole-workspace view used to be called "Map"; adopt the current name. */
function renameLegacyMap(workspace: Workspace): Workspace {
  return workspace.map.name === "Map"
    ? { ...workspace, map: { ...workspace.map, name: "Workspace" } }
    : workspace;
}

export function removeLegacyDemoContent(input: Workspace): Workspace {
  const workspace = renameLegacyMap(input);
  const removedTaskIds = new Set(
    workspace.tasks
      .filter((task) => legacyDemoTaskIds.has(task.id))
      .map((task) => task.id),
  );
  const tasks = workspace.tasks
    .filter((task) => !removedTaskIds.has(task.id))
    .map((task) => ({
      ...task,
      parentId:
        task.parentId && removedTaskIds.has(task.parentId) ? null : task.parentId,
    }));
  const usedProjectIds = new Set(tasks.flatMap((task) => task.projectIds));
  const projects = workspace.projects.filter(
    (project) =>
      !legacyDemoProjectIds.has(project.id) || usedProjectIds.has(project.id),
  );
  const links = workspace.links.filter(
    (link) =>
      !removedTaskIds.has(link.source) && !removedTaskIds.has(link.target),
  );

  if (
    tasks.length === workspace.tasks.length &&
    projects.length === workspace.projects.length &&
    links.length === workspace.links.length
  )
    return workspace;
  return { ...workspace, projects, tasks, links };
}
