import { Modal, Typography } from "@heroui/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { AuthForm, dismissRedirectFailure } from "./AuthForm";
import {
  authPopupHref,
  authPopupMode,
  authPopupState,
  clearAuthRequest,
  closedAuthHref,
  currentPath,
  pushedByCallToAction,
  type AuthMode,
} from "./auth-popup";
import "./auth-popup.css";

/**
 * Sign in and registration, over the signed-out page the visitor asked from.
 * The tab is the address's (`?auth=`), so switching it replaces the entry
 * rather than adding one, and closing — the button, Escape, the backdrop, or
 * Back — leaves the page underneath where it was.
 *
 * The router applies an address change as a transition, which a busy page (the
 * landing's animated field) can hold back for seconds. So the popup answers
 * the visitor at once from its own state and reads the real address from
 * `window` rather than from the router's copy, which may still be behind; the
 * address remains the source of truth whenever it moves on its own.
 */
export function AuthPopup({
  mode,
  redirectTo,
  onClose,
}: {
  mode: AuthMode;
  redirectTo: string;
  /** Called once the popup has been dismissed, before the address changes. */
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [shownMode, setShownMode] = useState(mode);
  const [open, setOpen] = useState(true);
  useEffect(() => setShownMode(mode), [mode]);
  // Back and Forward close (or keep) the popup the moment they happen.
  useEffect(() => {
    const follow = () => {
      const asked = authPopupMode(currentPath(), window.location.search);
      if (asked) {
        setShownMode(asked);
        setOpen(true);
      } else {
        clearAuthRequest();
        setOpen(false);
      }
    };
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);
  const registering = shownMode === "register";

  const close = () => {
    if (!open) return;
    setOpen(false);
    clearAuthRequest();
    dismissRedirectFailure();
    onClose?.();
    // The entry an in-page call to action pushed is stepped back over, so Back
    // afterwards goes where it went before the popup opened. A popup that was
    // arrived at (a link, a bookmark, a redirect) has nothing of ours behind it
    // to step back to, so its address is rewritten in place.
    if (pushedByCallToAction()) navigate(-1);
    else
      navigate(
        closedAuthHref(
          currentPath(),
          window.location.search,
          window.location.hash,
        ),
        { replace: true },
      );
  };

  const changeMode = (next: AuthMode) => {
    if (next === shownMode) return;
    setShownMode(next);
    navigate(
      authPopupHref(
        currentPath(),
        window.location.search,
        window.location.hash,
        next,
      ),
      // Keeps whether this popup was pushed by a call to action, which is what
      // decides how closing it leaves.
      {
        replace: true,
        state: pushedByCallToAction() ? authPopupState : null,
      },
    );
  };

  return (
    <Modal
      isOpen={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) close();
      }}
    >
      <Modal.Backdrop variant="blur" className="auth-popup">
        <Modal.Container
          size="sm"
          placement="auto"
          className="auth-popup__container"
        >
          <Modal.Dialog
            className="auth-popup__dialog"
            aria-label={t("authPopup.label")}
          >
            <Modal.CloseTrigger
              className="size-10"
              aria-label={t("authPopup.close")}
            />
            <Modal.Header className="flex-col items-start gap-1 pr-12">
              <Modal.Heading>
                {registering ? t("auth.createAccount") : t("auth.welcomeBack")}
              </Modal.Heading>
              <Typography type="body-xs" color="muted" className="text-pretty">
                {registering
                  ? t("auth.registerDescription")
                  : t("auth.loginDescription")}
              </Typography>
            </Modal.Header>
            <Modal.Body className="auth-popup__body">
              <AuthForm
                mode={shownMode}
                onModeChange={changeMode}
                redirectTo={redirectTo}
              />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
