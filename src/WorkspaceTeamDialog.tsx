import { useEffect, useState } from "react";
import {
  Avatar,
  Button,
  Card,
  Chip,
  ErrorMessage,
  Label,
  Input,
  ListBox,
  Select,
  Skeleton,
  TextField,
  Typography,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { backend } from "./backend";
import "./settings-card.css";
import { Copy, Mail, Trash2 } from "./icons";
import { Field } from "./ui";
import { repository } from "./store";

type TeamMember = {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  role: "owner" | "collaborator";
};

export type Team = {
  role: "owner" | "collaborator";
  currentUserId: string;
  members: TeamMember[];
  invitations: { id: string; target: string; expiresAt: string }[];
};

const DAY = 86_400_000;

/* Invitations only ever expire a few days out, so a relative day reads better
   than a date the reader has to compare against today. */
function expiresIn(expiresAt: string, locale: string) {
  const at = new Date(expiresAt).getTime();
  if (!Number.isFinite(at)) return "";
  const days = Math.round((at - Date.now()) / DAY);
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
    days,
    "day",
  );
}

function MemberRow({
  member,
  isSelf,
  action,
  confirmLabel,
  isConfirming,
  isPending,
  onAsk,
  onCancel,
  onConfirm,
}: {
  member: TeamMember;
  isSelf: boolean;
  action: { label: string; iconOnly: boolean } | null;
  confirmLabel: string;
  isConfirming: boolean;
  isPending: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const name = member.name || t("team.unnamed");
  return (
    <li className="workspace-team__row flex min-w-0 flex-wrap items-center gap-2 rounded-xl px-2 py-2">
      <Avatar size="sm">
        {member.avatarUrl && <Avatar.Image src={member.avatarUrl} alt={name} />}
        <Avatar.Fallback>{name.slice(0, 1).toUpperCase()}</Avatar.Fallback>
      </Avatar>
      <span className="flex min-w-0 flex-1 basis-32 flex-col">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-sm font-semibold">{name}</span>
          {isSelf && (
            <span className="shrink-0 text-xs text-muted">{t("team.you")}</span>
          )}
        </span>
        <span className="text-xs text-muted break-words">
          {member.email || t("team.noEmail")}
        </span>
      </span>
      <Chip
        size="sm"
        variant="soft"
        color={member.role === "owner" ? "accent" : "default"}
        className="shrink-0"
      >
        <Chip.Label>{t(`team.${member.role}`)}</Chip.Label>
      </Chip>
      {action && isConfirming && (
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <Typography type="body-xs" color="muted">
            {confirmLabel}
          </Typography>
          <Button
            size="sm"
            variant="danger"
            isPending={isPending}
            onPress={onConfirm}
          >
            {t("team.confirm")}
          </Button>
          <Button size="sm" variant="tertiary" onPress={onCancel}>
            {t("team.cancel")}
          </Button>
        </span>
      )}
      {action && !isConfirming && (
        <Button
          size="sm"
          variant={action.iconOnly ? "danger-soft" : "tertiary"}
          className="ml-auto shrink-0"
          isIconOnly={action.iconOnly}
          aria-label={action.iconOnly ? action.label : undefined}
          onPress={onAsk}
        >
          {action.iconOnly ? <Trash2 size={14} /> : action.label}
        </Button>
      )}
    </li>
  );
}

export function WorkspaceTeamSettings({
  workspaceId,
  onClose,
  fixedTeam,
}: {
  workspaceId: string;
  onClose: () => void;
  /** A team handed in rather than read: the signed-out landing showcase renders
   *  this panel for a workspace nobody is a member of, so there is no session
   *  to load one with and nothing to load it from. */
  fixedTeam?: Team;
}) {
  const { t, i18n } = useTranslation();
  const [team, setTeam] = useState<Team | null>(fixedTeam ?? null);
  const [kind, setKind] = useState("email");
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reload = async () => {
    if (!backend) return;
    try {
      setTeam((await backend.teams.get(workspaceId)) as Team);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    if (fixedTeam) return;
    void reload();
  }, [workspaceId, fixedTeam]);
  /* Every mutation flushes pending local edits first, then refreshes the
     repository: losing membership of the open workspace closes the dialog,
     anything else just repaints the panel. */
  const act = async (key: string, work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setPending(key);
    setError("");
    try {
      await repository.flush();
      await work();
      await repository.refresh();
      if (repository.getActiveWorkspaceId() !== workspaceId) onClose();
      else await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };
  const toggleInvite = () => {
    setInviting((open) => {
      if (!open) {
        setMessage("");
        setLink("");
        setCopied(false);
        setError("");
      }
      return !open;
    });
  };
  if (!backend && !fixedTeam) return null;
  const isOwner = team?.role === "owner";
  const invitations = isOwner ? (team?.invitations ?? []) : [];
  return (
    <section
      aria-label={t("team.title")}
      className="flex min-w-0 flex-col gap-3"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !confirming) return;
        event.stopPropagation();
        setConfirming(null);
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Typography type="body-sm" className="font-medium">
          {t("team.title")}
        </Typography>
        {team && (
          <Chip size="sm" variant="soft">
            <Chip.Label>{team.members.length}</Chip.Label>
          </Chip>
        )}
      </div>

      {inviting && (
        <Card
          variant="secondary"
          className="settings-card settings-card--tight relative"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Typography type="body-sm" className="font-medium">
              {t("team.invite")}
            </Typography>
            <Button
              size="sm"
              variant="tertiary"
              className="ml-auto shrink-0"
              onPress={toggleInvite}
            >
              {t("team.cancel")}
            </Button>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <Select
              className="w-full min-w-0"
              selectedKey={kind}
              onSelectionChange={(key) => setKind(String(key))}
            >
              <Label>{t("team.method")}</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="email" textValue={t("team.email")}>
                    {t("team.email")}
                  </ListBox.Item>
                  <ListBox.Item
                    id="github-username"
                    textValue={t("team.githubUsername")}
                  >
                    {t("team.githubUsername")}
                  </ListBox.Item>
                  <ListBox.Item id="github-id" textValue={t("team.githubId")}>
                    {t("team.githubId")}
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <div className="w-full min-w-0">
              <Field
                label={t("team.target")}
                value={target}
                onChange={setTarget}
                placeholder={kind === "email" ? "name@example.com" : "octocat"}
              />
            </div>
          </div>
          <Button
            variant="primary"
            isDisabled={!target.trim()}
            isPending={pending === "invite"}
            onPress={() =>
              void act("invite", async () => {
                const result = await backend!.teams.invite(workspaceId, {
                  kind,
                  target,
                });
                setMessage((result as { message: string }).message);
                setLink((result as { link: string }).link);
                setTarget("");
              })
            }
          >
            {t("team.createLink")}
          </Button>
          {message && (
            <Typography type="body-sm" className="break-words">
              {message}
            </Typography>
          )}
          {link && (
            <div className="flex min-w-0 items-center gap-2">
              <TextField className="min-w-0 flex-1" value={link} isReadOnly>
                <Input
                  aria-label={t("team.createLink")}
                  onFocus={(event) => event.target.select()}
                />
              </TextField>
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                onPress={() =>
                  void navigator.clipboard
                    .writeText(link)
                    .then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 2000);
                    })
                    .catch(() => setError(t("team.copyFailed")))
                }
              >
                <Copy size={14} />
                {t(copied ? "team.copied" : "team.copyLink")}
              </Button>
            </div>
          )}
          {error && <ErrorMessage>{error}</ErrorMessage>}
        </Card>
      )}

      {error && !inviting && <ErrorMessage role="alert">{error}</ErrorMessage>}

      {!team && !error && (
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-2 px-2 py-2">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 flex-1 rounded-md" />
            </div>
          ))}
        </div>
      )}

      {team && (
        <ul role="list" className="flex min-w-0 flex-col gap-1">
          {team.members.map((member) => {
            const isSelf = member.id === team.currentUserId;
            const canRemove = team.role === "owner" && member.role !== "owner";
            const canLeave = team.role === "collaborator" && isSelf;
            const action = canRemove
              ? { label: t("team.remove"), iconOnly: true }
              : canLeave
                ? { label: t("team.leave"), iconOnly: false }
                : null;
            return (
              <MemberRow
                key={member.id}
                member={member}
                isSelf={isSelf}
                action={action}
                confirmLabel={t(
                  canLeave ? "team.confirmLeave" : "team.confirmRemove",
                )}
                isConfirming={confirming === member.id}
                isPending={pending === member.id}
                onAsk={() => setConfirming(member.id)}
                onCancel={() => setConfirming(null)}
                onConfirm={() =>
                  void act(member.id, () =>
                    backend!.teams.remove(workspaceId, member.id),
                  ).then(() => setConfirming(null))
                }
              />
            );
          })}
        </ul>
      )}

      {!!invitations.length && (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2 px-2">
            <Typography type="body-xs" color="muted">
              {t("team.pending")}
            </Typography>
            <Chip size="sm" variant="soft">
              <Chip.Label>{invitations.length}</Chip.Label>
            </Chip>
          </div>
          <ul role="list" className="flex min-w-0 flex-col gap-1">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="workspace-team__row flex min-w-0 flex-wrap items-center gap-2 rounded-xl px-2 py-2"
              >
                <span className="shrink-0 text-muted">
                  <Mail size={16} />
                </span>
                <span className="flex min-w-0 flex-1 basis-32 flex-col">
                  <span className="text-sm break-words">
                    {invitation.target}
                  </span>
                  <span className="text-xs text-muted">
                    {t("team.expires", {
                      when: expiresIn(invitation.expiresAt, i18n.language),
                    })}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="tertiary"
                  className="ml-auto shrink-0"
                  isPending={pending === invitation.id}
                  onPress={() =>
                    void act(invitation.id, () =>
                      backend!.teams.revoke(workspaceId, invitation.id),
                    )
                  }
                >
                  {t("team.revoke")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isOwner && !inviting && (
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          aria-expanded={inviting}
          onPress={toggleInvite}
        >
          {t("team.inviteAction")}
        </Button>
      )}
    </section>
  );
}
