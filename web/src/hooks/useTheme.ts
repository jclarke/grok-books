import { useCallback, useEffect, useState } from "react";
import { useMediaQuery } from "./useMediaQuery";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "hpb-theme";

function readChoice(): ThemeChoice {
  try {
    const saved = window.localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const resolved: "light" | "dark" = choice === "system" ? (prefersDark ? "dark" : "light") : choice;

  useEffect(() => {
    const root = document.documentElement;
    if (choice === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);
    try {
      if (choice === "system") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, choice);
    } catch {
      /* storage unavailable */
    }
  }, [choice]);

  const toggle = useCallback(() => setChoice(resolved === "dark" ? "light" : "dark"), [resolved]);
  return { choice, resolved, setChoice, toggle };
}
