import { createHash } from "node:crypto";
import type { AgentKind, AgentSpec } from "../src/domain.ts";
import { hostKinds } from "./hosts.ts";

/** How many agents this runner brings: `each` for every CLI it finds, or a
 *  count per kind, which wins over `each`. Nothing set means one per CLI. */
export type Crew = { each?: number } & Partial<Record<AgentKind, number>>;

export const crewLimit = 8;
const runnerPart = 40;

function clamp(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(crewLimit, Math.max(0, Math.floor(value)));
}

/** How many of each kind to run. A kind whose CLI is not on this machine gets
 *  none, whatever was asked. */
export function crewSize(
  hosts: readonly AgentKind[],
  crew: Crew = {},
): Record<AgentKind, number> {
  const each = clamp(crew.each) ?? 1;
  const sizes = {} as Record<AgentKind, number>;
  for (const kind of hostKinds)
    sizes[kind] = hosts.includes(kind) ? (clamp(crew[kind]) ?? each) : 0;
  return sizes;
}

function digest(runnerId: string): string {
  return createHash("sha256").update(runnerId).digest("hex");
}

/** One agent of this runner: its number, the CLI it runs on and its roster
 *  id. The number names it ("Studio 2"); the kind is only a tag. */
export type CrewSeat = { n: number; kind: AgentKind; id: string };

/** Agents one runner holds at most, so each still has a 1-9 key to attach. */
export const seatLimit = 9;

/** The same runner and number give the same id on every start, and two
 *  runners never share one. */
export function crewAgentId(runnerId: string, n: number): string {
  return `r${digest(runnerId).slice(0, 10)}-${n}`;
}

/** Ids of the form the runner wrote before its agents were numbered across
 *  kinds ("r…-claude-1"). A runner that finds its own keeps using them, so a
 *  lock or lease that names one never loses its agent. */
export function legacyAgentId(
  runnerId: string,
  kind: AgentKind,
  index: number,
): string {
  return `r${digest(runnerId).slice(0, 10)}-${kind}-${index}`;
}

function legacy(id: string): boolean {
  return /^r[0-9a-f]{10}-(claude|codex)-\d+$/.test(id);
}

function clip(value: string, limit: number): string {
  const plain = value.replace(/\s+/g, " ").trim();
  return plain.length > limit ? plain.slice(0, limit).trim() : plain;
}

/** "Studio 1", "Studio 2", whatever CLI each runs. A runner whose name ends
 *  in a digit reads "Desk 2 · 1". When another runner in the workspace goes by
 *  the same name, a short piece of this runner's id tells the two apart, so
 *  the result is still the same on every start. */
export function crewAgentName(
  runner: { id: string; name: string },
  n: number,
  taken: ReadonlySet<string> = new Set(),
): string {
  const base = clip(runner.name, runnerPart) || "Runner";
  const joined = (head: string) =>
    /\d$/.test(head) ? `${head} · ${n}` : `${head} ${n}`;
  const plain = joined(base);
  if (!taken.has(plain.toLowerCase())) return plain;
  return joined(`${base} (${digest(runner.id).slice(0, 4)})`);
}

export function ownedBy(spec: AgentSpec, runnerId: string): boolean {
  return !!runnerId && spec.runner === runnerId;
}

/** A crew with these counts, numbered across kinds in turn (1 Claude,
 *  2 Codex, 3 Claude…). Ids this runner wrote in the older per-kind form are
 *  kept for the same kind, in roster order. */
export function planCrew(
  runnerId: string,
  sizes: Record<AgentKind, number>,
  roster: readonly AgentSpec[] = [],
): CrewSeat[] {
  const kept = new Map<AgentKind, string[]>();
  for (const spec of roster)
    if (ownedBy(spec, runnerId) && legacy(spec.id))
      kept.set(spec.kind, [...(kept.get(spec.kind) ?? []), spec.id]);
  const seats: CrewSeat[] = [];
  const most = Math.max(0, ...hostKinds.map((kind) => sizes[kind] ?? 0));
  for (let round = 0; round < most; round++)
    for (const kind of hostKinds) {
      if (round >= (sizes[kind] ?? 0)) continue;
      const n = seats.length + 1;
      seats.push({
        n,
        kind,
        id: kept.get(kind)?.shift() ?? crewAgentId(runnerId, n),
      });
    }
  return seats;
}

/** A saved crew as read back from disk, or undefined when it is not one. */
export function parseCrew(value: unknown): CrewSeat[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seats: CrewSeat[] = [];
  for (const entry of value) {
    const seat = (entry ?? {}) as Partial<CrewSeat>;
    const n = Number(seat.n);
    if (!Number.isInteger(n) || n < 1 || n > 99) continue;
    if (!hostKinds.includes(seat.kind as AgentKind)) continue;
    if (typeof seat.id !== "string" || !seat.id.trim()) continue;
    const id = seat.id.trim();
    if (seats.some((other) => other.n === n || other.id === id)) continue;
    seats.push({ n, kind: seat.kind as AgentKind, id });
  }
  return seats.sort((left, right) => left.n - right.n).slice(0, seatLimit);
}

/** The kind a new agent runs on: the CLI on this machine that the crew uses
 *  least, the first found on a tie. Undefined when neither is here. */
export function leastUsed(
  seats: readonly CrewSeat[],
  hosts: readonly AgentKind[],
): AgentKind | undefined {
  let best: AgentKind | undefined;
  let fewest = Infinity;
  for (const kind of hostKinds) {
    if (!hosts.includes(kind)) continue;
    const used = seats.filter((seat) => seat.kind === kind).length;
    if (used < fewest) {
      best = kind;
      fewest = used;
    }
  }
  return best;
}

/** The crew with one more agent, under the lowest free number. */
export function addSeat(
  seats: readonly CrewSeat[],
  runnerId: string,
  kind: AgentKind,
): CrewSeat[] {
  let n = 1;
  while (seats.some((seat) => seat.n === n)) n++;
  const id = crewAgentId(runnerId, n);
  return [...seats.filter((seat) => seat.id !== id), { n, kind, id }].sort(
    (left, right) => left.n - right.n,
  );
}

/** The agent `-` takes away: the highest-numbered one that is neither
 *  working nor named by a lock. */
export function removableSeat(
  seats: readonly CrewSeat[],
  busy: ReadonlySet<string>,
): CrewSeat | undefined {
  return [...seats]
    .sort((left, right) => right.n - left.n)
    .find((seat) => !busy.has(seat.id));
}

/** The roster entries this runner should hold now, for the seats whose CLI
 *  is on this machine. An entry someone switched off in the app stays off. */
export function crewSpecs(
  runner: { id: string; name: string },
  seats: readonly CrewSeat[],
  roster: readonly AgentSpec[],
  hosts: readonly AgentKind[] = hostKinds,
): AgentSpec[] {
  const taken = new Set(
    roster
      .filter((spec) => !ownedBy(spec, runner.id))
      .map((spec) => spec.name.trim().toLowerCase()),
  );
  return seats
    .filter((seat) => hosts.includes(seat.kind))
    .map((seat) => {
      const before = roster.find((spec) => spec.id === seat.id);
      return {
        id: seat.id,
        name: crewAgentName(runner, seat.n, taken),
        kind: seat.kind,
        enabled: before ? before.enabled !== false : true,
        runner: runner.id,
      };
    });
}

/** Where a run's crew comes from: counts given on the command line (which
 *  are then saved), else the crew saved for this folder, else one agent per
 *  CLI found. */
export function startingCrew(options: {
  runnerId: string;
  hosts: readonly AgentKind[];
  crew?: Crew;
  saved?: readonly CrewSeat[];
  roster?: readonly AgentSpec[];
}): { seats: CrewSeat[]; save: boolean } {
  const flagged = Object.values(options.crew ?? {}).some(
    (value) => value !== undefined,
  );
  if (!flagged && options.saved)
    return { seats: [...options.saved], save: false };
  return {
    seats: planCrew(
      options.runnerId,
      crewSize(options.hosts, flagged ? options.crew : {}),
      options.roster,
    ),
    save: flagged,
  };
}

export type Tidy = {
  /** Agents that must stay while a lock or lease names them. */
  keep?: ReadonlySet<string>;
  /** False until the runner has heard which locks it holds. */
  prune?: boolean;
  /** Runners the workspace still lists. With it, entries of a runner that is
   *  no longer listed at all go, unless `keep` names them. */
  listed?: ReadonlySet<string>;
};

/** The roster with this runner's crew written in: its entries updated in
 *  place, new ones added at the end, and ones it no longer runs removed once
 *  nothing holds them. Hand-made entries are never touched. Null when nothing
 *  would change. */
export function reconcileRoster(
  roster: readonly AgentSpec[],
  desired: readonly AgentSpec[],
  runnerId: string,
  tidy: Tidy = {},
): AgentSpec[] | null {
  const keep = tidy.keep ?? new Set<string>();
  const wanted = new Map(desired.map((spec) => [spec.id, spec]));
  const next: AgentSpec[] = [];
  for (const spec of roster) {
    const fresh = wanted.get(spec.id);
    if (fresh) {
      next.push(fresh);
      wanted.delete(spec.id);
      continue;
    }
    const mine = ownedBy(spec, runnerId);
    const gone =
      !mine && !!spec.runner && !!tidy.listed && !tidy.listed.has(spec.runner);
    if ((mine || gone) && tidy.prune && !keep.has(spec.id)) continue;
    next.push(spec);
  }
  next.push(...wanted.values());
  return JSON.stringify(next) === JSON.stringify(roster) ? null : next;
}

/** What to ask the server to seat: this runner's own agents and whatever was
 *  already picked for it in the app, as long as the roster still has them
 *  switched on, since the server refuses the whole list over one unknown id. */
export function seatsWanted(
  roster: readonly AgentSpec[],
  wanted: readonly string[],
  own: readonly string[],
): string[] {
  const on = new Set(
    roster
      .filter((spec) => spec.enabled && spec.id && spec.name.trim())
      .map((spec) => spec.id),
  );
  return [...new Set([...wanted, ...own])].filter((id) => on.has(id));
}
