import { Fragment, useRef, type CSSProperties, type MouseEvent } from "react";
import { Button } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { localPreview } from "./backend";
import { useOpenAuth } from "./auth-popup";
import {
  ArrowRight,
  ArrowUpRight,
  Display,
  GitBranch,
  GitHubMark,
  History,
} from "./icons";
import { AsciiFluid } from "./AsciiFluid";
import { LandingHero } from "./LandingHero";
import { LandingShowcase } from "./LandingShowcase";
import {
  DividerMarks,
  LandingRails,
  TeamSection,
  McpSection,
  WorkspaceKindsSection,
  useLandingReveal,
} from "./LandingSections";
import {
  ChatGptMark,
  ClaudeCodeMark,
  CodexMark,
  GitHubBrandMark,
  McpClientMark,
} from "./brand-marks";
import { PublicFooter, PublicTopBar, sourceRepository } from "./public-chrome";
import type { ResolvedTheme, ThemePreference } from "./theme";

type LandingPageProps = {
  theme: ResolvedTheme;
  onThemeChange: (theme: ThemePreference) => void;
};

const SHOWCASE_ID = "showcase";

/** The clients that speak to Wireal and the service a coding workspace tracks,
 *  each wearing its own mark. The row is the whole of that band: which tools
 *  connect is a list of names, and a paragraph restating what the MCP section
 *  above has already shown adds nothing to it. */
const integrationChips = [
  { key: "claudeCode", mark: ClaudeCodeMark },
  { key: "codex", mark: CodexMark },
  { key: "chatgpt", mark: ChatGptMark },
  { key: "anyClient", mark: McpClientMark },
  { key: "github", mark: GitHubBrandMark },
] as const;

const heroRows = [
  { key: "machine", icon: Display },
  { key: "branch", icon: GitBranch },
  { key: "card", icon: History },
] as const;

export function LandingPage({ theme, onThemeChange }: LandingPageProps) {
  const navigate = useNavigate();
  const openAuth = useOpenAuth();
  const { t } = useTranslation();
  const page = useRef<HTMLElement>(null);
  const heroPanel = useRef<HTMLDivElement>(null);
  useLandingReveal(page);
  // Signing in opens over this page rather than leaving it. The local preview
  // has no accounts, so its way in goes straight to the workspace.
  const openWorkspace = () =>
    localPreview ? navigate("/app") : openAuth("login");

  /** "Look inside" travels rather than jumps — except for a visitor who asked
   *  for less motion, who gets there at once. The hash is still the link's
   *  href, so the fallback without JavaScript is the jump. */
  const lookInside = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(SHOWCASE_ID);
    if (!target) return;
    event.preventDefault();
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <main className="landing landing-page" ref={page}>
      <LandingRails />
      <div className="landing-column">
        <PublicTopBar theme={theme} onThemeChange={onThemeChange} />

        <section
          className="landing-section landing-hero"
          aria-label={t("landing.hero.scene")}
        >
          <div className="landing-hero__panel" ref={heroPanel}>
            <AsciiFluid
              className="landing-hero__field"
              theme={theme}
              cellSize={11}
              force={0.9}
              dissipation={0.028}
              brush={0.6}
            />
            <div className="landing-hero__body">
              <h1 className="landing-hero__title">
                <span aria-hidden="true">
                  {t("landing.title")
                    .split(" ")
                    .map((word, index) => (
                      <Fragment key={`${index}-${word}`}>
                        {index > 0 ? " " : null}
                        <span
                          className="landing-hero__word"
                          style={{ "--word-i": index } as CSSProperties}
                        >
                          {word}
                        </span>
                      </Fragment>
                    ))}
                </span>
                <span className="landing-hero__title-read">
                  {t("landing.title")}
                </span>
              </h1>
              <p className="landing-hero__lead">{t("landing.hero.lead")}</p>
              <ul className="landing-rows landing-hero__rows">
                {heroRows.map(({ key, icon: Icon }, index) => (
                  <li
                    className="landing-row"
                    key={key}
                    style={{ "--row-i": index } as CSSProperties}
                  >
                    <span className="landing-row__glyph" aria-hidden="true">
                      <Icon size={16} />
                    </span>
                    {t(`landing.hero.rows.${key}`)}
                  </li>
                ))}
              </ul>
              <div className="landing-hero__actions">
                <Button
                  className="landing-hero__cta"
                  variant="primary"
                  onPress={openWorkspace}
                >
                  {t("landing.openWorkspace")} <ArrowRight size={16} />
                </Button>
                <a
                  className="landing-hero__link"
                  href={`#${SHOWCASE_ID}`}
                  onClick={lookInside}
                >
                  {t("landing.hero.secondary")}
                </a>
              </div>
            </div>
            <LandingHero panel={heroPanel} />
          </div>
        </section>

        <section
          className="landing-section landing-section--flush"
          id={SHOWCASE_ID}
          data-tone="raise"
        >
          <LandingShowcase theme={theme} />
        </section>

        <McpSection />
        <WorkspaceKindsSection />
        <TeamSection />

        {/* Open source is a reason to try it, so it has a band of its own:
        the licence, the three commands that run it on your own server, the
        code one press away, and the tools it already fits. */}
        <section
          className="landing-section landing-band landing-open"
          id="open-source"
          data-tone="raise"
        >
          <div className="landing-open__grid">
            <div className="landing-open__copy">
              <h2 className="landing-band__heading" data-reveal>
                {t("landing.openSource.heading")}
              </h2>
              <p
                className="landing-band__lead"
                data-reveal
                style={{ "--reveal-i": 1 } as CSSProperties}
              >
                {t("landing.openSource.lead")}
              </p>
              <div
                className="landing-open__actions"
                data-reveal
                style={{ "--reveal-i": 2 } as CSSProperties}
              >
                <a
                  className="button button--secondary landing-open__github"
                  href={sourceRepository}
                  target="_blank"
                  rel="noreferrer"
                >
                  <GitHubMark size={16} />
                  {t("landing.openSource.github")}
                </a>
                <a
                  className="landing-open__guide"
                  href={`${sourceRepository}#self-host-with-docker-compose`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("landing.openSource.guide")}
                  <ArrowUpRight size={14} />
                </a>
              </div>
              <span
                className="landing-open__label"
                data-reveal
                style={{ "--reveal-i": 3 } as CSSProperties}
              >
                {t("landing.integrations.heading")}
              </span>
              <ul
                className="landing-chips"
                id="integrations"
                data-reveal
                style={{ "--reveal-i": 3 } as CSSProperties}
              >
                {integrationChips.map(({ key, mark: Mark }) => (
                  <li className="landing-chip" key={key}>
                    <span className="landing-chip__mark">
                      <Mark />
                    </span>
                    {t(`landing.integrations.chips.${key}`)}
                  </li>
                ))}
              </ul>
            </div>
            <pre
              className="landing-open__code"
              data-reveal
              style={{ "--reveal-i": 2 } as CSSProperties}
              aria-label={t("landing.openSource.codeLabel")}
            >
              <span data-tone="note"># {t("landing.openSource.codeNote")}</span>
              {"\n"}
              <span data-tone="prompt">$ </span>git clone {sourceRepository}.git
              {"\n"}
              <span data-tone="prompt">$ </span>cd wireal && cp .env.example
              .env
              {"\n"}
              <span data-tone="prompt">$ </span>docker compose up -d
              {"\n"}
              <span data-tone="note">
                # AGPL-3.0 · PostgreSQL · Caddy HTTPS
              </span>
            </pre>
          </div>
        </section>

        <section className="landing-section landing-close" data-tone="stage">
          <div className="landing-close__cells">
            <DividerMarks at={[2 / 3]} />
            <div className="landing-close__text" data-reveal>
              <h2 className="landing-close__heading">
                {t("landing.close.heading")}
              </h2>
              <p className="landing-close__privacy">
                {t("landing.close.privacy")}
              </p>
            </div>
            <div
              className="landing-close__act"
              data-reveal
              style={{ "--reveal-i": 1 } as CSSProperties}
            >
              <Button
                className="landing-cta"
                variant="primary"
                onPress={openWorkspace}
              >
                {t("landing.openWorkspace")} <ArrowRight size={16} />
              </Button>
              <a
                className="landing-close__source"
                href={sourceRepository}
                target="_blank"
                rel="noreferrer"
              >
                <GitHubMark size={14} />
                {t("landing.openSource.orRead")}
              </a>
            </div>
          </div>
        </section>
      </div>
      <PublicFooter />
    </main>
  );
}
