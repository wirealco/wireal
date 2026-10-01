/* The first-run tour walks the real controls in the order a new user reaches
   for them: set up the workspace, add a project, give it a task, wire tasks
   together, then learn the views. Connecting an agent is a page of its own at
   /docs, not a step to be walked past. */
export const firstRunSteps = [
  "workspace",
  "project",
  "task",
  "wire",
  "views",
] as const;
export type FirstRunStep = (typeof firstRunSteps)[number];

/* Two steps point at controls that are not always on screen: "New task" only
   replaces "New project" once a project exists, and the board dock only exists
   on the board. Those steps are skipped rather than anchored to nothing, and
   an account with no workspace has none of them, since every anchor lives
   inside a board: the tour waits there rather than counting itself done. */
export type FirstRunContext = {
  hasWorkspace: boolean;
  hasProject: boolean;
  onBoard: boolean;
};

export function firstRunStepAvailable(
  step: FirstRunStep,
  context: FirstRunContext,
): boolean {
  if (!context.hasWorkspace) return false;
  if (step === "task") return context.hasProject;
  if (step === "wire") return context.onBoard;
  return true;
}

/** The steps this user will actually see, so progress counts what is shown. */
export function firstRunPath(context: FirstRunContext): FirstRunStep[] {
  return firstRunSteps.filter((step) => firstRunStepAvailable(step, context));
}

export function firstRunStart(context: FirstRunContext): FirstRunStep | null {
  return firstRunPath(context)[0] ?? null;
}

export function nextFirstRunStep(
  step: FirstRunStep,
  context: FirstRunContext,
): FirstRunStep | null {
  const after = firstRunSteps.slice(firstRunSteps.indexOf(step) + 1);
  return after.find((next) => firstRunStepAvailable(next, context)) ?? null;
}
