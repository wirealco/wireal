import { useCallback, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";

/**
 * Signing in is a popup over whatever signed-out page the visitor is on, not a
 * page of its own. The address bar is where it lives: `?auth=login` or
 * `?auth=register` on the page behind it. That makes the popup a link (a
 * footer entry can be opened in a new tab, a bookmark reopens it), puts it in
 * history (Back closes it rather than leaving the site), and keeps the page
 * underneath exactly where it was, since only the query changes.
 *
 * The old addresses still answer: /auth and /login (the provider's failure
 * return) render the landing page with the popup open, reading `?mode=` as the
 * tab for links that were written for the old page. Those two addresses are
 * kept in the bar while the popup is open, and closing it replaces them with /.
 */

export type AuthMode = "login" | "register";

export const authParam = "auth";

/** History state stamped on the entry an in-page call to action pushes, so
 *  closing that popup can step back over it instead of stacking another. */
export const authPopupState = { authPopup: true } as const;

/** Addresses that exist only to show the popup. */
const popupPaths = new Set(["/auth", "/login"]);

/** Signed-out pages the popup may be drawn over. */
export const authPopupHosts = new Set([
  "/",
  "/auth",
  "/login",
  "/invitations",
  "/docs",
  "/docs/runner",
  "/changelog",
  "/privacy",
  "/terms",
]);

export function readAuthMode(
  value: string | null | undefined,
): AuthMode | null {
  return value === "login" || value === "register" ? value : null;
}

/** Which tab the address asks the popup to open on, or null for no popup. */
export function authPopupMode(
  pathname: string,
  search: string,
): AuthMode | null {
  if (!authPopupHosts.has(pathname)) return null;
  const params = new URLSearchParams(search);
  const asked = readAuthMode(params.get(authParam));
  if (asked) return asked;
  // An invitation link reached while signed out is a sign-in errand too.
  if (popupPaths.has(pathname) || pathname === "/invitations")
    return readAuthMode(params.get("mode")) ?? "login";
  return null;
}

/**
 * A same-site path to go to after signing in, taken from `?next=`. Anything
 * that could leave the site — another origin, a protocol-relative `//host`, a
 * backslash some browsers read as a slash — is refused, as is a path back into
 * the popup itself.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  let url: URL;
  try {
    url = new URL(value, "https://wireal.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://wireal.invalid") return null;
  if (popupPaths.has(url.pathname.replace(/\/+$/, "") || "/")) return null;
  url.searchParams.delete(authParam);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The address of `mode`'s popup over the page at `pathname`. */
export function authPopupHref(
  pathname: string,
  search: string,
  hash: string,
  mode: AuthMode,
): string {
  const params = new URLSearchParams(search);
  params.delete("mode");
  params.set(authParam, mode);
  return `${pathname}?${params}${hash}`;
}

/** The address the page is left on once the popup closes. */
export function closedAuthHref(
  pathname: string,
  search: string,
  hash: string,
): string {
  if (popupPaths.has(pathname) || pathname === "/invitations") return "/";
  const params = new URLSearchParams(search);
  params.delete(authParam);
  params.delete("mode");
  params.delete("next");
  const rest = params.toString();
  return `${pathname}${rest ? `?${rest}` : ""}${hash}`;
}

/** The page's real address, with the same trailing-slash reading the gate
 *  gives it. */
export function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

/** Whether the entry the visitor is on was pushed by an in-page call to
 *  action (React Router keeps navigation state under `usr`). */
export function pushedByCallToAction(): boolean {
  const state = window.history.state as { usr?: { authPopup?: boolean } };
  return state?.usr?.authPopup === true;
}

/*
 * React Router applies an address change as a transition, and a busy page —
 * the landing's animated field — can hold a transition back for seconds. So a
 * call to action also says, synchronously, which popup it just asked for; the
 * gate draws it from that at once and the address catches up behind it.
 */
type AuthRequest = { mode: AuthMode; href: string } | null;
let request: AuthRequest = null;
const listeners = new Set<() => void>();

function setRequest(next: AuthRequest) {
  if (request === next) return;
  request = next;
  for (const listener of listeners) listener();
}

/** Forget the request once the address shows it, or the popup has closed. */
export function clearAuthRequest() {
  setRequest(null);
}

/** The popup a call to action has asked for that the address may not show
 *  yet. */
export function useAuthRequest(): AuthRequest {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => request,
    () => null,
  );
}

/** Opens the popup over the current page, as a new history entry. */
export function useOpenAuth() {
  const navigate = useNavigate();
  return useCallback(
    (mode: AuthMode) => {
      const path = currentPath();
      const host = authPopupHosts.has(path) ? path : "/";
      const href = authPopupHref(
        host,
        window.location.search,
        window.location.hash,
        mode,
      );
      setRequest({ mode, href });
      navigate(href, { state: authPopupState });
    },
    [navigate],
  );
}
