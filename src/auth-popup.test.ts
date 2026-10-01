import assert from "node:assert/strict";
import test from "node:test";
import {
  authPopupHref,
  authPopupMode,
  closedAuthHref,
  safeNext,
} from "./auth-popup";

test("the address decides whether the sign-in popup is open and on which tab", () => {
  assert.equal(authPopupMode("/", ""), null);
  assert.equal(authPopupMode("/", "?auth=login"), "login");
  assert.equal(authPopupMode("/docs", "?auth=register"), "register");
  assert.equal(authPopupMode("/", "?auth=nonsense"), null);
  // The old sign-in page and the provider's failure return open the popup.
  assert.equal(authPopupMode("/auth", ""), "login");
  assert.equal(authPopupMode("/auth", "?mode=register"), "register");
  assert.equal(authPopupMode("/login", ""), "login");
  assert.equal(authPopupMode("/invitations", "?team=abc"), "login");
  // The workspace and the consent screen never draw it.
  assert.equal(authPopupMode("/app", "?auth=login"), null);
  assert.equal(authPopupMode("/oauth/consent", "?auth=login"), null);
});

test("opening and closing the popup only touches its own parameters", () => {
  assert.equal(
    authPopupHref("/privacy", "?x=1", "#data", "register"),
    "/privacy?x=1&auth=register#data",
  );
  assert.equal(
    authPopupHref("/auth", "?mode=register", "", "login"),
    "/auth?auth=login",
  );
  assert.equal(
    closedAuthHref("/privacy", "?x=1&auth=register", "#data"),
    "/privacy?x=1#data",
  );
  assert.equal(closedAuthHref("/", "?auth=login", ""), "/");
  assert.equal(closedAuthHref("/auth", "?mode=register", ""), "/");
  assert.equal(closedAuthHref("/invitations", "?team=abc", ""), "/");
});

test("a return path after sign-in stays on this site", () => {
  assert.equal(safeNext("/app"), "/app");
  assert.equal(safeNext("/invitations?team=a#x"), "/invitations?team=a#x");
  assert.equal(safeNext("/docs?auth=login"), "/docs");
  assert.equal(safeNext(null), null);
  assert.equal(safeNext("https://evil.example/"), null);
  assert.equal(safeNext("//evil.example/"), null);
  assert.equal(safeNext("/\\evil.example"), null);
  assert.equal(safeNext("app"), null);
  assert.equal(safeNext("/auth"), null);
  assert.equal(safeNext("/login/"), null);
});
