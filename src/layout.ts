import { launchOrder, type Task, type Workspace } from "./domain";

export const cardWidth = 288;
export const nominalCardHeight = 108;
const columnGap = 120;
const rowGap = 48;
const bandGap = 120;
const origin = 40;

const columnPitch = cardWidth + columnGap;

type Point = { x: number; y: number };

/** Lays the board out the way it is read. Each flow (tasks joined by links
 *  or subtasks, and tasks that share a workflow) gets a band of its own,
 *  dependencies running left to right through it. The bands stack top to
 *  bottom in launch order, so the flow that starts first sits at the top.
 *  Tasks joined to nothing share one last band, in launch order, wrapped to
 *  the width of the board. */
export function arrangeWorkspace(
  state: Workspace,
  measured?: ReadonlyMap<string, number>,
  scope?: ReadonlySet<string>,
): Workspace {
  const board = scope
    ? state.tasks.filter((task) => scope.has(task.id))
    : state.tasks;
  if (!board.length) return state;
  const order = launchOrder(state);
  const rank = (id: string) => order.get(id) ?? Number.MAX_SAFE_INTEGER;
  const known = new Set(board.map((task) => task.id));
  const sources = new Map(board.map((task) => [task.id, [] as string[]]));
  const targets = new Map(board.map((task) => [task.id, [] as string[]]));
  const seen = new Set<string>();
  const connect = (source: string, target: string) => {
    const key = `${source}:${target}`;
    if (source === target || !known.has(source) || !known.has(target)) return;
    if (seen.has(key)) return;
    seen.add(key);
    sources.get(target)!.push(source);
    targets.get(source)!.push(target);
  };
  for (const link of state.links) connect(link.source, link.target);
  for (const task of board) if (task.parentId) connect(task.parentId, task.id);

  // Flows: what links join, and what a workflow names together.
  const parent = new Map(board.map((task) => [task.id, task.id]));
  const root = (id: string): string => {
    let at = id;
    while (parent.get(at) !== at) at = parent.get(at)!;
    parent.set(id, at);
    return at;
  };
  const join = (a: string, b: string) => parent.set(root(a), root(b));
  for (const [target, from] of sources)
    for (const source of from) join(source, target);
  const byWorkflow = new Map<string, string>();
  for (const task of board)
    for (const workflow of task.workflowIds ?? []) {
      const first = byWorkflow.get(workflow);
      if (first) join(first, task.id);
      else byWorkflow.set(workflow, task.id);
    }

  const queue = [...board].sort(byLaunchOrder(order));
  const groups = new Map<string, string[]>();
  for (const task of queue) {
    const key = root(task.id);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(task.id);
  }
  // A group is a flow when it holds more than one task; its place in the
  // stack is its first task's place in launch order.
  const flows = [...groups.values()].filter((ids) => ids.length > 1);
  const loose = [...groups.values()]
    .filter((ids) => ids.length === 1)
    .map((ids) => ids[0]);

  let unmeasured = nominalCardHeight;
  for (const value of measured?.values() ?? [])
    unmeasured = Math.max(unmeasured, value);
  const height = (id: string) => measured?.get(id) ?? unmeasured;

  const places = new Map<string, Point>();
  let top = 0;
  let widest = 1;
  for (const ids of flows) {
    // Columns by dependency depth, walked in launch order so a link that
    // closes a cycle is the one ignored.
    const column = new Map<string, number>();
    for (const id of ids) {
      let at = 0;
      for (const source of sources.get(id)!) {
        const before = column.get(source);
        if (before !== undefined) at = Math.max(at, before + 1);
      }
      column.set(id, at);
    }
    const columns: string[][] = [];
    for (const id of ids) (columns[column.get(id)!] ??= []).push(id);
    widest = Math.max(widest, columns.length);
    // Each column follows the one before it: a card sits level with the
    // tasks it waits on where it can, otherwise in launch order.
    const y = new Map<string, number>();
    let bottom = top;
    for (const [index, cards] of columns.entries()) {
      const wanted = (id: string) => {
        const from = sources
          .get(id)!
          .filter((source) => y.has(source))
          .map((source) => y.get(source)!);
        return from.length ? Math.min(...from) : top;
      };
      if (index)
        cards.sort((a, b) => wanted(a) - wanted(b) || rank(a) - rank(b));
      let next = top;
      for (const id of cards) {
        const at = Math.max(next, index ? wanted(id) : next);
        y.set(id, at);
        places.set(id, { x: index * columnPitch, y: at });
        next = at + height(id) + rowGap;
        bottom = Math.max(bottom, at + height(id));
      }
    }
    top = bottom + bandGap;
  }
  // Loose tasks wrap to the board's width, at least four to a row.
  const across = Math.max(widest, 4);
  for (let start = 0; start < loose.length; start += across) {
    const row = loose.slice(start, start + across);
    for (const [index, id] of row.entries())
      places.set(id, { x: index * columnPitch, y: top });
    top += Math.max(...row.map(height)) + rowGap;
  }

  const anchor = scope
    ? {
        x: Math.min(...board.map((task) => task.position.x)),
        y: Math.min(...board.map((task) => task.position.y)),
      }
    : { x: origin, y: origin };
  return {
    ...state,
    tasks: state.tasks.map((task) => {
      const place = places.get(task.id);
      return place
        ? {
            ...task,
            position: {
              x: Math.round(anchor.x + place.x),
              y: Math.round(anchor.y + place.y),
            },
          }
        : task;
    }),
  };
}

function byLaunchOrder(order: Map<string, number>) {
  return (a: Task, b: Task) => {
    const first = order.get(a.id);
    const second = order.get(b.id);
    if (first !== undefined && second !== undefined) return first - second;
    if (first !== undefined) return -1;
    if (second !== undefined) return 1;
    return (
      a.position.x - b.position.x ||
      a.position.y - b.position.y ||
      Number(a.referenceId) - Number(b.referenceId)
    );
  };
}
