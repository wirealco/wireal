import { DataClient, readResponse } from "../src/api-client.ts";
import { WirealClient } from "../mcp/client.ts";
import {
  apiUrl,
  mcpResource,
  readSession,
  sessionPath,
  withSessionLock,
  writeSession,
  type Session,
} from "./session.ts";

export type Tokens = { accessToken: string; refreshToken: string };
export type LeaseRow = { task_id: string; agent?: string; until: string };
export type SeatRow = { agent_id: string; since: string };
export type RunnerRow = {
  runner_id: string;
  name: string;
  host: string;
  last_seen: string;
  leases?: LeaseRow[];
  seats?: SeatRow[];
  /** The agents the runner last reported; step and files only from a
   *  backend that keeps them. */
  agents?: {
    id: string;
    name?: string;
    kind?: "claude" | "codex";
    task_id?: string | null;
    step?: string;
    files?: string[];
  }[];
};

export const refreshBefore = 60_000;
export const signedOutNote =
  "This machine's Wireal session was revoked. Run `wireal-run login` again.";

export function revoked(error: unknown): boolean {
  return /expired or revoked|invalid_grant|invalid refresh token/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

export function signedOut(error: unknown): boolean {
  const said = error instanceof Error ? error.message : String(error);
  return revoked(said) || /session was revoked|wireal-run login/i.test(said);
}

export function tokenExpiry(token: string): number {
  const part = token.split(".")[1];
  if (!part) return 0;
  try {
    const body = JSON.parse(
      Buffer.from(part, "base64url").toString("utf8"),
    ) as { exp?: unknown };
    return typeof body.exp === "number" && Number.isFinite(body.exp)
      ? body.exp * 1000
      : 0;
  } catch {
    return 0;
  }
}

export class RunnerSession {
  readonly origin: string;
  readonly data: DataClient;
  private accessToken: string;
  private refreshToken: string;
  private expiresAt: number;
  private rotating?: Promise<Tokens>;
  constructor(
    private readonly session: Session,
    private readonly path: string = sessionPath(),
  ) {
    this.origin = (session.apiUrl || apiUrl()).replace(/\/$/, "");
    this.accessToken = session.accessToken;
    this.refreshToken = session.refreshToken;
    this.expiresAt = tokenExpiry(session.accessToken);
    this.data = new DataClient(async (path, init) => {
      await this.tokens().catch(() => undefined);
      const send = () =>
        fetch(this.origin + path, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            Authorization: "Bearer " + this.accessToken,
          },
        });
      let response = await send();
      for (let attempt = 0; attempt < 2; attempt++) {
        if (response.status !== 401 || !this.refreshToken) break;
        await this.refresh();
        response = await send();
      }
      return readResponse(response);
    });
  }

  fresh(now = Date.now()): boolean {
    if (!this.accessToken) return false;
    return this.expiresAt === 0 || this.expiresAt - now > refreshBefore;
  }

  tokens(): Promise<Tokens> {
    if (this.fresh())
      return Promise.resolve({
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
      });
    return this.refresh();
  }

  private adopt(stored: Session | null, sent: string): Tokens | undefined {
    if (!stored?.refreshToken || stored.refreshToken === sent) return undefined;
    this.accessToken = stored.accessToken;
    this.refreshToken = stored.refreshToken;
    this.expiresAt = tokenExpiry(stored.accessToken);
    return { accessToken: this.accessToken, refreshToken: this.refreshToken };
  }

  refresh(): Promise<Tokens> {
    this.rotating ??= withSessionLock(async () => {
      const sent = this.refreshToken;
      const taken = this.adopt(readSession(this.path), sent);
      if (taken) return taken;
      let issued: { access_token: string; refresh_token: string };
      try {
        issued = await readResponse<{
          access_token: string;
          refresh_token: string;
        }>(
          await fetch(this.origin + "/oauth/token", {
            method: "POST",
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: sent,
              client_id: this.session.clientId,
              resource: mcpResource(),
            }),
            signal: AbortSignal.timeout(15_000),
          }),
        );
      } catch (error: unknown) {
        const rotated = this.adopt(readSession(this.path), sent);
        if (rotated) return rotated;
        throw revoked(error) ? new Error(signedOutNote) : error;
      }
      this.accessToken = issued.access_token;
      this.refreshToken = issued.refresh_token;
      this.expiresAt = tokenExpiry(issued.access_token);
      writeSession(
        {
          ...this.session,
          accessToken: this.accessToken,
          refreshToken: this.refreshToken,
          savedAt: new Date().toISOString(),
        },
        this.path,
      );
      return { accessToken: this.accessToken, refreshToken: this.refreshToken };
    }, this.path).finally(() => {
      this.rotating = undefined;
    });
    return this.rotating;
  }

  client(agentName: string, workspaceId?: string): WirealClient {
    return new WirealClient({
      url: this.origin,
      agentName,
      registeredClientName: agentName,
      ...(workspaceId ? { workspaceId } : {}),
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      clientId: this.session.clientId,
      resource: mcpResource(),
      refreshSession: () => this.tokens(),
    });
  }
}

export function openSession(path = sessionPath()): RunnerSession {
  const session = readSession(path);
  if (!session)
    throw new Error("Not signed in. Run `wireal-run login` on this machine.");
  return new RunnerSession(session, path);
}

export function liveLeases(rows: RunnerRow[], now = Date.now()): LeaseRow[] {
  return rows
    .flatMap((row) => row.leases ?? [])
    .filter((lease) => Date.parse(lease.until) > now);
}

export function runnerRows(data: DataClient) {
  return async (workspaceId: string): Promise<RunnerRow[]> => {
    const { data: rows, error } = await data
      .from("runners")
      .select("*")
      .eq("workspace_id", workspaceId);
    if (error) throw error;
    return (rows ?? []) as RunnerRow[];
  };
}
