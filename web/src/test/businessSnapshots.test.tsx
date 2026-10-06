import { screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { Icon, type IconName } from "../components/Icon";
import { CHECKING } from "./fixtures";
import { mockApi } from "./mockApi";
import { renderApp } from "./render";

/**
 * Business pages, main content only. These snapshots were written from the
 * UI before personal mode existed; they must not change. React ids are
 * normalized because they count every useId call in the tree, and long
 * floating-point tails in chart geometry are cut to four decimals.
 */
const PAGES: [string, string, string | RegExp][] = [
  ["/", "Dashboard", "Revenue, expenses & net income"],
  ["/transactions", "Transactions", "ZZZ HOSTING"],
  ["/accounts", "Accounts", "Bank and cash"],
  [`/accounts/${CHECKING}`, "Bank 1111", "ZZZ HOSTING"],
  ["/reports", "Reports", "Schedule C-style summary"],
  ["/reports/pnl", "Profit & Loss", "Net Income"],
  ["/reports/schedule-c", "Schedule C-style summary", "Gross receipts or sales"],
  ["/vendors", "Vendors", "ZZZ SOFTWARE"],
  ["/review", "Review inbox", "ZZZ QUEUE TWO"],
  ["/calendar", "Calendar & bills", "This is an estimate."],
  ["/rules", "Rules", "OLD THING"],
  ["/settings", "Settings", "Cash reserve"],
];

/**
 * The payments panel and the card tiles' payment block on /accounts came
 * later and have their own tests (payments.test.tsx, accountTiles.test.tsx);
 * leaving them out keeps the original snapshot exact. Likewise the issuer
 * badges (issuerLogo.test.tsx) go back to the generic icon they replaced.
 */
function mainHtml(): string {
  const main = document.querySelector("main")?.cloneNode(true) as HTMLElement | undefined;
  main?.querySelectorAll("section.payments, .account-pay").forEach((node) => node.remove());
  main?.querySelectorAll<HTMLElement>(".issuer-logo").forEach((node) => {
    node.outerHTML = renderToStaticMarkup(
      <span className="account-card__icon">
        <Icon name={node.dataset.icon as IconName} size={18} />
      </span>,
    );
  });
  return (main?.innerHTML ?? "").replace(/:r[0-9a-z]+:/g, ":r:").replace(/(\d\.\d{4})\d+/g, "$1");
}

describe("business pages are unchanged", () => {
  beforeEach(() => {
    mockApi();
  });

  it.each(PAGES)("%s main content matches the pre-personal snapshot", async (url, heading, content) => {
    renderApp(url);
    await screen.findByRole("heading", { level: 1, name: heading });
    await screen.findAllByText(content);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mainHtml()).toMatchSnapshot();
  });
});
