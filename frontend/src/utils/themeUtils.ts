export const THEME_STORAGE_KEY = "Tradonova-theme";

export type AppTheme = "light" | "dark";

/** Read the stored theme preference from localStorage. */
export function getStoredTheme(): AppTheme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" ? "light" : "dark";
}

/**
 * Apply a theme:
 * 1. Persists to localStorage.
 * 2. Sets `data-theme` attribute on `<html>` so `[data-theme="light"]` CSS rules work.
 * 3. Dispatches a `theme-change` event so Header and other listeners can re-render.
 */
export function applyTheme(theme: AppTheme): void {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  document.documentElement.setAttribute("data-theme", theme);
  window.dispatchEvent(new CustomEvent("theme-change"));
}

/**
 * Call once on app boot to initialise the `data-theme` attribute from storage
 * before React renders (avoids flash of wrong theme).
 */
export function initTheme(): void {
  document.documentElement.setAttribute("data-theme", getStoredTheme());
}
