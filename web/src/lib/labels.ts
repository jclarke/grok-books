import { getSiteConfig } from "./siteConfig";

/** Labels that do not depend on the configured businesses. */
const FIXED_BUSINESS_LABELS: Record<string, string> = {
  all: "All businesses",
};

/** System tags; the business tags come from the site config. */
const SYSTEM_TAG_LABELS: Record<string, string> = {
  owner_draw: "Owner draw",
  transfer: "Transfer",
  needs_review: "Needs review",
};

export type Tone = "brand" | "info" | "neutral" | "warn" | "pos" | "neg" | "violet";

const SYSTEM_TAG_TONES: Record<string, Tone> = {
  owner_draw: "info",
  transfer: "neutral",
  needs_review: "warn",
};

/** "all" first, then each configured business, in config order. */
export function businessLabels(): Record<string, string> {
  const labels: Record<string, string> = { ...FIXED_BUSINESS_LABELS };
  for (const row of getSiteConfig().businesses) labels[row.slug] = row.label;
  return labels;
}

export function tagLabels(): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const row of getSiteConfig().businesses) labels[row.slug] = row.label;
  return { ...labels, ...SYSTEM_TAG_LABELS };
}

export function tagTone(tag: string | null | undefined): Tone {
  if (!tag) return "neutral";
  const business = getSiteConfig().businesses.find((row) => row.slug === tag);
  if (business) return business.tone;
  return SYSTEM_TAG_TONES[tag] ?? "neutral";
}

export function tagLabel(tag: string | null | undefined): string {
  if (!tag) return "Needs review";
  return tagLabels()[tag] ?? tag;
}

export function businessLabel(business: string): string {
  return businessLabels()[business] ?? business;
}

export const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  rule: "Rule",
  seed: "Seed",
  agent: "Agent",
};

/** Owner draw and transfer always carry a fixed category. */
export function lockedCategory(tag: string): string | null {
  if (tag === "owner_draw") return "Owner Draw";
  if (tag === "transfer") return "Transfer";
  return null;
}
