import { uid, type Task, type Workflow, type Workspace } from "./domain";

/** Picked in turn for each new workflow, so two made one after the other are
 *  told apart at a glance. Bright enough to glow on both board themes. */
export const workflowPalette = [
  "#8b5cf6",
  "#22c55e",
  "#f97316",
  "#06b6d4",
  "#ec4899",
  "#eab308",
  "#3b82f6",
  "#ef4444",
] as const;

export function workflowsOf(state: Pick<Workspace, "workflows">): Workflow[] {
  return state.workflows ?? [];
}

export function taskWorkflows(
  state: Pick<Workspace, "workflows">,
  task: Pick<Task, "workflowIds">,
): Workflow[] {
  const ids = task.workflowIds ?? [];
  return workflowsOf(state).filter((workflow) => ids.includes(workflow.id));
}

export function nextWorkflowColor(state: Pick<Workspace, "workflows">): string {
  const used = new Set(workflowsOf(state).map((workflow) => workflow.color));
  return (
    workflowPalette.find((color) => !used.has(color)) ??
    workflowPalette[workflowsOf(state).length % workflowPalette.length]
  );
}

/** Every task wired to this one, through dependencies or subtasks in either
 *  direction: the whole piece of the board it is part of. */
export function connectedTasks(state: Workspace, taskId: string): string[] {
  const neighbours = new Map<string, string[]>();
  const join = (a: string, b: string) => {
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  };
  for (const link of state.links) join(link.source, link.target);
  for (const task of state.tasks)
    if (task.parentId) join(task.parentId, task.id);
  const known = new Set(state.tasks.map((task) => task.id));
  if (!known.has(taskId)) return [];
  const reached = new Set([taskId]);
  const queue = [taskId];
  while (queue.length)
    for (const next of neighbours.get(queue.shift()!) ?? [])
      if (known.has(next) && !reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
  // In board order, so the list reads the way the tasks sit.
  return state.tasks
    .filter((task) => reached.has(task.id))
    .map((task) => task.id);
}

function member(task: Task, workflowId: string, on: boolean): Task {
  const ids = task.workflowIds ?? [];
  const next = on
    ? ids.includes(workflowId)
      ? ids
      : [...ids, workflowId]
    : ids.filter((id) => id !== workflowId);
  if (next === ids) return task;
  const { workflowIds: _, ...rest } = task;
  return next.length ? { ...rest, workflowIds: next } : rest;
}

function cleanName(state: Workspace, name: string, except?: string): string {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new Error("A workflow needs a name.");
  if (
    workflowsOf(state).some(
      (workflow) =>
        workflow.id !== except &&
        workflow.name.toLowerCase() === clean.toLowerCase(),
    )
  )
    throw new Error("Use a unique workflow name.");
  return clean;
}

/** The name itself if no workflow has it yet, else the name with the first
 *  free number after it, so a workflow started from a task can always be made
 *  and renamed afterwards. */
export function freeWorkflowName(state: Workspace, base: string): string {
  const stem = base.trim().slice(0, 55) || "Workflow";
  const taken = new Set(
    workflowsOf(state).map((workflow) => workflow.name.toLowerCase()),
  );
  if (!taken.has(stem.toLowerCase())) return stem;
  let index = 2;
  while (taken.has(`${stem} ${index}`.toLowerCase())) index += 1;
  return `${stem} ${index}`;
}

export function createWorkflow(
  state: Workspace,
  input: { name: string; color?: string; taskIds: readonly string[] },
): { state: Workspace; workflow: Workflow } {
  const workflow: Workflow = {
    id: uid(),
    name: cleanName(state, input.name),
    color:
      input.color && /^#[0-9a-f]{6}$/i.test(input.color)
        ? input.color
        : nextWorkflowColor(state),
  };
  const chosen = new Set(input.taskIds);
  return {
    workflow,
    state: {
      ...state,
      workflows: [...workflowsOf(state), workflow],
      tasks: state.tasks.map((task) =>
        chosen.has(task.id) ? member(task, workflow.id, true) : task,
      ),
    },
  };
}

export function setWorkflowMembers(
  state: Workspace,
  workflowId: string,
  taskIds: readonly string[],
  on: boolean,
): Workspace {
  if (!workflowsOf(state).some((workflow) => workflow.id === workflowId))
    throw new Error("That workflow no longer exists.");
  const chosen = new Set(taskIds);
  return {
    ...state,
    tasks: state.tasks.map((task) =>
      chosen.has(task.id) ? member(task, workflowId, on) : task,
    ),
  };
}

export function saveWorkflow(
  state: Workspace,
  workflowId: string,
  patch: Partial<Pick<Workflow, "name" | "color">>,
): Workspace {
  const current = workflowsOf(state).find((item) => item.id === workflowId);
  if (!current) throw new Error("That workflow no longer exists.");
  const next: Workflow = { ...current };
  if (patch.name !== undefined)
    next.name = cleanName(state, patch.name, workflowId);
  if (patch.color !== undefined) {
    if (!/^#[0-9a-f]{6}$/i.test(patch.color))
      throw new Error("Choose a colour.");
    next.color = patch.color;
  }
  return {
    ...state,
    workflows: workflowsOf(state).map((item) =>
      item.id === workflowId ? next : item,
    ),
  };
}

export function deleteWorkflow(
  state: Workspace,
  workflowId: string,
): Workspace {
  const workflows = workflowsOf(state).filter((item) => item.id !== workflowId);
  const tasks = state.tasks.map((task) => member(task, workflowId, false));
  const { workflows: _, ...rest } = state;
  return workflows.length ? { ...rest, tasks, workflows } : { ...rest, tasks };
}

export function workflowTasks(state: Workspace, workflowId: string): Task[] {
  return state.tasks.filter((task) =>
    (task.workflowIds ?? []).includes(workflowId),
  );
}

/** How far along a workflow is: its done tasks out of all of them. */
export function workflowProgress(
  state: Workspace,
  workflowId: string,
): { done: number; total: number } {
  const tasks = workflowTasks(state, workflowId);
  return {
    done: tasks.filter((task) => task.status === "done").length,
    total: tasks.length,
  };
}

/** A card's glow: one ring per workflow it is in, stacked outwards so a task in
 *  two workflows shows both colours, with a soft halo in the first. */
export function workflowGlow(colors: readonly string[]): string | undefined {
  if (!colors.length) return undefined;
  const rings = colors.map(
    (color, index) => `0 0 0 ${2 + index * 3}px ${color}`,
  );
  // Rings are drawn front to back, so the innermost has to come first.
  return [
    ...rings,
    `0 0 22px ${4 + colors.length * 3}px color-mix(in srgb, ${colors[0]} 45%, transparent)`,
  ].join(", ");
}
