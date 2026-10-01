import { claude } from "./claude.ts";
import { codex } from "./codex.ts";
import type { AgentDriver, AgentKind } from "./types.ts";

export function driverFor(kind: AgentKind): AgentDriver {
  return kind === "codex" ? codex : claude;
}
