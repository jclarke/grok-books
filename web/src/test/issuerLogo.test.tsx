import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ISSUERS, IssuerLogo, matchIssuer, normalizeIssuerText } from "../components/IssuerLogo";
import { accounts, session as businessSession } from "./fixtures";
import { mockApi } from "./mockApi";
import * as px from "./personalFixtures";
import { renderApp } from "./render";

const CASES: [label: string, institution: string, id: string][] = [
  ["Amex EveryDay® Card", "", "amex"],
  ["Blue Cash Preferred", "American Express", "amex"],
  ["Apple Card", "Goldman Sachs", "apple"],
  ["Marcus Savings", "", "goldman"],
  ["Savings", "Goldman Sachs Bank USA", "goldman"],
  ["Chase Freedom Unlimited®", "", "chase"],
  ["Sapphire Preferred", "JPMorgan Chase", "chase"],
  ["Amazon Visa", "Chase", "amazon"],
  ["Prime Visa", "", "amazon"],
  ["Citi Double Cash® Card", "", "citi"],
  ["Custom Cash", "Citibank", "citi"],
  ["Costco Anywhere Visa", "Citi", "costco"],
  ["Discover it", "", "discover"],
  ["Quicksilver", "Capital One", "capitalone"],
  ["Venture X", "CapitalOne", "capitalone"],
  ["Customized Cash Rewards", "Bank of America", "bofa"],
  ["BofA 1111", "", "bofa"],
  ["Synchrony Premier", "", "synchrony"],
  ["Credit First (CFNA)", "", "creditfirst"],
  ["Firestone Credit Card", "", "creditfirst"],
  ["PayPal Cashback Mastercard", "Synchrony", "paypal"],
  ["PayPal", "", "paypal"],
  ["SoFi Checking", "", "sofi"],
  ["Personal Loan", "SoFi", "sofi"],
  ["USAA Rewards Visa", "", "usaa"],
  ["OnePay Cash", "", "onepay"],
  ["Disney® Premier Visa", "Chase", "disney"],
  ["Lowe's Advantage Card", "Synchrony", "lowes"],
  ["Visa Signature", "Some Credit Union", "visa"],
  ["World Mastercard", "", "mastercard"],
  ["Active Cash", "Wells Fargo", "wellsfargo"],
  ["Barclaycard View", "", "barclays"],
  ["Arrival Plus", "Barclays", "barclays"],
  ["cashRewards", "Navy Federal Credit Union", "navyfederal"],
  ["Virtual Wallet", "PNC Bank", "pnc"],
  ["Enjoy Cash", "Truist", "truist"],
  ["Altitude Go", "U.S. Bank", "usbank"],
  ["Cash+", "US Bank", "usbank"],
  ["Double Up", "TD Bank", "tdbank"],
  ["Target Circle Card", "TD Bank", "target"],
  ["Walmart Rewards Card", "Capital One", "walmart"],
  ["My Best Buy Visa", "Citi", "bestbuy"],
  ["Home Depot Consumer Card", "Citi", "homedepot"],
  ["Verizon Visa Card", "Synchrony", "verizon"],
  ["Venmo Credit Card", "Synchrony", "venmo"],
  ["Cash App", "", "cashapp"],
  ["Wise USD", "", "wise"],
  ["Mercury Checking", "", "mercury"],
  ["Brex Card", "", "brex"],
  ["Ramp Card", "", "ramp"],
  ["Stripe Balance", "", "stripe"],
];

describe("issuer matching", () => {
  it.each(CASES)("%s (%s) is %s", (label, institution, id) => {
    expect(matchIssuer(label, institution)?.id).toBe(id);
  });

  it("normalizes case, marks and punctuation", () => {
    expect(normalizeIssuerText("Amex EveryDay® Card")).toBe("amex everyday card");
    expect(normalizeIssuerText("Lowe’s")).toBe("lowes");
    expect(normalizeIssuerText("U.S. Bank")).toBe("u s bank");
    expect(normalizeIssuerText(null)).toBe("");
  });

  it("prefers the label, then the institution, then a network", () => {
    expect(matchIssuer("Apple Card", "Goldman Sachs")?.id).toBe("apple");
    expect(matchIssuer("Rewards Visa", "Chase")?.id).toBe("chase");
    expect(matchIssuer("Rewards Visa", "Fake Card Co")?.id).toBe("visa");
    // A card product name still resolves to its issuer; "Cash" alone is not Cash App.
    expect(matchIssuer("Chase Freedom", "")?.id).toBe("chase");
    expect(matchIssuer("Everyday Cash", "")).toBeNull();
  });

  it("returns null for unknown accounts", () => {
    expect(matchIssuer("Fake Everyday Checking", "Fake Bank")).toBeNull();
    expect(matchIssuer("", null)).toBeNull();
    expect(matchIssuer(undefined)).toBeNull();
  });

  it("has unique ids and valid colors", () => {
    expect(new Set(ISSUERS.map((issuer) => issuer.id)).size).toBe(ISSUERS.length);
    for (const issuer of ISSUERS) {
      expect(issuer.bg).toMatch(/^#[0-9A-F]{6}$/i);
      expect(issuer.fg).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe("IssuerLogo", () => {
  it("draws every issuer as inline SVG, decorative and sized", () => {
    for (const issuer of ISSUERS) {
      const { container, unmount } = render(<IssuerLogo label={issuer.name} kind="card" size={40} />);
      const badge = container.querySelector(".issuer-logo") as HTMLElement;
      expect(badge).toHaveAttribute("data-issuer", issuer.id);
      expect(badge).toHaveAttribute("aria-hidden", "true");
      const svg = badge.querySelector("svg") as SVGElement;
      expect(svg).toHaveAttribute("width", "40");
      expect(svg.querySelector("rect")).toHaveAttribute("fill", issuer.bg);
      unmount();
    }
  });

  it("falls back to the generic icon by account kind", () => {
    const icons = { card: "card", cash: "cash", investment: "trendingUp", loan: "home" } as const;
    for (const [kind, icon] of Object.entries(icons)) {
      const { container, unmount } = render(<IssuerLogo label="Fake Account" institution="Nowhere" kind={kind as keyof typeof icons} />);
      const badge = container.querySelector(".issuer-logo") as HTMLElement;
      expect(badge).toHaveClass("issuer-logo--generic");
      expect(badge).toHaveAttribute("data-icon", icon);
      expect(badge.querySelector("svg")).not.toBeNull();
      unmount();
    }
  });

  it("stays out of the accessibility tree", () => {
    render(
      <div>
        <IssuerLogo label="Amex Gold" kind="card" />
        <span>Amex Gold</span>
      </div>,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getAllByText(/Amex Gold|AMEX/).filter((node) => !node.closest("[aria-hidden]"))).toHaveLength(1);
  });
});

/** No <img>, no remote href/src anywhere in the tiles. */
function expectNoExternalAssets(root: Element) {
  expect(root.querySelectorAll("img")).toHaveLength(0);
  for (const node of root.querySelectorAll("*")) {
    for (const attr of ["src", "href", "xlink:href", "srcset"]) {
      expect(node.getAttribute(attr) ?? "").not.toMatch(/^(https?:)?\/\//);
    }
    expect(node.getAttribute("style") ?? "").not.toMatch(/url\(/);
  }
}

describe("issuer badges on the tiles", () => {
  it("renders badges on business tiles with no external assets", async () => {
    mockApi();
    renderApp("/accounts");
    await screen.findByRole("heading", { level: 3, name: "Card 2222" });
    const grids = document.querySelectorAll(".account-grid");
    expect(grids.length).toBeGreaterThan(0);
    const ids = [...document.querySelectorAll(".account-card .issuer-logo")].map((node) => node.getAttribute("data-issuer"));
    expect(ids).toHaveLength(accounts.rows.length);
    expect(ids).toContain("discover");
    expect(ids).toContain("generic");
    grids.forEach(expectNoExternalAssets);
  });

  it("renders badges on personal tiles with no external assets", async () => {
    mockApi({
      "GET /api/session": (call) => (call.query.get("mode") === "personal" ? px.personalSession : businessSession),
      "GET /api/personal/status": () => ({ ok: true, ready: true, account_count: 2, transaction_count: 130, setup_steps: px.personalSession.personal?.setup_steps }),
      "GET /api/personal/accounts": () => px.paccounts,
    });
    renderApp("/personal/accounts");
    await screen.findByRole("heading", { level: 3, name: "Fake Rewards Visa" });
    await waitFor(() => expect(document.querySelectorAll(".account-card .issuer-logo")).toHaveLength(2));
    document.querySelectorAll(".account-grid").forEach(expectNoExternalAssets);
  });
});
