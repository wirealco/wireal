import {
  ApiError,
  DataClient,
  jsonBody,
  readResponse,
  result,
  type ApiResult,
  type Session,
  type User,
  type UserIdentity,
} from "./api-client";
import type {
  GitHubConnectResult,
  GitHubFolder,
  GitHubInstallationChoices,
  GitHubStatus,
  ProxyCommitResult,
} from "./github-connection";
import { forgetUser, rememberUser } from "./auth-session";

export const localPreview =
  import.meta.env.DEV && import.meta.env.MODE === "development";
const configuredUrl = localPreview ? "" : import.meta.env.VITE_API_URL?.trim();
export const backendConfigured = Boolean(configuredUrl);
export const apiUrl = configuredUrl?.replace(/\/$/, "") ?? "";
if (configuredUrl) {
  const url = new URL(configuredUrl);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("VITE_API_URL must be an HTTPS API origin.");
}
type Access = { accessToken: string; expiresIn: number };
type Grant = {
  client: { id: string; name: string; uri: string; logo_uri: string };
  scopes: string[];
  granted_at: string;
};
type Authorization = {
  authorization_id: string;
  redirect_uri: string;
  client: Grant["client"];
  user: { id: string; email: string; display_name?: string };
  scope: string;
};

class BrowserClient extends DataClient {
  private access: Access | null = null;
  private expiresAt = 0;
  private session: Session | null = null;
  private refreshPending?: Promise<void>;
  private csrfPending?: { authenticated: boolean; promise: Promise<string> };
  private listeners = new Set<
    (event: string, session: Session | null) => void
  >();
  private channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel("wireal.auth")
      : null;
  constructor() {
    super((path, init) => this.send(path, init));
    this.channel?.addEventListener("message", (event) => {
      if (event.data === "logout") this.clear();
      else if (event.data === "login")
        void this.refresh().catch(() => undefined);
    });
  }
  private clear() {
    this.access = null;
    this.session = null;
    this.expiresAt = 0;
    this.csrfPending = undefined;
    forgetUser();
    this.emit("SIGNED_OUT");
  }
  private emit(event: string) {
    for (const listener of this.listeners) listener(event, this.session);
  }
  private async csrf(authenticated: boolean) {
    if (this.csrfPending?.authenticated === authenticated)
      return this.csrfPending.promise;
    const promise = fetch(apiUrl + "/auth/csrf", {
      credentials: "include",
      headers:
        authenticated && this.access
          ? { Authorization: `Bearer ${this.access.accessToken}` }
          : {},
    })
      .then(readResponse<{ token: string }>)
      .then((x) => x.token)
      .catch((error) => {
        this.csrfPending = undefined;
        throw error;
      });
    this.csrfPending = { authenticated, promise };
    return promise;
  }
  private async raw<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    const authenticated =
      Boolean(this.access) &&
      !["/auth/refresh", "/auth/login", "/auth/register"].includes(path);
    if (init.method && init.method !== "GET")
      headers.set("X-CSRF-TOKEN", await this.csrf(authenticated));
    if (authenticated && this.access)
      headers.set("Authorization", `Bearer ${this.access.accessToken}`);
    return readResponse<T>(
      await fetch(apiUrl + path, { ...init, headers, credentials: "include" }),
    );
  }
  private async install(access: Access) {
    this.csrfPending = undefined;
    this.access = access;
    this.expiresAt = Date.now() + access.expiresIn * 1000;
    const user = await this.raw<User>("/auth/me");
    this.session = { user, access_token: access.accessToken };
    rememberUser(user);
    this.emit("SIGNED_IN");
  }
  private refresh(): Promise<void> {
    if (!this.refreshPending) {
      const work = async () => {
        try {
          await this.install(
            await this.raw<Access>("/auth/refresh", jsonBody({})),
          );
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) this.clear();
          throw error;
        }
      };
      // Cross-tab serialization prevents legitimate simultaneous refreshes
      // from triggering the server's refresh-token replay protection.
      this.refreshPending = (
        navigator.locks
          ? navigator.locks.request("wireal.refresh", work)
          : work()
      ).finally(() => {
        this.refreshPending = undefined;
      });
    }
    return this.refreshPending;
  }
  private async send<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.access || this.expiresAt < Date.now() + 30_000)
      await this.refresh();
    try {
      return await this.raw<T>(path, init);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      await this.refresh();
      return this.raw<T>(path, init);
    }
  }
  auth = {
    getSession: async () => {
      const response = await result(async () => {
        if (window.location.hash === "#oauth") {
          history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search,
          );
          await this.install(
            await this.raw<Access>("/auth/token", jsonBody({})),
          );
        } else if (!this.access) await this.refresh();
        return this.session;
      });
      return { data: { session: response.data }, error: response.error };
    },
    getUser: async () => {
      const response = await result(() => this.send<User>("/auth/me"));
      return { data: { user: response.data }, error: response.error };
    },
    onAuthStateChange: (
      listener: (event: string, session: Session | null) => void,
    ) => {
      this.listeners.add(listener);
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              this.listeners.delete(listener);
            },
          },
        },
      };
    },
    verifyEmail: (token: string) =>
      result(() =>
        this.raw<{ message: string }>(
          "/auth/verification/confirm",
          jsonBody({ token }),
        ),
      ),
    // Registering an address that already has an account is answered exactly
    // like a new one, so this is the only way a visitor whose first email
    // never arrived can ask for another.
    resendVerification: (email: string, challenge: HTMLElement) =>
      result(async () =>
        this.raw<{ message: string }>(
          "/auth/verification/resend",
          jsonBody({
            email,
            turnstileToken: await securityChallenge("resend", challenge),
          }),
        ),
      ),
    signInWithPassword: async (
      input: { email: string; password: string },
      challenge: HTMLElement,
    ) => {
      const response = await result(async () => {
        const turnstileToken = await securityChallenge("login", challenge);
        await this.install(
          await this.raw<Access>(
            "/auth/login",
            jsonBody({ ...input, turnstileToken }),
          ),
        );
        this.channel?.postMessage("login");
        return this.session;
      });
      return { data: { session: response.data }, error: response.error };
    },
    signUp: async (
      input: {
        email: string;
        password: string;
        options: { data: { full_name: string }; emailRedirectTo?: string };
      },
      challenge: HTMLElement,
    ) => {
      const response = await result(async () =>
        this.raw(
          "/auth/register",
          jsonBody({
            email: input.email,
            password: input.password,
            displayName: input.options.data.full_name,
            turnstileToken: await securityChallenge("register", challenge),
          }),
        ),
      );
      return { data: { session: null }, error: response.error };
    },
    signInWithOAuth: async (
      input: {
        provider: string;
        options?: { redirectTo?: string };
      },
      challenge: HTMLElement,
    ) =>
      result(async () => {
        const authorizationId = input.options?.redirectTo
          ? new URL(input.options.redirectTo).searchParams.get(
              "authorization_id",
            )
          : null;
        const prepared = await this.raw<{ url: string }>(
          `/auth/${input.provider}/prepare`,
          jsonBody({
            turnstileToken: await securityChallenge(input.provider, challenge),
            authorizationId,
          }),
        );
        window.location.assign(apiUrl + prepared.url);
        return null;
      }),
    signOut: async (_options?: { scope?: string }) => {
      const response = await result(() =>
        this.raw("/auth/logout", jsonBody({})),
      );
      if (!response.error || response.error.status === 401) {
        this.clear();
        this.channel?.postMessage("logout");
      }
      return response;
    },
    updateUser: async (input: {
      data?: { full_name?: string; avatar_url?: string };
      email?: string;
      password?: string;
    }) => {
      const response = await result(() =>
        this.send<User>("/auth/profile", {
          ...jsonBody(input),
          method: "PATCH",
        }),
      );
      if (response.data && this.session) {
        this.session = { ...this.session, user: response.data };
        this.emit("USER_UPDATED");
      }
      return { data: { user: response.data }, error: response.error };
    },
    linkIdentity: async (input: {
      provider: string;
      options?: { redirectTo?: string };
    }) =>
      result(async () => {
        const prepared = await this.send<{ url: string }>(
          `/auth/identities/${input.provider}`,
          jsonBody({}),
        );
        window.location.assign(apiUrl + prepared.url);
        return null;
      }),
    unlinkIdentity: (identity: UserIdentity) =>
      result(() =>
        this.send(`/auth/identities/${identity.provider}`, {
          method: "DELETE",
        }),
      ),
    oauth: {
      getAuthorizationDetails: (id: string) =>
        result(() =>
          this.send<Authorization>(
            `/auth/oauth/authorizations/${encodeURIComponent(id)}`,
          ),
        ),
      approveAuthorization: (id: string, _options?: unknown) =>
        result(() =>
          this.send<{ redirect_url: string }>(
            `/auth/oauth/authorizations/${encodeURIComponent(id)}/approve`,
            jsonBody({}),
          ),
        ),
      denyAuthorization: (id: string, _options?: unknown) =>
        result(() =>
          this.send<{ redirect_url: string }>(
            `/auth/oauth/authorizations/${encodeURIComponent(id)}/deny`,
            jsonBody({}),
          ),
        ),
      listGrants: async () => {
        const r = await result(() => this.send<Grant[]>("/auth/oauth/grants"));
        return { ...r, data: r.data ?? [] };
      },
      revokeGrant: (input: { clientId: string }) =>
        result(() =>
          this.send(
            `/auth/oauth/grants/${encodeURIComponent(input.clientId)}`,
            { method: "DELETE" },
          ),
        ),
    },
  };
  teams = {
    get: (workspaceId: string) => this.send(`/api/teams/${workspaceId}`),
    inbox: () => this.send("/api/teams/invitations"),
    invite: (workspaceId: string, input: { kind: string; target: string }) =>
      this.send(`/api/teams/${workspaceId}/invitations`, {
        ...jsonBody(input),
        method: "POST",
      }),
    accept: (id: string) =>
      this.send(`/api/teams/invitations/${id}/accept`, { method: "POST" }),
    decline: (id: string) =>
      this.send(`/api/teams/invitations/${id}/decline`, { method: "POST" }),
    revoke: (workspaceId: string, id: string) =>
      this.send(`/api/teams/${workspaceId}/invitations/${id}`, {
        method: "DELETE",
      }),
    remove: (workspaceId: string, memberId: string) =>
      this.send(`/api/teams/${workspaceId}/members/${memberId}`, {
        method: "DELETE",
      }),
  };
  github = {
    status: (workspaceId: string): Promise<GitHubStatus> =>
      this.send(`/api/github/workspaces/${encodeURIComponent(workspaceId)}`),
    connect: (workspaceId: string): Promise<GitHubConnectResult> =>
      this.send(
        `/api/github/workspaces/${encodeURIComponent(workspaceId)}/connect`,
        { method: "POST" },
      ),
    installationChoices: (
      workspaceId: string,
      ticket: string,
    ): Promise<GitHubInstallationChoices> =>
      this.send(
        `/api/github/workspaces/${encodeURIComponent(workspaceId)}/installation-choices?ticket=${encodeURIComponent(ticket)}`,
      ),
    useInstallation: (
      workspaceId: string,
      input: { ticket: string; installationId: number },
    ): Promise<GitHubStatus> =>
      this.send(
        `/api/github/workspaces/${encodeURIComponent(workspaceId)}/installations`,
        { ...jsonBody(input), method: "POST" },
      ),
    disconnect: (workspaceId: string): Promise<void> =>
      this.send(`/api/github/workspaces/${encodeURIComponent(workspaceId)}`, {
        method: "DELETE",
      }),
    folders: (
      workspaceId: string,
      owner: string,
      repo: string,
      path: string,
    ): Promise<GitHubFolder[]> =>
      this.send(
        `/api/github/workspaces/${encodeURIComponent(workspaceId)}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/folders?path=${encodeURIComponent(path)}`,
      ),
    commits: (
      workspaceId: string,
      urls: string[],
    ): Promise<ProxyCommitResult[]> =>
      this.send(
        `/api/github/workspaces/${encodeURIComponent(workspaceId)}/commits`,
        { ...jsonBody({ urls }), method: "POST" },
      ),
  };
  storage = {
    from: (_bucket: "avatars") => ({
      upload: (
        path: string,
        file: File,
        _options?: unknown,
      ): Promise<ApiResult> =>
        result(() =>
          this.send(`/api/avatars/${encodeURIComponent(path.split("/")[0])}`, {
            method: "PUT",
            body: file,
            headers: { "Content-Type": file.type },
          }),
        ),
      getPublicUrl: (path: string) => ({
        data: {
          publicUrl: `${apiUrl}/api/avatars/${encodeURIComponent(path.split("/")[0])}`,
        },
      }),
    }),
  };
  watchWorkspaces(onChange: () => void): () => void {
    let stopped = false,
      previous: string | undefined,
      timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const connect = async () => {
      try {
        if (!this.access || this.expiresAt < Date.now() + 60_000)
          await this.refresh();
        const response = await fetch(apiUrl + "/api/workspace-events", {
          headers: { Authorization: `Bearer ${this.access!.accessToken}` },
          signal: abort.signal,
        });
        if (response.status === 401) await this.refresh();
        if (!response.ok || !response.body)
          throw new ApiError("Live sync connection failed.", response.status);
        const reader = response.body
          .pipeThrough(new TextDecoderStream())
          .getReader();
        let pending = "";
        while (!stopped) {
          const chunk = await reader.read();
          if (chunk.done) break;
          pending += chunk.value;
          let boundary: number;
          while ((boundary = pending.indexOf("\n\n")) >= 0) {
            const event = pending.slice(0, boundary);
            pending = pending.slice(boundary + 2);
            if (!event.startsWith("data: ")) continue;
            const fingerprint = event.slice(6);
            if (!stopped && fingerprint !== previous) onChange();
            previous = fingerprint;
          }
        }
        reader.releaseLock();
      } catch {
        /* Reconnect with a fresh token; failed requests never clear data. */
      }
      if (!stopped) timer = setTimeout(() => void connect(), 2000);
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      abort.abort();
    };
  }
}

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
let turnstileScript: Promise<Turnstile> | undefined;
async function securityChallenge(
  action: string,
  container: HTMLElement,
): Promise<string> {
  const config = await readResponse<{ turnstileSiteKey: string }>(
    await fetch(apiUrl + "/auth/config", { credentials: "include" }),
  );
  // A self-hosted API without Turnstile keys sends no site key and checks no token.
  if (!config.turnstileSiteKey) return "";
  turnstileScript ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.onload = () =>
      resolve((window as unknown as { turnstile: Turnstile }).turnstile);
    script.onerror = () => {
      turnstileScript = undefined;
      reject(new Error("Security challenge could not load. Try again."));
    };
    document.head.append(script);
  });
  const turnstile = await turnstileScript;
  if (!container.isConnected) throw new Error("Sign-in was cancelled.");
  return new Promise((resolve, reject) => {
    const dialog = document.createElement("div");
    dialog.className = "flex flex-col items-center gap-3 text-sm text-muted";
    const heading = document.createElement("p");
    heading.textContent = "Complete the security check to continue.";
    const target = document.createElement("div");
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.type = "button";
    cancel.className = "underline underline-offset-2";
    dialog.append(heading, target, cancel);
    container.append(dialog);
    let widget: string | undefined;
    const observer = new MutationObserver(() => {
      if (!container.isConnected) fail();
    });
    const close = () => {
      observer.disconnect();
      if (widget !== undefined) turnstile.remove(widget);
      dialog.remove();
    };
    const fail = () => {
      close();
      reject(new Error("Security check cancelled or expired. Try again."));
    };
    cancel.onclick = fail;
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      widget = turnstile.render(target, {
        sitekey: config.turnstileSiteKey,
        action,
        size: "flexible",
        callback: (token: string) => {
          close();
          resolve(token);
        },
        "error-callback": fail,
        "expired-callback": fail,
        "timeout-callback": fail,
      });
    } catch (error) {
      close();
      reject(error);
    }
  });
}
export const backend = backendConfigured ? new BrowserClient() : null;
