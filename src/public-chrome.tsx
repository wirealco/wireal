import { Button } from "@heroui/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { localPreview } from "./backend";
import { authPopupHref, useOpenAuth, type AuthMode } from "./auth-popup";
import { GitHubMark, Mail, Moon, Sun } from "./icons";
import type { ResolvedTheme, ThemePreference } from "./theme";
import "./public-page.css";

/** Chrome shared by every signed-out page: the landing page, the login card,
 *  the OAuth consent screen, and the policy pages all render the same mark,
 *  theme control, and legal footer. */

export function BrandMark({ className = "h-7" }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <a href="/" aria-label={t("public.home")}>
      <img
        className={`app-logo w-auto ${className}`}
        src="/logo.png"
        alt="Wireal"
        draggable={false}
      />
    </a>
  );
}

export function ThemeButton({
  theme,
  onThemeChange,
}: {
  theme: ResolvedTheme;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      isIconOnly
      size="sm"
      variant="tertiary"
      aria-label={t("theme.switchTo", {
        theme: theme === "light" ? t("theme.dark") : t("theme.light"),
      })}
      onPress={() => onThemeChange(theme === "light" ? "dark" : "light")}
    >
      {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
    </Button>
  );
}

type HeaderLink = { href: string; label: string };

function HeaderNav({ links }: { links: HeaderLink[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [mark, setMark] = useState({ left: 0, width: 0, lit: false });

  const measure = useCallback((link: HTMLElement) => {
    const track = trackRef.current;
    if (!track) return null;
    const box = link.getBoundingClientRect();
    return {
      left: box.left - track.getBoundingClientRect().left,
      width: box.width,
    };
  }, []);

  const follow = useCallback(
    (link: HTMLElement) => {
      const next = measure(link);
      if (next) setMark({ ...next, lit: true });
    },
    [measure],
  );

  const release = useCallback(() => {
    setMark((current) => (current.lit ? { ...current, lit: false } : current));
  }, []);

  const trail = links.map((link) => link.href).join(" ");
  useLayoutEffect(() => {
    const rest = () => {
      const first = trackRef.current?.querySelector<HTMLElement>(
        ".public-header__link",
      );
      const next = first && measure(first);
      if (!next) return;
      setMark((current) =>
        current.lit ||
        (current.left === next.left && current.width === next.width)
          ? current
          : { ...next, lit: false },
      );
    };
    rest();
    let live = true;
    document.fonts?.ready.then(() => {
      if (live) rest();
    });
    window.addEventListener("resize", rest);
    return () => {
      live = false;
      window.removeEventListener("resize", rest);
    };
  }, [measure, trail]);

  return (
    <div
      className="public-header__nav"
      ref={trackRef}
      onPointerLeave={release}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          release();
        }
      }}
    >
      <span
        aria-hidden="true"
        className="public-header__glider"
        data-lit={mark.lit || undefined}
        style={{ transform: `translateX(${mark.left}px)`, width: mark.width }}
      />
      {links.map((link) => (
        <a
          className="public-header__link"
          href={link.href}
          key={link.href}
          onFocus={(event) => follow(event.currentTarget)}
          onPointerEnter={(event) => follow(event.currentTarget)}
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}

/** The one row every signed-out page opens with: the mark and the guide, then
 *  the theme switch. `docs` drops the guide for the pages that are already an
 *  errand — the login card, the consent screen. */
export function PublicHeader({
  theme,
  onThemeChange,
  docs = true,
}: {
  theme: ResolvedTheme;
  onThemeChange: (theme: ThemePreference) => void;
  docs?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="public-header__brand">
        <BrandMark />
        {docs && (
          <HeaderNav links={[{ href: "/docs", label: t("public.docs") }]} />
        )}
      </div>
      <div className="public-header__actions flex items-center gap-2">
        <ThemeButton theme={theme} onThemeChange={onThemeChange} />
      </div>
    </div>
  );
}

/** The header every page on the open web opens with, the landing page's own
 *  row: the mark and the guide at one end, the theme switch and the way in at
 *  the other. The landing page and the documents render this same element in
 *  the same place on the same column, so moving between / and /docs never
 *  moves the header under the reader. */
export function PublicTopBar({
  theme,
  onThemeChange,
}: {
  theme: ResolvedTheme;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openAuth = useOpenAuth();
  return (
    <div className="landing-section landing-header">
      <div className="public-header__brand">
        <BrandMark />
        <HeaderNav
          links={[
            { href: "/docs", label: t("public.docs") },
            { href: "/changelog", label: t("public.changelog") },
          ]}
        />
      </div>
      <div className="landing-header__actions">
        <ThemeButton theme={theme} onThemeChange={onThemeChange} />
        <Button
          className="landing-cta"
          variant="primary"
          size="sm"
          onPress={() => (localPreview ? navigate("/app") : openAuth("login"))}
        >
          <span className="landing-header__cta-full">
            {t("landing.openWorkspace")}
          </span>
          <span className="landing-header__cta-tight">
            {t("landing.openShort")}
          </span>
        </Button>
      </div>
    </div>
  );
}

type FooterLink = {
  label: string;
  href: string;
  icon?: typeof GitHubMark;
  external?: boolean;
  /** Opens the sign-in popup on this tab over the current page; `href` is
   *  the same popup over the landing page, for a new tab. */
  auth?: AuthMode;
};

type FooterGroup = {
  label: string;
  links: FooterLink[];
};

const footerGroups: FooterGroup[] = [
  {
    label: "product",
    links: [
      { label: "lookInside", href: "/#showcase" },
      { label: "lines", href: "/#lines" },
      { label: "tools", href: "/#tools" },
      { label: "workspaces", href: "/#workspaces" },
      { label: "team", href: "/#team" },
      { label: "integrations", href: "/#integrations" },
    ],
  },
  {
    label: "getStarted",
    links: [
      {
        label: "openWorkspace",
        href: authPopupHref("/", "", "", "login"),
        auth: "login",
      },
      {
        label: "createAccount",
        href: authPopupHref("/", "", "", "register"),
        auth: "register",
      },
      { label: "docs", href: "/docs" },
      { label: "connectAgent", href: "/app" },
    ],
  },
  {
    label: "company",
    links: [
      { label: "changelog", href: "/changelog" },
      { label: "contact", href: "mailto:info@wireal.co" },
      { label: "privacy", href: "/privacy" },
      { label: "terms", href: "/terms" },
    ],
  },
  {
    label: "connect",
    links: [
      {
        label: "github",
        href: "https://github.com/wirealco/wireal",
        icon: GitHubMark,
        external: true,
      },
      { label: "email", href: "mailto:info@wireal.co", icon: Mail },
    ],
  },
];

export function PublicFooter({
  variant = "full",
}: {
  variant?: "full" | "compact";
}) {
  const { t } = useTranslation();
  const openAuth = useOpenAuth();
  useEffect(() => {
    if (variant !== "full" || !window.location.hash) return;
    const target = document.getElementById(
      decodeURIComponent(window.location.hash.slice(1)),
    );
    if (!target) return;
    requestAnimationFrame(() => target.scrollIntoView());
  }, [variant]);

  if (variant === "compact") {
    return (
      <footer className="public-page__footer public-page__footer--compact">
        <a href="mailto:info@wireal.co">info@wireal.co</a>
        <span aria-hidden="true">·</span>
        <a href="/privacy">{t("public.privacy")}</a>
        <span aria-hidden="true">·</span>
        <a href="/terms">{t("public.terms")}</a>
      </footer>
    );
  }

  const year = new Date().getFullYear();
  return (
    <footer className="public-page__footer public-page__footer--full">
      <div className="public-footer__brand">
        <BrandMark />
      </div>

      <nav className="public-footer__groups">
        {footerGroups.map((group) => (
          <div className="public-footer__group" key={group.label}>
            <h2>{t(`public.footer.${group.label}`)}</h2>
            <ul>
              {group.links.map((link) => {
                const Icon = link.icon;
                return (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noreferrer" : undefined}
                      onClick={(event) => {
                        const mode = link.auth;
                        // A modified click keeps the browser's own meaning:
                        // a new tab or window, opened on the popup's address.
                        if (
                          !mode ||
                          event.button !== 0 ||
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey
                        )
                          return;
                        event.preventDefault();
                        openAuth(mode);
                      }}
                    >
                      {Icon && <Icon size={16} aria-hidden="true" />}
                      <span>{t(`public.footer.links.${link.label}`)}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="public-footer__bottom">
        <span>{t("public.footer.copyright", { year })}</span>
        <div className="public-footer__legal">
          <a href="/privacy">{t("public.footer.links.privacy")}</a>
          <a href="/terms">{t("public.footer.links.terms")}</a>
        </div>
      </div>
    </footer>
  );
}
