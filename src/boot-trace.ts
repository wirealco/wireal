const started =
  typeof performance === "undefined" ? Date.now() : performance.now();
let beating = 0;
let on: boolean | undefined;

export function tracing(): boolean {
  if (on !== undefined) return on;
  try {
    on =
      new URLSearchParams(location.search).has("trace") ||
      localStorage.getItem("wireal.trace") === "on";
  } catch {
    on = false;
  }
  return on;
}

export function trace(label: string, detail?: unknown): void {
  if (!tracing()) return;
  const at = Math.round(
    (typeof performance === "undefined" ? Date.now() : performance.now()) -
      started,
  );
  if (detail === undefined) console.log(`[wireal +${at}ms] ${label}`);
  else console.log(`[wireal +${at}ms] ${label}`, detail);
}

const last = new Map<string, string>();
export function traceChange(label: string, detail: unknown): void {
  if (!tracing()) return;
  const written = JSON.stringify(detail);
  if (last.get(label) === written) return;
  last.set(label, written);
  trace(label, detail);
}

export function heartbeat(): void {
  if (!tracing() || beating) return;
  beating = window.setInterval(() => {
    trace("tick", {
      cards: document.querySelectorAll(".task-card").length,
      nodes: document.querySelectorAll(".react-flow__node").length,
      canvases: document.querySelectorAll("canvas").length,
      images: document.querySelectorAll("img").length,
    });
  }, 250);
}
