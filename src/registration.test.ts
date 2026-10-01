import assert from "node:assert/strict";
import test from "node:test";
import {
  invitationOnlyMessage,
  isRegistrationBlocked,
  registrationRedirectError,
} from "./registration";

test("the allowlist rejection is recognised through the wording GoTrue substitutes", () => {
  // What signUp actually returns once the trigger raises: the message the
  // trigger gave is gone, and this is all that arrives.
  assert.ok(
    isRegistrationBlocked({ message: "Database error saving new user" }),
  );
  assert.ok(
    isRegistrationBlocked({ message: "Signups not allowed for this instance" }),
  );
  // Should GoTrue ever forward it, the raised name is recognised too.
  assert.ok(
    isRegistrationBlocked({ message: "wireal_registration_not_allowed" }),
  );
  assert.ok(!isRegistrationBlocked({ message: "Invalid login credentials" }));
  assert.ok(!isRegistrationBlocked({ message: "" }));
  assert.ok(!isRegistrationBlocked(null));
  assert.ok(!isRegistrationBlocked(undefined));
});

test("a provider bounces the uninvited back with the reason in the fragment", () => {
  const result = registrationRedirectError(
    "https://wireal.co/login#error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user",
  );
  assert.equal(result?.message, invitationOnlyMessage);
  // Cleared, so a reload does not raise it a second time.
  assert.equal(result?.url, "/login");
});

test("the PKCE flow reports the same refusal in the query string", () => {
  const result = registrationRedirectError(
    "https://wireal.co/login?error=server_error&error_description=Database%20error%20saving%20new%20user",
  );
  assert.equal(result?.message, invitationOnlyMessage);
  assert.equal(result?.url, "/login");
});

test("a pending authorization survives the error being cleared", () => {
  const result = registrationRedirectError(
    "https://wireal.co/oauth/consent?authorization_id=abc123&error=server_error&error_description=Database+error+saving+new+user",
  );
  assert.equal(result?.message, invitationOnlyMessage);
  assert.equal(result?.url, "/oauth/consent?authorization_id=abc123");
});

test("an unrelated provider error is passed through rather than blamed on the allowlist", () => {
  const result = registrationRedirectError(
    "https://wireal.co/login#error=access_denied&error_description=The+user+denied+the+request",
  );
  assert.equal(result?.message, "The user denied the request");
});

test("a URL carrying no error, or a session, is left untouched", () => {
  assert.equal(registrationRedirectError("https://wireal.co/login"), null);
  assert.equal(
    registrationRedirectError(
      "https://wireal.co/login#access_token=token&expires_in=3600",
    ),
    null,
  );
  assert.equal(registrationRedirectError("not a url"), null);
});
