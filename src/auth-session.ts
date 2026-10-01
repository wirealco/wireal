import type { User } from "./api-client";

/**
 * Whether a Wireal error means the caller has no usable session, as opposed
 * to a request that genuinely failed. A stored session whose refresh token is
 * gone reads as signed in until the first call goes out, so the difference
 * decides whether a screen shows an error or asks the visitor to sign in.
 */
export function isMissingSession(
  error: { status?: number; message?: string } | null | undefined,
) {
  if (!error) return false;
  return (
    error.status === 401 ||
    error.status === 403 ||
    /refresh token|session expired/i.test(error.message ?? "")
  );
}

const SESSION_KEY = "wireal.session.v1";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

type RememberedSession = {
  id: string;
  email?: string;
  name?: string;
  avatar?: string;
  until: number;
};

function readRemembered(): RememberedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as RememberedSession;
    if (typeof stored?.id !== "string" || !stored.id) return null;
    if (typeof stored.until !== "number") return null;
    return stored;
  } catch {
    return null;
  }
}

export function rememberedUser(): User | null {
  const stored = readRemembered();
  if (!stored) return null;
  if (stored.until <= Date.now()) {
    forgetUser();
    return null;
  }
  return {
    id: stored.id,
    email: stored.email,
    user_metadata: { full_name: stored.name, avatar_url: stored.avatar },
    identities: [],
  };
}

export function rememberUser(user: User) {
  const previous = readRemembered();
  const metadataName = user.user_metadata?.full_name;
  const metadataAvatar =
    user.user_metadata?.avatar_url ?? user.user_metadata?.picture;
  const stored: RememberedSession = {
    id: user.id,
    email: user.email,
    name: typeof metadataName === "string" ? metadataName : undefined,
    avatar: typeof metadataAvatar === "string" ? metadataAvatar : undefined,
    until: previous?.id === user.id ? previous.until : Date.now() + SESSION_MS,
  };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
  } catch {}
}

export function forgetUser() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}
