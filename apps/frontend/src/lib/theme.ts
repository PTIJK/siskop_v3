import { useSyncExternalStore } from "react";

export type ThemeChoice = "light" | "dark";

const KEY = "siskop.theme";
const listeners = new Set<() => void>();

function storedTheme(): ThemeChoice | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

/** Saved choice, else the OS preference. */
export function resolveTheme(): ThemeChoice {
  const saved = storedTheme();
  if (saved) return saved;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: ThemeChoice): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

export function setTheme(theme: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage can be blocked; the choice then lasts for this page view only.
  }
  applyTheme(theme);
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

function currentTheme(): ThemeChoice {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useTheme(): { theme: ThemeChoice; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light" as ThemeChoice);
  return { theme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}
