import assert from "node:assert/strict";
import test from "node:test";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  get length() {
    return store.size;
  },
  key: (index: number) => [...store.keys()][index] ?? null,
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
};

const { CACHE_LIMIT, documentKey, readCache, writeCache, preserveCache } =
  await import("./workspace-cache");
const { emptyWorkspace } = await import("./workspace-default");

const KEY = "wireal.workspaces.v2.user.someone";

function workspace(name: string) {
  const value = emptyWorkspace();
  value.map = { ...value.map, name };
  return value;
}

function padded(name: string, size: number) {
  const value = workspace(name);
  value.labels = [
    { id: "label-0", name: "x".repeat(size), orb: value.map.orb },
  ];
  return value;
}

test.beforeEach(() => store.clear());

test("each workspace is saved under its own key, the index only names them", () => {
  writeCache(KEY, "two", [
    { id: "one", role: "owner", workspace: workspace("One") },
    { id: "two", workspace: workspace("Two") },
  ]);
  const index = JSON.parse(store.get(KEY)!);
  assert.deepEqual(index, {
    activeId: "two",
    workspaces: [{ id: "one", role: "owner" }, { id: "two" }],
  });
  assert.ok(!store.get(KEY)!.includes("One"), "the index carries no document");
  assert.equal(JSON.parse(store.get(documentKey(KEY, "one"))!).map.name, "One");
  assert.equal(JSON.parse(store.get(documentKey(KEY, "two"))!).map.name, "Two");
});

test("a workspace too big to be read back at once is not cached", () => {
  writeCache(KEY, "small", [
    { id: "small", workspace: workspace("Small") },
    { id: "huge", workspace: padded("Huge", CACHE_LIMIT) },
  ]);
  assert.equal(store.has(documentKey(KEY, "huge")), false);
  assert.deepEqual(JSON.parse(store.get(KEY)!).workspaces, [{ id: "small" }]);

  // It is dropped again on the next write, however it got there.
  store.set(documentKey(KEY, "huge"), "{}");
  writeCache(KEY, "small", [
    { id: "small", workspace: workspace("Small") },
    { id: "huge", workspace: padded("Huge", CACHE_LIMIT) },
  ]);
  assert.equal(store.has(documentKey(KEY, "huge")), false);
});

test("a workspace that left the account leaves no document behind", () => {
  writeCache(KEY, "one", [
    { id: "one", workspace: workspace("One") },
    { id: "gone", workspace: workspace("Gone") },
  ]);
  writeCache(KEY, "one", [{ id: "one", workspace: workspace("One") }]);
  assert.equal(store.has(documentKey(KEY, "gone")), false);
  assert.equal(store.has(documentKey(KEY, "one")), true);
});

test("what was written is what is read back", () => {
  writeCache(KEY, "two", [
    { id: "one", role: "collaborator", workspace: workspace("One") },
    { id: "two", workspace: workspace("Two") },
  ]);
  const read = readCache(KEY);
  assert.equal(read.activeId, "two");
  assert.equal(read.carried, false);
  assert.equal(read.unreadable, false);
  assert.deepEqual(
    read.workspaces.map((item) => [
      item.id,
      item.role ?? "",
      item.workspace.map.name,
    ]),
    [
      ["one", "collaborator", "One"],
      ["two", "", "Two"],
    ],
  );
});

test("the old shape, which held every workspace in one string, is migrated", () => {
  store.set(
    KEY,
    JSON.stringify({
      activeId: "one",
      workspaces: [
        { id: "one", role: "owner", data: workspace("One") },
        { id: "two", data: workspace("Two") },
      ],
    }),
  );
  const read = readCache(KEY);
  assert.equal(read.carried, true, "the caller is told to write it again");
  assert.deepEqual(
    read.workspaces.map((item) => item.workspace.map.name),
    ["One", "Two"],
  );
  writeCache(KEY, read.activeId, read.workspaces);
  assert.ok(!store.get(KEY)!.includes("One"), "the fat string is gone");
  assert.equal(readCache(KEY).carried, false);
});

test("an old string too big to hold twice is dropped, not parsed", () => {
  const fat = JSON.stringify({
    activeId: "one",
    workspaces: [{ id: "one", data: padded("One", CACHE_LIMIT) }],
  });
  assert.ok(fat.length > CACHE_LIMIT);
  store.set(KEY, fat);
  const read = readCache(KEY);
  assert.deepEqual(read.workspaces, []);
  assert.equal(read.unreadable, false, "nothing was lost that the server has");
  assert.equal(store.has(KEY), false);
});

test("one unreadable document is skipped and the rest still open", () => {
  writeCache(KEY, "one", [
    { id: "one", workspace: workspace("One") },
    { id: "two", workspace: workspace("Two") },
  ]);
  store.set(documentKey(KEY, "two"), "{ not json");
  const read = readCache(KEY);
  assert.deepEqual(
    read.workspaces.map((item) => item.id),
    ["one"],
  );
  assert.equal(read.unreadable, true);
});

test("a preserved cache keeps the index and every document beside it", () => {
  writeCache(KEY, "one", [{ id: "one", workspace: workspace("One") }]);
  preserveCache(KEY, 1700000000000);
  assert.equal(store.has(`${KEY}.recovery.1700000000000`), true);
  assert.equal(
    store.has(`${documentKey(KEY, "one")}.recovery.1700000000000`),
    true,
  );

  // A recovery copy is not itself a document, so it is never cleaned away as
  // one, and never read back as a workspace.
  writeCache(KEY, "two", [{ id: "two", workspace: workspace("Two") }]);
  assert.equal(
    store.has(`${documentKey(KEY, "one")}.recovery.1700000000000`),
    true,
  );
  assert.deepEqual(
    readCache(KEY).workspaces.map((item) => item.id),
    ["two"],
  );
});
