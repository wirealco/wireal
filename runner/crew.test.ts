import assert from "node:assert/strict";
import test from "node:test";
import type { AgentKind, AgentSpec } from "../src/domain.ts";
import {
  addSeat,
  crewAgentId,
  crewAgentName,
  crewSize,
  crewSpecs,
  leastUsed,
  legacyAgentId,
  parseCrew,
  planCrew,
  reconcileRoster,
  removableSeat,
  seatsWanted,
  startingCrew,
} from "./crew.ts";
import { agentIdentity } from "./roster.ts";

const studio = { id: "runner-studio", name: "Studio" };
const laptop = { id: "runner-laptop", name: "Studio" };

const hand = (over: Partial<AgentSpec> = {}): AgentSpec => ({
  id: "ada",
  name: "Ada",
  kind: "claude",
  enabled: true,
  ...over,
});

const seatsOf = (
  runner: { id: string },
  sizes: Record<AgentKind, number>,
  roster: readonly AgentSpec[] = [],
) => planCrew(runner.id, sizes, roster);

/** The server's roster rule for seats and locks (AgentRoster in
 *  ProjectRunners.cs): switched on, with an id, a name and a known kind. */
const serverAccepts = (spec: AgentSpec) =>
  spec.enabled === true &&
  spec.id.trim().length > 0 &&
  spec.name.trim().length > 0 &&
  (spec.kind === "claude" || spec.kind === "codex");

test("one agent per CLI found by default, more when asked, none without the CLI", () => {
  assert.deepEqual(crewSize(["claude", "codex"]), { claude: 1, codex: 1 });
  assert.deepEqual(crewSize(["claude"]), { claude: 1, codex: 0 });
  assert.deepEqual(crewSize(["claude", "codex"], { each: 3 }), {
    claude: 3,
    codex: 3,
  });
  assert.deepEqual(crewSize(["claude", "codex"], { claude: 2, codex: 0 }), {
    claude: 2,
    codex: 0,
  });
  assert.deepEqual(crewSize(["claude", "codex"], { each: 0, codex: 1 }), {
    claude: 0,
    codex: 1,
  });
  assert.deepEqual(crewSize(["codex"], { claude: 4 }), { claude: 0, codex: 1 });
  assert.deepEqual(crewSize(["claude"], { each: 99 }), { claude: 8, codex: 0 });
});

test("agents are numbered across kinds, with neutral names and stable ids", () => {
  const first = crewAgentId(studio.id, 1);
  assert.equal(first, crewAgentId(studio.id, 1));
  assert.match(first, /^r[0-9a-f]{10}-1$/);
  assert.notEqual(first, crewAgentId(studio.id, 2));
  assert.notEqual(first, crewAgentId(laptop.id, 1));
  assert.deepEqual(
    seatsOf(studio, { claude: 2, codex: 1 }).map(({ n, kind }) => [n, kind]),
    [
      [1, "claude"],
      [2, "codex"],
      [3, "claude"],
    ],
  );
  assert.equal(crewAgentName(studio, 1), "Studio 1");
  assert.equal(crewAgentName(studio, 2), "Studio 2");
  assert.equal(crewAgentName({ id: "x", name: "Desk 2" }, 1), "Desk 2 · 1");
  assert.equal(crewAgentName({ id: "x", name: "  " }, 3), "Runner 3");
  // Authorship still carries the kind, as a tag in front of the name.
  assert.equal(
    agentIdentity(hand({ name: "Studio 1", kind: "codex" })),
    "Codex · Studio 1",
  );
});

test("a runner that wrote per-kind ids keeps them, so no lock loses its agent", () => {
  const old = [
    {
      id: legacyAgentId(studio.id, "claude", 1),
      name: "Studio · Claude",
      kind: "claude" as const,
      enabled: true,
      runner: studio.id,
    },
    {
      id: legacyAgentId(studio.id, "codex", 1),
      name: "Studio · Codex",
      kind: "codex" as const,
      enabled: true,
      runner: studio.id,
    },
    hand({ id: legacyAgentId(laptop.id, "claude", 1), runner: laptop.id }),
  ];
  const seats = seatsOf(studio, { claude: 2, codex: 1 }, old);
  assert.deepEqual(
    seats.map((seat) => seat.id),
    [old[0]!.id, old[1]!.id, crewAgentId(studio.id, 3)],
  );
  const specs = crewSpecs(studio, seats, old);
  assert.deepEqual(
    specs.map((spec) => spec.name),
    ["Studio 1", "Studio 2", "Studio 3"],
  );
  assert.equal(
    reconcileRoster(old, specs, studio.id, { prune: true })?.length,
    4,
  );
});

test("two runners with one name in a workspace still get distinct names", () => {
  const sizes = crewSize(["claude", "codex"]);
  const one = crewSpecs(studio, seatsOf(studio, sizes), []);
  const two = crewSpecs(laptop, seatsOf(laptop, sizes), one);
  const names = [...one, ...two].map((spec) => spec.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
  assert.match(two[0]!.name, /^Studio \([0-9a-f]{4}\) 1$/);
  assert.deepEqual(crewSpecs(laptop, seatsOf(laptop, sizes), one), two);
  assert.equal(
    new Set([...one, ...two].map((spec) => spec.id)).size,
    one.length + two.length,
  );
});

test("a runner's agents are ones the server seats and locks to", () => {
  const specs = crewSpecs(
    studio,
    seatsOf(studio, crewSize(["claude", "codex"])),
    [],
  );
  assert.equal(specs.length, 2);
  for (const spec of specs) {
    assert.ok(serverAccepts(spec));
    assert.equal(spec.runner, studio.id);
    assert.equal(spec.model, undefined);
    assert.equal(spec.brief, undefined);
  }
});

test("a seat whose CLI is not on this machine is kept but not written", () => {
  const seats = seatsOf(studio, { claude: 1, codex: 1 });
  assert.deepEqual(
    crewSpecs(studio, seats, [], ["codex"]).map((spec) => spec.kind),
    ["codex"],
  );
});

test("an agent switched off in the app stays off", () => {
  const id = crewAgentId(studio.id, 1);
  const [spec] = crewSpecs(studio, seatsOf(studio, { claude: 1, codex: 0 }), [
    { id, name: "old", kind: "claude", enabled: false, runner: studio.id },
  ]);
  assert.equal(spec!.enabled, false);
  assert.equal(spec!.name, "Studio 1");
});

test("+ takes the CLI used least and the lowest free number; - the highest idle one", () => {
  const one = seatsOf(studio, { claude: 1, codex: 0 });
  assert.equal(leastUsed(one, ["claude", "codex"]), "codex");
  assert.equal(leastUsed(one, ["claude"]), "claude");
  assert.equal(leastUsed([], []), undefined);
  const two = addSeat(one, studio.id, "codex");
  assert.deepEqual(
    two.map(({ n, kind, id }) => [n, kind, id]),
    [
      [1, "claude", one[0]!.id],
      [2, "codex", crewAgentId(studio.id, 2)],
    ],
  );
  const three = addSeat(two, studio.id, "claude");
  assert.equal(removableSeat(three, new Set())?.n, 3);
  assert.equal(removableSeat(three, new Set([three[2]!.id]))?.n, 2);
  assert.equal(
    removableSeat(three, new Set(three.map((seat) => seat.id))),
    undefined,
  );
  const gap = three.filter((seat) => seat.n !== 2);
  assert.equal(addSeat(gap, studio.id, "codex")[1]!.n, 2);
});

test("a crew comes from the flags, else what was saved, else one per CLI", () => {
  const saved = seatsOf(studio, { claude: 3, codex: 0 });
  const hosts = ["claude", "codex"] as AgentKind[];
  assert.deepEqual(startingCrew({ runnerId: studio.id, hosts, saved }), {
    seats: saved,
    save: false,
  });
  const flagged = startingCrew({
    runnerId: studio.id,
    hosts,
    saved,
    crew: { codex: 2, each: 0 },
  });
  assert.equal(flagged.save, true);
  assert.deepEqual(
    flagged.seats.map((seat) => seat.kind),
    ["codex", "codex"],
  );
  assert.deepEqual(
    startingCrew({ runnerId: studio.id, hosts, crew: {} }).seats.map(
      (seat) => seat.kind,
    ),
    ["claude", "codex"],
  );
  assert.deepEqual(
    startingCrew({ runnerId: studio.id, hosts, saved: [] }).seats,
    [],
  );
});

test("a saved crew reads back only what makes sense", () => {
  assert.equal(parseCrew(undefined), undefined);
  assert.deepEqual(
    parseCrew([
      { n: 2, kind: "codex", id: "b" },
      { n: 1, kind: "claude", id: "a" },
      { n: 1, kind: "claude", id: "dup" },
      { n: 3, kind: "gpt", id: "c" },
      { n: 0, kind: "claude", id: "d" },
      null,
    ]),
    [
      { n: 1, kind: "claude", id: "a" },
      { n: 2, kind: "codex", id: "b" },
    ],
  );
});

test("the roster gains the crew and keeps hand-made agents where they are", () => {
  const desired = crewSpecs(studio, seatsOf(studio, crewSize(["claude"])), []);
  const next = reconcileRoster([hand()], desired, studio.id);
  assert.deepEqual(next, [hand(), ...desired]);
  assert.equal(reconcileRoster(next!, desired, studio.id), null);
});

test("a renamed runner renames its agents in place", () => {
  const seats = seatsOf(studio, crewSize(["claude"]));
  const before = crewSpecs(studio, seats, []);
  const renamed = crewSpecs({ ...studio, name: "Desk" }, seats, []);
  const next = reconcileRoster([...before, hand()], renamed, studio.id);
  assert.deepEqual(
    next?.map((spec) => spec.name),
    ["Desk 1", "Ada"],
  );
});

test("agents the runner no longer runs go once nothing holds them", () => {
  const two = crewSpecs(studio, seatsOf(studio, { claude: 2, codex: 0 }), []);
  const one = two.slice(0, 1);
  const extra = two[1]!.id;
  assert.equal(reconcileRoster(two, one, studio.id), null);
  assert.equal(
    reconcileRoster(two, one, studio.id, {
      prune: true,
      keep: new Set([extra]),
    }),
    null,
  );
  assert.deepEqual(reconcileRoster(two, one, studio.id, { prune: true }), one);
});

test("another runner's agents stay unless the workspace no longer lists it", () => {
  const mine = crewSpecs(studio, seatsOf(studio, crewSize(["claude"])), []);
  const theirs = crewSpecs(laptop, seatsOf(laptop, crewSize(["codex"])), mine);
  const roster = [...mine, ...theirs, hand()];
  assert.equal(
    reconcileRoster(roster, mine, studio.id, {
      prune: true,
      listed: new Set([studio.id, laptop.id]),
    }),
    null,
  );
  assert.equal(reconcileRoster(roster, mine, studio.id, { prune: true }), null);
  assert.deepEqual(
    reconcileRoster(roster, mine, studio.id, {
      prune: true,
      listed: new Set([studio.id]),
    }),
    [...mine, hand()],
  );
  assert.equal(
    reconcileRoster(roster, mine, studio.id, {
      prune: true,
      listed: new Set([studio.id]),
      keep: new Set([theirs[0]!.id]),
    }),
    null,
  );
});

test("the seats asked for are the crew plus what was picked, all still switched on", () => {
  const roster = [
    hand(),
    hand({ id: "ida", enabled: false }),
    ...crewSpecs(studio, seatsOf(studio, crewSize(["claude"])), []),
  ];
  const own = [roster[2]!.id];
  assert.deepEqual(seatsWanted(roster, ["ada", "ida", "gone"], own), [
    "ada",
    own[0],
  ]);
  assert.deepEqual(seatsWanted(roster, [], own), own);
});
