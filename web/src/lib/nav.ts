import type { IconName } from "../components/Icon";

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Shown in the phone bottom bar. */
  primary?: boolean;
  badge?: "review";
  /** Sidebar heading this item sits under. */
  section?: string;
  /** Active only on this exact path, not its children. */
  exact?: boolean;
  /** Label in the command palette when the sidebar label needs its section for context. */
  paletteLabel?: string;
  /** Feature flags (from the site config) that must all be on for this item and its route. */
  requires?: Feature[];
}

export type Feature = "whmcs" | "margins";
export type Features = Record<Feature, boolean>;

export const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "dashboard", primary: true },
  { to: "/transactions", label: "Transactions", icon: "transactions", primary: true },
  { to: "/accounts", label: "Accounts", icon: "accounts" },
  { to: "/reports", label: "Reports", icon: "reports", primary: true },
  { to: "/vendors", label: "Vendors", icon: "vendors" },
  { to: "/review", label: "Review", icon: "review", badge: "review", primary: true },
  { to: "/calendar", label: "Calendar & bills", icon: "calendar" },
  { to: "/rules", label: "Rules", icon: "rules" },
  { to: "/audit", label: "Audit log", icon: "audit" },
  { to: "/settings", label: "Settings", icon: "settings" },
  { to: "/whmcs", label: "Billing overview", icon: "server", section: "WHMCS", requires: ["whmcs"], exact: true, paletteLabel: "WHMCS billing overview" },
  { to: "/whmcs/revenue", label: "Revenue", icon: "reports", section: "WHMCS", requires: ["whmcs"], paletteLabel: "WHMCS revenue by brand and plan" },
  { to: "/whmcs/mrr", label: "MRR & ARR", icon: "trendingUp", section: "WHMCS", requires: ["whmcs"], paletteLabel: "WHMCS MRR & ARR" },
  { to: "/whmcs/churn", label: "Churn", icon: "trendingDown", section: "WHMCS", requires: ["whmcs"], paletteLabel: "WHMCS churn and cancellations" },
  { to: "/whmcs/refunds", label: "Refunds", icon: "undo", section: "WHMCS", requires: ["whmcs"], paletteLabel: "WHMCS refunds" },
  { to: "/whmcs/collections", label: "Collections", icon: "alert", section: "WHMCS", requires: ["whmcs"], paletteLabel: "WHMCS failed payments and collections" },
  { to: "/whmcs/reconciliation", label: "PayPal reconciliation", icon: "scale", section: "WHMCS", requires: ["whmcs"], paletteLabel: "WHMCS PayPal reconciliation" },
  { to: "/whmcs/margins", label: "Server margins", icon: "server", section: "WHMCS", requires: ["whmcs", "margins"], paletteLabel: "WHMCS server margins" },
  { to: "/whmcs/customers", label: "Customers", icon: "users", section: "WHMCS", requires: ["whmcs"], paletteLabel: "WHMCS customer lookup" },
];

/** Personal mode navigation. The business list above is unchanged. */
export const PERSONAL_NAV: NavItem[] = [
  { to: "/personal", label: "Dashboard", icon: "dashboard", primary: true, exact: true, paletteLabel: "Personal dashboard" },
  { to: "/personal/net-worth", label: "Net worth", icon: "wallet" },
  { to: "/personal/accounts", label: "Accounts", icon: "accounts", paletteLabel: "Personal accounts" },
  { to: "/personal/transactions", label: "Transactions", icon: "transactions", primary: true, paletteLabel: "Personal transactions" },
  { to: "/personal/spending", label: "Spending", icon: "pie" },
  { to: "/personal/cash-flow", label: "Cash flow", icon: "trendingUp" },
  { to: "/personal/budgets", label: "Budgets", icon: "target", primary: true },
  { to: "/personal/recurring", label: "Recurring", icon: "repeat", paletteLabel: "Recurring and subscriptions" },
  { to: "/personal/bills", label: "Bills", icon: "calendar", paletteLabel: "Upcoming bills" },
  { to: "/personal/goals", label: "Goals", icon: "bookmark" },
  { to: "/personal/debt-payoff", label: "Debt payoff", icon: "trendingDown", paletteLabel: "Debt payoff and consolidation what-if" },
  { to: "/personal/review-month", label: "Monthly summary", icon: "fileText" },
  { to: "/personal/review", label: "Review", icon: "review", badge: "review", primary: true, paletteLabel: "Personal review queue" },
  { to: "/personal/categories", label: "Categories & rules", icon: "tag" },
  { to: "/personal/settings", label: "Settings", icon: "settings", paletteLabel: "Personal settings and accounts" },
];

export function featureOn(item: Pick<NavItem, "requires">, features: Features): boolean {
  return (item.requires ?? []).every((feature) => features[feature]);
}

/** The navigation for a mode, without items whose features are off. */
export function navFor(mode: "business" | "personal", features: Features): NavItem[] {
  return (mode === "personal" ? PERSONAL_NAV : NAV).filter((item) => featureOn(item, features));
}

/** Feature-gated route prefixes; the most specific match decides. */
const ROUTE_FEATURES: { prefix: string; requires: Feature[] }[] = [
  { prefix: "/whmcs/margins", requires: ["whmcs", "margins"] },
  { prefix: "/whmcs", requires: ["whmcs"] },
];

export function routeEnabled(pathname: string, features: Features): boolean {
  const rule = ROUTE_FEATURES.find((item) => pathname === item.prefix || pathname.startsWith(item.prefix + "/"));
  return rule ? featureOn(rule, features) : true;
}

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.to === "/" || item.exact) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(item.to + "/");
}
