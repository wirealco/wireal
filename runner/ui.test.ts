import assert from "node:assert/strict";
import test from "node:test";
import type { PtyLink } from "./agents/types.ts";
import { createScreen } from "./screen.ts";
import {
  agentPlan,
  bar,
  cells,
  clock,
  colourful,
  createAttachment,
  createUi,
  detachKey,
  detachKeys,
  detachLabel,
  elapsed,
  eraseLine,
  fancy,
  feedFloor,
  feedGrowth,
  feedRows,
  feedScroll,
  fillMs,
  fit,
  glyphsFor,
  keyPieces,
  legacy,
  painting,
  popTitle,
  render,
  revealMs,
  titleFor,
  toneOf,
  windowInk,
  type SlotView,
  type Terminal,
  type View,
} from "./ui.ts";

const escape = String.fromCharCode(27);

function fakeTerminal(columns = 100, rows = 30) {
  const written: string[] = [];
  const input = new Set<(data: string) => void>();
  const resize = new Set<() => void>();
  const raw: boolean[] = [];
  let size = { columns, rows };
  const terminal: Terminal = {
    write: (text) => written.push(text),
    size: () => size,
    onInput: (listen) => {
      input.add(listen);
      return () => input.delete(listen);
    },
    onResize: (listen) => {
      resize.add(listen);
      return () => resize.delete(listen);
    },
    raw: (on) => raw.push(on),
  };
  return {
    terminal,
    written,
    raw,
    resizeTo: (next: { columns: number; rows: number }) => {
      size = next;
      for (const listen of [...resize]) listen();
    },
    listeners: () => resize.size + input.size,
    type: (data: string) => {
      for (const listen of [...input]) listen(data);
    },
  };
}

function fakeLink() {
  const written: string[] = [];
  const sizes: { columns: number; rows: number }[] = [];
  const data = new Set<(chunk: string) => void>();
  const link: PtyLink = {
    write: (chunk) => written.push(chunk),
    resize: (columns, rows) => sizes.push({ columns, rows }),
    onData: (listen) => {
      data.add(listen);
      return () => data.delete(listen);
    },
  };
  return {
    link,
    written,
    sizes,
    say: (chunk: string) => {
      for (const listen of [...data]) listen(chunk);
    },
    listeners: () => data.size,
  };
}

const now = Date.parse("2026-09-30T18:45:00");

const slot = (over: Partial<SlotView> = {}): SlotView => ({
  agent: "Ada",
  kind: "claude",
  model: "claude-opus-5",
  enabled: true,
  hosted: true,
  reference: "7",
  name: "Set up authentication",
  state: "working",
  since: now - 252_000,
  last: "Write src/auth.ts",
  step: "editing src/auth.ts",
  files: ["src/session.ts", "src/auth.ts"],
  costUsd: 0.42,
  paused: "",
  following: "",
  lines: ["Write src/auth.ts"],
  ...over,
});

const resting = (over: Partial<SlotView> = {}): SlotView =>
  slot({
    state: "idle",
    reference: "",
    name: "",
    last: "",
    step: "",
    files: [],
    costUsd: 0,
    ...over,
  });

const view = (over: Partial<View> = {}): View => ({
  runner: "Ada's laptop",
  runnerId: "12345678-abcd-4000-8000-123456789abc",
  host: "studio",
  workspace: "Wireal",
  mode: "automatic",
  costUsd: 1.2,
  paused: "",
  skipped: [],
  slots: [slot()],
  usage: [
    {
      kind: "claude",
      fiveHour: 10,
      sevenDay: 70,
      fiveHourReset: now + 2 * 3_600_000 + 13 * 60_000,
      sevenDayReset: now + 3 * 86_400_000,
      at: now - 60_000,
    },
    { kind: "codex", fiveHour: 92.4, at: now - 60_000 },
  ],
  feed: [
    { at: now - 600_000, text: "runner Ada's laptop ready" },
    { at: now - 120_000, text: "Merged into main as a3f19c2" },
    { at: now - 60_000, text: "task list failed: Request failed (502)" },
  ],
  ...over,
});

const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");
const rows = (text: string) => text.split("\n");
/** The first line under the header that matches, so an agent is not found
 *  in the runner's own name. */
const row = (drawn: string, pattern: RegExp) =>
  rows(drawn)
    .slice(1)
    .find((line) => pattern.test(line)) ?? "";

test("the frame is a rounded box one column short of the window", () => {
  const drawn = rows(render(view(), now, null, 100));
  assert.match(drawn[0], /^╭─ wireal-run · Ada's laptop ─+ /);
  assert.match(drawn[0], / Wireal · automatic · \$1\.20 · ● live ─╮$/);
  assert.match(drawn.at(-1) ?? "", /^╰─ \+ add {2}- remove .*─╯$/);
  for (const line of drawn.slice(1, -1)) assert.match(line, /^[│├].*[│┤]$/);
  for (const line of drawn) assert.equal(cells(line), 99);
});

test("the header drops the cost, the mode and the host before the live dot", () => {
  assert.match(
    rows(render(view(), now, null, 140))[0],
    /wireal-run · Ada's laptop on studio ─/,
  );
  const narrow = rows(render(view(), now, null, 48))[0];
  assert.doesNotMatch(narrow, /\$1\.20|automatic|studio/);
  assert.match(narrow, /● live ─╮$/);
});

test("a paused runner, a paused workspace and a runner cut off say so in the header", () => {
  assert.match(
    rows(render(view({ paused: "Intake paused" }), now, null, 100))[0],
    /‖ paused ─╮$/,
  );
  const held = rows(
    render(view({ mode: "paused", paused: "Paused" }), now, null, 100),
  )[0];
  assert.match(held, /‖ paused ─╮$/);
  assert.doesNotMatch(held, /automatic/);
  assert.match(
    rows(render(view({ offline: true }), now, null, 100))[0],
    /✕ offline ─╮$/,
  );
});

test("the live dot breathes from frame to frame", () => {
  const dots = [0, 2, 4, 6, 8, 10].map(
    (frame) =>
      rows(render(view(), now, null, 100, { frame, motion: true }))[0].match(
        /(\S) live/,
      )?.[1],
  );
  assert.ok(new Set(dots).size > 1, `the dot never changed: ${dots}`);
  const inks = [0, 2, 4, 6].map(
    (frame) =>
      render(view(), now, null, 100, { frame, motion: true, colour: true })
        .split("\n")[0]
        .match(/\u001b\[(38;5;\d+)m\S\u001b\[0m\u001b\[38;5;78m live/)?.[1],
  );
  assert.ok(new Set(inks).size > 1, `the dot never changed colour: ${inks}`);
});

test("each CLI's windows are bars with a percentage and, when there is room, the reset", () => {
  const wide = render(view(), now, null, 100);
  assert.match(
    row(wide, /Claude/),
    /│ Claude {2}5h ▓▓░+ {2}10% ↻ 2h 13m {3}week ▓+░+ {2}70% ↻ 3d 0h/,
  );
  assert.match(row(wide, /Codex/), /│ Codex {3}5h ▓+░* {2}92% .* week ░+ +--/);
  const narrow = render(view(), now, null, 60);
  assert.doesNotMatch(narrow, /↻/);
  assert.match(row(narrow, /Claude/), /5h ▓░+ {2}10% {3}week ▓+░+ {2}70%/);
  assert.match(
    row(render(view(), now, null, 34), /Claude/),
    /Claude {2}5h {2}10% {3}wk {2}70%/,
  );
  assert.match(
    render(view({ usage: [{ kind: "codex" }] }), now, null, 100),
    /Codex {3}no limits read yet/,
  );
});

test("a bar fills to its value and takes the colour of what is left", () => {
  assert.deepEqual(bar(10, 10, fancy), { full: "▓", empty: "░".repeat(9) });
  assert.deepEqual(bar(100, 4, fancy), { full: "▓▓▓▓", empty: "" });
  assert.deepEqual(bar(undefined, 3, fancy), { full: "", empty: "░░░" });
  assert.deepEqual(windowInk(59), [38, 5, 78]);
  assert.deepEqual(windowInk(60), [38, 5, 214]);
  assert.deepEqual(windowInk(85), [38, 5, 203]);
  assert.match(
    render(view(), now, null, 100, { colour: true }),
    /\u001b\[38;5;203m ?92%/,
  );
});

test("the bars fill up over the first frames after the figures arrive", () => {
  const arriving = view({
    usage: [{ kind: "claude", fiveHour: 80, sevenDay: 40, at: now }],
  });
  const figure = (at: number) =>
    Number(
      row(render(arriving, at, null, 100, { motion: true }), /Claude/).match(
        /5h ▓*░* +(\d+)%/,
      )?.[1],
    );
  const seen = [0, 120, 240, 480, fillMs].map((after) => figure(now + after));
  assert.equal(seen[0], 0);
  assert.equal(seen.at(-1), 80);
  for (let index = 1; index < seen.length; index++)
    assert.ok(seen[index] >= seen[index - 1], `the bar went back: ${seen}`);
  assert.equal(figure(now), 0);
  assert.equal(
    Number(
      row(render(arriving, now, null, 100), /Claude/).match(/(\d+)%/)?.[1],
    ),
    80,
  );
});

test("a working agent's row spins and carries its CLI, task, timer and step", () => {
  const first = row(render(view(), now, null, 100), /Ada/);
  assert.match(
    first,
    /│ 1 ⠋ Ada {2}claude WRL·7 Set up authentication +4m 12s editing src\/auth\.ts/,
  );
  const later = row(
    render(view(), now + 1_000, null, 100, { frame: 2 }),
    /Ada/,
  );
  assert.match(later, /│ 1 ⠹ Ada .* 4m 13s editing/);
  assert.equal(cells(first), cells(later));
  const files = rows(render(view(), now, null, 100));
  const at = files.findIndex((line) => /^│ 1 /.test(line));
  assert.match(files[at + 1], /^│ {4}└ src\/auth\.ts {2}src\/session\.ts +│$/);
});

test("the files line keeps to its width and counts what it left out", () => {
  const busy = slot({
    files: Array.from({ length: 12 }, (_, index) => `src/file-${index}.ts`),
  });
  const line = row(render(view({ slots: [busy] }), now, null, 80), /└/);
  assert.match(line, /└ src\/file-11\.ts {2}src\/file-10\.ts .* \+\d+ +│$/);
  assert.equal(cells(line), 79);
  const following = slot({ following: "6", files: [] });
  assert.match(
    row(render(view({ slots: [following] }), now, null, 100), /└/),
    /└ after WRL·6/,
  );
  assert.doesNotMatch(render(view(), now, null, 50), /└/);
});

test("claiming, committing and merging read differently from working", () => {
  const drawn = render(
    view({
      slots: [
        slot({ agent: "Ada", state: "claiming" }),
        slot({ agent: "Rex", state: "committing" }),
        slot({ agent: "Sol", state: "merging", last: "merging wireal/7" }),
      ],
    }),
    now,
    null,
    100,
  );
  assert.match(row(drawn, /Ada/), /◐ Ada .* claiming…/);
  assert.match(row(drawn, /Rex/), /⠋ Rex .* committing…/);
  assert.match(row(drawn, /Sol/), /⠋ Sol .* merging wireal\/7/);
});

test("idle, paused, locked, switched off and missing agents are told apart", () => {
  const drawn = render(
    view({
      slots: [
        resting({ agent: "Ada" }),
        resting({
          agent: "Bea",
          paused: "Paused: 5-hour window at 92% (limit 80%)",
        }),
        resting({ agent: "Cal", locked: "12" }),
        resting({ agent: "Dot", enabled: false }),
        resting({ agent: "Eve", kind: "codex", hosted: false }),
      ],
    }),
    now,
    null,
    100,
  );
  assert.match(
    row(drawn, /Ada/),
    /◌ Ada +claude idle · waiting for a ready task/,
  );
  assert.match(
    row(drawn, /Bea/),
    /‖ Bea +claude paused · 5-hour window at 92% \(limit 80%\)/,
  );
  assert.match(
    row(drawn, /Cal/),
    /◆ Cal +claude next · WRL·12 is locked to it/,
  );
  assert.match(
    row(drawn, /Dot/),
    /○ Dot +claude off · switched off in the app/,
  );
  assert.match(
    row(drawn, /Eve/),
    /✕ Eve +codex +no CLI · codex is not on this machine's PATH/,
  );
  assert.doesNotMatch(drawn, /└/);

  const directed = render(
    view({ mode: "directed", slots: [resting()] }),
    now,
    null,
    100,
  );
  assert.match(directed, /idle · waiting for a task to be handed to it/);
  const halted = render(
    view({ paused: "Intake paused", slots: [resting()] }),
    now,
    null,
    100,
  );
  assert.match(halted, /‖ Ada +claude paused · intake paused here, p resumes/);
});

test("the agents edge counts who is working and names the folder", () => {
  const drawn = render(
    view({
      slots: [slot(), resting({ agent: "Rex" })],
      folder: {
        branch: "main",
        dirty: true,
        behind: 2,
        ahead: 1,
        path: "~/code/wireal",
      },
    }),
    now,
    null,
    120,
  );
  assert.match(
    row(drawn, /agents/),
    /^├─ agents · 1 of 2 working ─+ ~\/code\/wireal · main · uncommitted changes, 2 behind, 1 unpushed ─┤$/,
  );
  const narrow = row(
    render(
      view({
        folder: {
          branch: "main",
          dirty: false,
          behind: 2,
          path: "~/code/a/long/folder",
        },
      }),
      now,
      null,
      56,
    ),
    /agents/,
  );
  assert.match(narrow, /main · 2 behind ─┤$/);
  assert.doesNotMatch(narrow, /~\/code/);
});

test("an agent's row narrows by dropping its CLI, timer and step", () => {
  const names = ["Ada"];
  assert.deepEqual(agentPlan(120, names), {
    name: 5,
    kind: 7,
    task: 43,
    time: 8,
    step: 53,
    details: true,
  });
  const narrow = agentPlan(40, names);
  assert.equal(narrow.kind, 0);
  assert.equal(narrow.time, 0);
  assert.equal(narrow.step, 0);
  assert.equal(narrow.details, false);
  for (const inner of [120, 80, 56, 40, 20]) {
    const plan = agentPlan(inner, ["A long agent name"]);
    assert.ok(
      4 + plan.name + plan.kind + plan.task + plan.time + plan.step <= inner,
    );
  }
});

test("the feed shows each note with its time, newest last, marked by how it went", () => {
  const drawn = rows(render(view(), now, null, 100));
  const at = drawn.findIndex((line) => /^├─ feed ─/.test(line));
  assert.ok(at > 0);
  assert.match(
    drawn[at + 1],
    new RegExp(`│ ${clock(now - 600_000)} {2}· runner Ada's laptop ready`),
  );
  assert.match(drawn[at + 2], /✓ Merged into main as a3f19c2/);
  assert.match(drawn[at + 3], /✕ task list failed: Request failed \(502\)/);
  assert.match(drawn[at + 4], /^╰─/);
  assert.equal(toneOf("WRL·7 was unlocked in the app, Ada stopped"), "bad");
  assert.equal(toneOf("7 done abc1234 $0.50"), "good");
  assert.equal(toneOf("Paused: 5-hour window at 94% (limit 80%)"), "warn");
  assert.equal(toneOf("the app pinged this runner"), "plain");
  assert.equal(clock(Date.parse("2026-09-30T08:05:00")), "08:05");
});

test("a new feed line types itself in brightly, and a finished task's tick flashes", () => {
  const fresh = view({
    feed: [{ at: now, text: "7 done abc1234 $0.50" }],
  });
  const typed = (after: number) =>
    row(render(fresh, now + after, null, 100, { motion: true }), /✓/);
  assert.match(typed(revealMs / 3), /✓ 7 done +│$/);
  assert.match(typed(revealMs), /✓ 7 done abc1234 \$0\.50 +│$/);
  const painted = (frame: number, after: number) =>
    render(fresh, now + after, null, 100, {
      motion: true,
      colour: true,
      frame,
    });
  assert.notEqual(
    row(painted(0, 400), /✓/).match(/\u001b\[([0-9;]+)m✓/)?.[1],
    row(painted(1, 400), /✓/).match(/\u001b\[([0-9;]+)m✓/)?.[1],
  );
  assert.match(row(painted(0, 400), /✓/), /\u001b\[1;97m7 done/);
  assert.equal(
    row(painted(0, 60_000), /✓/).match(/\u001b\[([0-9;]+)m✓/)?.[1],
    "38;5;78",
  );
  assert.equal(
    row(render(fresh, now + 10, null, 100), /✓/),
    row(render(fresh, now + 5_000, null, 100), /✓/),
  );
});

test("work going on beside the loop spins in the feed until it is done", () => {
  const pending = view({
    feed: [
      {
        at: now,
        text: "Readying the browser agents take screenshots with",
        pending: true,
      },
    ],
  });
  assert.match(
    render(pending, now + 5_000, null, 100),
    /⠋ Readying the browser agents take screenshots with…/,
  );
  assert.match(
    render(pending, now + 5_000, null, 100, { frame: 1 }),
    /⠙ Readying the browser/,
  );
});

test("a short window gives up the feed first and keeps the header, the agents and the keys", () => {
  const many = view({
    slots: [slot(), resting({ agent: "Rex" })],
    skipped: [{ reference: "9", name: "Marketing", reason: "no objective" }],
    feed: Array.from({ length: 20 }, (_, index) => ({
      at: now - (20 - index) * 1_000,
      text: `note ${index}`,
    })),
  });
  const whole = rows(render(many, now, null, 100, { height: 60 }));
  // At most ten feed lines show; the frame fills the rest of the window so
  // the key bar sits on its last line.
  assert.equal(whole.filter((line) => /note \d+/.test(line)).length, feedRows);
  assert.match(whole.join("\n"), /note 19/);
  assert.doesNotMatch(whole.join("\n"), /note 9\b/);
  assert.equal(whole.length, 59);
  const short = rows(render(many, now, null, 100, { height: 16 }));
  assert.ok(short.length <= 15);
  assert.equal(short[0], whole[0]);
  assert.equal(short.at(-1), whole.at(-1));
  assert.match(short.join("\n"), /note 19/);
  assert.doesNotMatch(short.join("\n"), /note 0\b/);
  assert.match(short.join("\n"), /Rex/);
  assert.match(short.join("\n"), /└/);
  const shorter = rows(render(many, now, null, 100, { height: 12 }));
  assert.ok(shorter.length <= 11);
  assert.equal(
    shorter.filter((line) => /note \d+/.test(line)).length,
    feedFloor,
  );
  assert.doesNotMatch(shorter.join("\n"), /└|skipped/);
  const tiny = rows(render(many, now, null, 100, { height: 6 }));
  assert.ok(tiny.length <= 5);
  assert.match(tiny.join("\n"), /Ada/);
  assert.match(tiny.at(-1) ?? "", /^╰─ \+ add/);
  const unbounded = rows(render(many, now, null, 100));
  assert.equal(
    unbounded.filter((line) => /note \d+/.test(line)).length,
    feedRows,
  );
});

test("the feed scrolls back through older lines and says how many are newer", () => {
  const many = view({
    feed: Array.from({ length: 30 }, (_, index) => ({
      at: now - (30 - index) * 1_000,
      text: `note ${index}`,
    })),
  });
  const newest = render(many, now, null, 100, { height: 60 });
  assert.match(newest, /feed · ↑ older/);
  assert.match(newest, /note 29/);
  const back = render(many, now, null, 100, { height: 60, feedOffset: 5 });
  assert.match(back, /feed · 5 newer ↓/);
  assert.match(back, /note 24/);
  assert.doesNotMatch(back, /note 25/);
  assert.match(back, /note 15/);
  const oldest = render(many, now, null, 100, { height: 60, feedOffset: 99 });
  assert.match(oldest, /note 0\b/);
  assert.match(oldest, /20 newer ↓/);
  assert.equal(feedScroll("\u001b[A"), 1);
  assert.equal(feedScroll("\u001b[B"), -1);
  assert.equal(feedScroll("\u001b[5~"), feedRows);
  assert.equal(feedScroll("\u001b[F"), "end");
  assert.equal(feedScroll("x"), undefined);
  const a = { at: 1, text: "a" };
  const b = { at: 2, text: "b" };
  const c = { at: 3, text: "c" };
  assert.equal(feedGrowth([a, b], [a, b, c]), 1);
  assert.equal(feedGrowth([a, b], [b, c]), 1);
  assert.equal(feedGrowth([a, b], [a, b]), 0);
});

test("no line runs past the window at any width, with or without colour", () => {
  const busy = view({
    awake: true,
    folder: { branch: "wireal/14", dirty: true, behind: 3, path: "~/code/x" },
    skipped: [{ reference: "9", name: "Marketing site", reason: "belongs" }],
    slots: [
      slot({ agent: "A very long agent name indeed" }),
      resting({ agent: "Rex", paused: "Paused: 5-hour window at 92%" }),
    ],
  });
  for (const width of [160, 120, 100, 80, 64, 52, 46, 34, 24]) {
    for (const colour of [false, true]) {
      const drawn = render(busy, now, 0, width, {
        height: 40,
        colour,
        motion: true,
        frame: 3,
      });
      for (const line of drawn.split("\n"))
        assert.equal(
          cells(plain(line)),
          width - 1,
          `a ${width} column window drew: ${plain(line)}`,
        );
    }
  }
});

test("what reaches the terminal never fills the last column or the last row", () => {
  const frame = render(view(), now, null, 90, { colour: true, height: 24 });
  const lines = painting(frame, 24).split("\r\n");
  for (const line of lines) {
    assert.ok(
      line.endsWith(eraseLine),
      `a line came without an erase: ${line}`,
    );
    const shown = line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
    assert.ok(cells(shown) < 90, `a 90 column window was handed ${shown}`);
    assert.doesNotMatch(shown, / $/);
  }
  assert.equal(lines.length, frame.split("\n").length);
  assert.equal(painting(frame, 6).split("\r\n").length, 5);
  assert.equal(painting(frame, 1).split("\r\n").length, 1);
});

test("the keys shorten with the window and an empty runner invites an agent", () => {
  const text = (width: number, over: Partial<View> = {}) =>
    keyPieces(view(over), width)
      .map(([piece]) => piece)
      .join("");
  assert.equal(
    text(200),
    "+ add  - remove  c/x claude/codex  p pause  1-9 attach  ctrl-g detach  ↑↓ feed  q quit",
  );
  assert.equal(
    text(70),
    "+ add  - remove  c/x claude/codex  p pause  1-9 attach  q quit",
  );
  assert.equal(text(50), "+ add  - remove  p pause  1-9 attach  q quit");
  assert.equal(text(20), "+ - p 1-9 q");
  assert.match(text(200, { paused: "Intake paused" }), /p resume/);
  assert.match(text(200, { mode: "paused", paused: "Paused" }), /p pause/);
  const empty = render(view({ slots: [] }), now, null, 100);
  assert.match(empty, /│ No agents yet · \+ adds one +│/);
  assert.match(rows(empty).at(-1) ?? "", /^╰─ \+ add an agent {2}c\/x/);
  assert.equal(detachLabel, "ctrl-g");
  assert.deepEqual(detachKeys, ["\u0007", "\u001d"]);
});

test("while the runner starts, the screen lists its steps", () => {
  const starting = view({
    workspace: "",
    slots: [],
    usage: [],
    feed: [{ at: now, text: "starting" }],
    starting: [
      { text: "bound to Wireal", state: "done" },
      { text: "could not write the agents", state: "failed" },
      { text: "Reading the repository", state: "doing" },
    ],
  });
  const drawn = rows(render(starting, now, null, 80));
  assert.match(drawn[0], /⠋ starting ─╮$/);
  assert.match(drawn.join("\n"), /│ {3}✓ bound to Wireal +│/);
  assert.match(drawn.join("\n"), /│ {3}✕ could not write the agents +│/);
  assert.match(drawn.join("\n"), /│ {3}⠋ Reading the repository… +│/);
  assert.match(drawn.join("\n"), /· starting/);
  assert.match(drawn.at(-1) ?? "", /^╰─ q quit ─+╯$/);
  assert.doesNotMatch(drawn.join("\n"), /agents ·|idle/);
  assert.ok(
    render(starting, now, null, 80, { height: 5 }).split("\n").length <= 4,
  );
});

test("colour paints the screen without moving anything in it", () => {
  const bare = render(view(), now, null, 110);
  const painted = render(view(), now, null, 110, { colour: true });
  assert.notEqual(painted, bare);
  assert.equal(plain(painted), bare);
  assert.match(painted, /\u001b\[38;5;216mclaude/);
  assert.match(painted, /\u001b\[38;5;152mCodex/);

  assert.equal(colourful({}, true), true);
  assert.equal(colourful({}, false), false);
  assert.equal(colourful({ NO_COLOR: "1" }, true), false);
  assert.equal(colourful({ TERM: "dumb" }, true), false);
});

test("the old Windows console gets shapes its fonts have", () => {
  assert.equal(glyphsFor({}, "win32"), legacy);
  assert.equal(glyphsFor({ WT_SESSION: "1" }, "win32"), fancy);
  assert.equal(glyphsFor({}, "linux"), fancy);
  const drawn = rows(render(view(), now, null, 100, { glyphs: legacy }));
  assert.match(drawn[0], /^┌─/);
  assert.match(drawn.at(-1) ?? "", /^└─.*┘$/);
  assert.match(row(drawn.join("\n"), /Ada/), /1 - Ada/);
  assert.match(drawn.join("\n"), /√ Merged/);
});

test("the timer ticks in seconds, then minutes, then hours", () => {
  assert.equal(elapsed(42_000), "42s");
  assert.equal(elapsed(252_000), "4m 12s");
  assert.equal(elapsed(3_840_000), "1h 04m");
  assert.equal(elapsed(-1), "");
  assert.equal(fit("abcdef", 4), "abc…");
});

test("the skipped tasks are listed with the reason", () => {
  const drawn = render(
    view({
      skipped: [
        {
          reference: "9",
          name: "Marketing site",
          reason: "belongs to acme/site",
        },
        { reference: "11", name: "Tidy", reason: "no objective" },
      ],
    }),
    now,
    null,
    100,
  );
  assert.match(drawn, /├─ skipped ─+┤/);
  assert.match(drawn, /│ WRL·9 Marketing site · belongs to acme\/site +│/);
  assert.match(drawn, /│ WRL·11 Tidy · no objective +│/);
});

test("an expanded agent shows its screen inside the frame, colours and all", async () => {
  const screen = createScreen(40, 8);
  screen.write("Reading runner/ui.ts\r\n");
  screen.write("Working 1s");
  screen.write(`\rWorking 2s ${escape}[32mdone${escape}[0m`);
  await screen.settled();

  const shown = { slots: [resting({ lines: ["stale log line"], screen })] };
  const drawn = rows(render(view(shown), now, 0, 60, { colour: true }));
  const start = drawn.findIndex((line) => /^.*├─ .*1 .*Ada/.test(plain(line)));
  assert.ok(start > 0);
  assert.equal(
    plain(drawn[start + 1]),
    "│ Reading runner/ui.ts" + " ".repeat(35) + " │",
  );
  assert.match(drawn[start + 2], new RegExp(`${escape}\\[32mdone`));
  assert.doesNotMatch(drawn.join("\n"), /stale log line|Working 1s/);
  const bare = render(view(shown), now, 0, 60);
  assert.doesNotMatch(bare, /\u001b/);
  screen.dispose();
});

test("an expanded agent with no screen yet shows its log lines", () => {
  const drawn = render(
    view({
      slots: [resting({ lines: ["read src/auth.ts", "wrote the test"] })],
    }),
    now,
    0,
    60,
  );
  assert.match(drawn, /│ read src\/auth\.ts +│\n│ wrote the test +│\n/);
});

test("the crew keys reach the runner, and the footer names them", () => {
  const terminal = fakeTerminal(110, 30);
  const keys: string[] = [];
  let quit = 0;
  const ui = createUi(() => (quit += 1), terminal.terminal, {
    tty: true,
    onKey: (key) => keys.push(key),
  });
  ui.update(view());
  for (const key of ["+", "=", "-", "c", "x", "p", "z"]) terminal.type(key);
  assert.deepEqual(keys, ["+", "+", "-", "c", "x", "p"]);
  assert.equal(quit, 0);
  const shown = () =>
    terminal.written.join("").replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
  assert.match(shown(), /\+ add {2}- remove {2}c\/x claude\/codex {2}p pause/);
  ui.update(view({ slots: [] }));
  assert.match(shown(), /No agents yet · \+ adds one/);
  terminal.type("q");
  assert.equal(quit, 1);
  ui.stop();
});

test("a digit on an agent without a screen opens its lines, and again closes them", () => {
  const terminal = fakeTerminal(110, 40);
  const ui = createUi(() => {}, terminal.terminal, { tty: true });
  ui.update(view({ slots: [resting({ lines: ["an old line"] })] }));
  terminal.written.length = 0;
  terminal.type("1");
  assert.match(terminal.written.join(""), /an old line/);
  terminal.written.length = 0;
  terminal.type("1");
  assert.doesNotMatch(terminal.written.join(""), /an old line/);
  ui.stop();
});

test("the terminal takes the runner's name while the runner holds it", () => {
  const terminal = fakeTerminal(110, 30);
  const ui = createUi(() => {}, terminal.terminal, { tty: true });
  ui.update(view());
  const opened = terminal.written.join("");
  assert.match(opened, /\u001b\[22;2t/);
  assert.ok(opened.includes(titleFor("Ada's laptop")));
  terminal.written.length = 0;

  ui.update(view());
  assert.equal(
    terminal.written.join("").includes(titleFor("Ada's laptop")),
    false,
  );
  ui.update(view({ runner: "Studio" }));
  assert.ok(terminal.written.join("").includes(titleFor("Studio")));

  terminal.written.length = 0;
  ui.stop();
  assert.ok(terminal.written.join("").startsWith(popTitle));
});

test("a resized window is cleared before the next frame is painted", () => {
  const terminal = fakeTerminal(110, 30);
  const ui = createUi(() => {}, terminal.terminal, { tty: true });
  ui.update(view());
  const first = terminal.written.join("");
  assert.match(first, /Ada's laptop/);
  terminal.written.length = 0;

  terminal.resizeTo({ columns: 70, rows: 20 });
  const second = terminal.written.join("");
  assert.match(second, /\u001b\[H\u001b\[J/);
  for (const line of second.split("\u001b[H").at(-1)?.split("\n") ?? [])
    assert.ok(line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").length <= 70);
  ui.stop();
});

test("attaching forwards bytes both ways and sizes the pty to the terminal", () => {
  const terminal = fakeTerminal(150, 44);
  const pty = fakeLink();
  const detached: number[] = [];
  const attachment = createAttachment(terminal.terminal, () =>
    detached.push(1),
  );

  assert.equal(attachment.attached(), null);
  assert.equal(attachment.attach(2, pty.link), true);
  assert.equal(attachment.attached(), 2);
  assert.equal(attachment.attach(0, pty.link), false);
  assert.deepEqual(terminal.raw, [true]);
  assert.deepEqual(pty.sizes, [{ columns: 150, rows: 44 }]);
  assert.match(terminal.written.join(""), /\u001b\[\?1049h/);

  pty.say("Claude Code redraws");
  assert.match(terminal.written.join(""), /Claude Code redraws/);

  attachment.send("npm test\r");
  assert.deepEqual(pty.written, ["npm test\r"]);

  terminal.resizeTo({ columns: 80, rows: 24 });
  assert.deepEqual(pty.sizes.at(-1), { columns: 80, rows: 24 });
});

test("ctrl-] detaches, unsubscribes and restores the table's size", () => {
  const terminal = fakeTerminal(150, 44);
  const pty = fakeLink();
  const detached: number[] = [];
  const attachment = createAttachment(terminal.terminal, () =>
    detached.push(1),
  );
  attachment.attach(1, pty.link);
  assert.equal(pty.listeners(), 1);

  attachment.send(detachKey);
  assert.equal(attachment.attached(), null);
  assert.deepEqual(detached, [1]);
  assert.equal(pty.listeners(), 0);
  assert.equal(terminal.listeners(), 0);
  assert.deepEqual(pty.sizes.at(-1), { columns: 120, rows: 40 });
  assert.deepEqual(terminal.raw, [true]);
  assert.match(terminal.written.join(""), /\u001b\[\?1049l/);

  assert.equal(attachment.detach(), false);
  attachment.send("ignored");
  assert.deepEqual(pty.written, []);

  assert.equal(attachment.attach(1, pty.link), true);
  assert.equal(attachment.attached(), 1);
  attachment.send("\u001d");
  assert.equal(attachment.attached(), null);
});

test("attaching repaints the agent's screen before the next redraw", async () => {
  const terminal = fakeTerminal(30, 6);
  const pty = fakeLink();
  const screen = createScreen(120, 40);
  screen.write(`${escape}[36mClaude Code${escape}[0m\r\n> `);
  await screen.settled();
  const attachment = createAttachment(terminal.terminal);

  assert.equal(attachment.attach(0, pty.link, screen), true);
  assert.deepEqual(screen.size(), { columns: 30, rows: 6 });
  const written = terminal.written.join("");
  assert.match(written, new RegExp(`${escape}\\[36mClaude Code`));
  assert.match(written, new RegExp(`${escape}\\[2;1H>${escape}\\[2;3H`));

  terminal.resizeTo({ columns: 90, rows: 20 });
  assert.deepEqual(pty.sizes.at(-1), { columns: 90, rows: 20 });
  assert.deepEqual(screen.size(), { columns: 90, rows: 20 });

  attachment.detach();
  assert.deepEqual(screen.size(), { columns: 120, rows: 40 });
  screen.dispose();
});

test("an error over several lines stays one feed row, and a repeated line folds", () => {
  const drawn = rows(
    render(
      view({
        feed: [
          {
            at: now - 60_000,
            text: "48 stopped: git worktree failed: Preparing worktree\nfatal: 'C:/w/48' already exists",
          },
          {
            at: now - 60_000,
            text: "This runner has no agent to remove",
            times: 4,
          },
        ],
      }),
      now,
      null,
      100,
    ),
  );
  const at = drawn.findIndex((line) => /^├─ feed ─/.test(line));
  assert.match(drawn[at + 1], /Preparing worktree · fatal: 'C:\/w\/48'/);
  assert.match(drawn[at + 1], /│$/);
  assert.match(drawn[at + 2], /This runner has no agent to remove ×4 +│$/);
  assert.match(drawn[at + 3], /^╰─/);
});
