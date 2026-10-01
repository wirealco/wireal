import assert from "node:assert/strict";
import test from "node:test";
import { chooseBackground } from "./board-background";

test("a board nobody has chosen for follows the device it opens on", () => {
  assert.equal(chooseBackground(null, false), "fluid");
  assert.equal(chooseBackground(null, true), "dots");
  assert.equal(chooseBackground("nonsense", true), "dots");
});

test("a choice already made is kept, whatever the device", () => {
  assert.equal(chooseBackground("fluid", true), "fluid");
  assert.equal(chooseBackground("dots", false), "dots");
});
