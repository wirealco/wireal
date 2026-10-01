import {
  memo,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { User } from "./api-client";
import { Button, Card, Typography } from "@heroui/react";
import { repository, useWorkspaceAvailability } from "./store";
import { backend, backendConfigured, localPreview } from "./backend";
import { Navigate, useLocation } from "react-router";
import type { ResolvedTheme, ThemePreference } from "./theme";
import { isMissingSession, rememberedUser } from "./auth-session";
import { PublicHeader } from "./public-chrome";
import { ChangelogPage } from "./ChangelogPage";
import { DocsPage } from "./DocsPage";
import { PolicyPage } from "./PolicyPage";
import { PublicPage } from "./PublicPage";
import { LandingPage } from "./LandingPage";
import { WorkspaceStartPage } from "./WorkspaceStart";
import { AuthForm, hasPendingRedirectFailure } from "./AuthForm";
import { AuthPopup } from "./AuthPopup";
import {
  authParam,
  authPopupMode,
  clearAuthRequest,
  safeNext,
  useAuthRequest,
} from "./auth-popup";
import {
  authorizationUserLabel,
  discardStaleAuthorization,
  forgetPendingAuthorization,
  isStaleAuthorizationError,
  readPendingAuthorization,
  rememberPendingAuthorization,
} from "./oauth-authorization";

type AuthorizationDetails = {
  authorization_id: string;
  redirect_uri: string;
  client: { id: string; name: string; uri: string; logo_uri: string };
  user: { id: string; email: string; display_name?: string };
  scope: string;
};

function savedAuthorizationId(): string | null {
  return readPendingAuthorization(window.sessionStorage);
}

function rememberAuthorization(id: string) {
  rememberPendingAuthorization(window.sessionStorage, id);
}

export type WorkspaceUser = {
  id?: string;
  name: string;
  email: string;
  avatarUrl?: string;
};

// Memoised so the sign-in popup opening and closing over it does not redraw
// the whole landing page underneath.
const HomePage = memo(function HomePage({
  theme,
  onThemeChange,
}: {
  theme: ResolvedTheme;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  return <LandingPage theme={theme} onThemeChange={onThemeChange} />;
});

function userDetails(user: User): WorkspaceUser {
  const metadataName = user.user_metadata?.full_name;
  const metadataAvatar =
    user.user_metadata?.avatar_url ?? user.user_metadata?.picture;
  return {
    id: user.id,
    name:
      typeof metadataName === "string" && metadataName.trim()
        ? metadataName.trim()
        : user.email?.split("@")[0] || "You",
    email: user.email ?? "",
    avatarUrl:
      typeof metadataAvatar === "string" && metadataAvatar.trim()
        ? metadataAvatar.trim()
        : undefined,
  };
}

/**
 * The one sign-in that is still a page of its own: an MCP client sent the
 * visitor here to approve access. It is an errand begun somewhere else, with
 * nothing on the landing page to return to, and a popup that could be waved
 * away would strand the pending authorization behind a marketing page.
 */
function ConsentSignInPage({
  theme,
  onThemeChange,
  authorizationId,
}: {
  theme: ResolvedTheme;
  onThemeChange: (theme: ThemePreference) => void;
  authorizationId: string | null;
}) {
  const { t } = useTranslation();
  return (
    <PublicPage theme={theme} onThemeChange={onThemeChange}>
      <Card className="public-page__card w-full" variant="secondary">
        <Card.Header className="flex flex-col items-start gap-4">
          <PublicHeader
            theme={theme}
            onThemeChange={onThemeChange}
            docs={false}
          />
          <div>
            <Card.Title>{t("auth.connect")}</Card.Title>
            <Card.Description>{t("auth.connectDescription")}</Card.Description>
          </div>
        </Card.Header>
        <Card.Content>
          <AuthForm
            mode="login"
            onModeChange={() => undefined}
            redirectTo={`${window.location.origin}/oauth/consent`}
            authorizing
            authorizationId={authorizationId}
          />
        </Card.Content>
      </Card>
    </PublicPage>
  );
}

function EmailVerificationPage({
  theme,
  onThemeChange,
}: {
  theme: ResolvedTheme;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  const [token] = useState(
    () =>
      new URLSearchParams(window.location.hash.slice(1)).get("verify") ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  const verify = async () => {
    if (!backend || busy) return;
    setBusy(true);
    setError("");
    const result = await backend.auth.verifyEmail(token);
    setBusy(false);
    if (result.error) setError(result.error.message);
    else setVerified(true);
  };
  return (
    <PublicPage theme={theme} onThemeChange={onThemeChange}>
      <Card className="public-page__card w-full" variant="secondary">
        <Card.Header className="flex flex-col items-start gap-4">
          <PublicHeader
            theme={theme}
            onThemeChange={onThemeChange}
            docs={false}
          />
          <Card.Title>
            {verified ? "Email verified" : "Verify your email"}
          </Card.Title>
          <Card.Description>
            {verified
              ? "Your email address is confirmed. Continue to sign in."
              : token
                ? "Confirm your email address to continue to Wireal."
                : "This verification link is missing its token. Open the link from your verification email."}
          </Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          {error && (
            <Typography className="text-danger" role="alert">
              {error}
            </Typography>
          )}
          {token && !verified && (
            <Button
              isPending={busy}
              isDisabled={busy || !backend}
              onPress={() => void verify()}
            >
              Verify my email
            </Button>
          )}
          <Button
            variant={verified ? "primary" : "tertiary"}
            onPress={() => window.location.assign("/auth")}
          >
            Continue to sign in
          </Button>
        </Card.Content>
      </Card>
    </PublicPage>
  );
}

function OAuthConsentPage({
  theme,
  onThemeChange,
}: {
  theme: ResolvedTheme;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  const authorizationId =
    new URLSearchParams(window.location.search).get("authorization_id") ||
    savedAuthorizationId();
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState("");

  const discardAuthorization = (id: string) => {
    const url = discardStaleAuthorization(
      window.sessionStorage,
      id,
      window.location.href,
    );
    try {
      window.history.replaceState(null, "", url);
    } catch {
      // Storage cleanup still prevents a stale id from surviving a new flow.
    }
    setError(
      "This authorization request has expired. Return to ChatGPT and connect Wireal again; the old request has been cleared.",
    );
  };

  useEffect(() => {
    if (!backend || !authorizationId) {
      setError("This authorization request is missing or invalid.");
      return;
    }
    let active = true;
    const client = backend;
    void client.auth.oauth
      .getAuthorizationDetails(authorizationId)
      .then(({ data, error: authorizationError }) => {
        if (!active) return;
        if (authorizationError || !data) {
          if (isStaleAuthorizationError(authorizationError)) {
            discardAuthorization(authorizationId);
            return;
          }
          // A stored session whose refresh token is gone arrives here as a
          // 401 or 403, which is a dead end: the visitor holds a
          // pending authorization and no way to sign in for it. Keep the
          // authorization and clear the stale session — signing out locally
          // makes no request, and AuthGate then renders the sign-in card that
          // knows how to come back here.
          if (isMissingSession(authorizationError)) {
            rememberAuthorization(authorizationId);
            void client.auth.signOut({ scope: "local" });
            return;
          }
          setError(
            authorizationError?.message ||
              "The authorization request could not be loaded.",
          );
          return;
        }
        if ("redirect_url" in data && typeof data.redirect_url === "string") {
          window.location.assign(data.redirect_url);
          return;
        }
        setDetails(data);
      })
      .catch(() => {
        if (active) setError("The authorization request could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [authorizationId]);

  const decide = async (decision: "approve" | "deny") => {
    if (!backend || !authorizationId) return;
    setBusy(decision);
    setError("");
    const result =
      decision === "approve"
        ? await backend.auth.oauth.approveAuthorization(authorizationId, {
            skipBrowserRedirect: true,
          })
        : await backend.auth.oauth.denyAuthorization(authorizationId, {
            skipBrowserRedirect: true,
          });
    if (result.error || !result.data?.redirect_url) {
      setBusy(null);
      if (isStaleAuthorizationError(result.error)) {
        discardAuthorization(authorizationId);
        return;
      }
      if (isMissingSession(result.error)) {
        rememberAuthorization(authorizationId);
        void backend.auth.signOut({ scope: "local" });
        return;
      }
      setError(
        result.error?.message || "Wireal could not complete authorization.",
      );
      return;
    }
    forgetPendingAuthorization(window.sessionStorage, authorizationId);
    window.location.assign(result.data.redirect_url);
  };

  const scopes = details?.scope.split(/\s+/).filter(Boolean) ?? [];
  return (
    <PublicPage theme={theme} onThemeChange={onThemeChange}>
      <Card className="public-page__card w-full" variant="secondary">
        <Card.Header className="flex flex-col items-start gap-6">
          <PublicHeader
            theme={theme}
            onThemeChange={onThemeChange}
            docs={false}
          />
          <div>
            <Card.Title>Authorize Wireal access</Card.Title>
            <Card.Description>
              Review what this MCP client will be able to do in your workspace.
            </Card.Description>
          </div>
        </Card.Header>
        <Card.Content className="flex flex-col gap-5">
          {!details && !error && (
            <Typography color="muted">
              Loading authorization request…
            </Typography>
          )}
          {details && (
            <>
              <div className="flex flex-col items-start gap-1 rounded-xl bg-default p-4">
                <Typography weight="semibold">
                  {details.client.name || "MCP client"}
                </Typography>
                <Typography type="body-xs" color="muted">
                  Signed in as {authorizationUserLabel(details.user)}
                </Typography>
              </div>
              <div className="flex flex-col gap-2">
                <Typography type="body-sm" weight="semibold">
                  This client will be able to:
                </Typography>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                  <li>Read your Wireal projects, tasks, and their activity.</li>
                  <li>Create and update workspace content on your behalf.</li>
                  <li>
                    Keep access until you revoke it or the session expires.
                  </li>
                </ul>
              </div>
              {scopes.length > 0 && (
                <Typography type="body-xs" color="muted">
                  Requested permissions: {scopes.join(", ")}
                </Typography>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  isPending={busy === "approve"}
                  isDisabled={busy !== null}
                  onPress={() => void decide("approve")}
                >
                  Allow access
                </Button>
                <Button
                  size="sm"
                  variant="tertiary"
                  isPending={busy === "deny"}
                  isDisabled={busy !== null}
                  onPress={() => void decide("deny")}
                >
                  Deny
                </Button>
              </div>
            </>
          )}
          {error && (
            <Typography type="body-sm" className="text-danger" role="alert">
              {error}
            </Typography>
          )}
        </Card.Content>
      </Card>
    </PublicPage>
  );
}

/**
 * Shown when the account is signed in but its workspaces could not be reached.
 * The alternative was the workspace opening on whatever the store had locally,
 * which looks like a working — but empty and unfamiliar — workspace, and takes
 * every edit made in it nowhere.
 */
function WorkspaceUnavailablePage({
  message,
  theme,
  onThemeChange,
  onRetry,
  onSignOut,
}: {
  message: string;
  theme: ResolvedTheme;
  onThemeChange: (theme: ThemePreference) => void;
  onRetry: () => void;
  onSignOut: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <PublicPage theme={theme} onThemeChange={onThemeChange}>
      <Card className="public-page__card w-full" variant="secondary">
        <Card.Header className="flex flex-col items-start gap-6">
          <PublicHeader
            theme={theme}
            onThemeChange={onThemeChange}
            docs={false}
          />
          <div>
            <Card.Title>{t("common.workspaceUnavailable")}</Card.Title>
            <Card.Description>
              {t("common.workspaceUnavailableHelp")}
            </Card.Description>
          </div>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          {message && (
            <Typography type="body-sm" color="muted">
              {message}
            </Typography>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onPress={onRetry}>{t("common.tryAgain")}</Button>
            <Button variant="tertiary" onPress={() => void onSignOut()}>
              {t("navigation.signOut")}
            </Button>
          </div>
        </Card.Content>
      </Card>
    </PublicPage>
  );
}

export function AuthGate({
  children,
  theme,
  onThemeChange,
}: {
  children: (user: WorkspaceUser, signOut?: () => Promise<void>) => ReactNode;
  theme: ResolvedTheme;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  const [user, setUser] = useState<User | null | undefined>(() =>
    backendConfigured ? (rememberedUser() ?? undefined) : undefined,
  );
  const [workspaceFailure, setWorkspaceFailure] = useState<string | null>(null);
  const [connectAttempt, setConnectAttempt] = useState(0);
  // A provider that refused a sign-in returns to the landing page with the
  // reason; the popup opens once to say it.
  const [failureOpen, setFailureOpen] = useState(hasPendingRedirectFailure);
  const availability = useWorkspaceAvailability();
  const location = useLocation();
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  const needsWorkspace = ![
    "/oauth/consent",
    "/verify-email",
    "/docs",
    "/docs/runner",
    "/changelog",
    "/privacy",
    "/terms",
  ].includes(pathname);
  useEffect(() => {
    if (!backend) return;
    void backend.auth
      .getSession()
      .then(({ data }) => setUser(data.session?.user ?? null));
    const { data } = backend.auth.onAuthStateChange((_event, session) =>
      setUser(session?.user ?? null),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  useLayoutEffect(() => {
    if (!backendConfigured || !user || !needsWorkspace) return;
    repository.open(user.id);
  }, [needsWorkspace, user?.id]);
  useEffect(() => {
    if (!backendConfigured || !user || !needsWorkspace) return;
    let active = true;
    setWorkspaceFailure(null);
    void repository
      .connect(user.id)
      .then((result) => {
        // A cached copy of this account's own workspaces is worth opening while
        // the network is down. Nothing of theirs is not: the store would other-
        // wise hand a signed-in visitor the signed-out catalog from this
        // browser and sync their edits to a workspace that does not exist.
        if (active)
          setWorkspaceFailure(
            result.ok || result.cached ? null : (result.message ?? ""),
          );
      })
      .catch((connectError: unknown) => {
        if (active)
          setWorkspaceFailure(
            connectError instanceof Error ? connectError.message : "",
          );
      });
    return () => {
      active = false;
    };
  }, [needsWorkspace, user?.id, connectAttempt]);
  // A call to action's popup is drawn from its request until the router's
  // address shows it, and never outlives a sign-in.
  const authRequest = useAuthRequest();
  const addressMode = authPopupMode(pathname, location.search);
  const requestShown = addressMode !== null || Boolean(user);
  useEffect(() => {
    if (authRequest && requestShown) clearAuthRequest();
  }, [authRequest, requestShown]);
  // Where a sign-in from the popup leads: `?next=` when it names a page of
  // this site, the pending invitation when that is what asked, else the app.
  const params = new URLSearchParams(location.search);
  const signedInTarget = safeNext(params.get("next")) ?? "/app";
  params.delete(authParam);
  params.delete("mode");
  const popupRedirect =
    pathname === "/invitations"
      ? `/invitations${params.toString() ? `?${params}` : ""}`
      : signedInTarget;
  const popupMode =
    addressMode ??
    authRequest?.mode ??
    (failureOpen && pathname === "/" ? "login" : null);
  const withPopup = (page: ReactNode) => (
    <>
      {page}
      {popupMode && !user && (
        <AuthPopup
          mode={popupMode}
          redirectTo={`${window.location.origin}${popupRedirect}`}
          onClose={() => setFailureOpen(false)}
        />
      )}
    </>
  );
  // A signed-in visitor has no use for the sign-in popup: its address sends
  // them on to where signing in would have. An invitation is the exception,
  // since the workspace itself answers it.
  if (user && popupMode && pathname !== "/invitations")
    return <Navigate to={signedInTarget} replace />;
  if (pathname === "/verify-email")
    return (
      <EmailVerificationPage theme={theme} onThemeChange={onThemeChange} />
    );
  if (pathname === "/docs" || pathname === "/docs/runner")
    return withPopup(
      <DocsPage
        topic={pathname === "/docs/runner" ? "runner" : "mcp"}
        theme={theme}
        onThemeChange={onThemeChange}
      />,
    );
  if (pathname === "/changelog")
    return withPopup(
      <ChangelogPage theme={theme} onThemeChange={onThemeChange} />,
    );
  if (pathname === "/privacy" || pathname === "/terms")
    return withPopup(
      <PolicyPage
        page={pathname === "/privacy" ? "privacy" : "terms"}
        theme={theme}
        onThemeChange={onThemeChange}
      />,
    );
  if (localPreview) {
    if (
      pathname === "/app" &&
      new URLSearchParams(location.search).has("start")
    )
      return (
        <WorkspaceStartPage
          theme={theme}
          onThemeChange={onThemeChange}
          onSignOut={async () => undefined}
        />
      );
    if (pathname === "/app")
      return children({ name: "Local preview", email: "" });
    return withPopup(<HomePage theme={theme} onThemeChange={onThemeChange} />);
  }
  if (!backendConfigured)
    return (
      // A misconfigured deployment says so, rather than quietly opening a
      // shared workspace to whoever loads the page.
      <main className="grid min-h-dvh place-items-center bg-background p-6">
        <div className="flex max-w-md flex-col items-center gap-2 text-center">
          <Typography weight="semibold">Wireal is not configured</Typography>
          <Typography type="body-sm" color="muted">
            This deployment has no Wireal connection, so there is no workspace
            to sign in to.
          </Typography>
        </div>
      </main>
    );
  if (pathname === "/oauth/consent")
    return user ? (
      <OAuthConsentPage theme={theme} onThemeChange={onThemeChange} />
    ) : (
      <ConsentSignInPage
        theme={theme}
        onThemeChange={onThemeChange}
        authorizationId={
          new URLSearchParams(window.location.search).get("authorization_id") ??
          savedAuthorizationId()
        }
      />
    );
  if (!user && pathname === "/app") return <Navigate to="/auth" replace />;
  if (
    user &&
    (pathname === "/auth" || pathname === "/login" || pathname === "/")
  )
    return <Navigate to={signedInTarget} replace />;
  // Signed out, every other address is the landing page — with the sign-in
  // popup over it when the address asks for one (/auth, /login, ?auth=, and an
  // invitation link, which needs an account before it can be answered).
  if (!user)
    return withPopup(<HomePage theme={theme} onThemeChange={onThemeChange} />);
  const signOut = async () => {
    try {
      await repository.flush();
    } catch {
      return;
    } // The sync error is visible and the unsaved copy is retained.
    const { error } = await backend!.auth.signOut({ scope: "local" });
    if (error) {
      repository.reportError(`Sign out failed: ${error.message}`);
      if (workspaceFailure !== null) setWorkspaceFailure(error.message);
      return;
    }
    repository.disconnect();
  };
  if (workspaceFailure !== null)
    return (
      <WorkspaceUnavailablePage
        message={workspaceFailure}
        theme={theme}
        onThemeChange={onThemeChange}
        onRetry={() => setConnectAttempt((attempt) => attempt + 1)}
        onSignOut={signOut}
      />
    );
  if (availability === "none")
    return (
      <WorkspaceStartPage
        theme={theme}
        onThemeChange={onThemeChange}
        onSignOut={signOut}
      />
    );
  return children(userDetails(user), signOut);
}
