/** The two little worlds a workspace can be, drawn rather than iconified.
 *
 *  A workspace kind is the first thing anyone chooses and the hardest thing to
 *  explain in a word, so each kind gets a miniature of what it actually looks
 *  like once it is running: the coding kind is the task canvas seen from far
 *  away — cards on a dot grid, a dependency wire with a signal on it, a commit
 *  chip, a branch — and the everyday kind is the page you would have written
 *  instead — a checklist, a month, and one of the product's orbs breathing
 *  beside them.
 *
 *  Both are inline SVG on the app's own tokens, so they follow the theme, carry
 *  no image weight, and can be shown at any size. Nothing here animates by
 *  itself: every animation is defined in workspace-kind-art.css and paused
 *  until an ancestor says otherwise, which is what lets the picker wake an
 *  illustration on hover and the landing page loop one on reveal without this
 *  file knowing about either. */
import { useId, type CSSProperties } from "react";
import type { WorkspaceKind } from "./domain";
import "./workspace-kind-art.css";

/** Both drawings share one box so the two panels beside each other agree. */
const VIEW_BOX = "0 0 132 100";

/** A task card as the canvas draws it: a plate, a title line, a second shorter
 *  line, and the status dot on its right. */
function TaskCard({
  x,
  y,
  width = 48,
  height = 28,
  tone,
  quiet = false,
}: {
  x: number;
  y: number;
  width?: number;
  height?: number;
  tone: string;
  quiet?: boolean;
}) {
  return (
    <g opacity={quiet ? 0.72 : 1}>
      <rect
        className="wk-art__card"
        x={x}
        y={y}
        width={width}
        height={height}
        rx={6}
      />
      <rect
        className="wk-art__line"
        x={x + 7}
        y={y + 8}
        width={width - 24}
        height={3}
        rx={1.5}
      />
      <rect
        className="wk-art__line wk-art__line--faint"
        x={x + 7}
        y={y + 16}
        width={width - 32}
        height={3}
        rx={1.5}
      />
      <circle cx={x + width - 9} cy={y + 9} r={3} fill={tone} />
    </g>
  );
}

function CodingArt({ uid }: { uid: string }) {
  const grid = `wk-grid-${uid}`;
  return (
    <>
      <defs>
        <pattern
          id={grid}
          width={11}
          height={11}
          patternUnits="userSpaceOnUse"
          x={5}
          y={5}
        >
          <circle className="wk-art__grid-dot" cx={1} cy={1} r={0.9} />
        </pattern>
      </defs>
      <rect
        className="wk-art__plate"
        x={1}
        y={1}
        width={130}
        height={98}
        rx={9}
      />
      <rect x={1} y={1} width={130} height={98} rx={9} fill={`url(#${grid})`} />

      {/* The wire first, so both cards sit on top of the end it meets. */}
      <path
        className="wk-art__wire"
        d="M60 30 C 73 30, 67 60, 80 60"
        pathLength={100}
      />
      <path
        className="wk-art__signal"
        d="M60 30 C 73 30, 67 60, 80 60"
        pathLength={100}
      />

      <TaskCard x={12} y={16} tone="var(--wk-ink-a)" />
      <TaskCard x={72} y={58} tone="var(--wk-ink-b)" />

      {/* The commit the left card was closed by: a hash chip with its dot. */}
      <g className="wk-art__commit">
        <rect
          className="wk-art__chip"
          x={12}
          y={58}
          width={52}
          height={16}
          rx={8}
        />
        <circle className="wk-art__chip-dot" cx={21} cy={66} r={2.6} />
        <text className="wk-art__hash" x={27} y={69}>
          a3f19c
        </text>
      </g>

      {/* A branch leaving the trunk, with the same kind of signal running out
          along it a beat after the wire's. */}
      <g className="wk-art__branch">
        <path className="wk-art__wire" d="M104 18 L104 44" pathLength={100} />
        <path
          className="wk-art__wire"
          d="M104 30 C 104 22, 110 20, 120 20"
          pathLength={100}
        />
        <path
          className="wk-art__signal wk-art__signal--late"
          d="M104 30 C 104 22, 110 20, 120 20"
          pathLength={100}
        />
        <circle className="wk-art__node" cx={104} cy={18} r={3} />
        <circle className="wk-art__node" cx={104} cy={44} r={3} />
        <circle
          className="wk-art__node wk-art__node--tip"
          cx={120}
          cy={20}
          r={3}
        />
      </g>
    </>
  );
}

function EverydayArt({ uid }: { uid: string }) {
  const orb = `wk-orb-${uid}`;
  const rows = [26, 40, 54, 68];
  return (
    <>
      <defs>
        <radialGradient id={orb} cx="34%" cy="28%" r="78%">
          <stop offset="0" stopColor="var(--wk-orb-glow)" />
          <stop offset="0.52" stopColor="var(--wk-orb-start)" />
          <stop offset="1" stopColor="var(--wk-orb-end)" />
        </radialGradient>
      </defs>
      <rect
        className="wk-art__plate"
        x={1}
        y={1}
        width={130}
        height={98}
        rx={9}
      />

      {/* The page. Its margin rule is the one warm line on it. */}
      <rect
        className="wk-art__page"
        x={10}
        y={12}
        width={64}
        height={76}
        rx={7}
      />
      <path className="wk-art__margin" d="M23 18 L23 82" />
      {rows.map((y, index) => (
        <g key={y}>
          <rect
            className="wk-art__box"
            x={30}
            y={y}
            width={9}
            height={9}
            rx={2.5}
          />
          <rect
            className="wk-art__line wk-art__line--warm"
            x={44}
            y={y + 3}
            width={index === 1 ? 20 : index === 3 ? 14 : 22}
            height={3}
            rx={1.5}
          />
        </g>
      ))}
      {/* The first row is the one that gets done: the tick draws itself and the
          line it belongs to is ruled through a beat later. */}
      <path
        className="wk-art__tick"
        d="M32.2 30.6 L34.2 32.8 L37.4 28.4"
        pathLength={100}
      />
      <path className="wk-art__strike" d="M44 30.5 L66 30.5" pathLength={100} />

      {/* A month, with one day already spoken for. */}
      <g className="wk-art__cal">
        <rect
          className="wk-art__cal-plate"
          x={86}
          y={16}
          width={36}
          height={34}
          rx={5}
        />
        <path className="wk-art__cal-rule" d="M86 26 L122 26" />
        <path className="wk-art__cal-peg" d="M95 12 L95 18" />
        <path className="wk-art__cal-peg" d="M113 12 L113 18" />
        {[33, 42].map((cy) =>
          [94, 104, 114].map((cx) => (
            <circle
              key={`${cx}-${cy}`}
              className="wk-art__cal-day"
              cx={cx}
              cy={cy}
              r={2}
            />
          )),
        )}
        <circle className="wk-art__cal-today" cx={104} cy={33} r={2.4} />
        <circle className="wk-art__cal-halo" cx={104} cy={33} r={5} />
      </g>

      {/* The orb, breathing. */}
      <g className="wk-art__orb">
        <circle className="wk-art__orb-glow" cx={104} cy={72} r={16} />
        <circle cx={104} cy={72} r={12} fill={`url(#${orb})`} />
        <ellipse
          className="wk-art__orb-shine"
          cx={100}
          cy={67.5}
          rx={4}
          ry={2.8}
        />
      </g>
    </>
  );
}

/** One kind's illustration. `height` is the drawing's height in pixels; the
 *  width follows from the shared box, and both shrink together if the column
 *  they are in is narrower than that. */
export function WorkspaceKindArt({
  kind,
  height = 88,
  className,
}: {
  kind: WorkspaceKind;
  height?: number;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  return (
    <span
      className={`wk-art wk-art--${kind}${className ? ` ${className}` : ""}`}
      style={{ "--wk-art-h": `${height}px` } as CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox={VIEW_BOX} focusable="false" role="presentation">
        {kind === "coding" ? (
          <CodingArt uid={uid} />
        ) : (
          <EverydayArt uid={uid} />
        )}
      </svg>
    </span>
  );
}
