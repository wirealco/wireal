import assert from "node:assert/strict";
import test from "node:test";
import {
  editorFileUrl,
  editorRootsKey,
  normalizeRoot,
  readEditorRoots,
  repoKey,
  writeEditorRoot,
} from "./local-editor";

const storage = (value?: string) => {
  const box: { value: string | null } = { value: value ?? null };
  return {
    box,
    getItem: () => box.value,
    setItem: (_key: string, next: string) => {
      box.value = next;
    },
  };
};

test("a root is trimmed, slashed forward and made absolute", () => {
  assert.equal(normalizeRoot("  /Users/me/wireal/ "), "/Users/me/wireal");
  assert.equal(normalizeRoot("C:\\code\\wireal\\"), "C:/code/wireal");
  assert.equal(normalizeRoot("Users/me/wireal"), "/Users/me/wireal");
  assert.equal(normalizeRoot("   "), "");
});

test("roots are stored per repository and read back without the junk", () => {
  const store = storage();
  assert.deepEqual(readEditorRoots(store), {});
  writeEditorRoot(store, repoKey({ owner: "Acme", repo: "Widgets" }), "/w");
  assert.deepEqual(readEditorRoots(store), { "acme/widgets": "/w" });
  writeEditorRoot(store, "acme/widgets", "");
  assert.deepEqual(readEditorRoots(store), {});
  assert.deepEqual(readEditorRoots(storage("[]")), {});
  assert.deepEqual(readEditorRoots(storage("nonsense")), {});
  assert.deepEqual(readEditorRoots(storage('{"a/b":3,"c/d":"/x"}')), {
    "c/d": "/x",
  });
  assert.equal(store.box.value, JSON.stringify({}));
  assert.equal(editorRootsKey, "wireal.commits.editorRoots");
});

test("a file url points VS Code at the checked out path", () => {
  assert.equal(
    editorFileUrl("/Users/me/wireal", "src/task files.ts"),
    "vscode://file/Users/me/wireal/src/task%20files.ts",
  );
  assert.equal(
    editorFileUrl("C:\\code\\wireal", "src/a.ts"),
    "vscode://file/C:/code/wireal/src/a.ts",
  );
  assert.equal(editorFileUrl("", "src/a.ts"), "");
});
