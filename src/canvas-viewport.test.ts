import assert from "node:assert/strict";
import test from "node:test";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};

const { boardViewportKey, recallViewport, rememberViewport, forgetViewports } =
  await import("./canvas-viewport");

test("a frame survives the page, keyed by workspace and project", () => {
  const key = boardViewportKey("workspace-a", "launchpad");
  rememberViewport(key, { x: -120, y: 40, zoom: 0.75 });
  assert.deepEqual(recallViewport(key), { x: -120, y: 40, zoom: 0.75 });

  // The same project id in another workspace is a different board.
  assert.equal(
    recallViewport(boardViewportKey("workspace-b", "launchpad")),
    undefined,
  );

  // What was written is what a reload would read back.
  const written = JSON.parse(store.get("wireal.canvas.viewport")!);
  assert.deepEqual(written.find(([id]: [string]) => id === key)?.[1], {
    x: -120,
    y: 40,
    zoom: 0.75,
  });
});

test("a frame that could not be recovered from is refused", () => {
  const key = boardViewportKey("workspace-a", "broken");
  // A zoom of zero opens a blank board with no way to tell why; NaN comes back
  // from a viewport read before the canvas has been measured.
  for (const zoom of [0, -1, Number.NaN, Infinity])
    rememberViewport(key, { x: 0, y: 0, zoom });
  assert.equal(recallViewport(key), undefined);
  rememberViewport(key, { x: 1, y: 2, zoom: Number.NaN });
  assert.equal(recallViewport(key), undefined);
});

test("the store is bounded, dropping the least recently used", () => {
  forgetViewports();
  for (let i = 0; i < 45; i++)
    rememberViewport(boardViewportKey("w", `p${i}`), { x: i, y: 0, zoom: 1 });
  assert.equal(recallViewport(boardViewportKey("w", "p0")), undefined);
  assert.deepEqual(recallViewport(boardViewportKey("w", "p44")), {
    x: 44,
    y: 0,
    zoom: 1,
  });
  // Touching an old key keeps it alive rather than letting age alone decide.
  rememberViewport(boardViewportKey("w", "p10"), { x: 10, y: 0, zoom: 1 });
  for (let i = 45; i < 50; i++)
    rememberViewport(boardViewportKey("w", `p${i}`), { x: i, y: 0, zoom: 1 });
  assert.ok(recallViewport(boardViewportKey("w", "p10")));
});

test("unreadable storage leaves a board that simply frames itself", async () => {
  store.set("wireal.canvas.viewport", "{ not json");
  const again = await import(`./canvas-viewport?reload=${Date.now()}`);
  assert.equal(again.recallViewport(boardViewportKey("w", "p1")), undefined);
});
