import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import type { User, UserIdentity } from "./api-client";
import {
  Avatar,
  Button,
  Chip,
  Input,
  Label,
  Modal,
  ScrollShadow,
  Separator,
  TextField,
  Typography,
} from "@heroui/react";
import { GitHubMark, GoogleMark, Link2, LogOut, Mail, Unlink } from "./icons";
import { backend } from "./backend";
import { Dialog, Section } from "./ui";

type LinkableProvider = "google" | "github";

type OAuthGrant = {
  client: { id: string; name: string; uri: string; logo_uri: string };
  scopes: string[];
  granted_at: string;
};

const providerMeta: Record<string, { label: string; icon: React.ReactNode }> = {
  email: { label: "Email & password", icon: <Mail size={16} /> },
  google: { label: "Google", icon: <GoogleMark size={16} /> },
  github: { label: "GitHub", icon: <GitHubMark size={16} /> },
};

const linkableProviders: LinkableProvider[] = ["google", "github"];

export function AccountSettings({
  onClose,
  onSignOut,
}: {
  onClose: () => void;
  onSignOut?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<
    "avatar" | "profile" | "email" | "password" | null
  >(null);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const [grants, setGrants] = useState<OAuthGrant[]>([]);
  const [grantBusy, setGrantBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!backend) return;
    void backend.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      setUser(data.user);
      const fullName = data.user.user_metadata?.full_name;
      setName(typeof fullName === "string" ? fullName : "");
      setEmail(data.user.email ?? "");
    });
    void backend.auth.oauth
      .listGrants()
      .then(({ data }) => setGrants(data ?? []));
    const { data } = backend.auth.onAuthStateChange((_event, session) => {
      if (session?.user) setUser(session.user);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!backend || !user) return null;
  const client = backend;

  const identities = user.identities ?? [];
  const hasIdentity = (provider: string) =>
    identities.some((identity) => identity.provider === provider);

  const run = async (
    key: Exclude<typeof busy, null>,
    action: () => Promise<{ error: { message: string } | null }>,
    success: string,
  ) => {
    setBusy(key);
    setError("");
    setNotice("");
    const { error: actionError } = await action();
    setBusy(null);
    if (actionError) setError(actionError.message);
    else setNotice(success);
  };

  const linkProvider = async (provider: LinkableProvider) => {
    setLinkBusy(provider);
    setError("");
    setNotice("");
    const { error: linkError } = await client.auth.linkIdentity({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (linkError) {
      setLinkBusy(null);
      setError(
        /manual linking/i.test(linkError.message)
          ? t("account.manualLinking")
          : linkError.message,
      );
    }
  };

  const unlinkProvider = async (identity: UserIdentity) => {
    setLinkBusy(identity.identity_id ?? identity.provider);
    setError("");
    setNotice("");
    const { error: unlinkError } = await client.auth.unlinkIdentity(identity);
    setLinkBusy(null);
    if (unlinkError) {
      setError(unlinkError.message);
      return;
    }
    const { data } = await client.auth.getUser();
    if (data.user) setUser(data.user);
    setNotice(
      t("account.disconnected", {
        provider:
          identity.provider === "email"
            ? t("account.emailPassword")
            : (providerMeta[identity.provider]?.label ?? identity.provider),
      }),
    );
  };

  const revokeGrant = async (grant: OAuthGrant) => {
    setGrantBusy(grant.client.id);
    setError("");
    setNotice("");
    const { error: revokeError } = await client.auth.oauth.revokeGrant({
      clientId: grant.client.id,
    });
    setGrantBusy(null);
    if (revokeError) {
      setError(revokeError.message);
      return;
    }
    setGrants((current) =>
      current.filter((item) => item.client.id !== grant.client.id),
    );
    setNotice(
      t("account.revoked", {
        client: grant.client.name || t("account.mcpClient"),
      }),
    );
  };

  const uploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
        file.type,
      )
    ) {
      setError(t("account.imageTypeError"));
      setNotice("");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError(t("account.imageSizeError"));
      setNotice("");
      return;
    }

    setBusy("avatar");
    setError("");
    setNotice("");
    const path = `${user.id}/avatar`;
    const { error: uploadError } = await client.storage
      .from("avatars")
      .upload(path, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: true,
      });
    if (uploadError) {
      setBusy(null);
      setError(uploadError.message);
      return;
    }

    const { data: publicImage } = client.storage
      .from("avatars")
      .getPublicUrl(path);
    const avatarUrl = `${publicImage.publicUrl}?v=${Date.now()}`;
    const { data, error: updateError } = await client.auth.updateUser({
      data: { avatar_url: avatarUrl },
    });
    setBusy(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setUser(data.user);
    setNotice(t("account.imageUpdated"));
  };

  const passwordAlreadySet = hasIdentity("email");
  const avatarUrl =
    user.user_metadata?.avatar_url ?? user.user_metadata?.picture;

  return (
    <Dialog
      title={t("account.title")}
      onClose={onClose}
      size="sm"
      dialogClassName="w-[calc(100vw-2rem)] max-w-[920px]"
    >
      <Modal.Body className="p-0">
        <ScrollShadow
          orientation="vertical"
          variant="fade"
          hideScrollBar
          className="grid max-h-[76dvh] min-w-0 gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
        >
          <div className="flex min-w-0 flex-col gap-6">
            <Section
              title={t("account.profile")}
              description={t("account.profileDescription")}
            >
              <div className="flex items-center gap-3">
                <Avatar size="lg">
                  {typeof avatarUrl === "string" && avatarUrl && (
                    <Avatar.Image
                      src={avatarUrl}
                      alt={name || t("account.yourProfile")}
                    />
                  )}
                  <Avatar.Fallback>
                    {(name || email || "Y").slice(0, 1).toUpperCase()}
                  </Avatar.Fallback>
                </Avatar>
                <input
                  ref={avatarInputRef}
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  aria-label={t("account.chooseImage")}
                  onChange={(event) => void uploadAvatar(event)}
                />
                <div className="flex flex-col items-start gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    isPending={busy === "avatar"}
                    isDisabled={busy !== null}
                    onPress={() => avatarInputRef.current?.click()}
                  >
                    {t("account.uploadImage")}
                  </Button>
                  <Typography type="body-xs" color="muted">
                    {t("account.imageHelp")}
                  </Typography>
                </div>
              </div>
              <TextField value={name} onChange={setName}>
                <Label>{t("account.displayName")}</Label>
                <Input
                  aria-label={t("account.displayName")}
                  placeholder={t("account.yourName")}
                  maxLength={80}
                />
              </TextField>
              <Button
                variant="secondary"
                className="self-start"
                isPending={busy === "profile"}
                isDisabled={busy !== null || !name.trim()}
                onPress={() =>
                  void run(
                    "profile",
                    () =>
                      client.auth.updateUser({
                        data: { full_name: name.trim() },
                      }),
                    t("account.displayNameUpdated"),
                  )
                }
              >
                {t("account.saveProfile")}
              </Button>
            </Section>

            <Separator />

            <Section
              title={t("account.emailAddress")}
              description={t("account.emailDescription")}
            >
              <TextField value={email} onChange={setEmail}>
                <Label>{t("common.email")}</Label>
                <Input
                  aria-label={t("common.email")}
                  type="email"
                  autoComplete="email"
                />
              </TextField>
              <Button
                variant="secondary"
                className="self-start"
                isPending={busy === "email"}
                isDisabled={
                  busy !== null || !email.trim() || email.trim() === user.email
                }
                onPress={() =>
                  void run(
                    "email",
                    () => client.auth.updateUser({ email: email.trim() }),
                    t("account.confirmationSent"),
                  )
                }
              >
                {t("account.updateEmail")}
              </Button>
            </Section>

            <Separator />

            <Section
              title={
                passwordAlreadySet
                  ? t("account.changePassword")
                  : t("account.setPassword")
              }
              description={
                passwordAlreadySet
                  ? t("account.passwordHelp")
                  : t("account.passwordDescription")
              }
            >
              <TextField value={password} onChange={setPassword}>
                <Label>{t("account.newPassword")}</Label>
                <Input
                  aria-label={t("account.newPassword")}
                  type="password"
                  autoComplete="new-password"
                  minLength={15}
                  maxLength={128}
                />
              </TextField>
              <Button
                variant="secondary"
                className="self-start"
                isPending={busy === "password"}
                isDisabled={busy !== null || password.length < 15}
                onPress={() =>
                  void run(
                    "password",
                    async () => {
                      const result = await client.auth.updateUser({ password });
                      if (!result.error) setPassword("");
                      return result;
                    },
                    t("account.passwordUpdated"),
                  )
                }
              >
                {passwordAlreadySet
                  ? t("account.changePassword")
                  : t("account.setPassword")}
              </Button>
            </Section>
          </div>
          <Separator orientation="vertical" className="hidden lg:block" />
          <div className="flex min-w-0 flex-col gap-6 border-t border-border pt-6 lg:border-t-0 lg:pt-0">
            <Section
              title={t("account.connectedAccounts")}
              description={t("account.connectedAccountsDescription")}
            >
              <ul className="flex flex-col gap-2">
                {identities.map((identity) => {
                  const meta = providerMeta[identity.provider] ?? {
                    label: identity.provider,
                    icon: <Link2 size={16} />,
                  };
                  return (
                    <li
                      key={identity.identity_id ?? identity.provider}
                      className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {meta.icon}
                        <span className="truncate text-sm">
                          {identity.provider === "email"
                            ? t("account.emailPassword")
                            : meta.label}
                        </span>
                        <Chip size="sm" variant="soft" color="success">
                          {t("account.connected")}
                        </Chip>
                      </span>
                      {identities.length > 1 &&
                        identity.provider !== "email" && (
                          <Button
                            size="sm"
                            variant="tertiary"
                            isPending={
                              linkBusy ===
                              (identity.identity_id ?? identity.provider)
                            }
                            isDisabled={linkBusy !== null}
                            onPress={() => void unlinkProvider(identity)}
                          >
                            <Unlink size={14} />
                            {t("account.disconnect")}
                          </Button>
                        )}
                    </li>
                  );
                })}
                {linkableProviders
                  .filter((provider) => !hasIdentity(provider))
                  .map((provider) => {
                    const meta = providerMeta[provider];
                    return (
                      <li
                        key={provider}
                        className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {meta.icon}
                          <span className="truncate text-sm">{meta.label}</span>
                        </span>
                        <Button
                          size="sm"
                          variant="secondary"
                          isPending={linkBusy === provider}
                          isDisabled={linkBusy !== null}
                          onPress={() => void linkProvider(provider)}
                        >
                          <Link2 size={14} />
                          {t("account.connect")}
                        </Button>
                      </li>
                    );
                  })}
              </ul>
            </Section>

            <Separator />

            <Section
              title={t("account.connectedMcp")}
              description={t("account.connectedMcpDescription")}
            >
              {grants.length ? (
                <ul className="flex flex-col gap-2">
                  {grants.map((grant) => (
                    <li
                      key={grant.client.id}
                      className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm">
                          {grant.client.name || t("account.mcpClient")}
                        </span>
                        <span className="truncate text-xs text-muted">
                          {grant.scopes.join(", ")}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="danger-soft"
                        isPending={grantBusy === grant.client.id}
                        isDisabled={grantBusy !== null}
                        onPress={() => void revokeGrant(grant)}
                      >
                        <Unlink size={14} />
                        {t("account.revoke")}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <Typography type="body-xs" color="muted">
                  {t("account.noMcpClients")}
                </Typography>
              )}
            </Section>

            {(error || notice) && (
              <Typography
                type="body-xs"
                className={error ? "text-danger" : "text-success"}
                role={error ? "alert" : "status"}
              >
                {error || notice}
              </Typography>
            )}
          </div>
        </ScrollShadow>
      </Modal.Body>
      <Modal.Footer>
        {onSignOut && (
          <Button
            variant="danger-soft"
            className="mr-auto"
            onPress={() => void onSignOut()}
          >
            <LogOut size={16} />
            {t("navigation.signOut")}
          </Button>
        )}
        <Button variant="primary" onPress={onClose}>
          {t("common.done")}
        </Button>
      </Modal.Footer>
    </Dialog>
  );
}
