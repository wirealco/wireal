import { useSyncExternalStore } from "react";

/* One source for the phone-width layout, on the same 768px line the CSS uses,
   so components that have to swap markup (not just styling) agree with it. */
const compact = typeof window === "undefined" ? null : window.matchMedia("(max-width: 767px)");

function subscribe(onChange: () => void) {
  compact?.addEventListener("change", onChange);
  return () => compact?.removeEventListener("change", onChange);
}

export function useIsCompact() {
  return useSyncExternalStore(subscribe, () => compact?.matches ?? false, () => false);
}
