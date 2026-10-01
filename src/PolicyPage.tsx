import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { DocumentHero, PublicDocument } from "./PublicPage";
import {
  policyDocuments,
  policyUpdated,
  type PolicySection,
} from "./policy-content";
import type { ResolvedTheme, ThemePreference } from "./theme";
import "./policy-page.css";

type PolicyPageProps = {
  page: "privacy" | "terms";
  theme: ResolvedTheme;
  onThemeChange: (theme: ThemePreference) => void;
};

/** Where the reading band starts: far enough below the top of the viewport
 *  that a heading scrolled to its anchor is clear of the edge, and the same
 *  number the sections reserve with scroll-margin-top. */
const BAND_TOP = 104;

function prefersReducedMotion() {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Two digits, so the contents column is a ruled list rather than a ragged
 *  one: 01, 02 … and still 10 if a document ever grows that long. */
function ordinal(index: number) {
  return String(index + 1).padStart(2, "0");
}

/**
 * Which section the reader is in: the last one whose top has passed the band
 * just under the top of the viewport, or the first while none has. The
 * observer is what asks the question — its band is drawn so that it fires at
 * exactly the moments the answer can change, scroll or no scroll — and the
 * rule above is what answers it. Band membership cannot answer it on its own:
 * two sections meet on a shared edge, so the one ending on the band's top line
 * and the one starting there are both reported as intersecting, and whichever
 * of the two is picked by position in the list is right only half the time.
 */
function useCurrentSection(ids: string[]) {
  const [current, setCurrent] = useState(() => ids[0] ?? "");

  useEffect(() => {
    setCurrent(ids[0] ?? "");
    if (typeof IntersectionObserver !== "function") return;
    const nodes = ids
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => node !== null);
    if (!nodes.length) return;

    /** The last section can never reach the band: the document runs out
     *  before it gets there. So the end of the page is the end of the list,
     *  whatever the band says — but only on a page long enough to have an
     *  end to reach. */
    const atEnd = () => {
      const doc = document.documentElement;
      if (doc.scrollHeight <= window.innerHeight + 4) return false;
      return window.scrollY + window.innerHeight >= doc.scrollHeight - 4;
    };
    const resolve = () => {
      if (atEnd()) return ids[ids.length - 1];
      let reached = ids[0];
      for (const node of nodes) {
        // A section jumped to lands its top on the band's line exactly, so the
        // line itself counts as reached.
        if (node.getBoundingClientRect().top <= BAND_TOP + 1) reached = node.id;
      }
      return reached;
    };
    const observer = new IntersectionObserver(() => setCurrent(resolve()), {
      rootMargin: `-${BAND_TOP}px 0px -55% 0px`,
      threshold: 0,
    });
    for (const node of nodes) observer.observe(node);

    /** The observer alone cannot see the last few pixels of the page: coming
     *  to rest at the foot crosses no boundary, so nothing would fire and the
     *  contents would keep pointing at the section above. One passive
     *  listener, read once per frame, settles it. */
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setCurrent(resolve());
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ids]);

  return current;
}

/** The numbered contents, rendered once and worn twice: as the sticky rail
 *  beside the document on a wide screen, and as a scrolling row of chips
 *  under the hero on a narrow one. */
function PolicyContents({
  sections,
  current,
  variant,
  onJump,
}: {
  sections: PolicySection[];
  current: string;
  variant: "rail" | "chips";
  onJump: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const list = useRef<HTMLOListElement>(null);

  /** The active chip brings itself to the middle of the row. The row is
   *  scrolled directly rather than through scrollIntoView, which would drag
   *  the page vertically after the chip once the row had scrolled off the
   *  top — the reader would be pulled back up by their own reading. */
  useEffect(() => {
    if (variant !== "chips") return;
    const row = list.current;
    const active = row?.querySelector<HTMLElement>('[data-current="true"]');
    if (!row || !active) return;
    row.scrollTo({
      left: active.offsetLeft - (row.clientWidth - active.clientWidth) / 2,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [current, variant]);

  return (
    <nav
      className={`policy-contents policy-contents--${variant}`}
      aria-label="Contents"
    >
      <ol className="policy-contents__list" ref={list}>
        {sections.map((section, index) => (
          <li className="policy-contents__item" key={section.id}>
            <a
              className="policy-contents__link"
              href={`#${section.id}`}
              data-current={section.id === current}
              aria-current={section.id === current ? "true" : undefined}
              onClick={(event) => onJump(event, section.id)}
            >
              <span className="policy-contents__number" aria-hidden="true">
                {ordinal(index)}
              </span>
              <span className="policy-contents__title">{section.title}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PolicyPage({ page, theme, onThemeChange }: PolicyPageProps) {
  const document_ = policyDocuments[page];
  const ids = useMemo(
    () => document_.sections.map((section) => section.id),
    [document_],
  );
  const current = useCurrentSection(ids);

  /** A contents entry travels to its section rather than jumping to it,
   *  except for a reader who asked for less motion. The hash stays the
   *  link's href, so without script the jump is still the fallback, and the
   *  address bar is updated in place so the router is not asked to navigate. */
  const jump = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, id: string) => {
      const target = window.document.getElementById(id);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
      try {
        window.history.replaceState(null, "", `#${id}`);
      } catch {
        // An address bar this browser refuses to rewrite changes nothing
        // about where the reader has just been taken.
      }
    },
    [],
  );

  return (
    <PublicDocument theme={theme} onThemeChange={onThemeChange}>
      <div className="policy" data-policy={page}>
        <DocumentHero
          eyebrow="Legal"
          title={document_.title}
          lead={document_.lead}
          meta={policyUpdated}
        />

        <div className="landing-section policy-chips" data-tone="raise">
          <PolicyContents
            sections={document_.sections}
            current={current}
            variant="chips"
            onJump={jump}
          />
        </div>

        <div className="landing-section policy-body" data-tone="raise">
          <div className="policy-body__rail">
            <PolicyContents
              sections={document_.sections}
              current={current}
              variant="rail"
              onJump={jump}
            />
          </div>
          <div className="policy-doc">
            {document_.sections.map((section, index) => (
              <section
                className="policy-entry"
                id={section.id}
                key={section.id}
                aria-labelledby={`${section.id}-heading`}
              >
                <p className="policy-entry__number" aria-hidden="true">
                  {ordinal(index)}
                </p>
                <div className="policy-entry__text">
                  <h2
                    className="policy-entry__heading"
                    id={`${section.id}-heading`}
                  >
                    {section.title}
                  </h2>
                  <div className="policy-prose">{section.body}</div>
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </PublicDocument>
  );
}
