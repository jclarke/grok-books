/**
 * Site configuration from GET /api/config: product and company names, the
 * businesses (labels, tones, colors), feature flags, and account names used
 * in copy. Label helpers are plain functions used everywhere, so the loaded
 * config also lives in a small module-level registry (applySiteConfig).
 */
import type { Session } from "../api/types";

export type BusinessTone = "brand" | "info" | "neutral" | "warn" | "pos" | "neg" | "violet";

export interface BusinessConfig {
  slug: string;
  label: string;
  kind: string;
  color: string | null;
  color_dark: string | null;
  tone: BusinessTone;
  revenue_category: string | null;
}

export interface AccountConfig {
  id: string;
  short_name: string;
  label: string;
  type: string;
  roles: string[];
}

export interface BankSide {
  gateway: string;
  label: string;
  /** Optional full clause; when absent the UI derives one from the label. */
  description?: string;
}

export interface SiteFeatures {
  whmcs: boolean;
  margins: boolean;
  /** Business / personal mode installed (features.business / features.personal). At least one is on. */
  business: boolean;
  personal: boolean;
}

export interface SiteConfig {
  product: string;
  company: string;
  wordmark: string;
  features: SiteFeatures;
  businesses: BusinessConfig[];
  default_business: string;
  accounts: AccountConfig[];
  operating_account: AccountConfig | null;
  whmcs_brands: string[];
  whmcs_bank_sides: BankSide[];
}

/** The raw /api/config payload; every key may be missing. */
export type RawSiteConfig = Partial<Omit<SiteConfig, "features" | "businesses">> & {
  ok?: boolean;
  features?: Partial<SiteFeatures>;
  businesses?: Partial<BusinessConfig>[];
};

const SLUG = /^[a-z0-9_]+$/;
const COLOR = /^#[0-9a-fA-F]{3,8}$/;
const TONES: BusinessTone[] = ["brand", "info", "neutral", "warn", "pos", "neg", "violet"];

export function isSafeSlug(slug: unknown): slug is string {
  return typeof slug === "string" && SLUG.test(slug);
}

export function isSafeColor(color: unknown): color is string {
  return typeof color === "string" && COLOR.test(color);
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function normalizeAccount(raw: unknown): AccountConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<AccountConfig>;
  const shortName = str(row.short_name, "");
  if (!shortName && !row.label) return null;
  return {
    id: str(row.id, ""),
    short_name: shortName || str(row.label, ""),
    label: str(row.label, shortName),
    type: str(row.type, ""),
    roles: Array.isArray(row.roles) ? row.roles.filter((role): role is string => typeof role === "string") : [],
  };
}

/** Fill every missing key with a sane default. Businesses fall back to the session's slugs. */
export function normalizeSiteConfig(raw: RawSiteConfig | null | undefined, session?: Pick<Session, "businesses"> | null): SiteConfig {
  const cfg: RawSiteConfig = raw && typeof raw === "object" ? raw : {};
  const product = str(cfg.product, "Books");
  const wordmark = str(cfg.wordmark, product);
  const personal = cfg.features?.personal !== false;
  const features: SiteFeatures = {
    whmcs: cfg.features?.whmcs === true,
    margins: cfg.features?.whmcs === true && cfg.features?.margins === true,
    // Both off is rejected by the server; if it ever arrives, business wins.
    business: cfg.features?.business !== false || !personal,
    personal,
  };

  let businesses: BusinessConfig[] = [];
  if (Array.isArray(cfg.businesses)) {
    for (const row of cfg.businesses) {
      if (!row || !isSafeSlug(row.slug) || row.slug === "all") continue;
      businesses.push({
        slug: row.slug,
        label: str(row.label, row.slug),
        kind: str(row.kind, ""),
        color: isSafeColor(row.color) ? row.color : null,
        color_dark: isSafeColor(row.color_dark) ? row.color_dark : isSafeColor(row.color) ? row.color : null,
        tone: TONES.includes(row.tone as BusinessTone) ? (row.tone as BusinessTone) : "neutral",
        revenue_category: typeof row.revenue_category === "string" ? row.revenue_category : null,
      });
    }
  }
  if (businesses.length === 0 && session?.businesses) {
    businesses = session.businesses
      .filter((slug) => slug !== "all" && isSafeSlug(slug))
      .map((slug) => ({ slug, label: slug, kind: "", color: null, color_dark: null, tone: "neutral" as BusinessTone, revenue_category: null }));
  }
  const slugs = businesses.map((row) => row.slug);
  const defaultBusiness =
    typeof cfg.default_business === "string" && slugs.includes(cfg.default_business)
      ? cfg.default_business
      : slugs.includes("general") || slugs.length === 0
        ? "general"
        : slugs[slugs.length - 1];

  const accounts = Array.isArray(cfg.accounts) ? cfg.accounts.map(normalizeAccount).filter((row): row is AccountConfig => row !== null) : [];
  const brands = features.whmcs && Array.isArray(cfg.whmcs_brands) ? cfg.whmcs_brands.filter((brand): brand is string => typeof brand === "string" && brand.length > 0) : [];
  const sides = features.whmcs && Array.isArray(cfg.whmcs_bank_sides)
    ? cfg.whmcs_bank_sides.filter((side): side is BankSide => Boolean(side) && typeof side.gateway === "string" && typeof side.label === "string")
    : [];

  return {
    product,
    company: str(cfg.company, "My Business"),
    wordmark,
    features,
    businesses,
    default_business: defaultBusiness,
    accounts,
    operating_account: normalizeAccount(cfg.operating_account),
    whmcs_brands: brands,
    whmcs_bank_sides: sides,
  };
}

/** True once the signed-in keys (businesses and friends) are in the payload. */
export function hasDetail(raw: RawSiteConfig | null | undefined): boolean {
  return Boolean(raw && Array.isArray(raw.businesses));
}

// --- Registry -------------------------------------------------------------

let current: SiteConfig = normalizeSiteConfig(null);

export function getSiteConfig(): SiteConfig {
  return current;
}

/** Make this config the one label helpers, nav, and colors use. Idempotent. */
export function applySiteConfig(cfg: SiteConfig): void {
  current = cfg;
  if (typeof document !== "undefined") {
    injectBusinessStyles(cfg.businesses);
    applyFavicon(cfg.wordmark);
  }
}

export function businessSlugs(): string[] {
  return current.businesses.map((row) => row.slug);
}

export function businessConfig(slug: string): BusinessConfig | undefined {
  return current.businesses.find((row) => row.slug === slug);
}

export function defaultBusiness(): string {
  return current.default_business;
}

/** The category classify controls start on: "Office/Other" when the site has it, else its last operating expense. */
export function fallbackCategory(session: Pick<Session, "categories" | "category_groups">): string {
  if (session.categories.includes("Office/Other")) return "Office/Other";
  const opex = session.category_groups?.opex ?? [];
  return opex[opex.length - 1] ?? "Uncategorized";
}

// --- Text helpers ---------------------------------------------------------

/** "A", "A and B", "A, B, and C". */
export function joinList(items: string[], conjunction = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items[items.length - 1]}`;
}

/** The part of the product name after the wordmark ("Acme Shop Books" − "Acme Shop" → "Books"). */
export function productSuffix(product: string, wordmark: string): string {
  if (product === wordmark || !product.startsWith(wordmark)) return "";
  return product.slice(wordmark.length).trim();
}

/** How a WHMCS gateway is named in copy. */
const GATEWAY_NAMES: Record<string, string> = {
  paypal: "PayPal",
  litle: "litle (cards)",
};

/**
 * One clause per bank side, derived from its label unless the payload gives a
 * description: "Processor settlements (A, B)" → "<gateway> compares to
 * Processor settlements from A and B, which settle on their own schedule";
 * "PayPal account, …" → "<gateway> compares to the PayPal account".
 */
export function bankSideClause(side: BankSide): string {
  if (side.description) return side.description;
  const gateway = GATEWAY_NAMES[side.gateway] ?? side.gateway;
  const label = side.label.trim();
  const processors = label.match(/^(.*?)\s*\(([^)]+)\)$/);
  if (processors) {
    const names = processors[2].split(",").map((name) => name.trim()).filter(Boolean);
    return `${gateway} compares to ${processors[1]} from ${joinList(names)}, which settle on their own schedule`;
  }
  const head = label.split(",")[0].trim();
  return `${gateway} compares to the ${head}`;
}

export function gatewaysSubtitle(sides: BankSide[]): string {
  if (sides.length === 0) return "WHMCS totals for every gateway. No gateway has a bank side in the books.";
  return `WHMCS totals for every gateway. ${sides.map(bankSideClause).join("; ")}. Other gateways have no bank side.`;
}

// --- Runtime styles -------------------------------------------------------

const STYLE_ID = "site-config-businesses";
/* Same selectors tokens.css uses for its dark values. */
const DARK_MEDIA = "@media (prefers-color-scheme: dark)";
const DARK_AUTO = ':root:not([data-theme="light"])';
const DARK_PINNED = ':root[data-theme="dark"]';

export function businessStyleText(businesses: BusinessConfig[]): string {
  const safe = businesses.filter((row) => isSafeSlug(row.slug));
  const light: string[] = [];
  const dark: string[] = [];
  for (const row of safe) {
    if (isSafeColor(row.color)) light.push(`  --biz-${row.slug}: ${row.color};`);
    const darkColor = isSafeColor(row.color_dark) ? row.color_dark : isSafeColor(row.color) ? row.color : null;
    if (darkColor) dark.push(`--biz-${row.slug}: ${darkColor};`);
  }
  const parts: string[] = [];
  if (light.length) parts.push(`:root {\n${light.join("\n")}\n}`);
  if (dark.length) {
    parts.push(`${DARK_MEDIA} {\n  ${DARK_AUTO} {\n${dark.map((line) => `    ${line}`).join("\n")}\n  }\n}`);
    parts.push(`${DARK_PINNED} {\n${dark.map((line) => `  ${line}`).join("\n")}\n}`);
  }
  for (const row of safe) {
    if (isSafeColor(row.color)) parts.push(`.tone-biz-${row.slug} { --tone: var(--biz-${row.slug}); }`);
  }
  return parts.join("\n");
}

function injectBusinessStyles(businesses: BusinessConfig[]): void {
  const text = businessStyleText(businesses);
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  if (style.textContent !== text) style.textContent = text;
}

/** The first letter of the wordmark; "H" keeps the drawn glyph. */
export function markLetter(wordmark: string): string {
  const match = wordmark.match(/[\p{L}\p{N}]/u);
  return (match ? match[0] : "B").toUpperCase();
}

let originalFavicon: string | null = null;

function applyFavicon(wordmark: string): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  if (originalFavicon === null) originalFavicon = link.getAttribute("href") ?? "";
  const letter = markLetter(wordmark);
  if (letter === "H") {
    if (link.getAttribute("href") !== originalFavicon) link.setAttribute("href", originalFavicon);
    return;
  }
  const escaped = letter.replace(/[<>&"']/g, "");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="#0f766e"/>` +
    `<text x="32" y="33" text-anchor="middle" dominant-baseline="central" font-family="ui-sans-serif, system-ui, sans-serif" font-size="34" font-weight="700" fill="#fff">${escaped}</text>` +
    `<path d="M14 52h36" stroke="#5eead4" stroke-width="4" stroke-linecap="round"/>` +
    `</svg>`;
  const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);
}
