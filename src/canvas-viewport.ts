export type Viewport = { x: number; y: number; zoom: number };

/**
 * Where the whiteboard was left.
 *
 * The board is conditionally rendered, so switching tabs unmounts it and React
 * Flow starts again at its default viewport — which is why it came back at 100%
 * however it was left. A ref inside the component cannot help, because the
 * component is the thing being destroyed; this outlives it, and outlives the
 * page, so a refresh comes back to the same place too.
 */
const storageKey = "wireal.canvas.viewport";
/** Keyed by workspace and project, so two workspaces cannot share a frame, and
 *  bounded so a long-lived browser does not accumulate one entry per project
 *  ever opened. The oldest are dropped first. */
const limit = 40;

const viewports = new Map<string, Viewport>(load());

function valid(value: unknown): value is Viewport {
  if (!value || typeof value !== "object") return false;
  const { x, y, zoom } = value as Viewport;
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(zoom) &&
    // A zoom of zero or a negative one is not recoverable by panning: the board
    // would open blank with no way to tell why.
    zoom > 0.01 &&
    zoom < 10
  );
}

function load(): [string, Viewport][] {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is [string, Viewport] =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        valid(entry[1]),
    );
  } catch {
    // Unreadable, disallowed, or written by an older shape. A board that opens
    // fitted is a fine outcome; refusing to render is not.
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...viewports]));
  } catch {
    // Private browsing and full quotas both land here. The frame still works
    // for this session; it just will not survive the refresh.
  }
}

/** The board is one canvas per workspace; the project part is kept so frames
 *  saved as the whole-workspace view ("all") are still found. */
export const boardViewportKey = (workspaceId: string, projectId = "all") =>
  `board:${workspaceId}:${projectId}`;

export function rememberViewport(key: string, viewport: Viewport) {
  if (!valid(viewport)) return;
  // Re-inserted so the most recently used key is last, which is what makes
  // dropping from the front drop the least recently used.
  viewports.delete(key);
  viewports.set(key, viewport);
  while (viewports.size > limit)
    viewports.delete(viewports.keys().next().value!);
  save();
}

export function recallViewport(key: string) {
  return viewports.get(key);
}

export function forgetViewports() {
  viewports.clear();
  save();
}
