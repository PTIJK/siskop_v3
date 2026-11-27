import { useSyncExternalStore } from "react";

export type ThemeChoice = "light" | "dark";

const KEY = "siskop.theme";
const listeners = new Set<() => void>();
const darkPreference = "(prefers-color-scheme: dark)";
let temporaryChoice: ThemeChoice | null = null;

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
  const saved = temporaryChoice ?? storedTheme();
  if (saved) return saved;
  return typeof window !== "undefined" && window.matchMedia?.(darkPreference).matches ? "dark" : "light";
}

export function applyTheme(theme: ThemeChoice): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

// Marketing and sign-in pages are always light. Keep in sync with public/theme-init.js.
const MARKETING = /^\/(?:$|login|register|checkout|mitra)/;

/** Applies the theme a route should show and tells useTheme() subscribers. */
export function syncRouteTheme(pathname: string): void {
  applyTheme(MARKETING.test(pathname) ? "light" : resolveTheme());
  listeners.forEach((notify) => notify());
}

export function setTheme(theme: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, theme);
    temporaryChoice = null;
  } catch {
    temporaryChoice = theme;
  }
  applyTheme(theme);
  listeners.forEach((notify) => notify());
}

export function followSystemTheme(): void {
  window.matchMedia?.(darkPreference).addEventListener?.("change", () => {
    if (temporaryChoice || storedTheme()) return;
    syncRouteTheme(window.location.pathname);
  });
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
