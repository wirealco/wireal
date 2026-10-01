import xterm from "@xterm/headless";
import type { IBufferCell, IBufferLine, IMarker } from "@xterm/headless";
import { defaultColumns, defaultRows } from "./agents/pty.ts";

const { Terminal } = xterm;

export const reset = "\u001b[0m";

export type Screen = {
  write: (chunk: string) => void;
  resize: (columns: number, rows: number) => void;
  size: () => { columns: number; rows: number };
  lines: (count: number, width: number) => string[];
  scrolled: (width: number) => string[];
  paint: () => string;
  settled: () => Promise<void>;
  dispose: () => void;
};

export function style(cell: IBufferCell): string {
  const codes: number[] = [];
  if (cell.isBold()) codes.push(1);
  if (cell.isDim()) codes.push(2);
  if (cell.isItalic()) codes.push(3);
  if (cell.isUnderline()) codes.push(4);
  if (cell.isBlink()) codes.push(5);
  if (cell.isInverse()) codes.push(7);
  if (cell.isInvisible()) codes.push(8);
  if (cell.isStrikethrough()) codes.push(9);
  if (cell.isFgPalette()) {
    const colour = cell.getFgColor();
    if (colour < 8) codes.push(30 + colour);
    else if (colour < 16) codes.push(90 + colour - 8);
    else codes.push(38, 5, colour);
  } else if (cell.isFgRGB()) {
    const colour = cell.getFgColor();
    codes.push(38, 2, (colour >> 16) & 255, (colour >> 8) & 255, colour & 255);
  }
  if (cell.isBgPalette()) {
    const colour = cell.getBgColor();
    if (colour < 8) codes.push(40 + colour);
    else if (colour < 16) codes.push(100 + colour - 8);
    else codes.push(48, 5, colour);
  } else if (cell.isBgRGB()) {
    const colour = cell.getBgColor();
    codes.push(48, 2, (colour >> 16) & 255, (colour >> 8) & 255, colour & 255);
  }
  return codes.length ? `\u001b[${codes.join(";")}m` : "";
}

let spare: IBufferCell | undefined;

type Painted = { chars: string; width: number; style: string };

function cellsOf(line: IBufferLine, width: number): Painted[] {
  const painted: Painted[] = [];
  let used = 0;
  for (let x = 0; x < line.length && used < width; x++) {
    const cell = line.getCell(x, spare);
    if (!cell) break;
    if (!spare) spare = cell;
    const cellWidth = cell.getWidth();
    if (cellWidth === 0) continue;
    if (used + cellWidth > width) break;
    painted.push({
      chars: cell.getChars() || " ",
      width: cellWidth,
      style: style(cell),
    });
    used += cellWidth;
  }
  return painted;
}

export function renderLine(
  line: IBufferLine | undefined,
  width: number,
  pad: boolean,
): string {
  const painted = line ? cellsOf(line, width) : [];
  let last = -1;
  painted.forEach((cell, index) => {
    if (cell.chars.trim() !== "" || cell.style !== "") last = index;
  });
  const wanted = pad ? painted.length : last + 1;
  let text = "";
  let current = "";
  let used = 0;
  for (let index = 0; index < wanted; index++) {
    const cell = painted[index];
    if (cell.style !== current) {
      if (current !== "") text += reset;
      text += cell.style;
      current = cell.style;
    }
    text += cell.chars;
    used += cell.width;
  }
  if (current !== "") text += reset;
  if (pad && used < width) text += " ".repeat(width - used);
  return text;
}

export function createScreen(
  columns = defaultColumns,
  rows = defaultRows,
): Screen {
  const terminal = new Terminal({
    cols: Math.max(20, columns),
    rows: Math.max(5, rows),
    scrollback: 400,
    allowProposedApi: true,
  });
  let pending = 0;
  let waiting: (() => void)[] = [];
  let alive = true;
  let mark: IMarker | undefined;
  return {
    write: (chunk) => {
      if (!alive) return;
      pending += 1;
      terminal.write(chunk, () => {
        pending -= 1;
        if (pending > 0) return;
        const woken = waiting;
        waiting = [];
        for (const wake of woken) wake();
      });
    },
    resize: (nextColumns, nextRows) => {
      const wide = Math.max(20, nextColumns);
      const tall = Math.max(5, nextRows);
      if (terminal.cols === wide && terminal.rows === tall) return;
      terminal.resize(wide, tall);
    },
    size: () => ({ columns: terminal.cols, rows: terminal.rows }),
    lines: (count, width) => {
      if (!alive) return [];
      const buffer = terminal.buffer.active;
      const drawn: string[] = [];
      for (let y = 0; y < terminal.rows; y++)
        drawn.push(renderLine(buffer.getLine(buffer.baseY + y), width, true));
      while (drawn.length && drawn[drawn.length - 1].trim() === "") drawn.pop();
      return drawn.slice(-count);
    },
    scrolled: (width) => {
      if (!alive || terminal.buffer.active.type === "alternate") return [];
      const buffer = terminal.buffer.normal;
      const from = mark && mark.line >= 0 ? mark.line + 1 : 0;
      if (from >= buffer.baseY) return [];
      const gone: string[] = [];
      for (let y = from; y < buffer.baseY; y++)
        gone.push(renderLine(buffer.getLine(y), width, false));
      mark?.dispose();
      mark = terminal.registerMarker(-1 - buffer.cursorY);
      return gone;
    },
    paint: () => {
      const buffer = terminal.buffer.active;
      let out = `${reset}\u001b[H\u001b[2J`;
      for (let y = 0; y < terminal.rows; y++) {
        const text = renderLine(
          buffer.getLine(buffer.baseY + y),
          terminal.cols,
          false,
        );
        if (text === "") continue;
        out += `\u001b[${y + 1};1H${text}`;
      }
      return out + `\u001b[${buffer.cursorY + 1};${buffer.cursorX + 1}H`;
    },
    settled: () =>
      pending === 0
        ? Promise.resolve()
        : new Promise<void>((done) => waiting.push(done)),
    dispose: () => {
      alive = false;
      mark?.dispose();
      terminal.dispose();
    },
  };
}
