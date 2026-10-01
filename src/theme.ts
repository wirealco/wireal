import { useLayoutEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

const THEME_KEY = "wireal.theme";

function savedPreference(): ThemePreference {
  const value = localStorage.getItem(THEME_KEY);
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function useThemePreference() {
  const [preference, setPreference] =
    useState<ThemePreference>(savedPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    preference === "system" ? systemTheme() : preference,
  );

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const next =
        preference === "system"
          ? media.matches
            ? "dark"
            : "light"
          : preference;
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      // iOS paints the status bar band and the strip behind the bottom toolbar
      // from this, so it is HeroUI's --background resolved to sRGB — anything
      // else is a seam at the top and bottom of every page.
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", next === "dark" ? "#060607" : "#f5f5f5");
      setResolved(next);
    };

    localStorage.setItem(THEME_KEY, preference);
    apply();
    if (preference === "system") media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);

  return { preference, resolved, setPreference };
}
