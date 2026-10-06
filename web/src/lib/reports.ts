import type { IconName } from "../components/Icon";
import { getSiteConfig, joinList } from "./siteConfig";

export interface ReportInfo {
  slug: string;
  title: string;
  description: string;
  icon: IconName;
  usesBusiness: boolean;
  hasLimit?: boolean;
}

export const REPORTS: ReportInfo[] = [
  { slug: "pnl", title: "Profit & Loss", description: "Income statement by month or for the whole range, compared with the prior period. Click any line to see its transactions.", icon: "reports", usesBusiness: true },
  { slug: "pnl-by-business", title: "P&L by business", description: "", icon: "dashboard", usesBusiness: false },
  { slug: "cash-flow", title: "Cash flow", description: "Money in and out by month and account, without transfers between accounts.", icon: "cash", usesBusiness: true },
  { slug: "expenses-by-vendor", title: "Expenses by vendor", description: "Top merchants by spend for the dates you pick.", icon: "vendors", usesBusiness: true, hasLimit: true },
  { slug: "owner-draws", title: "Owner draws", description: "Money taken out by the owner. Shown below the line, never as an expense.", icon: "arrowRight", usesBusiness: false },
  { slug: "schedule-c", title: "Schedule C-style summary", description: "Year-end lines in Schedule C order. A bookkeeping aid, not a tax return.", icon: "audit", usesBusiness: true },
];

/** "Shop, Consulting, and General side by side." from the configured businesses. */
function byBusinessDescription(): string {
  const labels = getSiteConfig().businesses.map((row) => row.label);
  return labels.length ? `${joinList(labels)} side by side.` : "Every business side by side.";
}

/** The report list with descriptions that depend on the site config filled in. */
export function reportList(): ReportInfo[] {
  return REPORTS.map((report) => (report.slug === "pnl-by-business" ? { ...report, description: byBusinessDescription() } : report));
}

export function reportInfo(slug: string): ReportInfo | undefined {
  return reportList().find((report) => report.slug === slug);
}
