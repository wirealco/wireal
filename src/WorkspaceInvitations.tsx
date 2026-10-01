import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, Button, Modal, Typography } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { backend } from "./backend";
import { FluidOrb } from "./FluidOrb";
import { Mail } from "./icons";
import { validOrb, type OrbSettings } from "./orb-settings";
import { repository } from "./store";
import { Dialog, SettingsCard } from "./ui";

type Invitation = {
  id: string;
  workspaceName: string;
  expiresAt: string;
  invitedBy: { name: string; avatarUrl: string | null };
  workspaceKind?: string | null;
  memberCount?: number | null;
  orb?: OrbSettings | null;
};
type Inbox = Invitation[];

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function WorkspaceInvitations({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [targetInvitationId] = useState(() =>
    new URLSearchParams(window.location.search).get("invitation_id"),
  );
  const [inbox, setInbox] = useState<Inbox>([]);
  const [loading, setLoading] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [acceptedId, setAcceptedId] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const scrolledToTarget = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const skeletonTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const reload = useCallback(async () => {
    const rows = backend ? ((await backend.teams.inbox()) as Inbox) : [];
    setInbox(rows);
    return rows;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    skeletonTimer.current = setTimeout(() => setShowSkeleton(true), 300);
    try {
      await reload();
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      if (skeletonTimer.current) clearTimeout(skeletonTimer.current);
      setShowSkeleton(false);
      setLoading(false);
    }
  }, [reload]);

  useEffect(() => {
    void load();
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      if (skeletonTimer.current) clearTimeout(skeletonTimer.current);
    };
  }, [load]);

  useEffect(() => {
    if (
      loading ||
      scrolledToTarget.current ||
      !targetInvitationId ||
      !inbox.some((invitation) => invitation.id === targetInvitationId)
    )
      return;
    scrolledToTarget.current = true;
    cardRefs.current
      .get(targetInvitationId)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [inbox, loading, targetInvitationId]);

  const accept = async (invitation: Invitation) => {
    if (pendingId) return;
    setPendingId(invitation.id);
    setCardErrors((current) => ({ ...current, [invitation.id]: "" }));
    try {
      await repository.flush();
      await backend!.teams.accept(invitation.id);
      await repository.refresh();
      setAcceptedId(invitation.id);
      closeTimer.current = setTimeout(onClose, 600);
    } catch (error) {
      setCardErrors((current) => ({
        ...current,
        [invitation.id]: errorMessage(error),
      }));
    } finally {
      setPendingId(null);
    }
  };

  const decline = async (invitation: Invitation) => {
    if (pendingId) return;
    const previousInbox = inbox;
    setPendingId(invitation.id);
    setCardErrors((current) => ({ ...current, [invitation.id]: "" }));
    setInbox((current) =>
      current.filter((candidate) => candidate.id !== invitation.id),
    );
    try {
      await repository.flush();
      await backend!.teams.decline(invitation.id);
      await reload();
    } catch (error) {
      setInbox(previousInbox);
      setCardErrors((current) => ({
        ...current,
        [invitation.id]: errorMessage(error),
      }));
    } finally {
      setPendingId(null);
    }
  };

  const expires = (expiresAt: string) => {
    const days = Math.ceil(
      (new Date(expiresAt).getTime() - Date.now()) / 86_400_000,
    );
    return new Intl.RelativeTimeFormat(i18n.language, {
      numeric: "auto",
    }).format(days, "day");
  };

  const targetNotFound =
    !loading &&
    !loadError &&
    targetInvitationId &&
    !inbox.some((invitation) => invitation.id === targetInvitationId);

  return (
    <Dialog
      title={
        <span className="flex min-w-0 flex-col">
          <span>{t("team.inbox")}</span>
          <span className="truncate text-sm font-normal text-muted">
            {t("invitations.subtitle")}
          </span>
        </span>
      }
      onClose={onClose}
      size="md"
    >
      <Modal.Body className="flex min-h-0 min-w-0 flex-col gap-4 overflow-auto pt-2">
        {targetNotFound && (
          <div
            role="status"
            className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm break-words"
          >
            {t("invitations.notFound")}
          </div>
        )}

        {loading && !showSkeleton ? (
          <div className="min-h-32" aria-busy="true" />
        ) : loading ? (
          <div className="flex flex-col gap-3" aria-label={t("team.inbox")}>
            {[0, 1].map((item) => (
              <SettingsCard
                key={item}
                className="animate-pulse"
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-7 shrink-0 rounded-lg bg-default-200" />
                    <span className="block h-4 w-2/5 rounded bg-default-200" />
                  </span>
                }
              >
                <div className="flex min-w-0 flex-col gap-2">
                  <span className="block h-3 w-4/5 rounded bg-default-100" />
                  <span className="block h-3 w-1/3 rounded bg-default-100" />
                </div>
              </SettingsCard>
            ))}
          </div>
        ) : loadError ? (
          <div className="flex min-w-0 flex-col items-start gap-3">
            <Typography role="alert" className="break-words text-danger">
              {loadError}
            </Typography>
            <Button size="sm" onPress={() => void load()}>
              {t("common.tryAgain")}
            </Button>
          </div>
        ) : inbox.length ? (
          <div className="flex min-w-0 flex-col gap-3">
            {inbox.map((invitation) => {
              const highlighted = invitation.id === targetInvitationId;
              const inviterName =
                invitation.invitedBy.name || t("team.unnamed");
              const kind =
                invitation.workspaceKind === "everyday" ? "everyday" : "coding";
              const isAccepted = acceptedId === invitation.id;
              return (
                <div
                  key={invitation.id}
                  ref={(node) => {
                    if (node) cardRefs.current.set(invitation.id, node);
                    else cardRefs.current.delete(invitation.id);
                  }}
                >
                  <SettingsCard
                    className={
                      highlighted ? "ring-1 ring-accent/40" : undefined
                    }
                    title={
                      <span className="flex min-w-0 items-center gap-2">
                        {validOrb(invitation.orb) ? (
                          <FluidOrb
                            settings={invitation.orb}
                            size={28}
                            label={invitation.workspaceName}
                          />
                        ) : (
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-default-100 text-sm font-semibold text-muted">
                            {invitation.workspaceName
                              .trim()
                              .charAt(0)
                              .toUpperCase() || "W"}
                          </span>
                        )}
                        <span className="truncate">
                          {invitation.workspaceName}
                        </span>
                      </span>
                    }
                  >
                    <div className="flex min-w-0 flex-col gap-2">
                      <div className="flex min-w-0 items-center gap-2 text-sm text-muted">
                        <Avatar size="sm" className="shrink-0">
                          {invitation.invitedBy.avatarUrl && (
                            <Avatar.Image
                              src={invitation.invitedBy.avatarUrl}
                              alt={inviterName}
                            />
                          )}
                          <Avatar.Fallback>
                            {inviterName.charAt(0).toUpperCase()}
                          </Avatar.Fallback>
                        </Avatar>
                        <span className="min-w-0 break-words">
                          {t("invitations.invitedBy", {
                            name: inviterName,
                            kind: t(`workspaceKind.${kind}`),
                          })}
                        </span>
                      </div>
                      <Typography
                        type="body-xs"
                        color="muted"
                        className="break-words"
                      >
                        {t("invitations.expires", {
                          when: expires(invitation.expiresAt),
                        })}
                        {invitation.memberCount != null && (
                          <>
                            {" · "}
                            {t("invitations.members", {
                              count: invitation.memberCount,
                            })}
                          </>
                        )}
                      </Typography>

                      {isAccepted ? (
                        <Typography
                          role="status"
                          className="break-words text-success"
                        >
                          {t("invitations.accepted", {
                            name: invitation.workspaceName,
                          })}
                        </Typography>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            autoFocus={highlighted}
                            isPending={pendingId === invitation.id}
                            isDisabled={pendingId !== null}
                            onPress={() => void accept(invitation)}
                          >
                            {t("team.accept")}
                          </Button>
                          <Button
                            size="sm"
                            variant="tertiary"
                            isDisabled={pendingId !== null}
                            onPress={() => void decline(invitation)}
                          >
                            {t("team.decline")}
                          </Button>
                        </div>
                      )}
                      {cardErrors[invitation.id] && (
                        <Typography
                          role="alert"
                          type="body-xs"
                          className="break-words text-danger"
                        >
                          {cardErrors[invitation.id]}
                        </Typography>
                      )}
                    </div>
                  </SettingsCard>
                </div>
              );
            })}
          </div>
        ) : (
          <SettingsCard>
            <div className="flex min-w-0 flex-col items-center gap-2 py-8 text-center">
              <div className="flex size-10 items-center justify-center rounded-xl bg-default-100 text-muted">
                <Mail size={20} />
              </div>
              <Typography className="font-semibold">
                {t("invitations.emptyTitle")}
              </Typography>
              <Typography
                type="body-sm"
                color="muted"
                className="max-w-sm break-words"
              >
                {t("invitations.emptyHelp")}
              </Typography>
            </div>
          </SettingsCard>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button onPress={onClose}>{t("common.done")}</Button>
      </Modal.Footer>
    </Dialog>
  );
}
