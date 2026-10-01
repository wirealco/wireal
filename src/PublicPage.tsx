import type { ReactNode } from "react";

import { AsciiFluid } from "./AsciiFluid";
import { LandingRails } from "./LandingSections";
import { PublicFooter, PublicTopBar } from "./public-chrome";
import type { ResolvedTheme, ThemePreference } from "./theme";
import "./public-page.css";

type PublicPageProps = {
  theme: ResolvedTheme;
  /** Handed on to whatever chrome the page puts in its own children. */
  onThemeChange: (theme: ThemePreference) => void;
  /** Mount the ASCII fluid ground. Default true. */
  fluid?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * The frame the one-errand signed-out pages are drawn in — the login card, the
 * consent screen, the verification notice — so /auth reads as the same product
 * as /: the fluid field for a ground, two fine dashed rails on the card
 * column's own edges, a square marker wherever the column's top and bottom
 * edges meet one, and the legal footer under it all.
 *
 * The fluid is pinned to the viewport rather than to the document, so it draws
 * one field at one scale whatever the card's height, and it paints itself from
 * the page's `--background`, so the band iOS draws behind the status bar and
 * the one behind the bottom toolbar are the canvas's own colour.
 *
 * The header is not part of the scaffold: a page puts `PublicHeader` inside its
 * own card and this only holds the frame around it. A document — the guide, the
 * two policies — is not drawn here at all: it takes the landing page's own
 * column, `PublicDocument` below.
 */
export function PublicPage({
  theme,
  fluid = true,
  className,
  children,
}: PublicPageProps) {
  return (
    <main className={["public-page", className].filter(Boolean).join(" ")}>
      {fluid && (
        <AsciiFluid
          className="public-page__fluid"
          theme={theme}
          cellSize={11}
          force={0.9}
          dissipation={0.028}
          brush={0.6}
        />
      )}
      <div className="public-page__column">
        <span className="public-page__mark public-page__mark--top-start" />
        <span className="public-page__mark public-page__mark--top-end" />
        <span className="public-page__mark public-page__mark--bottom-start" />
        <span className="public-page__mark public-page__mark--bottom-end" />
        {children}
      </div>
      <PublicFooter variant="compact" />
    </main>
  );
}

type PublicDocumentProps = {
  theme: ResolvedTheme;
  onThemeChange: (theme: ThemePreference) => void;
  className?: string;
  children: ReactNode;
};

/**
 * Every page that is read rather than answered — the setup guide, the privacy
 * notice, the terms — drawn on the landing page's own sheet rather than on one
 * of its own: the same 1200px column at the same inset, the same four dashed
 * rails, the same header row, the same footer, the same two tones. A document
 * hands this scaffold a run of `.landing-section` bands and nothing else, so
 * what changes from path to path is what is inside the bands and never the
 * frame around them.
 *
 * There is no fluid field here. The landing's field belongs to its first
 * screen, which is a panel a document does not have, and the ground beside the
 * column is the same dotted paper on every path either way.
 */
export function PublicDocument({
  theme,
  onThemeChange,
  className,
  children,
}: PublicDocumentProps) {
  return (
    <main
      className={["landing", "landing-page", "public-document", className]
        .filter(Boolean)
        .join(" ")}
    >
      <LandingRails />
      <div className="landing-column">
        <PublicTopBar theme={theme} onThemeChange={onThemeChange} />
        {children}
      </div>
      <PublicFooter />
    </main>
  );
}

type DocumentHeroProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  meta?: ReactNode;
};

/**
 * The opening band every read page shares — the guide, the changelog, the two
 * policies. One title block, centred in the column the way a document states
 * its own name before the reading starts, with the label over it, the sentence
 * that says what the page is under it, and the revision line last. What
 * follows the band goes back to the left margin: the block is the only thing
 * on these pages that is centred, so it reads as the page's title rather than
 * as a centred layout.
 */
export function DocumentHero({
  eyebrow,
  title,
  lead,
  meta,
}: DocumentHeroProps) {
  return (
    <section className="landing-section document-hero">
      <div className="document-hero__body">
        {eyebrow && <p className="document-hero__eyebrow">{eyebrow}</p>}
        <h1 className="document-hero__title">{title}</h1>
        {lead && <p className="document-hero__lead">{lead}</p>}
        {meta && <p className="document-hero__meta">{meta}</p>}
      </div>
    </section>
  );
}
