import assert from "node:assert/strict";
import test from "node:test";
import { canvasShortcut } from "./canvas-shortcuts";

function key(
  value: string,
  overrides: Partial<Parameters<typeof canvasShortcut>[0]> = {},
) {
  return {
    key: value,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    ...overrides,
  };
}

test("fit view works on the board", () => {
  assert.equal(canvasShortcut(key("f"), "board"), "fit-view");
  assert.equal(canvasShortcut(key("F"), "board"), "fit-view");
});

test("board-specific shortcuts stay on the board", () => {
  assert.equal(canvasShortcut(key("a"), "board"), "arrange");
  assert.equal(canvasShortcut(key("v"), "board"), "select");
  assert.equal(canvasShortcut(key("v"), "commits"), null);
  assert.equal(canvasShortcut(key("e"), "board"), null);
});

test("modified and repeated keys are ignored", () => {
  assert.equal(canvasShortcut(key("f", { metaKey: true }), "board"), null);
  assert.equal(canvasShortcut(key("a", { shiftKey: true }), "board"), null);
  assert.equal(canvasShortcut(key("f", { repeat: true }), "board"), null);
});
