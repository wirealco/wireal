import {
  namesBrand,
  type AgentKind,
  type AgentSettings,
  type AgentSpec,
} from "../src/domain.ts";
import type { LeaseRow } from "./api.ts";

export const brandNames: Record<AgentKind, string> = {
  claude: "Claude",
  codex: "Codex",
};

export function rosterOf(settings: AgentSettings): AgentSpec[] {
  return (settings.roster ?? []).filter((agent) => agent?.id);
}

export function agentIdentity(agent: AgentSpec): string {
  const brand = brandNames[agent.kind] ?? brandNames.claude;
  const name = agent.name.trim();
  if (!name || name.toLowerCase() === brand.toLowerCase()) return brand;
  return namesBrand(name, brand) ? name : `${brand} · ${name}`;
}

export function leaseHolders(leases: readonly LeaseRow[]): Set<string> {
  return new Set(leases.map((lease) => lease.agent ?? "").filter(Boolean));
}

export function freeAgents(
  roster: readonly AgentSpec[],
  hosts: readonly AgentKind[],
  busy: ReadonlySet<string>,
): AgentSpec[] {
  return roster.filter(
    (agent) =>
      agent.enabled && hosts.includes(agent.kind) && !busy.has(agent.id),
  );
}
