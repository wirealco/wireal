export type CanvasShortcut = "fit-view" | "arrange" | "select";

type ShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "repeat" | "shiftKey"
>;

/**
 * Single-key canvas commands. Keeping the mapping outside the board keeps its
 * keyboard handling separate from the component that renders it.
 */
export function canvasShortcut(
  event: ShortcutEvent,
  canvas: "board" | "commits",
): CanvasShortcut | null {
  if (
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return null;

  switch (event.key.toLowerCase()) {
    case "f":
      return "fit-view";
    case "a":
      return canvas === "board" ? "arrange" : null;
    case "v":
      return canvas === "board" ? "select" : null;
    default:
      return null;
  }
}

/** Canvas shortcuts should never steal letters from an editor or an overlay. */
export function isCanvasShortcutTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest(
      'input,textarea,select,[contenteditable="true"],[role="dialog"],[role="listbox"]',
    )
  );
}
