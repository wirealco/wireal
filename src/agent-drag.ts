/** Dragging an agent onto the board with the pointer rather than the
 *  browser's drag and drop. The browser's version cannot reach a card behind
 *  an open overlay, gives a faint snapshot for an image and does nothing on a
 *  touch screen; this one carries the agent's own face under the finger,
 *  lights the card it is over, and lands in it.
 *
 *  A drop target is any element with `data-agent-target` naming what it is,
 *  `task:<id>` or `workflow:<id>`; only targets that would take the agent
 *  carry it. The drop arrives as an `agentDropEvent` on window. */

export const agentDropEvent = "wireal:agent-drop";

export type AgentDrop = { target: string; agent: string; runnerId?: string };

const threshold = 5;

/** A copy of the agent's face to carry. Its gradients are renamed: the
 *  copy outlives the popover it came from, and with it the definitions its
 *  fills point at. */
function carried(face: Element): HTMLElement {
  const copy = face.cloneNode(true) as HTMLElement;
  copy.style.setProperty("--bloub-size", "44px");
  for (const defined of copy.querySelectorAll("[id]")) {
    const old = defined.id;
    const fresh = `${old}-carried`;
    defined.id = fresh;
    for (const user of copy.querySelectorAll(`[fill="url(#${old})"]`))
      user.setAttribute("fill", `url(#${fresh})`);
  }
  return copy;
}

/** Start following a pointer that went down on an agent. Nothing happens
 *  until it has moved a few pixels, so a plain click stays a click. */
export function startAgentDrag(
  down: { button: number; clientX: number; clientY: number },
  face: Element | null,
  agent: { agent: string; runnerId?: string },
  hooks: { onStart?: () => void; onEnd?: (dropped: boolean) => void } = {},
) {
  if (down.button !== 0) return;
  const startX = down.clientX;
  const startY = down.clientY;
  let ghost: HTMLElement | null = null;
  let over: Element | null = null;

  const lift = () => {
    ghost = document.createElement("div");
    ghost.className = "agent-drag-ghost";
    ghost.setAttribute("aria-hidden", "true");
    if (face) ghost.append(carried(face));
    document.body.append(ghost);
    document.documentElement.setAttribute("data-agent-dragging", "");
    hooks.onStart?.();
  };
  const place = (x: number, y: number) => {
    if (ghost) ghost.style.transform = `translate(${x}px, ${y}px)`;
  };
  const aim = (x: number, y: number) => {
    const target =
      document.elementFromPoint(x, y)?.closest("[data-agent-target]") ?? null;
    if (target === over) return;
    over?.removeAttribute("data-agent-over");
    over = target;
    over?.setAttribute("data-agent-over", "");
  };
  const finish = (dropped: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", escape);
    over?.removeAttribute("data-agent-over");
    document.documentElement.removeAttribute("data-agent-dragging");
    const left = ghost;
    if (left) {
      // Into the card it landed on, or away where it was let go.
      left.dataset.end = dropped ? "landed" : "dropped";
      window.setTimeout(() => left.remove(), 260);
    }
    if (ghost) hooks.onEnd?.(dropped);
  };
  const move = (event: PointerEvent) => {
    if (!ghost) {
      if (
        Math.hypot(event.clientX - startX, event.clientY - startY) < threshold
      )
        return;
      lift();
    }
    event.preventDefault();
    place(event.clientX, event.clientY);
    aim(event.clientX, event.clientY);
  };
  const up = (event: PointerEvent) => {
    if (!ghost) return finish(false);
    aim(event.clientX, event.clientY);
    const target = over?.getAttribute("data-agent-target");
    if (target)
      window.dispatchEvent(
        new CustomEvent<AgentDrop>(agentDropEvent, {
          detail: { target, ...agent },
        }),
      );
    finish(!!target);
  };
  const cancel = () => finish(false);
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape") finish(false);
  };
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", escape);
}

/** What a drop names: a task or a workflow, and its id. */
export function dropTarget(
  target: string,
): { kind: "task" | "workflow"; id: string } | null {
  const [kind, ...rest] = target.split(":");
  const id = rest.join(":");
  if (!id || (kind !== "task" && kind !== "workflow")) return null;
  return { kind, id };
}
