import type { AgentKind, AgentMode } from "../src/domain.ts";
import { taskIdLabel } from "../src/domain.ts";
import type { PtyLink } from "./agents/types.ts";
import { defaultColumns, defaultRows } from "./agents/pty.ts";
import { brandOf, untilText } from "./agents/usage.ts";
import type { Screen } from "./screen.ts";

export type SlotState =
  "idle" | "claiming" | "working" | "committing" | "merging";
export type FolderView = {
  branch: string;
  dirty: boolean;
  ahead?: number;
  behind: number;
  path?: string;
};
export type SlotView = {
  agent: string;
  kind: AgentKind;
  model: string;
  enabled: boolean;
  hosted: boolean;
  reference: string;
  name: string;
  state: SlotState;
  since: number;
  last: string;
  costUsd: number;
  fiveHour?: number;
  sevenDay?: number;
  paused: string;
  following: string;
  lines: string[];
  /** What the agent is doing now, as the hooks describe it. */
  step?: string;
  /** Files the agent has written, oldest first. */
  files?: string[];
  /** The reference of a task locked to this agent while it is idle. */
  locked?: string;
  pty?: PtyLink;
  screen?: Screen;
};
export type SkippedView = { reference: string; name: string; reason: string };
/** One line of the feed: what `say` reported, and when. A pending line is
 *  work still going on beside the loop, drawn with a spinner until the loop
 *  takes it away. */
/** `times` counts the same line said again straight after itself, which
 *  the feed folds into one line rather than scrolling everything else away. */
export type FeedLine = {
  at: number;
  text: string;
  pending?: boolean;
  times?: number;
};
/** A CLI's limits as the runner last read them. `at` is when they first
 *  arrived, which the bars fill up from. */
export type UsageView = {
  kind: AgentKind;
  fiveHour?: number;
  sevenDay?: number;
  fiveHourReset?: number;
  sevenDayReset?: number;
  at?: number;
};
export type StartStep = { text: string; state: "doing" | "done" | "failed" };
export type View = {
  awake?: boolean;
  runner: string;
  runnerId: string;
  host: string;
  workspace: string;
  mode: AgentMode;
  costUsd: number;
  paused: string;
  seating?: string;
  skipped: SkippedView[];
  slots: SlotView[];
  folder?: FolderView;
  feed?: FeedLine[];
  usage?: UsageView[];
  /** Set while the runner is still starting; the screen shows these steps
   *  instead of an agent table that has nothing in it yet. */
  starting?: StartStep[];
  /** The last heartbeat did not reach Wireal. */
  offline?: boolean;
};
export type Ui = {
  update: (view: View) => void;
  log: (text: string) => void;
  stop: () => void;
};

/** Keys that steer the crew: + adds an agent on the CLI used least (= does
 *  the same without shift), c and x add a Claude Code or a Codex one, -
 *  removes the highest-numbered idle agent, p pauses or resumes intake. */
export const crewKeys = ["+", "=", "-", "c", "x", "p"];
export const detachKey = "\u0007";
export const detachKeys = [detachKey, "\u001d"];
export const detachLabel = "ctrl-g";
const alternate = "\u001b[?1049h";
const normal = "\u001b[?1049l";
const clear = "\u001b[H\u001b[J";
const home = "\u001b[H";
const eraseBelow = "\u001b[0J";
const hideCursor = "\u001b[?25l";
const showCursor = "\u001b[?25h";
export const eraseLine = "\u001b[K";
export const pushTitle = "\u001b[22;2t";
export const popTitle = "\u001b[23;2t";

export function titleFor(name: string): string {
  return `\u001b]2;${name.replace(/[\u0000-\u001f\u007f]/g, " ").trim()}\u0007`;
}
const reset = "\u001b[0m";

export const previewRows = 10;
export const cup = "☕";
export const steam = [" ", "˙", "·", "˚"];

export function awakeMark(frame: number): string {
  return `${steam[frame % steam.length]}${cup}`;
}
export const spinnerMs = 120;
/** How long a usage bar takes to fill once its figures arrive. */
export const fillMs = 900;
/** How long a new feed line takes to type itself in. */
export const revealMs = 360;
/** How long a new feed line stays brighter than the rest. */
export const freshMs = 1_200;
/** How long the tick of a finished task flashes. */
export const flashMs = 1_500;
/** The most feed lines on screen at once; the rest scroll with ↑ and ↓. */
export const feedRows = 10;
/** Feed lines kept before anything else gives way to a short window. */
export const feedFloor = 3;

/** The characters the screen is drawn with. The fancy set needs a font with
 *  braille and the rounded box corners, which Windows Terminal, macOS and
 *  Linux terminals have; the old Windows console only has the code page 437
 *  shapes, so it gets a set made of those. */
export type Glyphs = {
  spinner: readonly string[];
  claim: readonly string[];
  breath: readonly string[];
  idle: string;
  paused: string;
  off: string;
  missing: string;
  locked: string;
  done: string;
  failed: string;
  plain: string;
  corners: readonly [string, string, string, string];
  branch: string;
  reset: string;
  full: string;
  empty: string;
  cup: boolean;
};

export const fancy: Glyphs = {
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  claim: ["◐", "◓", "◑", "◒"],
  breath: ["∙", "•", "●", "●", "●", "●", "•", "∙"],
  idle: "◌",
  paused: "‖",
  off: "○",
  missing: "✕",
  locked: "◆",
  done: "✓",
  failed: "✕",
  plain: "·",
  corners: ["╭", "╮", "╰", "╯"],
  branch: "└",
  reset: "↻",
  full: "▓",
  empty: "░",
  cup: true,
};

export const legacy: Glyphs = {
  spinner: ["-", "\\", "|", "/"],
  claim: ["-", "\\", "|", "/"],
  breath: ["·", "•", "●", "●", "•", "·"],
  idle: "·",
  paused: "║",
  off: "o",
  missing: "x",
  locked: "♦",
  done: "√",
  failed: "x",
  plain: "·",
  corners: ["┌", "┐", "└", "┘"],
  branch: "└",
  reset: "~",
  full: "▓",
  empty: "░",
  cup: false,
};

/** The old console host sets neither variable; Windows Terminal sets
 *  WT_SESSION and most other terminals TERM_PROGRAM. */
export function glyphsFor(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Glyphs {
  return platform === "win32" && !env.WT_SESSION && !env.TERM_PROGRAM
    ? legacy
    : fancy;
}

export type Ink = readonly number[];
export type Paint = (text: string, ink?: Ink) => string;
export type Piece = readonly [string, Ink?];

const dim: Ink = [90];
const bright: Ink = [97];
const strong: Ink = [1];
const loud: Ink = [1, 97];
const accent: Ink = [38, 5, 209];
const good: Ink = [38, 5, 78];
const warn: Ink = [38, 5, 214];
const bad: Ink = [38, 5, 203];
const cool: Ink = [38, 5, 110];
const line: Ink = [38, 5, 240];
const claudeInk: Ink = [38, 5, 216];
const codexInk: Ink = [38, 5, 152];
/** Greens from dark to light and back, one per step of the live dot. */
const breathing: Ink[] = [22, 28, 34, 40, 46, 46, 40, 34].map((code) => [
  38,
  5,
  code,
]);

export const inked: Paint = (text, ink) =>
  ink?.length && text ? `\u001b[${ink.join(";")}m${text}\u001b[0m` : text;
export const bare: Paint = (text) => text;

export function painter(colour: boolean): Paint {
  return colour ? inked : bare;
}

export function colourful(
  env: NodeJS.ProcessEnv = process.env,
  tty = true,
): boolean {
  if (!tty || env.TERM === "dumb") return false;
  return !env.NO_COLOR;
}

export function kindInk(kind: AgentKind): Ink {
  return kind === "codex" ? codexInk : claudeInk;
}

export function stateInk(state: string): Ink {
  if (state === "working") return good;
  if (state === "claiming") return warn;
  if (state === "committing") return cool;
  if (state === "merging") return accent;
  return dim;
}

/** Green while there is plenty left, amber past 60%, red past 85%. */
export function windowInk(value: number | undefined): Ink {
  if (value === undefined) return dim;
  if (value >= 85) return bad;
  if (value >= 60) return warn;
  return good;
}

export type Tone = "good" | "bad" | "warn" | "plain";

const failing =
  /fail|error|revoke|expired|conflict|blocked|signed out|could not|stopped/i;
const finishing =
  /^(Merged|Promoted|Added|Cached|Intake resumed)\b|\b(done|pushed|caught up)\b/;
const holding = /^(Paused|Intake paused|Removed)\b|\bskipped\b|\bheld by\b/;

/** How a feed line reads: something that went wrong, something finished,
 *  something held back, or news. */
export function toneOf(text: string): Tone {
  if (failing.test(text)) return "bad";
  if (finishing.test(text)) return "good";
  if (holding.test(text)) return "warn";
  return "plain";
}

/** A running time that ticks every second: 42s, 4m 12s, 1h 04m. */
export function elapsed(milliseconds: number): string {
  if (milliseconds < 0) return "";
  const total = Math.floor(milliseconds / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60)
    return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** The time of day a feed line was said, in the machine's own zone. */
export function clock(at: number): string {
  const when = new Date(at);
  return `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
}

export function fit(value: string, width: number): string {
  const text = value.replace(/\s+/g, " ");
  if (text.length <= width) return text.padEnd(width);
  return width <= 1 ? text.slice(0, width) : text.slice(0, width - 1) + "…";
}

export function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

export const wide = /[\u{1F300}-\u{1FAFF}\u{2615}\u{231A}\u{23F0}]/gu;

export function cells(text: string): number {
  return text.length + (text.match(wide)?.length ?? 0);
}

export function span(pieces: readonly Piece[]): number {
  return pieces.reduce((sum, [text]) => sum + cells(text), 0);
}

/** The pieces cut to a width, the last one ending in an ellipsis when
 *  anything was cut, and how many cells they take. */
export function clip(
  pieces: readonly Piece[],
  width: number,
): { pieces: Piece[]; used: number } {
  let used = 0;
  const kept: Piece[] = [];
  for (const [text, ink] of pieces) {
    if (used >= width) break;
    const room = width - used;
    const cut =
      cells(text) <= room
        ? text
        : room <= 1
          ? ""
          : text.slice(0, room - 1).replace(wide, "") + "…";
    if (cut) kept.push([cut, ink]);
    used += cells(cut);
  }
  return { pieces: kept, used };
}

export function laid(
  pieces: readonly Piece[],
  width: number,
  paint: Paint,
): string {
  const { pieces: kept, used } = clip(pieces, width);
  return (
    kept.map(([text, ink]) => paint(text, ink)).join("") +
    " ".repeat(Math.max(0, width - used))
  );
}

/** Eases a bar in: fast at first, settling on its value. */
export function eased(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return 1 - (1 - t) ** 3;
}

export function working(view: View): SlotView[] {
  return view.slots.filter((slot) => slot.state !== "idle");
}

/** What an idle runner is waiting for. */
export function waitingFor(view: View): string {
  if (view.mode === "paused") return "the workspace is paused";
  if (view.paused) return "intake paused here, p resumes";
  return view.mode === "directed"
    ? "waiting for a task to be handed to it"
    : "waiting for a ready task";
}

type Drawing = {
  paint: Paint;
  glyphs: Glyphs;
  frame: number;
  now: number;
  motion: boolean;
  box: number;
  inner: number;
};

/** A horizontal edge of the frame: a label on the left, groups on the right
 *  joined by dots. When the edge is too short the right-hand group with the
 *  highest rank goes first, then the label is cut. */
export function rule(
  draw: Pick<Drawing, "paint" | "box">,
  ends: readonly [string, string],
  left: readonly Piece[],
  right: readonly { pieces: readonly Piece[]; rank: number }[] = [],
): string {
  const { paint, box } = draw;
  const joined = (groups: typeof right): Piece[] =>
    groups.flatMap((group, index) =>
      index ? [[" · ", dim] as Piece, ...group.pieces] : [...group.pieces],
    );
  let shown = [...right];
  const inside = box - 2;
  const leftWidth = left.length ? span(left) + 3 : 1;
  const rightWidth = () => (shown.length ? span(joined(shown)) + 3 : 0);
  while (shown.length && leftWidth + rightWidth() + 2 > inside) {
    const drop = shown.reduce((worst, group) =>
      group.rank > worst.rank ? group : worst,
    );
    shown = shown.filter((group) => group !== drop);
  }
  const tail = shown.length
    ? ([[" ", undefined], ...joined(shown), [" ─", line]] as Piece[])
    : [];
  const room = inside - span(tail) - 4;
  const label = left.length ? clip(left, Math.max(0, room)) : clip([], 0);
  const head: Piece[] = label.used
    ? [["─ ", line], ...label.pieces, [" ", undefined]]
    : [["─", line]];
  const fill = Math.max(0, inside - span(head) - span(tail));
  return [
    [ends[0], line] as Piece,
    ...head,
    ["─".repeat(fill), line] as Piece,
    ...tail,
    [ends[1], line] as Piece,
  ]
    .map(([text, ink]) => paint(text, ink))
    .join("");
}

function boxed(draw: Drawing, pieces: readonly Piece[]): string {
  const side = draw.paint("│", line);
  return `${side} ${laid(pieces, draw.inner, draw.paint)} ${side}`;
}

/** A line that already carries its own colours, such as an agent's screen,
 *  set inside the frame as it is. */
function framed(draw: Drawing, text: string): string {
  const side = draw.paint("│", line);
  return `${side} ${text} ${side}`;
}

function liveMark(view: View, draw: Drawing): Piece[] {
  const { glyphs, frame } = draw;
  if (view.starting)
    return [
      [glyphs.spinner[frame % glyphs.spinner.length], accent],
      [" starting", dim],
    ];
  if (view.offline)
    return [
      [glyphs.failed, bad],
      [" offline", bad],
    ];
  if (view.mode === "paused" || view.paused)
    return [
      [glyphs.paused, warn],
      [" paused", warn],
    ];
  const step = Math.floor(frame / 2);
  return [
    [
      draw.motion ? glyphs.breath[step % glyphs.breath.length] : "●",
      draw.motion ? breathing[step % breathing.length] : good,
    ],
    [" live", good],
  ];
}

function header(view: View, draw: Drawing): string {
  const [topLeft, topRight] = draw.glyphs.corners;
  const groups: { pieces: Piece[]; rank: number }[] = [];
  if (view.workspace)
    groups.push({ pieces: [[view.workspace, cool]], rank: 1 });
  if (view.mode !== "paused" && !view.starting)
    groups.push({ pieces: [[view.mode, dim]], rank: 4 });
  if (view.costUsd > 0)
    groups.push({ pieces: [[money(view.costUsd), warn]], rank: 5 });
  if (view.awake)
    groups.push({
      pieces: draw.glyphs.cup
        ? [[awakeMark(draw.frame), accent]]
        : [["awake", accent]],
      rank: 4,
    });
  groups.push({ pieces: liveMark(view, draw), rank: 0 });
  return rule(
    draw,
    [topLeft, topRight],
    [
      ["wireal-run", strong],
      [" · ", dim],
      [view.runner, bright],
      ...(view.host && draw.inner >= 100
        ? ([[` on ${view.host}`, dim]] as Piece[])
        : []),
    ],
    groups,
  );
}

/** A bar of `width` cells, filled to `value` percent. */
export function bar(
  value: number | undefined,
  width: number,
  glyphs: Pick<Glyphs, "full" | "empty">,
): { full: string; empty: string } {
  const filled =
    value === undefined
      ? 0
      : Math.min(width, Math.max(0, Math.round((value / 100) * width)));
  return {
    full: glyphs.full.repeat(filled),
    empty: glyphs.empty.repeat(width - filled),
  };
}

/** The pieces of one usage line: a CLI's 5-hour and weekly windows. Bars
 *  shrink with the window, the reset times go on a narrow one and the bars
 *  go on a very narrow one. */
export function usagePieces(usage: UsageView, draw: Drawing): Piece[] {
  const name: Piece = [brandOf(usage.kind).padEnd(8), kindInk(usage.kind)];
  if (usage.fiveHour === undefined && usage.sevenDay === undefined)
    return [name, ["no limits read yet", dim]];
  const progress =
    draw.motion && usage.at !== undefined
      ? eased((draw.now - usage.at) / fillMs)
      : 1;
  const shown = (value: number | undefined) =>
    value === undefined ? undefined : value * progress;
  const resets = draw.inner >= 47 + 2 * 8;
  const width = resets
    ? Math.min(28, Math.floor((draw.inner - 47) / 2))
    : Math.min(28, Math.floor((draw.inner - 29) / 2));
  const window = (
    label: string,
    value: number | undefined,
    resetAt: number | undefined,
  ): Piece[] => {
    const now = shown(value);
    const ink = windowInk(value);
    const figure = (
      value === undefined ? "--" : `${Math.round(now ?? 0)}%`
    ).padStart(4);
    const drawn: Piece[] = [[`${label} `, dim]];
    if (width >= 4) {
      const cellsOf = bar(now, width, draw.glyphs);
      drawn.push([cellsOf.full, ink], [cellsOf.empty, dim], [" ", undefined]);
    }
    drawn.push([figure, value === undefined ? dim : ink]);
    if (resets)
      drawn.push([
        resetAt === undefined
          ? " ".repeat(9)
          : ` ${draw.glyphs.reset} ${untilText(resetAt - draw.now).padEnd(6)}`,
        dim,
      ]);
    return drawn;
  };
  return [
    name,
    ...window("5h", usage.fiveHour, usage.fiveHourReset),
    ["   ", undefined],
    ...window(
      draw.inner < 30 ? "wk" : "week",
      usage.sevenDay,
      usage.sevenDayReset,
    ),
  ];
}

type AgentPlan = {
  name: number;
  kind: number;
  task: number;
  time: number;
  step: number;
  details: boolean;
};

/** How an agent row is split at a given width. The CLI, the timer and the
 *  step go as the window narrows, and the files line with them. */
export function agentPlan(inner: number, names: readonly string[]): AgentPlan {
  const longest = Math.max(4, ...names.map((name) => name.length));
  const name = Math.min(inner < 50 ? 9 : 14, longest) + 1;
  const kind = inner >= 58 ? 7 : 0;
  const time = inner >= 46 ? 8 : 0;
  const rest = Math.max(0, inner - 4 - name - kind - time);
  const task = rest >= 36 ? Math.floor(rest * 0.45) : rest;
  return {
    name,
    kind,
    task,
    time,
    step: rest - task,
    details: inner >= 48,
  };
}

function glyphOf(view: View, slot: SlotView, draw: Drawing): Piece {
  const { glyphs, frame } = draw;
  const turn = (list: readonly string[]) => list[frame % list.length];
  if (slot.state === "claiming") return [turn(glyphs.claim), warn];
  if (slot.state !== "idle")
    return [turn(glyphs.spinner), stateInk(slot.state)];
  if (!slot.enabled) return [glyphs.off, dim];
  if (!slot.hosted) return [glyphs.missing, bad];
  if (slot.paused || view.mode === "paused" || view.paused)
    return [glyphs.paused, warn];
  if (slot.locked) return [glyphs.locked, cool];
  return [glyphs.idle, dim];
}

/** What an idle agent's row says instead of a task. */
export function idleText(view: View, slot: SlotView): Piece[] {
  if (!slot.enabled)
    return [
      ["off", dim],
      [" · switched off in the app", dim],
    ];
  if (!slot.hosted)
    return [
      ["no CLI", bad],
      [` · ${slot.kind} is not on this machine's PATH`, dim],
    ];
  if (slot.paused)
    return [
      ["paused", warn],
      [` · ${slot.paused.replace(/^Paused:\s*/, "")}`, dim],
    ];
  if (view.mode === "paused" || view.paused)
    return [
      ["paused", warn],
      [` · ${waitingFor(view)}`, dim],
    ];
  if (slot.locked)
    return [
      ["next", cool],
      [` · ${taskIdLabel(slot.locked)} is locked to it`, dim],
    ];
  return [
    ["idle", dim],
    [` · ${waitingFor(view)}`, dim],
  ];
}

/** What a busy agent's row says it is doing: the hook's step while it
 *  works, the phase otherwise. The verb takes the state's colour. */
export function doing(slot: SlotView): Piece[] {
  if (slot.state === "claiming") return [["claiming…", warn]];
  if (slot.state === "committing") return [["committing…", cool]];
  if (slot.state === "merging") return [[slot.last || "merging…", accent]];
  const said = (slot.step || slot.last || "starting…").replace(/\s+/g, " ");
  const [verb, ...rest] = said.split(" ");
  return rest.length
    ? [
        [verb, good],
        [` ${rest.join(" ")}`, undefined],
      ]
    : [[verb, good]];
}

function agentRow(
  view: View,
  slot: SlotView,
  index: number,
  plan: AgentPlan,
  draw: Drawing,
): Piece[] {
  const live = slot.state !== "idle";
  const pieces: Piece[] = [
    [index < 9 ? `${index + 1} ` : "  ", slot.pty ? accent : dim],
    glyphOf(view, slot, draw),
    [" ", undefined],
    [
      fit(slot.agent, plan.name - 1) + " ",
      live ? loud : slot.enabled && slot.hosted ? bright : dim,
    ],
  ];
  if (plan.kind)
    pieces.push([fit(slot.kind, plan.kind - 1) + " ", kindInk(slot.kind)]);
  if (!live) return [...pieces, ...idleText(view, slot)];
  const task = slot.reference
    ? `${taskIdLabel(slot.reference)} ${slot.name}`
    : slot.name;
  pieces.push([plan.task > 1 ? fit(task, plan.task - 1) + " " : "", cool]);
  if (plan.time)
    pieces.push([
      elapsed(draw.now - slot.since).padStart(plan.time - 1) + " ",
      dim,
    ]);
  if (plan.step) pieces.push(...clip(doing(slot), plan.step).pieces);
  return pieces;
}

/** The dim line under a busy agent: the task it follows and the files it
 *  wrote, newest first, as many as fit. */
export function detailPieces(slot: SlotView, width: number): Piece[] {
  if (slot.state === "idle") return [];
  const files = [...(slot.files ?? [])].reverse();
  if (!files.length && !slot.following) return [];
  const pieces: Piece[] = [];
  let used = 0;
  if (slot.following) {
    const text = `after ${taskIdLabel(slot.following)}`;
    pieces.push([text, cool]);
    used += text.length;
  }
  for (let index = 0; index < files.length; index++) {
    const more = files.length - index - 1;
    const tail = more ? `  +${more}` : "";
    const text = `${used ? "  " : ""}${files[index]}`;
    if (used + text.length + tail.length > width) {
      const left = files.length - index;
      pieces.push([`${used ? "  " : ""}+${left}`, dim]);
      break;
    }
    pieces.push([text, dim]);
    used += text.length;
  }
  return pieces;
}

function folderGroups(
  folder: FolderView | undefined,
): { pieces: Piece[]; rank: number }[] {
  if (!folder) return [];
  const flags: string[] = [];
  if (folder.dirty) flags.push("uncommitted changes");
  if (folder.behind) flags.push(`${folder.behind} behind`);
  if (folder.ahead) flags.push(`${folder.ahead} unpushed`);
  return [
    ...(folder.path
      ? [{ pieces: [[folder.path, dim] as Piece], rank: 3 }]
      : []),
    { pieces: [[folder.branch || "no branch", cool]], rank: 2 },
    ...(flags.length
      ? [{ pieces: [[flags.join(", "), warn] as Piece], rank: 1 }]
      : []),
  ];
}

/** One feed line: the time, a mark for how it went, and the text. A new
 *  line types itself in and stays bright for a moment; a finished task's
 *  tick flashes. */
export function feedPieces(entry: FeedLine, draw: Drawing): Piece[] {
  const { glyphs, frame, motion } = draw;
  const age = draw.now - entry.at;
  const tone = entry.pending ? "plain" : toneOf(entry.text);
  const fresh = motion && age >= 0 && age < freshMs;
  const mark: Piece = entry.pending
    ? [glyphs.spinner[frame % glyphs.spinner.length], accent]
    : tone === "good"
      ? [
          glyphs.done,
          motion && age >= 0 && age < flashMs
            ? frame % 2
              ? [1, 38, 5, 46]
              : [1, 97]
            : good,
        ]
      : tone === "bad"
        ? [glyphs.failed, bad]
        : tone === "warn"
          ? ["!", warn]
          : [glyphs.plain, dim];
  // Git and the agents' CLIs report errors over several lines; a feed line
  // is one row of the frame, so they are joined rather than left to break it.
  const text = entry.text.replace(/\s*[\r\n]+\s*/g, " · ").trim();
  const said = entry.pending
    ? `${text}…`
    : (entry.times ?? 1) > 1
      ? `${text} ×${entry.times}`
      : text;
  const typed =
    motion && age >= 0 && age < revealMs
      ? said.slice(0, Math.max(1, Math.ceil((said.length * age) / revealMs)))
      : said;
  const ink: Ink | undefined = fresh
    ? tone === "bad"
      ? [1, ...bad]
      : loud
    : tone === "bad"
      ? bad
      : tone === "warn"
        ? warn
        : age > 10 * 60_000
          ? dim
          : undefined;
  return [
    ...(draw.inner >= 40
      ? ([[`${clock(entry.at)}  `, fresh ? bright : dim]] as Piece[])
      : []),
    mark,
    [" ", undefined],
    [typed, ink],
  ];
}

/** Keys for the bottom edge, shortened until they fit: first the detach
 *  key goes, then the CLI keys, then the words. */
export function keyPieces(view: View, width: number): Piece[] {
  const resume = !!view.paused && view.mode !== "paused";
  const items: [string, string][] = view.slots.length
    ? [
        ["+", "add"],
        ["-", "remove"],
        ["c/x", "claude/codex"],
        ["p", resume ? "resume" : "pause"],
        ["1-9", "attach"],
        [detachLabel, "detach"],
        ["↑↓", "feed"],
        ["q", "quit"],
      ]
    : [
        ["+", "add an agent"],
        ["c/x", "claude/codex"],
        ["q", "quit"],
      ];
  const worded = (list: [string, string][]): Piece[] =>
    list.flatMap(([key, word], index) => [
      [`${index ? "  " : ""}${key}`, strong] as Piece,
      [` ${word}`, dim] as Piece,
    ]);
  const bare = (list: [string, string][]): Piece[] =>
    list.map(([key], index) => [`${index ? " " : ""}${key}`, strong] as Piece);
  const lean = items.filter(([key]) => key !== detachLabel && key !== "↑↓");
  const leaner = lean.filter(([key]) => key !== "c/x");
  for (const choice of [worded(items), worded(lean), worded(leaner)])
    if (span(choice) <= width) return choice;
  return bare(leaner);
}

type Block = { rows: string[]; ruled: boolean };

/** Rows a block may keep out of what it wants, given what is left; a block
 *  under a rule of its own is all or nothing about that rule. */
function share(left: number, wanted: number, ruled: boolean): number {
  const got = Math.max(0, Math.min(left, wanted));
  return ruled && got < 2 ? 0 : got;
}

export function render(
  view: View,
  now: number,
  expanded: number | null,
  width: number,
  options: {
    colour?: boolean;
    frame?: number;
    height?: number;
    motion?: boolean;
    glyphs?: Glyphs;
    /** How many lines the feed is scrolled back from its newest. */
    feedOffset?: number;
  } = {},
): string {
  // The frame stops one column short of the window, so a terminal that
  // wraps at its last column never pushes the screen up a line.
  const box = Math.max(24, width) - 1;
  const draw: Drawing = {
    paint: painter(options.colour === true),
    glyphs: options.glyphs ?? fancy,
    frame: options.frame ?? 0,
    now,
    motion: options.motion === true,
    box,
    inner: box - 4,
  };
  const [, , bottomLeft, bottomRight] = draw.glyphs.corners;
  const tee = ["├", "┤"] as const;
  const top = header(view, draw);
  const footer = rule(
    draw,
    [bottomLeft, bottomRight],
    view.starting
      ? [
          ["q", strong],
          [" quit", dim],
        ]
      : keyPieces(view, box - 7),
  );
  const feed = view.feed ?? [];
  // The feed shows at most feedRows lines; scrolled back, it ends that many
  // lines before the newest and its rule says how many newer ones wait.
  const offset = Math.max(
    0,
    Math.min(options.feedOffset ?? 0, feed.length - feedRows),
  );
  const feedWindow = (count: number) =>
    feed.slice(Math.max(0, feed.length - offset - count), feed.length - offset);
  const feedTitle: Piece[] = [
    ["feed", dim],
    ...(offset > 0
      ? ([[` · ${offset} newer ↓`, accent]] as Piece[])
      : feed.length > feedRows
        ? ([[" · ↑ older", dim]] as Piece[])
        : []),
  ];
  const feedBlock = (count: number): string[] => [
    rule(draw, tee, feedTitle),
    ...feedWindow(count).map((entry) => boxed(draw, feedPieces(entry, draw))),
  ];
  const limit =
    options.height && options.height > 0
      ? Math.max(4, options.height - 1)
      : Infinity;

  if (view.starting) {
    const steps = view.starting.map((step) =>
      boxed(draw, [
        ["  ", undefined],
        step.state === "doing"
          ? [
              draw.glyphs.spinner[draw.frame % draw.glyphs.spinner.length],
              accent,
            ]
          : step.state === "done"
            ? [draw.glyphs.done, good]
            : [draw.glyphs.failed, bad],
        [" ", undefined],
        [
          step.state === "doing" ? `${step.text}…` : step.text,
          step.state === "doing"
            ? bright
            : step.state === "failed"
              ? bad
              : undefined,
        ],
      ]),
    );
    const body = [boxed(draw, []), ...steps, boxed(draw, [])];
    const kept = body.slice(0, share(limit - 2, body.length, false));
    const room = share(
      limit - 2 - kept.length,
      feed.length ? 1 + Math.min(feed.length, feedRows) : 0,
      true,
    );
    const rows = [top, ...kept, ...(room ? feedBlock(room - 1) : [])];
    if (limit !== Infinity)
      while (rows.length < limit - 1) rows.push(boxed(draw, []));
    return [...rows, footer].join("\n");
  }

  const plan = agentPlan(
    draw.inner,
    view.slots.map((slot) => slot.agent),
  );
  const busy = working(view).length;
  const agentsRule = rule(
    draw,
    tee,
    view.slots.length && draw.inner >= 36
      ? [
          ["agents", dim],
          [` · ${busy} of ${view.slots.length} working`, busy ? good : dim],
        ]
      : [["agents", dim]],
    folderGroups(view.folder),
  );
  const mains = view.slots.map((slot, index) =>
    boxed(draw, agentRow(view, slot, index, plan, draw)),
  );
  const details = view.slots.map((slot) => {
    if (!plan.details) return "";
    const pieces = detailPieces(slot, draw.inner - 7);
    return pieces.length
      ? boxed(draw, [[`   ${draw.glyphs.branch} `, dim], ...pieces])
      : "";
  });
  const notes: string[] = [];
  if (!view.slots.length)
    notes.push(
      boxed(draw, [
        ["No agents yet", bright],
        [" · ", dim],
        ["+", strong],
        [" adds one", dim],
      ]),
    );
  const seating = view.seating ?? "";
  if (
    seating &&
    (!seating.startsWith("Seated here") || / is held by /.test(seating))
  )
    notes.push(boxed(draw, [[seating, warn]]));
  const usage = (view.usage ?? []).map((entry) =>
    boxed(draw, usagePieces(entry, draw)),
  );
  const skipped: Block = {
    ruled: true,
    rows: view.skipped.length
      ? [
          rule(draw, tee, [["skipped", dim]]),
          ...view.skipped.map((item) =>
            boxed(draw, [
              [taskIdLabel(item.reference), dim],
              [` ${item.name}`, undefined],
              [` · ${item.reason}`, dim],
            ]),
          ),
        ]
      : [],
  };
  const opened = expanded === null ? undefined : view.slots[expanded];
  const preview: Block = {
    ruled: true,
    rows: opened
      ? [
          rule(draw, tee, [
            [`${(expanded ?? 0) + 1} `, accent],
            [opened.agent || `slot ${(expanded ?? 0) + 1}`, bright],
          ]),
          ...(opened.screen
            ? opened.screen
                .lines(previewRows, draw.inner)
                .map((text) =>
                  framed(
                    draw,
                    options.colour === true
                      ? text
                      : text.replace(/\u001b\[[0-9;]*m/g, ""),
                  ),
                )
            : opened.lines
                .slice(-previewRows)
                .map((text) => boxed(draw, [[text, undefined]]))),
        ]
      : [],
  };
  const feedRowsWanted = feed.length ? 1 + Math.min(feed.length, feedRows) : 0;

  // Rows are handed out in order of what matters most; the feed gives way
  // first, down to a few lines, then the files, the skipped tasks and the
  // preview, then the rest of the feed, the usage and last the agents.
  let left = limit - 2;
  const take = (wanted: number, ruled: boolean) => {
    const got = share(left, wanted, ruled);
    left -= got;
    return got;
  };
  const agentRows = take(1 + mains.length + notes.length, false);
  const usageRows = take(usage.length, false);
  const previewRowsKept = take(preview.rows.length, true);
  const feedFirst = take(Math.min(feedRowsWanted, 1 + feedFloor), true);
  const detailRows = take(details.filter(Boolean).length, false);
  const skippedRows = take(skipped.rows.length, true);
  const feedRest = feedFirst ? take(feedRowsWanted - feedFirst, false) : 0;

  const rows: string[] = [top, ...usage.slice(0, usageRows)];
  const body: string[] = [];
  let spare = detailRows;
  view.slots.forEach((_, index) => {
    body.push(mains[index]);
    if (details[index] && spare > 0) {
      body.push(details[index]);
      spare -= 1;
    }
  });
  body.push(...notes);
  rows.push(...[agentsRule, ...body].slice(0, agentRows + detailRows));
  rows.push(...skipped.rows.slice(0, skippedRows));
  rows.push(...preview.rows.slice(0, previewRowsKept));
  const feedKept = feedFirst + feedRest;
  if (feedKept >= 2) rows.push(...feedBlock(feedKept - 1));
  // With a height to fill, the frame reaches the bottom of the window, so
  // the key bar always sits on the last line whatever the rest holds.
  if (limit !== Infinity)
    while (rows.length < limit - 1) rows.push(boxed(draw, []));
  rows.push(footer);
  return rows.join("\n");
}

export const trailing = /(?:\u001b\[[0-9;]*m| )+$/;

export function painting(frame: string, rows: number): string {
  const room = Math.max(1, rows - 1);
  return frame
    .split("\n")
    .slice(0, room)
    .map((line) => line.replace(trailing, "") + reset + eraseLine)
    .join("\r\n");
}

export type Terminal = {
  write: (text: string) => void;
  size: () => { columns: number; rows: number };
  onInput: (listen: (data: string) => void) => () => void;
  onResize: (listen: () => void) => () => void;
  raw: (on: boolean) => void;
};

export type Attachment = {
  attached: () => number | null;
  attach: (index: number, link: PtyLink, screen?: Screen) => boolean;
  detach: () => boolean;
  send: (data: string) => void;
};

export function createAttachment(
  terminal: Terminal,
  onDetach: () => void = () => {},
): Attachment {
  let index: number | null = null;
  let link: PtyLink | null = null;
  let buffer: Screen | null = null;
  let drop: (() => void)[] = [];
  const resize = () => {
    const size = terminal.size();
    link?.resize(size.columns, size.rows);
    buffer?.resize(size.columns, size.rows);
  };
  const detach = () => {
    if (index === null) return false;
    for (const stop of drop) stop();
    drop = [];
    link?.resize(defaultColumns, defaultRows);
    buffer?.resize(defaultColumns, defaultRows);
    link = null;
    buffer = null;
    index = null;
    terminal.write(normal + clear);
    onDetach();
    return true;
  };
  return {
    attached: () => index,
    attach: (slot, session, screen) => {
      if (index !== null) return false;
      index = slot;
      link = session;
      buffer = screen ?? null;
      terminal.raw(true);
      terminal.write(alternate + clear + showCursor);
      drop = [
        session.onData((chunk) => terminal.write(chunk)),
        terminal.onResize(resize),
      ];
      resize();
      if (screen) terminal.write(screen.paint());
      return true;
    },
    detach,
    send: (data) => {
      if (index === null) return;
      if (detachKeys.some((key) => data.includes(key))) {
        detach();
        return;
      }
      link?.write(data);
    },
  };
}

export function processTerminal(): Terminal {
  return {
    write: (text) => process.stdout.write(text),
    size: () => ({
      columns: process.stdout.columns ?? defaultColumns,
      rows: process.stdout.rows ?? defaultRows,
    }),
    onInput: (listen) => {
      const take = (chunk: Buffer | string) => listen(String(chunk));
      process.stdin.on("data", take);
      return () => process.stdin.off("data", take);
    },
    onResize: (listen) => {
      process.stdout.on("resize", listen);
      return () => process.stdout.off("resize", listen);
    },
    raw: (on) => {
      if (process.stdin.isTTY) process.stdin.setRawMode(on);
    },
  };
}

/** What a key does to the feed's scroll: lines back (positive) or forward,
 *  or "end" for the newest. ↑ ↓ move a line, PgUp PgDn a screen, End jumps
 *  to the newest. */
export function feedScroll(data: string): number | "end" | undefined {
  if (data === "\u001b[A") return 1;
  if (data === "\u001b[B") return -1;
  if (data === "\u001b[5~") return feedRows;
  if (data === "\u001b[6~") return -feedRows;
  if (data === "\u001b[F" || data === "\u001b[4~" || data === "\u001bOF")
    return "end";
  return undefined;
}

/** How many lines arrived between two feeds. The runner keeps only its
 *  newest lines, so a full feed that moved on grew by however far its old
 *  newest line now sits from the end. */
export function feedGrowth(
  before: readonly FeedLine[] | undefined,
  after: readonly FeedLine[] | undefined,
): number {
  if (!before?.length || !after?.length) return 0;
  const newest = before[before.length - 1];
  const at = after.lastIndexOf(newest);
  if (at >= 0) return after.length - 1 - at;
  return Math.max(0, after.length - before.length);
}

export function createUi(
  onQuit: () => void,
  terminal: Terminal = processTerminal(),
  parts: { tty?: boolean; onKey?: (key: string) => void } = {},
): Ui {
  const tty =
    parts.tty ??
    (process.stdout.isTTY === true && process.stdin.isTTY === true);
  const colour = colourful(process.env, tty);
  const glyphs = glyphsFor();
  let latest: View | null = null;
  let expanded: number | null = null;
  let feedOffset = 0;
  let stopped = false;
  let frame = 0;
  let painted = "";
  let titled = "";
  let size = terminal.size();
  const draw = () => {
    if (stopped || !latest || attachment.attached() !== null) return;
    if (latest.runner && latest.runner !== titled) {
      terminal.write((titled ? "" : pushTitle) + titleFor(latest.runner));
      titled = latest.runner;
    }
    const now = terminal.size();
    if (now.columns !== size.columns || now.rows !== size.rows) {
      size = now;
      painted = "";
      terminal.write(clear);
    }
    const text = render(latest, Date.now(), expanded, now.columns, {
      colour,
      frame,
      height: now.rows,
      motion: true,
      glyphs,
      feedOffset,
    });
    if (text === painted) return;
    painted = text;
    terminal.write(hideCursor + home + painting(text, now.rows) + eraseBelow);
  };
  const attachment = createAttachment(terminal, () => {
    painted = "";
    titled = "";
    draw();
  });
  const timer = tty
    ? setInterval(() => {
        frame += 1;
        draw();
      }, spinnerMs)
    : undefined;
  timer?.unref();
  const onData = (data: string) => {
    if (attachment.attached() !== null) {
      attachment.send(data);
      return;
    }
    if (data === "q" || data === "\u0003") {
      onQuit();
      return;
    }
    if (crewKeys.includes(data)) {
      parts.onKey?.(data === "=" ? "+" : data);
      return;
    }
    const scroll = feedScroll(data);
    if (scroll !== undefined) {
      const room = Math.max(0, (latest?.feed?.length ?? 0) - feedRows);
      feedOffset =
        scroll === "end" ? 0 : Math.max(0, Math.min(room, feedOffset + scroll));
      draw();
      return;
    }
    const digit = Number(data);
    if (!Number.isInteger(digit) || digit < 1 || digit > 9) return;
    const slot = latest?.slots[digit - 1];
    if (slot?.pty) {
      attachment.attach(digit - 1, slot.pty, slot.screen);
      return;
    }
    expanded = expanded === digit - 1 ? null : digit - 1;
    draw();
  };
  let dropInput: () => void = () => {};
  let dropResize: () => void = () => {};
  if (tty) {
    terminal.raw(true);
    if (process.stdin.isTTY) process.stdin.resume();
    dropInput = terminal.onInput(onData);
    dropResize = terminal.onResize(draw);
  }
  return {
    update: (view) => {
      // Scrolled back, the view holds still while new lines arrive below it.
      if (feedOffset > 0) feedOffset += feedGrowth(latest?.feed, view.feed);
      latest = view;
      if (tty) draw();
    },
    log: (text) => {
      if (!tty) process.stdout.write(`${new Date().toISOString()} ${text}\n`);
    },
    stop: () => {
      stopped = true;
      attachment.detach();
      if (timer) clearInterval(timer);
      if (tty) {
        terminal.write((titled ? popTitle : "") + showCursor);
        dropInput();
        dropResize();
        terminal.raw(false);
        if (process.stdin.isTTY) process.stdin.pause();
      }
    },
  };
}
