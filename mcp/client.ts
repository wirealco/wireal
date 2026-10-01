import { DataClient, readResponse } from "../src/api-client.ts";
import {
  parseWorkspace,
  workspaceKind,
  type Workspace,
  type WorkspaceKind,
} from "../src/domain.ts";
import {
  ownerOnlyRepositoryMessage,
  repositoryScopeChanged,
} from "../src/repository-scope.ts";

type WorkspaceRow = {
  id: string;
  data: unknown;
  revision: number;
  role?: "owner" | "collaborator";
};
type WorkspaceCatalogRow = WorkspaceRow & { is_active: boolean };
export type WorkspaceInfo = {
  kind?: WorkspaceKind;
  id: string;
  name: string;
  repositoryUrl: string;
  revision: number;
  isActive: boolean;
};
/** A live CLI session as the backend's list_presence returns it. */
export type Presence = {
  workspace_id: string;
  session: string;
  user_id: string;
  user_name: string;
  client: string;
  handle: string | null;
  task_id: string | null;
  note: string | null;
  last_seen: string;
};
/** A runner as the runners query returns it: who it is, when it last
 *  reported in, and the agents that heartbeat named. */
export type RunnerRow = {
  runner_id: string;
  name: string;
  host?: string;
  last_seen: string;
  agents?: {
    id: string;
    name?: string;
    kind?: string;
    task_id?: string | null;
    step?: string;
    waiting?: string;
  }[];
};
export type PresenceTouch = {
  session: string;
  client: string;
  handle?: string;
  taskId?: string;
  note?: string;
};
export type WirealClientConfig = {
  url: string;
  /** Last-resort attribution when this request carries no usable identity. */
  agentName: string;
  /** Name of the OAuth client registration that owns the current grant. */
  registeredClientName?: string;
  /** HTTP User-Agent, used only as a known-brand signal. */
  userAgent?: string;
  accessToken?: string;
  refreshToken?: string;
  workspaceId?: string;
  clientId?: string;
  resource?: string;
  onSession?: (accessToken: string, refreshToken: string) => void;
  /** Stdio serializes rotation across processes sharing a saved session. */
  refreshSession?: () => Promise<{ accessToken: string; refreshToken: string }>;
};
export class WirealClient {
  readonly agentName: string;
  readonly registeredClientName?: string;
  readonly userAgent?: string;
  readonly workspaceId?: string;
  private knownWorkspaceId?: string;
  private readonly dataClient: DataClient;
  private accessToken: string;
  private refreshToken: string;
  private refreshing?: Promise<void>;
  constructor(private readonly config: WirealClientConfig) {
    if (!config.url)
      throw new Error(
        "Set WIREAL_API_URL or VITE_API_URL before starting MCP.",
      );
    const url = new URL(config.url);
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error("The API URL must be an HTTPS origin.");
    this.agentName = config.agentName;
    this.workspaceId = config.workspaceId?.trim() || undefined;
    this.registeredClientName = config.registeredClientName;
    this.userAgent = config.userAgent;
    this.accessToken = config.accessToken ?? "";
    this.refreshToken = config.refreshToken ?? "";
    this.dataClient = new DataClient(async (path, init) => {
      await this.authenticate();
      const send = () =>
        fetch(config.url.replace(/\/$/, "") + path, {
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
  private async authenticate(): Promise<void> {
    if (!this.accessToken && this.refreshToken) await this.refresh();
    if (!this.accessToken)
      throw new Error(
        "Wireal MCP is not authenticated. Reconnect your client to the hosted Wireal MCP endpoint.",
      );
  }
  private refresh(): Promise<void> {
    this.refreshing ??= (async () => {
      if (this.config.refreshSession) {
        const session = await this.config.refreshSession();
        this.accessToken = session.accessToken;
        this.refreshToken = session.refreshToken;
        return;
      }
      if (!this.config.clientId)
        throw new Error(
          "MCP client registration is missing. Reconnect your client to the hosted Wireal MCP endpoint.",
        );
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
        client_id: this.config.clientId,
        resource: this.config.resource ?? "https://mcp.wireal.co",
      });
      const session = await readResponse<{
        access_token: string;
        refresh_token: string;
      }>(
        await fetch(this.config.url.replace(/\/$/, "") + "/oauth/token", {
          method: "POST",
          body,
          signal: AbortSignal.timeout(15_000),
        }),
      );
      this.accessToken = session.access_token;
      this.refreshToken = session.refresh_token;
      this.config.onSession?.(this.accessToken, this.refreshToken);
    })().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async readCurrent(): Promise<{
    workspace: Workspace;
    revision: number;
    workspaceId: string;
    role?: "owner" | "collaborator";
  }> {
    await this.authenticate();
    const rows = this.dataClient
      .from("workspaces")
      .select("id,data,revision,role");
    const { data, error } = await (
      this.workspaceId
        ? rows.eq("id", this.workspaceId)
        : rows.eq("is_active", true)
    )
      .limit(1)
      .maybeSingle<WorkspaceRow>();
    if (error) throw error;
    if (!data)
      throw new Error(
        this.workspaceId
          ? `Workspace ${this.workspaceId} is not available to this user.`
          : "This account owns no Wireal workspace yet. Create one in the app, or accept an invitation to somebody else's, then try again.",
      );
    this.knownWorkspaceId = data.id;
    return {
      workspace: parseWorkspace(JSON.stringify(data.data)),
      revision: Number(data.revision),
      workspaceId: data.id,
      role: data.role,
    };
  }

  /** The workspace this session acts on, without reading its document when a
   *  pin or an earlier read already said which one it is. */
  async currentWorkspaceId(): Promise<string> {
    if (this.workspaceId) return this.workspaceId;
    if (this.knownWorkspaceId) return this.knownWorkspaceId;
    await this.authenticate();
    const { data, error } = await this.dataClient
      .from("workspaces")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (error) throw error;
    if (!data) throw new Error("This account has no active workspace.");
    this.knownWorkspaceId = data.id;
    return data.id;
  }

  /** Says a person's own CLI session is live on this workspace, and on which
   *  task when it named one. Rows lapse after ten quiet minutes. */
  async touchPresence(presence: PresenceTouch): Promise<void> {
    const workspace_id = await this.currentWorkspaceId();
    const text = (value: string | undefined, max: number) => {
      const trimmed = value?.trim().slice(0, max);
      return trimmed ? trimmed : undefined;
    };
    await this.command("touch_presence", {
      workspace_id,
      session: presence.session.trim().slice(0, 100),
      client: presence.client.trim().slice(0, 60) || "Agent",
      ...(text(presence.handle, 60)
        ? { handle: text(presence.handle, 60) }
        : {}),
      ...(presence.taskId ? { task_id: presence.taskId } : {}),
      ...(text(presence.note, 200) ? { note: text(presence.note, 200) } : {}),
    });
  }

  async endPresence(session: string): Promise<void> {
    const workspace_id = await this.currentWorkspaceId();
    await this.command("end_presence", {
      workspace_id,
      session: session.trim().slice(0, 100),
    });
  }

  async listPresence(workspaceId?: string): Promise<Presence[]> {
    const workspace_id = workspaceId ?? (await this.currentWorkspaceId());
    const result = await this.command<{ presence?: Presence[] } | null>(
      "list_presence",
      { workspace_id },
    );
    return Array.isArray(result?.presence) ? result.presence : [];
  }

  /** The workspace's runners as their last heartbeat left them. */
  async listRunners(workspaceId?: string): Promise<RunnerRow[]> {
    const workspace_id = workspaceId ?? (await this.currentWorkspaceId());
    await this.authenticate();
    const { data, error } = await this.dataClient
      .from("runners")
      .select("*")
      .eq("workspace_id", workspace_id);
    if (error) throw error;
    return ((data ?? []) as RunnerRow[]).filter((row) => row?.runner_id);
  }

  /** Removes a task's lock and lease, the way Unlock in the app does, so the
   *  runner stops its agent there. Answers with the task ids unlocked; only
   *  the lock's owner or the workspace owner may. */
  async unlockTask(taskId: string, line = false): Promise<string[]> {
    const workspace_id = await this.currentWorkspaceId();
    const result = await this.command<{ unlocked?: unknown[] } | null>(
      "unlock_task",
      { workspace_id, task_id: taskId, line },
    );
    return (result?.unlocked ?? []).map((id) => String(id));
  }

  async command<T>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.authenticate();
    const { data, error } = await this.dataClient.rpc(name, args);
    if (error) throw error;
    return data as T;
  }

  async read(): Promise<{
    workspace: Workspace;
    revision: number;
    workspaceId?: string;
  }> {
    return this.readCurrent();
  }

  async listWorkspaces(): Promise<WorkspaceInfo[]> {
    await this.authenticate();
    const { data, error } = await this.dataClient
      .from("workspaces")
      .select("id,data,revision,is_active")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as WorkspaceCatalogRow[]).map((row) => {
      const workspace = parseWorkspace(JSON.stringify(row.data));
      return {
        id: row.id,
        name: workspace.map.name,
        kind: workspaceKind(workspace),
        repositoryUrl:
          workspaceKind(workspace) === "everyday"
            ? ""
            : workspace.map.repositoryUrl,
        revision: Number(row.revision),
        isActive: this.workspaceId
          ? row.id === this.workspaceId
          : row.is_active,
      };
    });
  }

  async setActiveWorkspace(identifier: string): Promise<WorkspaceInfo> {
    if (this.workspaceId) {
      const pinned = await this.readCurrent();
      throw new Error(
        `This session is pinned to workspace ${pinned.workspace.map.name}.`,
      );
    }
    const workspaces = await this.listWorkspaces();
    const needle = identifier.trim().toLowerCase();
    const matches = workspaces.filter(
      (workspace) =>
        workspace.id.toLowerCase() === needle ||
        workspace.name.toLowerCase() === needle,
    );
    if (matches.length > 1)
      throw new Error(`Ambiguous workspace: ${identifier}. Use its ID.`);
    const workspace = matches[0];
    if (!workspace) throw new Error(`Unknown workspace: ${identifier}`);
    if (workspace.isActive) {
      this.knownWorkspaceId = workspace.id;
      return workspace;
    }
    const { data, error } = await this.dataClient.rpc("set_active_workspace", {
      target_workspace_id: workspace.id,
    });
    if (error) throw error;
    if (!data)
      throw new Error(`Workspace could not be activated: ${identifier}`);
    this.knownWorkspaceId = workspace.id;
    return { ...workspace, isActive: true };
  }

  async mutate<T>(
    change: (workspace: Workspace) => { state: Workspace; value: T },
  ): Promise<{ value: T; revision: number }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.readCurrent();
      const changed = change(current.workspace);
      const validated = parseWorkspace(JSON.stringify(changed.state));
      if (JSON.stringify(validated) === JSON.stringify(current.workspace)) {
        return { value: changed.value, revision: current.revision };
      }
      // The server refuses this too; saying so first spares a doomed write and
      // names the rule instead of a bare 403.
      if (
        current.role === "collaborator" &&
        repositoryScopeChanged(current.workspace, validated)
      )
        throw new Error(ownerOnlyRepositoryMessage);
      const { data, error } = await this.dataClient
        .from("workspaces")
        .update({ data: validated, updated_at: new Date().toISOString() })
        .eq("id", current.workspaceId)
        .eq("revision", current.revision)
        .select("revision")
        .maybeSingle<{ revision: number }>();
      if (error) throw error;
      if (data)
        return { value: changed.value, revision: Number(data.revision) };
    }
    throw new Error("The workspace changed concurrently. Retry the operation.");
  }
}
