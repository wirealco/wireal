import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ActivityAgentBrand } from "./activity-author";

type PointerPosition = { x: number; y: number } | null;
/** A face reads where it sits and hands back the write that moves it. Every
 *  face reads before any face writes, so a board of them costs one layout a
 *  frame instead of one per face. */
type PointerSubscriber = (position: PointerPosition) => (() => void) | void;

const pointerSubscribers = new Set<PointerSubscriber>();
let pointerFrame = 0;
let pendingPointer: PointerPosition = null;

function publishPointer() {
  pointerFrame = 0;
  const writes: (() => void)[] = [];
  pointerSubscribers.forEach((subscriber) => {
    const write = subscriber(pendingPointer);
    if (write) writes.push(write);
  });
  writes.forEach((write) => write());
}

function trackPointer(event: PointerEvent) {
  if (event.pointerType === "touch") return;
  pendingPointer = { x: event.clientX, y: event.clientY };
  if (!pointerFrame) pointerFrame = requestAnimationFrame(publishPointer);
}

function clearPointer() {
  pendingPointer = null;
  if (!pointerFrame) pointerFrame = requestAnimationFrame(publishPointer);
}

function subscribeToPointer(subscriber: PointerSubscriber) {
  pointerSubscribers.add(subscriber);
  if (pointerSubscribers.size === 1) {
    window.addEventListener("pointermove", trackPointer, { passive: true });
    window.addEventListener("blur", clearPointer);
    document.documentElement.addEventListener("pointerleave", clearPointer);
  }
  if (pendingPointer) subscriber(pendingPointer)?.();

  return () => {
    pointerSubscribers.delete(subscriber);
    if (pointerSubscribers.size === 0) {
      window.removeEventListener("pointermove", trackPointer);
      window.removeEventListener("blur", clearPointer);
      document.documentElement.removeEventListener(
        "pointerleave",
        clearPointer,
      );
      if (pointerFrame) cancelAnimationFrame(pointerFrame);
      pointerFrame = 0;
      pendingPointer = null;
    }
  };
}

/* The board stills every face while it is zoomed out or crowded: dozens of
   blinking, eye-following faces too small to read cost frames for nothing. */
let calm = false;
const calmSubscribers = new Set<() => void>();
export function setBloubsCalm(next: boolean) {
  if (next === calm) return;
  calm = next;
  // The board's own looping motion (lit wires, the pulse round a working
  // agent) stills with the faces.
  document.documentElement.toggleAttribute("data-board-calm", next);
  calmSubscribers.forEach((notify) => notify());
}
function useBloubsCalm(): boolean {
  return useSyncExternalStore(
    (notify) => {
      calmSubscribers.add(notify);
      return () => calmSubscribers.delete(notify);
    },
    () => calm,
    () => false,
  );
}

const palette = {
  chatgpt: { start: "#FFFFFF", end: "#E4E4E7", glow: "#FFFFFF" },
  claude: { start: "#F09A72", end: "#C96543", glow: "#F6B394" },
  codex: { start: "#34353A", end: "#08090B", glow: "#777A83" },
  agent: { start: "#8578F5", end: "#5341C9", glow: "#A99FFF" },
  guide: { start: "#FAFAFA", end: "#D4D4D8", glow: "#FFFFFF" },
} as const;

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

/** Compact React adaptation of Jérémy Perret's Bloub SVG avatar concept. */
export function ActivityBloub({
  brand,
  label,
  ariaLabel,
  delay = 0,
}: {
  brand: ActivityAgentBrand | "guide" | null;
  label: string;
  ariaLabel?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  const calmed = useBloubsCalm();
  const reducedMotion = reduced || calmed;
  const gradientId = `activity-bloub-${useId().replace(/:/g, "")}`;
  const colors = palette[brand ?? "agent"];
  const begin = `${-Math.abs(delay)}s`;
  const svgRef = useRef<SVGSVGElement>(null);
  const faceRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (reducedMotion) {
      faceRef.current?.setAttribute("transform", "translate(0 0)");
      return;
    }

    return subscribeToPointer((pointer) => {
      const svg = svgRef.current;
      const face = faceRef.current;
      if (!svg || !face) return;

      if (!pointer)
        return () => face.setAttribute("transform", "translate(0 0)");

      const bounds = svg.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const dx = Math.max(
        -1,
        Math.min(1, (pointer.x - (bounds.left + bounds.width / 2)) / 180),
      );
      const dy = Math.max(
        -1,
        Math.min(1, (pointer.y - (bounds.top + bounds.height / 2)) / 180),
      );
      const moved = `translate(${(dx * 7).toFixed(2)} ${(dy * 5).toFixed(2)})`;
      return () => face.setAttribute("transform", moved);
    });
  }, [reducedMotion]);

  return (
    <svg
      ref={svgRef}
      aria-label={ariaLabel ?? `${label} agent`}
      className="activity-bloub"
      data-brand={brand ?? "agent"}
      role="img"
      viewBox="0 0 100 100"
    >
      <defs>
        <radialGradient id={gradientId} cx="35%" cy="27%" r="76%">
          <stop offset="0" stopColor={colors.glow} />
          <stop offset="0.52" stopColor={colors.start} />
          <stop offset="1" stopColor={colors.end} />
        </radialGradient>
      </defs>

      <g className="activity-bloub__body">
        <circle
          cx="50"
          cy="50"
          r="49"
          fill={`url(#${gradientId})`}
          stroke="currentColor"
          strokeOpacity="0.18"
          strokeWidth="1"
        />

        <g ref={faceRef} className="activity-bloub__face">
          <ellipse
            cx="38"
            cy="48"
            rx="5.3"
            ry="10.5"
            transform="rotate(-12 38 48)"
          >
            {!reducedMotion && (
              <>
                <animate
                  attributeName="cx"
                  begin={begin}
                  dur="4.8s"
                  repeatCount="indefinite"
                  values="38;41;36;38"
                />
                <animate
                  attributeName="cy"
                  begin={begin}
                  dur="4.8s"
                  repeatCount="indefinite"
                  values="48;46;51;48"
                />
                <animate
                  attributeName="ry"
                  begin={begin}
                  dur="4.8s"
                  keyTimes="0;0.42;0.45;0.49;0.52;1"
                  repeatCount="indefinite"
                  values="10.5;10.5;1.2;1.2;10.5;10.5"
                />
              </>
            )}
          </ellipse>
          <ellipse
            cx="61"
            cy="46"
            rx="5.3"
            ry="10.5"
            transform="rotate(-12 61 46)"
          >
            {!reducedMotion && (
              <>
                <animate
                  attributeName="cx"
                  begin={begin}
                  dur="4.8s"
                  repeatCount="indefinite"
                  values="61;64;59;61"
                />
                <animate
                  attributeName="cy"
                  begin={begin}
                  dur="4.8s"
                  repeatCount="indefinite"
                  values="46;44;49;46"
                />
                <animate
                  attributeName="ry"
                  begin={begin}
                  dur="4.8s"
                  keyTimes="0;0.42;0.45;0.49;0.52;1"
                  repeatCount="indefinite"
                  values="10.5;10.5;1.2;1.2;10.5;10.5"
                />
              </>
            )}
          </ellipse>
        </g>
      </g>
    </svg>
  );
}
