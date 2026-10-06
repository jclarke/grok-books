import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { apiGet, getApiMode } from "../api/client";
import { modeFromPath, type Mode } from "../lib/mode";
import { getSiteConfig, normalizeSiteConfig, type RawSiteConfig, type SiteConfig } from "../lib/siteConfig";
import { useSession } from "./useSession";

export const configKey = ["config"] as const;

/** GET /api/config. Never fails: a failed request yields an empty payload and the defaults. */
export function fetchConfig(mode: Mode = getApiMode()): Promise<RawSiteConfig> {
  return apiGet<RawSiteConfig>("/config", { mode }).catch(() => ({}));
}

/** The config is the same in both modes; the request names the mode on screen, like every other. */
export function useConfigQuery() {
  const mode = modeFromPath(useLocation().pathname);
  return useQuery({ queryKey: configKey, queryFn: () => fetchConfig(mode), staleTime: 5 * 60_000 });
}

/**
 * The site config with defaults filled in. Businesses fall back to the
 * session's slugs (labelled by slug) when the payload has none.
 */
export function useConfig(): SiteConfig {
  const { data: raw, isSuccess } = useConfigQuery();
  const { data: session } = useSession();
  return useMemo(() => (isSuccess ? normalizeSiteConfig(raw, session) : getSiteConfig()), [isSuccess, raw, session]);
}
