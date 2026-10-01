/**
 * Registration is gated by the .NET API's configured invitation lists. The Register
 * tab stays where it was: someone who has been invited signs up on it normally,
 * and the invitation is checked when the account is actually created rather than
 * by hiding the form from everyone. This module is the half that turns a
 * rejection into a sentence a person can act on.
 */

export const invitationOnlyMessage =
  "Wireal is invite-only for now, and this address is not on the list. Ask for an invitation and sign up with the address it was sent to.";

/**
 * Legacy redirects may still contain the previous allowlist error. Its trigger
 * raised inside the transaction that created the user, and
 * GoTrue does not forward what it raised — it reports an unexpected failure with
 * this wording instead. "Signups not allowed" is the other shape, from
 * `enable_signup = false` on the project. Neither tells a visitor anything, so
 * both become the sentence above.
 */
const blockedSignatures = [
  "database error saving new user",
  "signups not allowed",
  "wireal_registration_not_allowed",
];

export function isRegistrationBlocked(
  error: { message?: string | null } | null | undefined,
): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return blockedSignatures.some((signature) => message.includes(signature));
}

const errorKeys = ["error", "error_code", "error_description"];

/**
 * Google and GitHub reject an uninvited address only after the visitor has
 * already consented at the provider, so the refusal comes back as a redirect to
 * the sign-in card with the reason in the URL — in the fragment for the implicit
 * flow, in the query string for PKCE. Without this they would land on a card
 * that looks like it simply forgot them.
 *
 * Returns the message to show and the URL to put in its place, so a reload does
 * not raise the same error again. Anything else in the URL is left alone: a
 * pending `authorization_id` has to survive.
 */
export function registrationRedirectError(
  href: string,
): { message: string; url: string } | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const source = fragment.get("error") ? fragment : url.searchParams;
  if (!source.get("error")) return null;
  const description = (
    source.get("error_description") ?? source.get("error")!
  ).replace(/\+/g, " ");
  for (const key of errorKeys) {
    fragment.delete(key);
    url.searchParams.delete(key);
  }
  const rest = fragment.toString();
  url.hash = rest ? `#${rest}` : "";
  return {
    message: isRegistrationBlocked({ message: description })
      ? invitationOnlyMessage
      : description,
    url: `${url.pathname}${url.search}${url.hash}`,
  };
}
