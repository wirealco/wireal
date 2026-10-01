import {
  useRef,
  useState,
  type FormEvent,
  type Key,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Description,
  FieldError,
  Form,
  Input,
  Label,
  Tabs,
  TextField,
  Typography,
} from "@heroui/react";
import { GitHubMark } from "./icons";
import { backend } from "./backend";
import {
  invitationOnlyMessage,
  isRegistrationBlocked,
  registrationRedirectError,
} from "./registration";
import { rememberPendingAuthorization } from "./oauth-authorization";
import type { AuthMode } from "./auth-popup";

type OAuthProvider = "github";

// Wording, logos, and colours follow each provider's sign-in guidance.
const oauthProviders: { id: OAuthProvider; label: string; icon: ReactNode }[] =
  [{ id: "github", label: "GitHub", icon: <GitHubMark size={18} /> }];

/**
 * Read at import, before the Wireal client finishes initialising and takes the
 * fragment for itself, so a provider's refusal is still there to be shown. The
 * error is cleared from the address bar at the same time; nothing else in the
 * URL is touched.
 */
const redirectFailure = registrationRedirectError(window.location.href);
if (redirectFailure) {
  try {
    window.history.replaceState(null, "", redirectFailure.url);
  } catch {
    // A history call this browser refuses only means the address bar keeps the
    // error; the message below is what matters.
  }
}
let pendingFailure = redirectFailure?.message ?? "";

/** Whether a provider's refusal is still waiting to be shown to the visitor. */
export function hasPendingRedirectFailure(): boolean {
  return pendingFailure !== "";
}

/** The refusal has been seen; a later sign-in form starts clean. */
export function dismissRedirectFailure() {
  pendingFailure = "";
}

/**
 * The sign-in and registration form, with the provider buttons, the security
 * check, and the confirmation-email follow-up. It draws no frame of its own:
 * the popup over the signed-out pages and the consent screen's card both hold
 * this same form, so every way in keeps the same checks and messages.
 */
export function AuthForm({
  mode,
  onModeChange,
  redirectTo,
  authorizing = false,
  authorizationId,
}: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  /** Where a new account's confirmation and a provider's return lead. */
  redirectTo: string;
  /** Approving an MCP client: sign in only, and come back to the consent. */
  authorizing?: boolean;
  authorizationId?: string | null;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState(() => pendingFailure);
  const [message, setMessage] = useState("");
  // The address a pending confirmation belongs to, which is also the one a
  // resend has to name: registering clears the form's own password but the
  // account may have been created by an earlier attempt entirely.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState("");
  const challenge = useRef<HTMLDivElement>(null);

  const changeMode = (key: Key) => {
    if (key !== "login" && key !== "register") return;
    onModeChange(key);
    setError("");
    setMessage("");
    setAwaitingConfirmation("");
    setPassword("");
  };

  const submit = async (
    event: FormEvent<HTMLFormElement>,
    nextMode: AuthMode,
  ) => {
    event.preventDefault();
    if (!backend || !challenge.current || busy || oauthBusy) return;
    setBusy(true);
    setError("");
    setMessage("");
    setAwaitingConfirmation("");
    const result =
      nextMode === "login"
        ? await backend.auth.signInWithPassword(
            {
              email: email.trim(),
              password,
            },
            challenge.current,
          )
        : await backend.auth.signUp(
            {
              email: email.trim(),
              password,
              options: {
                data: { full_name: name.trim() },
                emailRedirectTo: redirectTo,
              },
            },
            challenge.current,
          );
    setBusy(false);
    if (result.error) {
      // Registration is closed to everyone but the allowlist, and the database
      // is where that is enforced, so the form is reached and the refusal comes
      // back as an opaque database error. Say what it means instead.
      setError(
        nextMode === "register" && isRegistrationBlocked(result.error)
          ? invitationOnlyMessage
          : result.error.message,
      );
      return;
    }
    // Wireal returns no session while email confirmation is pending, which
    // is the only signal that the account still has to be confirmed.
    if (nextMode === "register" && !result.data.session) {
      setPassword("");
      setMessage(t("auth.confirmEmail"));
      setAwaitingConfirmation(email.trim());
    }
  };

  // Registration answers the same way for a new address and one that already
  // has an unconfirmed account, so the only way past a verification email that
  // never arrived is to ask for another.
  const resendVerification = async () => {
    if (!backend || !challenge.current || busy || oauthBusy) return;
    setBusy(true);
    setError("");
    setMessage("");
    const { error: resendError } = await backend.auth.resendVerification(
      awaitingConfirmation,
      challenge.current,
    );
    setBusy(false);
    if (resendError) setError(resendError.message);
    else setMessage(t("auth.verificationResent"));
  };

  const signInWithProvider = async (provider: OAuthProvider) => {
    if (!backend || !challenge.current || busy || oauthBusy) return;
    let signInRedirectTo = redirectTo;
    if (authorizationId) {
      signInRedirectTo = `${window.location.origin}/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
      rememberPendingAuthorization(window.sessionStorage, authorizationId);
    }
    setOauthBusy(provider);
    setError("");
    setMessage("");
    const { error: oauthError } = await backend.auth.signInWithOAuth(
      {
        provider,
        options: { redirectTo: signInRedirectTo },
      },
      challenge.current,
    );
    if (oauthError) {
      setOauthBusy(null);
      setError(oauthError.message);
    }
  };

  const credentials = (nextMode: AuthMode) => (
    <Form
      aria-label={
        nextMode === "login"
          ? t("auth.loginWithEmail")
          : t("auth.registerWithEmail")
      }
      className="flex flex-col gap-4"
      validationBehavior="native"
      onSubmit={(event) => void submit(event, nextMode)}
    >
      {nextMode === "register" && (
        <TextField value={name} onChange={setName} isRequired>
          <Label>{t("auth.name")}</Label>
          <Input name="name" autoComplete="name" autoFocus />
          <FieldError />
        </TextField>
      )}
      <TextField value={email} onChange={setEmail} isRequired>
        <Label>{t("common.email")}</Label>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          autoFocus={nextMode === "login"}
        />
        <FieldError />
      </TextField>
      <TextField value={password} onChange={setPassword} isRequired>
        <Label>{t("common.password")}</Label>
        <Input
          name="password"
          type="password"
          autoComplete={
            nextMode === "login" ? "current-password" : "new-password"
          }
          minLength={nextMode === "register" ? 15 : 1}
          maxLength={128}
        />
        {nextMode === "register" && (
          <Description>{t("auth.passwordHelp")}</Description>
        )}
        <FieldError />
      </TextField>
      <Button
        className="w-full"
        type="submit"
        variant="primary"
        isPending={busy}
        isDisabled={busy || oauthBusy !== null}
      >
        {nextMode === "login" ? t("auth.login") : t("auth.createAccountAction")}
      </Button>
    </Form>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Approving an MCP client is a sign-in, not a place to open a new
          account: registration would break off for email confirmation and
          lose the pending authorization. */}
      {authorizing ? (
        credentials("login")
      ) : (
        <Tabs
          className="w-full"
          selectedKey={mode}
          onSelectionChange={changeMode}
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label={t("auth.authentication")}>
              <Tabs.Tab id="login">
                {t("auth.login")}
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="register">
                {t("auth.register")}
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
          <Tabs.Panel id="login" className="pt-5">
            {credentials("login")}
          </Tabs.Panel>
          <Tabs.Panel id="register" className="pt-5">
            {credentials("register")}
          </Tabs.Panel>
        </Tabs>
      )}
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <Typography type="body-xs" color="muted">
          {t("auth.or")}
        </Typography>
        <span className="h-px flex-1 bg-border" />
      </div>
      {oauthProviders.map((provider) => (
        <button
          key={provider.id}
          type="button"
          className={`oauth-button oauth-button--${provider.id}`}
          aria-busy={oauthBusy === provider.id}
          disabled={busy || oauthBusy !== null}
          onClick={() => void signInWithProvider(provider.id)}
        >
          <span className="oauth-button__icon">{provider.icon}</span>
          <span>{t("auth.continueWith", { provider: provider.label })}</span>
        </button>
      ))}
      <div ref={challenge} aria-label="Security verification" />
      {error && (
        <Typography type="body-xs" className="text-danger" role="alert">
          {error}
        </Typography>
      )}
      {message && (
        <Typography type="body-xs" className="text-success" role="status">
          {message}
        </Typography>
      )}
      {awaitingConfirmation && (
        <button
          type="button"
          className="self-start text-xs text-muted underline underline-offset-2 disabled:opacity-50"
          disabled={busy || oauthBusy !== null}
          onClick={() => void resendVerification()}
        >
          {t("auth.resendVerification")}
        </button>
      )}
    </div>
  );
}
