import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSettings, AgentSpec } from "../src/domain.ts";
import { detectHosts } from "./hosts.ts";
import { agentIdentity, freeAgents, leaseHolders, rosterOf } from "./roster.ts";

const agent = (over: Partial<AgentSpec> = {}): AgentSpec => ({
  id: "ada",
  name: "Ada",
  kind: "claude",
  enabled: true,
  ...over,
});

const settings = (over: Partial<AgentSettings> = {}): AgentSettings => ({
  mode: "automatic",
  leaseMinutes: 5,
  ...over,
});

test("a runner hosts the agents whose command sits on its PATH", () => {
  const installed = (...files: string[]) => {
    const found = new Set(files);
    return (file: string) => found.has(file);
  };
  assert.deepEqual(
    detectHosts({
      path: "/usr/bin:/opt/homebrew/bin",
      platform: "darwin",
      exists: installed("/opt/homebrew/bin/claude", "/usr/bin/codex"),
    }),
    ["claude", "codex"],
  );
  assert.deepEqual(
    detectHosts({
      path: "/usr/bin:/opt/homebrew/bin",
      platform: "darwin",
      exists: installed("/usr/bin/codex"),
    }),
    ["codex"],
  );
  assert.deepEqual(
    detectHosts({
      path: "C:\\tools;C:\\bin",
      platform: "win32",
      exists: installed("C:\\tools\\claude.cmd"),
    }),
    ["claude"],
  );
  assert.deepEqual(
    detectHosts({ path: "", platform: "darwin", exists: () => true }),
    [],
  );
});

test("an empty roster has no agents", () => {
  assert.deepEqual(rosterOf(settings()), []);
  assert.deepEqual(rosterOf(settings({ roster: [] })), []);
  const roster = [agent(), agent({ id: "rex", name: "Rex", kind: "codex" })];
  assert.deepEqual(rosterOf(settings({ roster })), roster);
});

test("an agent signs its work with its brand and its name", () => {
  assert.equal(agentIdentity(agent()), "Claude · Ada");
  assert.equal(
    agentIdentity(agent({ id: "rex", name: "Rex", kind: "codex" })),
    "Codex · Rex",
  );
  assert.equal(agentIdentity(agent({ name: "Claude" })), "Claude");
  assert.equal(agentIdentity(agent({ name: "Codex", kind: "codex" })), "Codex");
  assert.equal(agentIdentity(agent({ name: "  " })), "Claude");
});

test("a free agent is enabled, hosted and holds no lease anywhere", () => {
  const roster = [
    agent(),
    agent({ id: "rex", name: "Rex", kind: "codex" }),
    agent({ id: "ida", name: "Ida", enabled: false }),
  ];
  const busy = leaseHolders([
    { task_id: "fixture-task-7", agent: "ada", until: "2026-09-16T00:05:00Z" },
    { task_id: "fixture-task-4", until: "2026-09-16T00:05:00Z" },
  ]);
  assert.deepEqual([...busy], ["ada"]);
  assert.deepEqual(
    freeAgents(roster, ["claude", "codex"], busy).map((free) => free.id),
    ["rex"],
  );
  assert.deepEqual(
    freeAgents(roster, ["claude"], new Set()).map((free) => free.id),
    ["ada"],
  );
  assert.deepEqual(
    freeAgents(roster, [], new Set()).map((free) => free.id),
    [],
  );
});
