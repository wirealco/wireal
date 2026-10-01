import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  apiUrl,
  mcpResource,
  sessionPath,
  writeSession,
  type Session,
} from "./session.ts";

export type Pkce = { verifier: string; challenge: string };

export function createPkce(bytes: Buffer = randomBytes(32)): Pkce {
  const verifier = bytes.toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier, "ascii")
    .digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(options: {
  api: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  resource: string;
}): string {
  const url = new URL(options.api + "/oauth/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    code_challenge: options.challenge,
    code_challenge_method: "S256",
    state: options.state,
    scope: "wireal offline_access",
    resource: options.resource,
  }).toString();
  return url.href;
}

export function browserCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; verbatim: boolean } {
  if (platform === "win32")
    return {
      command: "cmd",
      args: ["/c", "start", '""', `"${url}"`],
      verbatim: true,
    };
  return {
    command: platform === "darwin" ? "open" : "xdg-open",
    args: [url],
    verbatim: false,
  };
}

export function openBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
  start: typeof spawn = spawn,
): void {
  const asked = browserCommand(url, platform);
  try {
    start(asked.command, asked.args, {
      stdio: "ignore",
      detached: true,
      ...(asked.verbatim ? { windowsVerbatimArguments: true } : {}),
    }).unref();
  } catch {
    return;
  }
}

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;padding:3rem;color:#111"><h1>${title}</h1><p>${body}</p>`;

type Callback = { code: string; state: string };

function waitForCallback(): Promise<{
  port: number;
  callback: Promise<Callback>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    let settle: (value: Callback) => void = () => {};
    let fail: (reason: Error) => void = () => {};
    const callback = new Promise<Callback>((done, error) => {
      settle = done;
      fail = error;
    });
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        response.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (error) {
        response.end(page("Sign in failed", error));
        fail(new Error(`Wireal refused the authorization: ${error}`));
        return;
      }
      response.end(page("Wireal runner connected", "You can close this tab."));
      settle({
        code: url.searchParams.get("code") ?? "",
        state: url.searchParams.get("state") ?? "",
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        callback,
        close: () => server.close(),
      });
    });
  });
}

async function post<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => null)) as
    (T & { error_description?: string; error?: string }) | null;
  if (!response.ok)
    throw new Error(
      body?.error_description ||
        body?.error ||
        `${url} failed (${response.status}).`,
    );
  return body as T;
}

export async function login(
  options: { path?: string; print?: (line: string) => void } = {},
): Promise<Session> {
  const print = options.print ?? ((line: string) => console.log(line));
  const api = apiUrl();
  const resource = mcpResource();
  const listener = await waitForCallback();
  const redirectUri = `http://127.0.0.1:${listener.port}/callback`;
  try {
    const registration = await post<{ client_id: string }>(
      api + "/oauth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Wireal runner",
          client_uri:
            process.env.WIREAL_APP_URL ||
            new URL(api).origin.replace("://api.", "://"),
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      },
    );
    const pkce = createPkce();
    const state = randomBytes(16).toString("base64url");
    const url = authorizeUrl({
      api,
      clientId: registration.client_id,
      redirectUri,
      challenge: pkce.challenge,
      state,
      resource,
    });
    print("Approve the runner in your browser:");
    print(url);
    openBrowser(url);
    const callback = await listener.callback;
    if (callback.state !== state)
      throw new Error("The sign in response did not match this request.");
    if (!callback.code)
      throw new Error("The sign in response carried no code.");
    const token = await post<{
      access_token: string;
      refresh_token?: string | null;
    }>(api + "/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: callback.code,
        redirect_uri: redirectUri,
        client_id: registration.client_id,
        code_verifier: pkce.verifier,
        resource,
      }),
    });
    const session: Session = {
      apiUrl: api,
      clientId: registration.client_id,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? "",
      savedAt: new Date().toISOString(),
    };
    writeSession(session, options.path ?? sessionPath());
    return session;
  } finally {
    listener.close();
  }
}
