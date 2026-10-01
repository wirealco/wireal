import assert from "node:assert/strict";
import test from "node:test";
import { createScreen, reset, type Screen } from "./screen.ts";

const escape = String.fromCharCode(27);

async function fed(chunks: string[], columns = 40, rows = 8): Promise<Screen> {
  const screen = createScreen(columns, rows);
  for (const chunk of chunks) screen.write(chunk);
  await screen.settled();
  return screen;
}

function bare(text: string): string {
  return text.replace(new RegExp(`${escape}\\[[0-9;?]*[a-zA-Z]`, "g"), "");
}

test("a redrawn line is one line on the screen, not a pile of duplicates", async () => {
  const screen = await fed([
    "Running tests\r\n",
    "Working 1s",
    "\rWorking 2s",
    "\rWorking 3s",
  ]);
  const lines = screen.lines(10, 20).map(bare);
  assert.deepEqual(lines, ["Running tests       ", "Working 3s          "]);
  screen.dispose();
});

test("the screen keeps the colours the agent wrote", async () => {
  const screen = await fed([`${escape}[31mred${escape}[0m plain`]);
  const [line] = screen.lines(1, 12);
  assert.equal(line, `${escape}[31mred${reset} plain   `);
  assert.equal(bare(line), "red plain   ");
  screen.dispose();
});

test("bright, 256 colour, true colour and bold all survive", async () => {
  const screen = await fed([
    `${escape}[1;92mb${escape}[0m`,
    `${escape}[38;5;208mo${escape}[0m`,
    `${escape}[38;2;10;20;30mt${escape}[0m`,
    `${escape}[44mg${escape}[0m`,
  ]);
  const [line] = screen.lines(1, 4);
  assert.equal(
    line,
    `${escape}[1;92mb${reset}${escape}[38;5;208mo${reset}` +
      `${escape}[38;2;10;20;30mt${reset}${escape}[44mg${reset}`,
  );
  screen.dispose();
});

test("preview lines are padded to the width the table asked for", async () => {
  const screen = await fed(["one\r\ntwo\r\n"]);
  const lines = screen.lines(10, 9);
  assert.deepEqual(
    lines.map((line) => line.length),
    [9, 9],
  );
  assert.deepEqual(lines.map(bare), ["one      ", "two      "]);
  screen.dispose();
});

test("a preview is the tail of the screen and never counts blank rows", async () => {
  const screen = await fed([
    [1, 2, 3, 4, 5, 6].map((number) => `line ${number}`).join("\r\n"),
  ]);
  assert.deepEqual(screen.lines(2, 6).map(bare), ["line 5", "line 6"]);
  screen.dispose();
});

test("a line is read once, and only once it has scrolled off the screen", async () => {
  const screen = await fed(["Running tests\r\n", "Working 1s"], 40, 5);
  assert.deepEqual(screen.scrolled(20), []);
  screen.write("\rWorking 2s\r\nsecond\r\nthird\r\nfourth\r\nfifth\r\n");
  await screen.settled();
  assert.deepEqual(screen.scrolled(20).map(bare), [
    "Running tests",
    "Working 2s",
  ]);
  assert.deepEqual(screen.scrolled(20), []);
  screen.write("sixth\r\n");
  await screen.settled();
  assert.deepEqual(screen.scrolled(20).map(bare), ["second"]);
  screen.dispose();
});

test("reading keeps its place once the scrollback drops the oldest lines", async () => {
  const screen = createScreen(40, 5);
  const read: string[] = [];
  for (let batch = 0; batch < 10; batch++) {
    let chunk = "";
    for (let line = 0; line < 100; line++)
      chunk += `line ${batch * 100 + line}\r\n`;
    screen.write(chunk);
    await screen.settled();
    read.push(...screen.scrolled(20).map(bare));
  }
  assert.equal(read.length, 996);
  assert.equal(read[0], "line 0");
  assert.equal(read.at(-1), "line 995");
  screen.dispose();
});

test("painting the buffer repeats the screen and puts the cursor back", async () => {
  const screen = await fed([`hello\r\n${escape}[33mworld${escape}[0m`], 20, 4);
  const painted = screen.paint();
  assert.match(
    painted,
    new RegExp(`^${escape}\\[0m${escape}\\[H${escape}\\[2J`),
  );
  assert.match(painted, new RegExp(`${escape}\\[1;1Hhello`));
  assert.match(painted, new RegExp(`${escape}\\[2;1H${escape}\\[33mworld`));
  assert.match(painted, new RegExp(`${escape}\\[2;6H$`));
  assert.doesNotMatch(painted, /\[3;1H/);
  screen.dispose();
});

test("resizing widens the screen and holds the smallest usable size", async () => {
  const screen = await fed(["narrow\r\n"], 10, 6);
  assert.deepEqual(screen.size(), { columns: 20, rows: 6 });
  screen.resize(40, 12);
  screen.write("a long line that wraps at twenty");
  await screen.settled();
  assert.deepEqual(screen.size(), { columns: 40, rows: 12 });
  assert.deepEqual(screen.lines(2, 31).map(bare), [
    "narrow                         ",
    "a long line that wraps at twenty".slice(0, 31),
  ]);
  screen.resize(4, 1);
  assert.deepEqual(screen.size(), { columns: 20, rows: 5 });
  screen.dispose();
});

test("an alternate screen app is read from its own buffer", async () => {
  const screen = await fed([
    "shell history\r\n",
    `${escape}[?1049h${escape}[H${escape}[2Jfull screen app`,
  ]);
  assert.deepEqual(screen.lines(5, 15).map(bare), ["full screen app"]);
  screen.write(`${escape}[?1049l`);
  await screen.settled();
  assert.deepEqual(screen.lines(5, 13).map(bare), ["shell history"]);
  screen.dispose();
});
