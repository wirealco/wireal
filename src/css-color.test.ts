import assert from "node:assert/strict";
import test from "node:test";
import {
  cssVariable,
  parseColor,
  parseHexColor,
  parseRgbColor,
  resolveCssColor,
} from "./css-color";

const close = (actual: number, expected: number) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `${actual} is not within a rounding step of ${expected}`,
  );

test("hex is read in every length the token file might use", () => {
  assert.deepEqual(parseHexColor("#000000"), [0, 0, 0]);
  assert.deepEqual(parseHexColor("#ffffff"), [1, 1, 1]);
  // The two hard-coded papers the engine used before it read the tokens.
  const paper = parseHexColor("#09090b")!;
  close(paper[0], 9 / 255);
  close(paper[2], 11 / 255);
  // Short form, alpha form, and a missing hash are all the same colour.
  assert.deepEqual(parseHexColor("#fff"), [1, 1, 1]);
  assert.deepEqual(parseHexColor("#ffff"), [1, 1, 1]);
  assert.deepEqual(parseHexColor("fafafa"), parseHexColor("#fafafa"));
  assert.deepEqual(parseHexColor("#ffffff80"), [1, 1, 1]);
});

test("a value that is not hex is not guessed at", () => {
  assert.equal(parseHexColor("#gg0000"), null);
  assert.equal(parseHexColor("#12345"), null);
  assert.equal(parseHexColor(""), null);
  assert.equal(parseHexColor("oklch(12% .005 285.823)"), null);
});

test("rgb() is read in both the comma and the space syntax", () => {
  assert.deepEqual(parseRgbColor("rgb(255, 255, 255)"), [1, 1, 1]);
  assert.deepEqual(parseRgbColor("rgb(255 255 255)"), [1, 1, 1]);
  assert.deepEqual(parseRgbColor("rgba(0, 0, 0, 0.5)"), [0, 0, 0]);
  assert.deepEqual(parseRgbColor("rgb(0 0 0 / 80%)"), [0, 0, 0]);
  assert.deepEqual(parseRgbColor("rgb(100%, 0%, 0%)"), [1, 0, 0]);
  // Out of range channels clamp rather than escaping into the shader.
  assert.deepEqual(parseRgbColor("rgb(300, -20, 0)"), [1, 0, 0]);
  assert.equal(parseRgbColor("rgb(1, 2)"), null);
  assert.equal(parseRgbColor("#09090b"), null);
});

test("parseColor takes either notation", () => {
  assert.deepEqual(parseColor("#000"), [0, 0, 0]);
  assert.deepEqual(parseColor("rgb(0 0 0)"), [0, 0, 0]);
  assert.equal(parseColor("cornflowerblue"), null);
});

test("without a canvas the caller is told so rather than given a wrong colour", () => {
  // node has no document: hex and rgb() still resolve, oklch cannot, and the
  // engine falls back to its own constants for that theme.
  assert.deepEqual(resolveCssColor("  #f5f5f5  "), [
    245 / 255,
    245 / 255,
    245 / 255,
  ]);
  assert.equal(resolveCssColor("oklch(12% .005 285.823)"), null);
  assert.equal(resolveCssColor(""), null);
  assert.equal(cssVariable("--background"), "");
});
