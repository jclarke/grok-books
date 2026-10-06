import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { setApiMode } from "../api/client";
import { counterpartPath, counterpartSearch, modeFromPath, storeMode, type Mode } from "../lib/mode";

/** The current mode (from the path) and a switch that keeps the date range. */
export function useMode(): { mode: Mode; switchMode: (next: Mode) => void } {
  const location = useLocation();
  const navigate = useNavigate();
  const mode = modeFromPath(location.pathname);
  // Shared API routes (session, search, audit) answer for the mode on screen.
  setApiMode(mode);
  const switchMode = useCallback(
    (next: Mode) => {
      storeMode(next);
      if (next === modeFromPath(location.pathname)) return;
      navigate(`${counterpartPath(location.pathname, next)}${counterpartSearch(location.search, next)}`);
    },
    [location.pathname, location.search, navigate],
  );
  return { mode, switchMode };
}
