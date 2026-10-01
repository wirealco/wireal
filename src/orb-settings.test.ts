import assert from "node:assert/strict";
import test from "node:test";
import { makeOrb, orbPaint, randomOrb, validOrb } from "./orb-settings";

test("a badge drawn in CSS carries all three colours of its palette", () => {
  const orb = makeOrb("#ffb33e");
  const paint = orbPaint(orb);
  for (const colour of orb.colors) assert.ok(paint.includes(colour), colour);
  assert.equal(paint.split("radial-gradient").length - 1, 3);
  assert.ok(paint.includes("linear-gradient"));
});

test("it fades to its own colour, never through transparent black", () => {
  const paint = orbPaint(makeOrb("#408cff"));
  assert.ok(!paint.includes("transparent"));
  assert.ok(paint.includes("#408cff00"));
});

test("two palettes that differ only by phase are drawn differently", () => {
  const one = { ...makeOrb("#ef6387"), phase: 0 };
  const other = { ...makeOrb("#ef6387"), phase: 60 };
  assert.notEqual(orbPaint(one), orbPaint(other));
});

test("every orb the app can make is one CSS can draw", () => {
  for (let i = 0; i < 40; i += 1) {
    const orb = randomOrb();
    assert.ok(validOrb(orb));
    assert.ok(!orbPaint(orb).includes("undefined"));
  }
});
