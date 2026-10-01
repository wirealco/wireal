import type { ApiError } from "./api-client";

export const pendingAuthorizationKey = "wireal.oauth.authorization_id";

type AuthorizationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function authorizationUserLabel(user: {
  email?: string | null;
  display_name?: string | null;
}): string {
  return user.email?.trim() || user.display_name?.trim() || "Wireal user";
}

export function isStaleAuthorizationError(
  error: ApiError | null | undefined,
): boolean {
  return error?.status === 400 && error.errorCode === "invalid_request";
}

export function readPendingAuthorization(
  storage: AuthorizationStorage,
): string | null {
  try {
    return storage.getItem(pendingAuthorizationKey);
  } catch {
    return null;
  }
}

export function rememberPendingAuthorization(
  storage: AuthorizationStorage,
  id: string,
) {
  try {
    storage.setItem(pendingAuthorizationKey, id);
  } catch {
    // Storage may be disallowed; the id stays in the URL for this attempt.
  }
}

export function forgetPendingAuthorization(
  storage: AuthorizationStorage,
  id: string,
) {
  try {
    if (storage.getItem(pendingAuthorizationKey) === id)
      storage.removeItem(pendingAuthorizationKey);
  } catch {
    // A blocked storage API must not prevent recovery through the URL.
  }
}

/**
 * Drop an authorization that the server has declared unusable. A new request
 * cannot be manufactured here because only the OAuth client has the original
 * state and PKCE verifier; returning to that client is the safe retry path.
 */
export function discardStaleAuthorization(
  storage: AuthorizationStorage,
  id: string,
  href: string,
): string {
  forgetPendingAuthorization(storage, id);
  const url = new URL(href);
  if (url.searchParams.get("authorization_id") === id)
    url.searchParams.delete("authorization_id");
  return `${url.pathname}${url.search}${url.hash}`;
}
