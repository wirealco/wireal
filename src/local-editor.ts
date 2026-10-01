export type EditorRoots = Record<string, string>;

export const editorRootsKey = "wireal.commits.editorRoots";

export function repoKey(ref: { owner: string; repo: string }): string {
  return `${ref.owner}/${ref.repo}`.toLowerCase();
}

export function normalizeRoot(value: string): string {
  const slashed = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!slashed) return "";
  return /^[a-zA-Z]:/.test(slashed) || slashed.startsWith("/")
    ? slashed
    : `/${slashed}`;
}

export function readEditorRoots(
  storage: Pick<Storage, "getItem">,
): EditorRoots {
  try {
    const saved = storage.getItem(editorRootsKey);
    if (!saved) return {};
    const parsed: unknown = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const roots: EditorRoots = {};
    for (const [key, value] of Object.entries(parsed))
      if (typeof value === "string" && value) roots[key] = value;
    return roots;
  } catch {
    return {};
  }
}

export function writeEditorRoot(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
  root: string,
): EditorRoots {
  const normalized = normalizeRoot(root);
  const roots = readEditorRoots(storage);
  if (normalized) roots[key] = normalized;
  else delete roots[key];
  try {
    storage.setItem(editorRootsKey, JSON.stringify(roots));
  } catch {
    return roots;
  }
  return roots;
}

/** VS Code answers vscode://file/<absolute path>, so the root the workspace was
 *  cloned into is all that stands between a commit path and the local file. */
export function editorFileUrl(root: string, path: string): string {
  const base = normalizeRoot(root);
  if (!base) return "";
  const full = `${base}/${path.replace(/^\/+/, "")}`;
  const encoded = full
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/%3A/gi, ":"))
    .join("/");
  return `vscode://file${encoded.startsWith("/") ? "" : "/"}${encoded}`;
}
