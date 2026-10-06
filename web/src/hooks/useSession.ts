import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { apiGet, getApiMode, setCsrfToken } from "../api/client";
import type { Session } from "../api/types";
import { modeFromPath, type Mode } from "../lib/mode";

export const sessionKey = ["session"] as const;

/** The books shell is available on loopback, and on a tailnet host after sign-in. */
export function sessionReady(session: Partial<Session> | undefined): session is Session {
  if (!session) return false;
  if (session.requires_login && !session.authenticated) return false;
  return typeof session.today === "string" && typeof session.csrf_token === "string";
}

export function fetchSession(mode: Mode = getApiMode()): Promise<Session> {
  return apiGet<Session>("/session", { mode }).then((session) => {
    setCsrfToken(session.csrf_token);
    return session;
  });
}

/** Session and reference data for the mode on screen (accounts, months, and review count differ by mode). */
export function useSession() {
  const mode = modeFromPath(useLocation().pathname);
  return useQuery({ queryKey: [...sessionKey, mode], queryFn: () => fetchSession(mode), staleTime: 60_000 });
}

/** Session data for components rendered inside the shell (which waits for it). */
export function useSessionData(): Session {
  const { data } = useSession();
  if (!data) throw new Error("session is not loaded");
  return data;
}
