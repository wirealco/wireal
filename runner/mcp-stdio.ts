import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createWirealServer, profileFromEnv } from "../mcp/create-server.ts";
import { sessionClient } from "./board.ts";

// The runner starts its agents with WIREAL_MCP_PROFILE=runner, which leaves
// them the few tools a task needs (task_brief, report, add_task_activity,
// propose_task) instead of the whole board.
const agentName = process.env.WIREAL_AGENT_NAME?.trim() || "Agent";
const workspaceId = process.env.WIREAL_WORKSPACE_ID?.trim() || undefined;
const server = createWirealServer(sessionClient(agentName, workspaceId), {
  profile: profileFromEnv(process.env),
});
await server.connect(new StdioServerTransport());
