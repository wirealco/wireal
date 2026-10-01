/**
 * The Wireal MCP server as a plain Node HTTP server, for Docker Compose.
 *
 * The hosted endpoint runs mcp/worker.ts on Cloudflare Workers. That handler
 * only speaks the Fetch API (Request in, Response out), which Node 22 has too,
 * so this file just translates node:http to and from it. Nothing here knows
 * about MCP. It serves plain HTTP; Caddy terminates TLS in front of it.
 *
 * Configuration, read once at start:
 *   WIREAL_API_URL     HTTPS origin of the Wireal API (required)
 *   MCP_PUBLIC_URL     public HTTPS origin of this server, as clients reach it
 *   WIREAL_APP_URL     the web app's origin, linked as the server's documentation
 *   WIREAL_AGENT_NAME  author recorded when a client does not name itself
 *   PORT               listening port, 8787 by default
 */
import { createServer } from "node:http";
import { Readable } from "node:stream";
import mcp, { type WorkerEnv } from "../../mcp/worker.ts";

const env: WorkerEnv = {
  WIREAL_API_URL: process.env.WIREAL_API_URL?.trim() ?? "",
  MCP_PUBLIC_URL: process.env.MCP_PUBLIC_URL?.trim() || undefined,
  WIREAL_APP_URL: process.env.WIREAL_APP_URL?.trim() || undefined,
  WIREAL_AGENT_NAME: process.env.WIREAL_AGENT_NAME?.trim() || undefined,
};
if (!env.WIREAL_API_URL) {
  console.error("Set WIREAL_API_URL to the HTTPS origin of the Wireal API.");
  process.exit(1);
}
const origin = env.MCP_PUBLIC_URL ?? "http://localhost";
const port = Number(process.env.PORT || 8787);

const server = createServer(async (incoming, outgoing) => {
  try {
    const headers = new Headers();
    for (let i = 0; i < incoming.rawHeaders.length; i += 2)
      headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
    const method = incoming.method ?? "GET";
    const request = new Request(new URL(incoming.url ?? "/", origin), {
      method,
      headers,
      body:
        method === "GET" || method === "HEAD"
          ? undefined
          : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>),
      // Required by Node for a streamed request body.
      duplex: "half",
    } as RequestInit);
    const response = await mcp.fetch(request, env, {
      // Workers keeps a promise alive after the response; Node does anyway.
      waitUntil: (promise) => void promise.catch(() => undefined),
    });
    const head: Record<string, string | string[]> = {};
    response.headers.forEach((value, key) => {
      head[key] =
        key === "set-cookie" ? response.headers.getSetCookie() : value;
    });
    outgoing.writeHead(response.status, head);
    if (!response.body || method === "HEAD") return void outgoing.end();
    // Streamed through, so server-sent events reach the client as they happen.
    Readable.fromWeb(response.body as never).pipe(outgoing);
  } catch (error) {
    console.error("Wireal MCP request failed:", (error as Error).message);
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
});
server.listen(port, () =>
  console.log(`Wireal MCP listening on :${port}, API ${env.WIREAL_API_URL}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close(() => process.exit(0)));
