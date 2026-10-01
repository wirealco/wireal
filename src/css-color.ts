/* Resolving a CSS colour to actual channels.
 *
 * The ASCII fluid paints its own paper, and that paper has to be the page's
 * own `--background` to the byte: iOS paints the status bar band and the area
 * behind the translucent bottom toolbar from the page background, so a canvas
 * even one step off shows as a lighter seam above and below the page. The
 * token is written in oklch, which nothing here can parse by hand, so anything
 * that is not plain hex or rgb() is handed to a 1x1 2D canvas and read back —
 * every browser that ships oklch parses it there too. */

/** An opaque colour as three 0–1 sRGB channels, the form the shaders want. */
export type Rgb = [number, number, number];

const HEX = /^#?[0-9a-f]{3,8}$/i;
const RGB = /^rgba?\(([^)]*)\)$/i;

function channel(part: string): number | null {
  const value = part.trim();
  if (!value) return null;
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return null;
  const scaled = value.endsWith("%") ? (number / 100) * 255 : number;
  return Math.min(1, Math.max(0, scaled / 255));
}

/** `#abc`, `#aabbcc`, `#aabbccdd` — alpha is read and dropped. */
export function parseHexColor(value: string): Rgb | null {
  const text = value.trim();
  if (!HEX.test(text)) return null;
  const digits = text.replace("#", "");
  if (
    digits.length !== 3 &&
    digits.length !== 4 &&
    digits.length !== 6 &&
    digits.length !== 8
  )
    return null;
  const short = digits.length <= 4;
  const pair = (index: number) => {
    const slice = short
      ? digits[index]! + digits[index]!
      : digits.slice(index * 2, index * 2 + 2);
    return Number.parseInt(slice, 16) / 255;
  };
  return [pair(0), pair(1), pair(2)];
}

/** `rgb(9 9 11)`, `rgb(9, 9, 11)`, `rgba(9 9 11 / 80%)`, percentages included. */
export function parseRgbColor(value: string): Rgb | null {
  const match = RGB.exec(value.trim());
  if (!match) return null;
  const [components] = match[1]!.split("/");
  const parts = components!
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length < 3) return null;
  const rgb = parts.slice(0, 3).map(channel);
  return rgb.every((part): part is number => part !== null)
    ? [rgb[0]!, rgb[1]!, rgb[2]!]
    : null;
}

/** The two notations that need no browser to read them. */
export function parseColor(value: string): Rgb | null {
  return parseHexColor(value) ?? parseRgbColor(value);
}

/* One probe canvas for the life of the document. `undefined` means "not tried
   yet", `null` means this environment has no 2D canvas to try again with. */
let probe: CanvasRenderingContext2D | null | undefined;

function probeContext(): CanvasRenderingContext2D | null {
  if (probe !== undefined) return probe;
  probe = null;
  if (typeof document === "undefined") return probe;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext("2d", { willReadFrequently: true }) ?? null;
  } catch {
    probe = null;
  }
  return probe;
}

/* `fillStyle` silently keeps its old value when handed something it cannot
   parse, so the only way to tell a rejection from a colour that happens to
   match is to offer the same string against two different starting points. */
function paints(ctx: CanvasRenderingContext2D, value: string): boolean {
  ctx.fillStyle = "#000000";
  ctx.fillStyle = value;
  const first = ctx.fillStyle;
  ctx.fillStyle = "#ffffff";
  ctx.fillStyle = value;
  return ctx.fillStyle === first;
}

/**
 * Any CSS colour — oklch, color-mix, a named colour — as 0–1 sRGB channels.
 * Returns `null` where the value is not a colour, or where there is no canvas
 * to ask (a test run, a server render); the caller keeps its own default.
 */
export function resolveCssColor(value: string): Rgb | null {
  const text = value.trim();
  if (!text) return null;
  const direct = parseColor(text);
  if (direct) return direct;
  const ctx = probeContext();
  if (!ctx || !paints(ctx, text)) return null;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillRect(0, 0, 1, 1);
  try {
    const { data } = ctx.getImageData(0, 0, 1, 1);
    return [data[0]! / 255, data[1]! / 255, data[2]! / 255];
  } catch {
    // A tainted or unavailable canvas: no colour rather than a wrong one.
    return null;
  }
}

/** The live value of a custom property on `<html>`, var() chains resolved. */
export function cssVariable(name: string): string {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function")
    return "";
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}
