import {
  agentBrand,
  agentDisplayName,
  agentQualifier,
} from "../src/agent-identity.ts";

export type McpCallerIdentity = {
  clientInfoName?: string;
  registeredClientName?: string;
  userAgent?: string;
  handle?: string;
  fallback: string;
};

const placeholders = new Set([
  "agent",
  "mcp",
  "mcp client",
  "unknown",
  "client",
]);

function realName(candidate: string | undefined): string | undefined {
  const name = candidate?.trim();
  return name && !placeholders.has(name.toLowerCase()) ? name : undefined;
}

export function agentHandle(value: string | undefined): string {
  return (value ?? "")
    .replace(/[^\p{L}\p{N} ._-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24)
    .trim();
}

function qualified(name: string, handle: string): string {
  if (!handle || agentQualifier(name)) return name;
  return `${name} · ${handle}`;
}

export function mcpCallerName(identity: McpCallerIdentity): string {
  const clientInfoName = identity.clientInfoName?.trim();
  const registeredClientName = identity.registeredClientName?.trim();
  const userAgent = identity.userAgent?.trim();
  const handle = agentHandle(identity.handle);

  // The grant is the connector the user approved and can audit, so its brand
  // wins if an MCP client reports a different brand for the same request.
  for (const candidate of [registeredClientName, clientInfoName, userAgent]) {
    if (candidate && agentBrand(candidate))
      return qualified(agentDisplayName(candidate), handle);
  }

  // User-Agent is deliberately excluded here: raw UA strings are noisy and
  // should only contribute when they identify one of our known brands.
  for (const candidate of [clientInfoName, registeredClientName]) {
    const name = realName(candidate);
    if (name) return qualified(agentDisplayName(name), handle);
  }

  return qualified(agentDisplayName(identity.fallback), handle);
}

/** The product a person is driving, for presence ("Grace · Claude Code").
 *  Claude Code says so in its handshake; everything else falls back to the
 *  brand the activity record would show. */
export function mcpClientLabel(
  identity: Omit<McpCallerIdentity, "handle">,
): string {
  for (const candidate of [
    identity.clientInfoName,
    identity.registeredClientName,
    identity.userAgent,
  ])
    if (candidate && /claude[\s_-]?code/i.test(candidate)) return "Claude Code";
  return mcpCallerName(identity).slice(0, 60);
}
