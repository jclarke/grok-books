import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { applySiteConfig, normalizeSiteConfig } from "../lib/siteConfig";
import { session, siteConfig } from "./fixtures";

// Components rendered outside the shell read labels and flags from the registry; start each test with the owner's config.
beforeEach(() => {
  applySiteConfig(normalizeSiteConfig(siteConfig, session));
});
