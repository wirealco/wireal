import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "./api-client.ts";
import {
  authorizationUserLabel,
  discardStaleAuthorization,
  isStaleAuthorizationError,
  pendingAuthorizationKey,
} from "./oauth-authorization.ts";

test("authorization identity prefers email and falls back without going blank", () => {
  assert.equal(
    authorizationUserLabel({
      email: "person@example.com",
      display_name: "octocat",
    }),
    "person@example.com",
  );
  assert.equal(
    authorizationUserLabel({ email: "", display_name: "octocat" }),
    "octocat",
  );
  assert.equal(
    authorizationUserLabel({ email: null, display_name: "" }),
    "Wireal user",
  );
});

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial) values.set(pendingAuthorizationKey, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

test("stale authorization cleanup removes the matching stored and URL ids", () => {
  const storage = memoryStorage("old-id");
  const nextUrl = discardStaleAuthorization(
    storage,
    "old-id",
    "https://wireal.co/oauth/consent?authorization_id=old-id&language=en#oauth",
  );

  assert.equal(storage.getItem(pendingAuthorizationKey), null);
  assert.equal(nextUrl, "/oauth/consent?language=en#oauth");
});

test("stale authorization cleanup preserves a newer stored request", () => {
  const storage = memoryStorage("new-id");
  discardStaleAuthorization(
    storage,
    "old-id",
    "https://wireal.co/oauth/consent?authorization_id=old-id",
  );

  assert.equal(storage.getItem(pendingAuthorizationKey), "new-id");
});

test("only server-declared stale authorization errors trigger cleanup", () => {
  assert.equal(
    isStaleAuthorizationError(
      new ApiError(
        "Authorization request is invalid or expired.",
        400,
        "invalid_request",
      ),
    ),
    true,
  );
  assert.equal(
    isStaleAuthorizationError(
      new ApiError("Authorization already decided.", 400, "invalid_request"),
    ),
    true,
  );
  assert.equal(
    isStaleAuthorizationError(new ApiError("Invalid CSRF token", 400)),
    false,
  );
});
