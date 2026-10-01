import mcp, { type WorkerEnv as McpEnv } from "../mcp/worker.ts";

/**
 * The one Wireal Worker: the web app and the MCP server behind a single
 * deployment, told apart by hostname.
 *
 * Static assets are configured with `run_worker_first: true`, so this runs
 * ahead of asset serving on every request. It has to: the app is a SPA, and
 * `not_found_handling: "single-page-application"` means every path matches
 * index.html — including `/mcp`. Without running first, the MCP server would
 * never see a request, it would get the app shell instead. Path patterns
 * cannot make the split either, because `/` means the app on one hostname and
 * the MCP endpoint on the other.
 */
export type Env = McpEnv & {
  /** Static assets, served for every hostname that is not the MCP one. */
  ASSETS: { fetch(request: Request): Promise<Response> };
};

/**
 * The hostname the MCP server answers on, from the origin it already
 * advertises as its OAuth resource identifier. Deriving it rather than adding
 * a second setting keeps the two from drifting: a request routed to the MCP
 * server on a hostname it does not claim in `/.well-known` would fail
 * verification anyway.
 */
function mcpHostname(env: Env): string | null {
  const configured = env.MCP_PUBLIC_URL?.trim();
  if (!configured) return null;
  try {
    return new URL(configured).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The hostname a request arrived on.
 *
 * Read from the Host header rather than `request.url`, which under a local
 * `wrangler dev` is always 127.0.0.1 — the MCP half would be unreachable
 * outside production, and so untestable. In production the two agree: Host is
 * what Cloudflare routed the request on in the first place.
 */
function requestHostname(request: Request): string {
  const header = request.headers.get("host")?.trim().toLowerCase();
  if (!header) return new URL(request.url).hostname.toLowerCase();
  // Strip a port, without cutting an IPv6 literal's own colons in half.
  const colon = header.lastIndexOf(":");
  return colon > header.lastIndexOf("]") ? header.slice(0, colon) : header;
}

export default {
  fetch(
    request: Request,
    env: Env,
    // Handed on so the MCP server can finish presence touches after it has
    // answered, instead of having them cut off with the response.
    ctx?: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<Response> | Response {
    // No MCP hostname configured means this deployment serves the app only.
    // Falling through to assets is the safe direction: the MCP server never
    // answers on a hostname it was not given, and the app still works.
    const hostname = mcpHostname(env);
    if (hostname && requestHostname(request) === hostname)
      return mcp.fetch(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
};
