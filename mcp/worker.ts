import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  oauthMetadataResponse,
  OAuthError,
  OAuthErrorCode,
  verifyBearerToken,
  type AuthInfo,
  type AuthMetadataOptions,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { WirealClient } from "./client.ts";
import { createWirealServer, digest } from "./create-server.ts";

/**
 * The remote Wireal MCP endpoint.
 *
 * It holds no credentials of its own. Every request carries the caller's
 * Wireal access token; the Worker verifies it, then forwards it to the Wireal
 * API, which applies the same workspace membership and role checks as it does
 * for that person in the browser. Serving is stateless — one server instance
 * per request — so no Durable Object is needed.
 */
export type WorkerEnv = {
  /** The HTTPS origin of the .NET API. */
  WIREAL_API_URL: string;
  /** Public origin of this Worker, e.g. https://mcp.wireal.co */
  MCP_PUBLIC_URL?: string;
  /**
   * Public origin of the web app, advertised as the service documentation.
   * Unset, it is this Worker's own origin with a leading `mcp.` dropped.
   */
  WIREAL_APP_URL?: string;
  /** Name recorded as the author of writes when a client does not identify itself. */
  WIREAL_AGENT_NAME?: string;
};

type WirealUser = {
  id: string;
  email?: string;
  client_id?: string;
  client_name?: string | null;
  resource?: string;
};

/** The web app's origin: configured, or the MCP host without its `mcp.`. */
function appOrigin(env: WorkerEnv, publicUrl: URL): URL {
  if (env.WIREAL_APP_URL) return new URL(env.WIREAL_APP_URL);
  const app = new URL(publicUrl.origin);
  app.hostname = app.hostname.replace(/^mcp\./, "");
  return app;
}

const invalid = (message: string) =>
  new OAuthError(OAuthErrorCode.InvalidToken, message);

/**
 * Wireal is the authorization server. Rather than parse the JWT here, ask
 * Wireal who the token belongs to: that honours revocation and rotation, and
 * it is one cached round trip rather than key handling we would have to keep
 * correct ourselves.
 */
function backendVerifier(env: WorkerEnv, publicUrl: URL): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const response = await fetch(
        `${env.WIREAL_API_URL.replace(/\/$/, "")}/auth/me`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (!response.ok) {
        if (response.status !== 401 && response.status !== 403)
          throw invalid(
            `Wireal rejected the access token (${response.status}).`,
          );
        // Expired and revoked are the same 401 to a client, but they mean
        // opposite things: one is a token that simply aged out and should have
        // been refreshed, the other is a grant somebody or something took away.
        // Wireal names which in the body, so carry that code through rather
        // than collapsing both into one unfalsifiable message.
        const code = await response
          .clone()
          .json()
          .then((body: { error_code?: unknown; msg?: unknown }) =>
            typeof body?.error_code === "string"
              ? body.error_code
              : typeof body?.msg === "string"
                ? body.msg
                : "",
          )
          .catch(() => "");
        throw invalid(
          code
            ? `Wireal rejected the access token (${response.status}: ${code}).`
            : `Wireal rejected the access token (${response.status}).`,
        );
      }
      const user = (await response.json()) as WirealUser;
      if (!user?.id) throw invalid("The access token has no Wireal user.");
      // The resource this server advertises in its metadata, so a token is only
      // good on the MCP server it was issued for.
      if (
        !user.client_id ||
        !user.resource ||
        new URL(user.resource).href !== publicUrl.href
      )
        throw invalid("This token was not issued for this MCP resource.");

      // Bearer verification refuses a token with no expiry, so read the JWT's
      // own `exp` rather than inventing a lifetime for someone else's token.
      const [, payload] = token.split(".");
      let expiresAt: number | undefined;
      let oauthClientId = user.client_id;
      let scopes = ["wireal"];
      try {
        const claims = JSON.parse(
          atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
        ) as { exp?: number; scope?: string; client_id?: string };
        expiresAt = claims.exp;
        if (typeof claims.client_id === "string" && claims.client_id)
          oauthClientId = claims.client_id;
        if (typeof claims.scope === "string" && claims.scope.trim())
          scopes = claims.scope.trim().split(/\s+/);
      } catch {
        expiresAt = undefined;
      }
      if (typeof expiresAt !== "number")
        throw invalid("The access token carries no expiry.");

      return {
        token,
        clientId: oauthClientId,
        scopes,
        expiresAt,
        extra: {
          userId: user.id,
          email: user.email,
          client_name:
            typeof user.client_name === "string" ? user.client_name : undefined,
        },
      } satisfies AuthInfo;
    },
  };
}

/** What the Workers runtime hands fetch as its third argument. */
export type WorkerContext = { waitUntil(promise: Promise<unknown>): void };

/**
 * Which CLI session a request belongs to, for presence: the MCP session ID
 * when the client keeps one, else a digest of who is calling with what, which
 * stays the same for one person's one client from request to request.
 */
export function presenceSession(
  headers: Headers | undefined,
  authInfo: AuthInfo | undefined,
): string {
  const session = headers?.get("mcp-session-id")?.trim();
  if (session) return session.slice(0, 100);
  const user = authInfo?.extra?.userId;
  return `h-${digest(
    [
      authInfo?.clientId ?? "",
      headers?.get("user-agent") ?? "",
      typeof user === "string" ? user : "",
    ].join("|"),
  )}`;
}

function clientFor(env: WorkerEnv, authInfo: AuthInfo, headers?: Headers) {
  const registeredClientName = authInfo.extra?.client_name;
  return new WirealClient({
    url: env.WIREAL_API_URL,
    agentName: env.WIREAL_AGENT_NAME?.trim() || "Agent",
    registeredClientName:
      typeof registeredClientName === "string"
        ? registeredClientName
        : undefined,
    userAgent: headers?.get("user-agent") ?? undefined,
    accessToken: authInfo.token,
  });
}

const handlers = new WeakMap<WorkerEnv, ReturnType<typeof createMcpHandler>>();

function handlerFor(env: WorkerEnv) {
  let handler = handlers.get(env);
  if (!handler) {
    handler = createMcpHandler(
      (context) => {
        const token = context.authInfo?.token;
        if (!token) throw invalid("This endpoint requires a bearer token.");
        const headers = context.requestInfo?.headers;
        // The request's waitUntil rides along in authInfo, the one thing the
        // handler passes through per request untouched.
        const waitUntil = context.authInfo?.extra?.waitUntil;
        return createWirealServer(clientFor(env, context.authInfo!, headers), {
          presence: {
            session: presenceSession(headers, context.authInfo),
            ...(typeof waitUntil === "function"
              ? { waitUntil: waitUntil as WorkerContext["waitUntil"] }
              : {}),
          },
        });
      },
      { onerror: (error) => console.error("Wireal MCP error:", error.message) },
    );
    handlers.set(env, handler);
  }
  return handler;
}

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    ctx?: WorkerContext,
  ): Promise<Response> {
    if (!env.WIREAL_API_URL)
      return new Response("Wireal MCP is not configured.", { status: 500 });

    const url = new URL(request.url);
    const publicUrl = new URL(env.MCP_PUBLIC_URL || url.origin);
    if (url.pathname === "/health") return new Response("ok");

    // Wireal is the authorization server; advertise it so a client knows
    // where a token comes from before it has one (RFC 9728 / RFC 8414).
    const issuer = `${env.WIREAL_API_URL.replace(/\/$/, "")}/oauth`;
    const metadata: AuthMetadataOptions = {
      resourceServerUrl: publicUrl,
      resourceName: "Wireal",
      serviceDocumentationUrl: appOrigin(env, publicUrl),
      // offline_access included: a client that takes its scope request from
      // the resource metadata rather than the AS metadata would otherwise never
      // ask for a refresh token, and drop off when the access token expires.
      scopesSupported: ["wireal", "offline_access"],
      oauthMetadata: {
        issuer,
        authorization_response_iss_parameter_supported: true,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        registration_endpoint: `${issuer}/register`,
        scopes_supported: ["wireal", "offline_access"],
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      },
    };
    const discovery = oauthMetadataResponse(request, metadata);
    if (discovery) return discovery;

    const options = {
      verifier: backendVerifier(env, publicUrl),
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(publicUrl),
    };
    let authInfo: AuthInfo;
    try {
      authInfo = await verifyBearerToken(
        request.headers.get("authorization"),
        options,
      );
    } catch (error) {
      return bearerAuthChallengeResponse(error, options);
    }
    const waitUntil = ctx ? ctx.waitUntil.bind(ctx) : undefined;
    // A client ending its MCP session is gone from the board at once rather
    // than ten minutes later.
    const ending = request.headers.get("mcp-session-id");
    if (request.method === "DELETE" && ending) {
      const leaving = clientFor(env, authInfo, request.headers)
        .endPresence(ending)
        .catch(() => undefined);
      waitUntil?.(leaving);
    }
    return handlerFor(env).fetch(request, {
      authInfo: waitUntil
        ? { ...authInfo, extra: { ...authInfo.extra, waitUntil } }
        : authInfo,
    });
  },
};
