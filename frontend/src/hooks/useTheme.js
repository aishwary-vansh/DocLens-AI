/**
 * useTheme
 * App theme preference: "dark" (default), "light" or "system". The resolved
 * theme is written to <html data-theme="…"> (styles/theme-light.css reads it)
 * and the preference is remembered per browser in localStorage.
 */
import { useCallback, useEffect, useState } from "react";

const KEY = "doclens_theme";
const EVENT = "doclens-theme-change"; // keeps every useTheme() instance in sync
const media = () => window.matchMedia?.("(prefers-color-scheme: light)");

function readPreference() {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "system" ? value : "dark";
  } catch {
    return "dark";
  }
}

function resolve(preference) {
  if (preference === "system") return media()?.matches ? "light" : "dark";
  return preference;
}

/** Apply the saved theme before React renders (avoids a flash of the wrong theme). */
export function applyStoredTheme() {
  document.documentElement.dataset.theme = resolve(readPreference());
}

export default function useTheme() {
  const [preference, setPreferenceState] = useState(readPreference);
  const [resolved, setResolved] = useState(() => resolve(readPreference()));

  useEffect(() => {
    const apply = () => {
      const next = resolve(preference);
      document.documentElement.dataset.theme = next;
      setResolved(next);
    };
    apply();
    if (preference !== "system") return undefined;
    const query = media();
    query?.addEventListener?.("change", apply);
    return () => query?.removeEventListener?.("change", apply);
  }, [preference]);

  useEffect(() => {
    const onChange = (event) => setPreferenceState(event.detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  const setPreference = useCallback((value) => {
    try { localStorage.setItem(KEY, value); } catch { /* storage unavailable */ }
    setPreferenceState(value);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
  }, []);

  const toggle = useCallback(() => setPreference(resolved === "dark" ? "light" : "dark"), [resolved, setPreference]);

  return { preference, resolved, setPreference, toggle };
}
