import { launchOrder, type Task, type Workspace } from "./domain";

export const cardWidth = 288;
export const nominalCardHeight = 108;
const columnGap = 120;
const rowGap = 56;
const flowGap = 128;
const laneClearance = 36;
const origin = 40;
const sweeps = 6;

const columnPitch = cardWidth + columnGap;

type Point = { x: number; y: number };
type Item = {
  id: string | null;
  group: number | null;
  height: number;
  desired: number;
  weight: number;
};

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
  const known = new Set(board.map((task) => task.id));
  const sources = new Map(board.map((task) => [task.id, [] as string[]]));
  const targets = new Map(board.map((task) => [task.id, [] as string[]]));
  const edges: { source: string; target: string }[] = [];
  const seen = new Set<string>();
  const connect = (source: string, target: string) => {
    const key = `${source}:${target}`;
    if (source === target || !known.has(source) || !known.has(target)) return;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target });
    sources.get(target)!.push(source);
    targets.get(source)!.push(target);
  };
  for (const link of state.links) connect(link.source, link.target);
  for (const task of board) if (task.parentId) connect(task.parentId, task.id);

  const queue = [...board].sort(byLaunchOrder(order));
  const column = new Map<string, number>();
  const columns: string[][] = [];
  for (const task of queue) {
    let at = 0;
    for (const source of sources.get(task.id)!) {
      const before = column.get(source);
      if (before !== undefined) at = Math.max(at, before + 1);
    }
    column.set(task.id, at);
    (columns[at] ??= []).push(task.id);
  }

  const flow = new Map<string, number>();
  let flows = 0;
  for (const task of queue) {
    if (flow.has(task.id)) continue;
    const walk = [task.id];
    flow.set(task.id, flows);
    while (walk.length) {
      const id = walk.pop()!;
      for (const next of [...sources.get(id)!, ...targets.get(id)!])
        if (!flow.has(next)) {
          flow.set(next, flows);
          walk.push(next);
        }
    }
    flows++;
  }

  // A card React Flow has not measured yet is given the tallest height on the
  // board rather than the nominal one: too much room is a gap, too little is an
  // overlap.
  let unmeasured = nominalCardHeight;
  for (const height of measured?.values() ?? [])
    unmeasured = Math.max(unmeasured, height);
  const height = (id: string) => measured?.get(id) ?? unmeasured;
  const gap = (above: string, below: string) =>
    flow.get(above) === flow.get(below) ? rowGap : flowGap;
  const y = new Map<string, number>();
  const center = (id: string) => y.get(id)! + height(id) / 2;
  for (const ids of columns) {
    let top = 0;
    for (const [row, id] of ids.entries()) {
      y.set(id, top);
      top += height(id) + (row + 1 < ids.length ? gap(id, ids[row + 1]) : 0);
    }
  }

  const previous = new Map<string, string>();
  for (const [index, task] of queue.entries())
    if (index) previous.set(task.id, queue[index - 1].id);

  const rank = (id: string) => order.get(id) ?? Number.MAX_SAFE_INTEGER;

  for (let sweep = 0; sweep < sweeps; sweep++) {
    for (const [index, ids] of columns.entries()) {
      const anchor = new Map<string, number>();
      for (const id of ids) {
        const from = sources.get(id)!;
        const to = targets.get(id)!;
        anchor.set(
          id,
          from.length
            ? median(from.map(center))
            : to.length
              ? median(to.map(center))
              : center(id),
        );
      }
      ids.sort(
        (a, b) =>
          flow.get(a)! - flow.get(b)! ||
          anchor.get(a)! - anchor.get(b)! ||
          rank(a) - rank(b),
      );
      let seeded = Math.min(...ids.map((id) => y.get(id)!));
      for (const [row, id] of ids.entries()) {
        y.set(id, seeded);
        seeded +=
          height(id) + (row + 1 < ids.length ? gap(id, ids[row + 1]) : 0);
      }
      const cards: Item[] = ids.map((id, row) => {
        const from = sources.get(id)!;
        const to = targets.get(id)!;
        const group = flow.get(id)!;
        if (from.length)
          return {
            id,
            group,
            height: height(id),
            desired: median(from.map(center)) - height(id) / 2,
            weight: 1,
          };
        if (to.length && sweep)
          return {
            id,
            group,
            height: height(id),
            desired: median(to.map(center)) - height(id) / 2,
            weight: 0.5,
          };
        const above = row ? ids[row - 1] : previous.get(id);
        const desired =
          above === undefined
            ? 0
            : row
              ? y.get(above)! + height(above) + gap(above, id)
              : y.get(above)!;
        return { id, group, height: height(id), desired, weight: 0.05 };
      });
      const lanes = edges
        .filter((edge) => {
          const start = column.get(edge.source)!;
          const end = column.get(edge.target)!;
          return start < index && index < end;
        })
        .map((edge) => {
          const start = column.get(edge.source)!;
          const end = column.get(edge.target)!;
          const from = center(edge.source);
          const to = center(edge.target);
          const [low, high] =
            start + end === index * 2
              ? [Math.min(from, to), Math.max(from, to)]
              : index * 2 < start + end
                ? [from, from]
                : [to, to];
          return {
            id: null,
            group: null,
            height: high - low + laneClearance * 2,
            desired: low - laneClearance,
            weight: 1000,
          };
        })
        .sort((a, b) => a.desired - b.desired);
      const items: Item[] = [];
      let next = 0;
      let reached = -Infinity;
      for (const card of cards) {
        const middle = Math.max(reached, card.desired + card.height / 2);
        reached = middle;
        while (
          next < lanes.length &&
          lanes[next].desired + lanes[next].height / 2 <= middle
        )
          items.push(lanes[next++]);
        items.push(card);
      }
      items.push(...lanes.slice(next));
      const tops = stack(items);
      for (const [at, item] of items.entries())
        if (item.id) y.set(item.id, tops[at]);
    }
  }

  const lowest = Math.min(...[...y.values()]);
  const anchor = scope
    ? {
        x: Math.min(...board.map((task) => task.position.x)),
        y: Math.min(...board.map((task) => task.position.y)),
      }
    : { x: origin, y: origin };
  const places = new Map<string, Point>();
  for (const [id, top] of y)
    places.set(id, {
      x: Math.round(anchor.x + column.get(id)! * columnPitch),
      y: Math.round(anchor.y + top - lowest),
    });
  return {
    ...state,
    tasks: state.tasks.map((task) => {
      const place = places.get(task.id);
      return place ? { ...task, position: place } : task;
    }),
  };
}

function stack(items: Item[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const [index, item] of items.entries()) {
    offsets.push(offset);
    const following = items[index + 1];
    offset +=
      item.height +
      (item.id && following?.id
        ? item.group === following.group
          ? rowGap
          : flowGap
        : 0);
  }
  const fitted = isotonic(
    items.map((item, index) => item.desired - offsets[index]),
    items.map((item) => item.weight),
  );
  return fitted.map((value, index) => value + offsets[index]);
}

function isotonic(values: number[], weights: number[]): number[] {
  const blocks: { start: number; end: number; weight: number; mean: number }[] =
    [];
  for (const [index, value] of values.entries()) {
    let block = {
      start: index,
      end: index,
      weight: weights[index],
      mean: value,
    };
    while (blocks.length && blocks[blocks.length - 1].mean > block.mean) {
      const before = blocks.pop()!;
      const weight = before.weight + block.weight;
      block = {
        start: before.start,
        end: block.end,
        weight,
        mean:
          (before.mean * before.weight + block.mean * block.weight) / weight,
      };
    }
    blocks.push(block);
  }
  const out: number[] = [];
  for (const block of blocks)
    for (let index = block.start; index <= block.end; index++)
      out[index] = block.mean;
  return out;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
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
