import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "./backend";

export type Invitation = {
  id: string;
  workspaceName: string;
  expiresAt: string;
  invitedBy: { name: string; avatarUrl: string | null };
};

const seenKey = "wireal.invitations.seen";
const pollInterval = 60_000;

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(seenKey);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id): id is string => typeof id === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function writeSeen(ids: Set<string>) {
  try {
    localStorage.setItem(seenKey, JSON.stringify([...ids]));
  } catch {
    // A check-in must never surface as an error; losing the seen set just
    // means a re-notification, which is harmless.
  }
}

function isInvitation(value: unknown): value is Invitation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.workspaceName === "string"
  );
}

/** Polls the workspace invitation inbox and reports invitations the user
    hasn't been notified about yet. A no-op while signed out of a backend
    (local preview) or disabled. */
export function useInvitationInbox({
  enabled,
  onNew,
}: {
  enabled: boolean;
  onNew: (invitations: Invitation[]) => void;
}): { count: number; refresh: () => Promise<void> } {
  const [count, setCount] = useState(0);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;

  const refresh = useCallback(async () => {
    if (!backend || !enabled) return;
    try {
      const response = await backend.teams.inbox();
      const invitations = Array.isArray(response)
        ? response.filter(isInvitation)
        : [];
      setCount(invitations.length);
      const seen = readSeen();
      const fresh = invitations.filter(
        (invitation) => !seen.has(invitation.id),
      );
      if (fresh.length) onNewRef.current(fresh);
      // Every invitation still in the inbox has now been told about (either
      // already, or just now); anything missing from the inbox is pruned so
      // the stored set tracks only what could still show up again.
      writeSeen(new Set(invitations.map((invitation) => invitation.id)));
    } catch {
      // Swallow errors: an inbox check must never surface as an error.
    }
  }, [enabled]);

  useEffect(() => {
    if (!backend || !enabled) return;
    void refresh();
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(() => void refresh(), pollInterval);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [enabled, refresh]);

  return { count, refresh };
}
