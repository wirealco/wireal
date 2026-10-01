/** The sections the landing page grew in round four, kept out of
 *  LandingPage.tsx so that file stays the page's outline rather than its
 *  contents. Each one draws itself with the product's own components — the task
 *  card's classes, the agent avatars the activity rail uses — so both themes
 *  and both languages come for free.
 *
 *  Nothing here runs an animation loop in JavaScript. The feed and the tool
 *  marquee are CSS animations; the only script is one IntersectionObserver
 *  that marks a block revealed exactly once. */
import {
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { Avatar, Card, Typography } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { ActivityBloub } from "./ActivityBloub";
import { Lock, Mail, Person, UserCog } from "./icons";
import { WorkspaceKindArt } from "./workspace-kind-art";
import { LabelBadge, StatusChip } from "./ui";
import { mcpHost } from "./mcp-endpoint";
import { taskIdLabel } from "./domain";
import type { ActivityAgentBrand } from "./activity-author";
import "./landing-sections.css";

/* ---- Frame --------------------------------------------------------------- */

/** The four rails: a pair on the column's edges and a pair near the viewport's,
 *  each a 1px column of fine dashes running the whole page. They are drawn over
 *  the sections rather than under them, because a section's tone is opaque and
 *  a rail under it would only show where nothing was painted. */
export function LandingRails() {
  return (
    <div className="landing-rails" aria-hidden="true">
      <span className="landing-rail landing-rail--inner-start" />
      <span className="landing-rail landing-rail--inner-end" />
      <span className="landing-rail landing-rail--outer landing-rail--outer-start" />
      <span className="landing-rail landing-rail--outer landing-rail--outer-end" />
    </div>
  );
}

/** The markers a cell divider leaves where it meets the section's own edges:
 *  one at the divider's top, one at its bottom, at each fraction of the row.
 *  The pair on the rails is the section's, drawn by its two pseudo-elements. */
export function DividerMarks({ at }: { at: number[] }) {
  return (
    <>
      {at.map((fraction) => (
        <span
          key={fraction}
          className="landing-divider-marks"
          aria-hidden="true"
          style={{ left: `${fraction * 100}%` }}
        >
          <span className="landing-mark landing-mark--top" />
          <span className="landing-mark landing-mark--bottom" />
        </span>
      ))}
    </>
  );
}

/* ---- Reveal -------------------------------------------------------------- */

/** Blocks rise 12px into place the first time they cross the fold, and only
 *  then: the observer stops watching an element the moment it fires. The armed
 *  attribute is set from script, so a page whose script never ran — or a
 *  visitor who asked for less motion — gets the finished state and no observer
 *  at all. Nothing moves in the layout: only opacity and transform. */
export function useLandingReveal(root: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    if (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    if (typeof IntersectionObserver !== "function") return;

    node.dataset.revealArmed = "";
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.revealed = "";
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.04 },
    );
    node
      .querySelectorAll("[data-reveal]")
      .forEach((target) => observer.observe(target));
    return () => {
      observer.disconnect();
      delete node.dataset.revealArmed;
    };
  }, [root]);
}

/* ---- Work as a team ------------------------------------------------------ */

type Who =
  | { kind: "agent"; brand: ActivityAgentBrand; label: string }
  | { kind: "person"; name: string; initials: string };

/** The five who have worked on the card — nobody is assigned in Wireal; a
 *  task's people are whoever its activity names — two people wearing their
 *  initials, three agents wearing the avatar the activity rail draws for them. */
const editors: Who[] = [
  { kind: "person", name: "Mr. Banana", initials: "MB" },
  { kind: "person", name: "Hallalobu H.", initials: "HH" },
  { kind: "agent", brand: "claude", label: "Claude" },
  { kind: "agent", brand: "codex", label: "Codex" },
  { kind: "agent", brand: "chatgpt", label: "ChatGPT" },
];

/** Six entries, each typed in by CSS on its own delay and then held until the
 *  loop comes round to it again. */
const feed: { key: string; who: Who }[] = [
  { key: "claimed", who: { kind: "agent", brand: "codex", label: "Codex" } },
  {
    key: "seated",
    who: { kind: "person", name: "Mr. Banana", initials: "MB" },
  },
  { key: "branch", who: { kind: "agent", brand: "claude", label: "Claude" } },
  { key: "merged", who: { kind: "agent", brand: "claude", label: "Claude" } },
  {
    key: "sentBack",
    who: { kind: "person", name: "Captain Marmalade", initials: "CM" },
  },
  {
    key: "reported",
    who: { kind: "agent", brand: "chatgpt", label: "ChatGPT" },
  },
];

const teamRows = [
  { key: "board", icon: Person },
  { key: "invites", icon: Mail },
  { key: "roles", icon: UserCog },
] as const;

function Face({ who }: { who: Who }) {
  if (who.kind === "agent") {
    return (
      <span className="landing-face landing-face--agent">
        <ActivityBloub brand={who.brand} label={who.label} />
      </span>
    );
  }
  return (
    <Avatar size="sm" className="landing-face landing-face--person">
      <Avatar.Fallback>{who.initials}</Avatar.Fallback>
    </Avatar>
  );
}

export function TeamSection() {
  const { t } = useTranslation();
  return (
    <section
      id="team"
      className="landing-section landing-band landing-team"
      data-tone="stage"
    >
      <div className="landing-split">
        <div className="landing-split__text" data-reveal>
          <h2 className="landing-band__heading">{t("landing.team.heading")}</h2>
          <p className="landing-band__lead">{t("landing.team.lead")}</p>
          <ul className="landing-rows">
            {teamRows.map(({ key, icon: Icon }) => (
              <li className="landing-row" key={key}>
                <span className="landing-row__glyph" aria-hidden="true">
                  <Icon size={16} />
                </span>
                {t(`landing.team.rows.${key}`)}
              </li>
            ))}
          </ul>
        </div>

        <div
          className="landing-panel"
          data-reveal
          style={{ "--reveal-i": 1 } as CSSProperties}
        >
          <DividerMarks at={[0, 1]} />
          <Card
            variant="secondary"
            className="task-card landing-panel__card"
            data-status="doing"
          >
            <Card.Header>
              <div className="min-w-0">
                <Card.Title className="break-words">
                  {t("landing.showcase.taskFields")}
                </Card.Title>
                <Typography
                  type="body-xs"
                  color="muted"
                  className="truncate font-mono"
                >
                  {taskIdLabel("4")}
                </Typography>
              </div>
            </Card.Header>
            <Card.Content>
              <div className="flex flex-wrap items-center gap-1.5">
                <LabelBadge name="Checkout" color="#408cff" />
                <LabelBadge name="Payments" color="#ef6387" />
              </div>
            </Card.Content>
            <Card.Content>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusChip status="doing" />
                <span className="node-tag node-tag--lock">
                  <Lock size={12} aria-hidden="true" />
                  <span className="node-tag__label">Mr. Banana</span>
                </span>
              </div>
            </Card.Content>
            <Card.Content>
              <div className="landing-assignees">
                <span className="landing-assignees__label">
                  {t("landing.team.editors")}
                </span>
                <span className="landing-assignees__faces">
                  {editors.map((who) => (
                    <Face
                      key={who.kind === "agent" ? who.brand : who.initials}
                      who={who}
                    />
                  ))}
                </span>
              </div>
            </Card.Content>
          </Card>

          <div className="landing-feed">
            <span className="landing-feed__label">
              {t("landing.team.activity")}
            </span>
            <ul className="landing-feed__list">
              {feed.map((line, index) => {
                const text = t(`landing.team.feed.${line.key}`);
                return (
                  <li
                    className="landing-feed__row"
                    key={line.key}
                    style={{ "--feed-i": index } as CSSProperties}
                  >
                    <Face who={line.who} />
                    <span
                      className="landing-feed__text"
                      style={{ "--feed-chars": text.length } as CSSProperties}
                    >
                      {text}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---- Two kinds of workspace ---------------------------------------------- */

/** The picker itself is a radio group that expects a value and a handler, so a
 *  page with nothing to choose borrows its drawings instead: the same two
 *  illustrations WorkspaceKindPicker shows on its cards, at panel size, and the
 *  same two names it labels them with. */
const kinds = [
  { key: "coding", points: ["repository", "revision", "lines"] },
  { key: "everyday", points: ["any", "none", "notes"] },
] as const;

export function WorkspaceKindsSection() {
  const { t } = useTranslation();
  return (
    <section
      id="workspaces"
      className="landing-section landing-band landing-band--cells landing-kinds"
      data-tone="raise"
    >
      <h2 className="landing-band__heading" data-reveal>
        {t("landing.kinds.heading")}
      </h2>
      <div className="landing-kinds__grid">
        <DividerMarks at={[1 / 2]} />
        {kinds.map(({ key, points }, index) => (
          <div
            className="landing-kind"
            key={key}
            data-reveal
            style={{ "--reveal-i": index } as CSSProperties}
          >
            <span className="landing-kind__stage">
              <DividerMarks at={[0, 1]} />
              <WorkspaceKindArt kind={key} height={140} />
            </span>
            {/* The words are one block of their own so they can be centred
                against the drawing beside them as a unit; loose in the panel
                they would be two rows stretched to the drawing's height. */}
            <div className="landing-kind__text">
              <h3 className="landing-kind__title">
                {t(`workspaceKind.${key}`)}
              </h3>
              <ul className="landing-kind__points">
                {points.map((point) => (
                  <li key={point}>{t(`landing.kinds.${key}.${point}`)}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---- The tool marquee ---------------------------------------------------- */

/** Every tool the Wireal MCP server registers, in the order a client lists
 *  them. The heading counts none of them: the marquee is the evidence that one
 *  server is the whole of it. */
export const mcpToolNames = [
  "workspaces",
  "list_projects",
  "project",
  "label",
  "list_tasks",
  "get_task",
  "task_brief",
  "create_tasks",
  "update_task",
  "delete_task",
  "report",
  "add_task_activity",
  "propose_task",
  "working_on",
  "runner",
] as const;

/* The section reads the way the tools it names are used: a command you paste,
   then the runner's own screen answering in the same window, drawn the way
   wireal-run draws it: a frame, each CLI's usage, the agents with a spinner
   and a clock, and a feed of what just happened. */
type Tone =
  | "frame"
  | "dim"
  | "bright"
  | "good"
  | "warn"
  | "accent"
  | "claude"
  | "codex"
  | "command";
type Segment = [string, Tone?] | ["spin", "spin"] | ["clock", "clock", number];
const screenWidth = 52;
const spinFrames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

function segmentText(segment: Segment, now: number): string {
  if (segment[1] === "spin") return spinFrames[Math.floor(now / 90) % 10];
  if (segment[1] === "clock") {
    const total = Math.floor((segment[2] as number) + now / 1000);
    return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
  }
  return segment[0];
}

function bar(percent: number, width = 10): Segment[] {
  const filled = Math.round((percent / 100) * width);
  const tone: Tone = percent < 60 ? "good" : "warn";
  return [
    ["█".repeat(filled), tone],
    ["█".repeat(width - filled), "frame"],
    [` ${String(percent).padStart(3)}%`, tone],
  ];
}

const ruled = (left: string, title: Segment[], right: string): Segment[] => {
  const used = title.reduce((sum, part) => sum + part[0].length, 0);
  return [
    [`${left}─ `, "frame"],
    ...title,
    [` ${"─".repeat(Math.max(0, screenWidth - used - 4))}${right}`, "frame"],
  ];
};

const screenRows: Segment[][] = [
  [
    ["$ ", "command"],
    ["claude mcp add --transport http wireal", "bright"],
  ],
  [["Added HTTP MCP server wireal", "dim"]],
  [
    ["$ ", "command"],
    ["wireal-run run", "bright"],
  ],
  ruled(
    "╭",
    [
      ["wireal-run · ", "dim"],
      ["Studio", "bright"],
      ["   Wireal · ", "dim"],
      ["● live", "good"],
    ],
    "╮",
  ),
  [
    ["Claude", "claude"],
    ["  5h ", "dim"],
    ...bar(31),
    ["  week ", "dim"],
    ...bar(71),
  ],
  [
    ["Codex ", "codex"],
    ["  5h ", "dim"],
    ...bar(12),
    ["  week ", "dim"],
    ...bar(27),
  ],
  ruled(
    "├",
    [
      ["agents · ", "dim"],
      ["2 of 3 working", "good"],
    ],
    "┤",
  ),
  [
    ["1 ", "accent"],
    ["spin", "spin"],
    [" Sol    ", "bright"],
    ["claude ", "claude"],
    ["WRL·41 Settle refunds ", "accent"],
    ["clock", "clock", 252],
  ],
  [
    ["2 ", "accent"],
    ["spin", "spin"],
    [" Pepper ", "bright"],
    ["codex  ", "codex"],
    ["WRL·38 Changelog page ", "accent"],
    ["clock", "clock", 65],
  ],
  [
    ["3 ", "dim"],
    ["◌", "dim"],
    [" Juno   ", "dim"],
    ["claude ", "claude"],
    ["idle · waiting for a task", "dim"],
  ],
  ruled("├", [["feed", "dim"]], "┤"),
  [
    ["18:42  ", "dim"],
    ["✓", "good"],
    [" 40 merged into main  a3f19c2", "bright"],
  ],
  [
    ["18:44  ", "dim"],
    ["·", "dim"],
    [" Sol claimed WRL·41", "bright"],
  ],
  ruled(
    "╰",
    [
      ["+", "bright"],
      [" add  ", "dim"],
      ["-", "bright"],
      [" remove  ", "dim"],
      ["1-9", "bright"],
      [" attach  ", "dim"],
      ["q", "bright"],
      [" quit", "dim"],
    ],
    "╯",
  ),
];

/** One row of the screen. Rows inside the frame are boxed with │ and padded
 *  to its width, so the columns line up however the clocks tick. */
function ScreenRow({ row, now }: { row: Segment[]; now: number }) {
  const outside = row[0][1] === "command" || /^[╭├╰]/.test(row[0][0]);
  const said = row.length === 1;
  const boxed = !outside && !said;
  const length = row.reduce(
    (sum, segment) => sum + segmentText(segment, now).length,
    0,
  );
  return (
    <span className="landing-terminal__line">
      {boxed && <span data-tone="frame">│ </span>}
      {row.map((segment, index) => (
        <span key={index} data-tone={segment[1]}>
          {segmentText(segment, now)}
        </span>
      ))}
      {boxed && (
        <span data-tone="frame">
          {" ".repeat(Math.max(0, screenWidth - 2 - length))}│
        </span>
      )}
    </span>
  );
}

function useTicking(every: number) {
  const [now, setNow] = useState(() => Date.now() - pageStart);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(
      () => setNow(Date.now() - pageStart),
      every,
    );
    return () => window.clearInterval(timer);
  }, [every]);
  return now;
}
const pageStart = Date.now();

export function McpSection() {
  const { t } = useTranslation();
  const now = useTicking(90);
  return (
    <section
      id="tools"
      className="landing-section landing-band landing-mcp"
      data-tone="stage"
    >
      <div className="landing-mcp__grid">
        <div className="landing-mcp__copy">
          <h2 className="landing-band__heading" data-reveal>
            {t("landing.tools.heading")}
          </h2>
          <p
            className="landing-band__lead"
            data-reveal
            style={{ "--reveal-i": 1 } as CSSProperties}
          >
            {t("landing.tools.lead")}
          </p>
          <ol className="landing-mcp__points">
            {(["server", "clients", "machine"] as const).map((key, index) => (
              <li
                className="landing-mcp__point"
                key={key}
                data-reveal
                style={{ "--reveal-i": index + 2 } as CSSProperties}
              >
                <span className="landing-mcp__index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="landing-mcp__point-body">
                  <span className="landing-mcp__point-title">
                    {t(`landing.tools.points.${key}.title`)}
                  </span>
                  <span className="landing-mcp__point-text">
                    {t(`landing.tools.points.${key}.body`, {
                      count: mcpToolNames.length,
                      host: mcpHost,
                    })}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div
          className="landing-terminal"
          data-reveal
          style={{ "--reveal-i": 2 } as CSSProperties}
          aria-label={t("landing.tools.terminalLabel")}
          role="img"
        >
          <div className="landing-terminal__bar" aria-hidden="true">
            <span className="landing-terminal__lights">
              <span />
              <span />
              <span />
            </span>
            <span className="landing-terminal__title">wireal-run — zsh</span>
          </div>
          <pre className="landing-terminal__body" aria-hidden="true">
            {screenRows.map((row, index) => (
              <ScreenRow key={index} row={row} now={now} />
            ))}
          </pre>
        </div>
      </div>
    </section>
  );
}
