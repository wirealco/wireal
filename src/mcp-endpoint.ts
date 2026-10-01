/**
 * The MCP server's public URL, as shown in the docs and on the landing page.
 * A build sets it with VITE_MCP_URL; vite.config.ts fills in the hosted
 * service's address when it is unset, so a self-hosted build only needs the
 * variable to point its instructions at its own server.
 */
export const mcpEndpoint: string =
  import.meta.env?.VITE_MCP_URL?.trim() || "https://mcp.wireal.co/mcp";

/** The host alone, for copy that names the server rather than linking it. */
export const mcpHost: string = new URL(mcpEndpoint).host;
