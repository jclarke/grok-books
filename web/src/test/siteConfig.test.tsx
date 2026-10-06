import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { Session } from "../api/types";
import { LogoMark } from "../components/Logo";
import { bankSideClause, businessStyleText, fallbackCategory, gatewaysSubtitle, joinList, normalizeSiteConfig, productSuffix, type RawSiteConfig } from "../lib/siteConfig";
import * as fx from "./fixtures";
import { MockResponse, mockApi } from "./mockApi";
import { renderApp } from "./render";

const whmcsOff: RawSiteConfig = { ...fx.siteConfig, features: { whmcs: false, margins: false }, whmcs_brands: [], whmcs_bank_sides: [] };

const genericConfig: RawSiteConfig = {
  ok: true,
  product: "Books",
  company: "My Business",
  wordmark: "Books",
  features: { whmcs: false, margins: false },
  businesses: [{ slug: "general", label: "Operations", kind: "overhead", color: "#123456", color_dark: "#abcdef", tone: "neutral", revenue_category: null }],
  default_business: "general",
  accounts: [],
  operating_account: null,
  whmcs_brands: [],
  whmcs_bank_sides: [],
};

const genericSession: Session = {
  ...fx.session,
  product: "Books",
  company: "My Business",
  businesses: ["all", "general"],
  tags: ["general", "owner_draw", "transfer", "needs_review"],
};

function mainNav() {
  return screen.findByRole("navigation", { name: "Main" });
}

describe("WHMCS turned off", () => {
  let calls: ReturnType<typeof mockApi>;
  beforeEach(() => {
    calls = mockApi({ "GET /api/config": () => whmcsOff });
  });

  it("hides the WHMCS nav section and the dashboard widget, and never asks the WHMCS API", async () => {
    renderApp("/");
    await screen.findByText("Net margin");
    const nav = await mainNav();
    expect(within(nav).queryByText("WHMCS")).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Billing overview" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Server margins" })).toBeNull();
    expect(screen.queryByText("Hosting billing (WHMCS)")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.some((call) => call.path.startsWith("/api/whmcs") || call.path.startsWith("/api/margins"))).toBe(false);
  });

  it.each(["/whmcs", "/whmcs/revenue", "/whmcs/margins", "/whmcs/customers/BrandA/1"])("%s shows the not-found page", async (url) => {
    renderApp(url);
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(calls.some((call) => call.path.startsWith("/api/whmcs") || call.path.startsWith("/api/margins"))).toBe(false);
  });
});

describe("server margins turned off", () => {
  let calls: ReturnType<typeof mockApi>;
  beforeEach(() => {
    calls = mockApi({ "GET /api/config": () => ({ ...fx.siteConfig, features: { whmcs: true, margins: false } }) });
  });

  it("keeps the WHMCS section but drops Server margins", async () => {
    renderApp("/whmcs");
    expect(await screen.findByRole("heading", { level: 1, name: "WHMCS billing" })).toBeInTheDocument();
    const nav = await mainNav();
    expect(within(nav).getByRole("link", { name: "Billing overview" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Server margins" })).toBeNull();
    expect(within(screen.getByRole("main")).queryByText("Server margins")).toBeNull();
  });

  it("answers /whmcs/margins with the not-found page", async () => {
    renderApp("/whmcs/margins");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(calls.some((call) => call.path.startsWith("/api/margins"))).toBe(false);
  });
});

describe("generic config", () => {
  beforeEach(() => {
    mockApi({ "GET /api/config": () => genericConfig, "GET /api/session": () => genericSession });
  });

  it("names the product, labels, and colors from the config", async () => {
    renderApp("/");
    await screen.findByText("Net margin");
    await waitFor(() => expect(document.title).toBe("Dashboard · Books"));
    expect(screen.getByRole("link", { name: "Books, dashboard" })).toBeInTheDocument();
    const nav = await mainNav();
    expect(nav.querySelector(".wordmark__name")?.textContent).toBe("Books");
    expect(nav.querySelector(".wordmark__product")).toBeNull();
    expect(nav.querySelector(".logo-mark text")?.textContent).toBe("B");
    expect(within(nav).queryByText("WHMCS")).toBeNull();
    const options = [...(screen.getAllByLabelText("Business")[0] as HTMLSelectElement).options].map((option) => [option.value, option.textContent]);
    expect(options).toEqual([
      ["all", "All businesses"],
      ["general", "Operations"],
    ]);
    const style = document.getElementById("site-config-businesses")?.textContent ?? "";
    expect(style).toContain("--biz-general: #123456;");
    expect(style).toContain(':root[data-theme="dark"] {\n  --biz-general: #abcdef;');
    expect(style).toContain('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n    --biz-general: #abcdef;');
    expect(style).toContain(".tone-biz-general { --tone: var(--biz-general); }");
    expect(style).not.toContain("branda");
  });

  it("describes reports with the configured business labels", async () => {
    renderApp("/reports");
    expect(await screen.findByText("Operations side by side.")).toBeInTheDocument();
  });

  it("uses operating-account wording when no operating account is configured", async () => {
    renderApp("/calendar");
    expect(await screen.findByText("Operating account today")).toBeInTheDocument();
    expect(screen.getByText(/starts from the imported operating account balance/)).toBeInTheDocument();
  });

  it("falls back to cash accounts wording on Accounts", async () => {
    renderApp("/accounts");
    expect(await screen.findByText("Money in cash accounts")).toBeInTheDocument();
  });
});

describe("config request fails", () => {
  it("opens the app with defaults and session-derived businesses", async () => {
    mockApi({ "GET /api/config": () => new MockResponse(500, { ok: false, error: "boom" }) });
    renderApp("/");
    await screen.findByText("Net margin");
    expect(screen.getByRole("link", { name: "Books, dashboard" })).toBeInTheDocument();
    expect(screen.queryByText("Hosting billing (WHMCS)")).toBeNull();
    const options = [...(screen.getAllByLabelText("Business")[0] as HTMLSelectElement).options].map((option) => option.textContent);
    expect(options).toEqual(["All businesses", "branda", "consulting", "general"]);
  });
});

describe("owner config reads as before", () => {
  beforeEach(() => {
    mockApi();
  });

  it("names the product and draws the letter mark", async () => {
    renderApp("/");
    await screen.findByText("Net margin");
    await waitFor(() => expect(document.title).toBe("Dashboard · Example Books"));
    const brand = screen.getByRole("link", { name: "Example Books, dashboard" });
    expect(brand.querySelector(".wordmark__name")?.textContent).toBe("Example");
    expect(brand.querySelector(".wordmark__product")?.textContent).toBe("Books");
    expect(brand.querySelector(".logo-mark .logo-mark__letter")?.textContent).toBe("E");
    expect(screen.getByText("Hosting versus consulting")).toBeInTheDocument();
    expect(screen.getByText("BrandA", { selector: ".strong" })).toBeInTheDocument();
  });

  it("draws the H glyph for an H wordmark", () => {
    const { container } = render(<LogoMark letter="H" />);
    expect(container.querySelector(".logo-mark path.logo-mark__glyph")?.getAttribute("d")).toBe("M18 46V18h6v11h16V18h6v28h-6V35H24v11z");
  });

  it("keeps the cash account copy on Accounts", async () => {
    renderApp("/accounts");
    expect(await screen.findByText("Money in Bank and PayPal")).toBeInTheDocument();
  });

  it("keeps the business colors", () => {
    const text = businessStyleText(normalizeSiteConfig(fx.siteConfig).businesses);
    expect(text).toContain("--biz-branda: #0d9488;");
    expect(text).toContain("--biz-consulting: #4f46e5;");
    expect(text).toContain("--biz-general: #64748b;");
    expect(text).toContain("--biz-branda: #2dd4bf;");
    expect(text).toContain("--biz-consulting: #a5b4fc;");
    expect(text).toContain("--biz-general: #94a3b8;");
  });
});

describe("site config helpers", () => {
  it("joins lists", () => {
    expect(joinList(["A"])).toBe("A");
    expect(joinList(["A", "B"])).toBe("A and B");
    expect(joinList(["A", "B", "C"])).toBe("A, B, and C");
    expect(joinList([])).toBe("");
  });

  it("falls back to Office/Other when it exists, else the last opex category", () => {
    expect(fallbackCategory(fx.session)).toBe("Office/Other");
    const noOffice = { categories: ["Rent", "Supplies", "Uncategorized"], category_groups: { revenue: [], cogs: [], opex: ["Rent", "Supplies"], other: ["Uncategorized"] } };
    expect(fallbackCategory(noOffice)).toBe("Supplies");
    expect(fallbackCategory({ categories: ["Misc"], category_groups: { revenue: [], cogs: [], opex: [], other: [] } })).toBe("Uncategorized");
  });

  it("splits the product name around the wordmark", () => {
    expect(productSuffix("Example Books", "Example")).toBe("Books");
    expect(productSuffix("Books", "Books")).toBe("");
  });

  it("builds the owner's gateway sentence word for word", () => {
    const sides = normalizeSiteConfig(fx.siteConfig).whmcs_bank_sides;
    expect(gatewaysSubtitle(sides)).toBe(
      "WHMCS totals for every gateway. PayPal compares to the PayPal account; litle (cards) compares to Bank card settlements from Processor A and Processor B, which settle on their own schedule. Other gateways have no bank side.",
    );
    expect(bankSideClause({ gateway: "stripe", label: "x", description: "Stripe compares to payouts" })).toBe("Stripe compares to payouts");
  });

  it("drops unsafe slugs and colors before they reach a style element", () => {
    const cfg = normalizeSiteConfig({
      businesses: [
        { slug: "ok_1", label: "OK", color: "#fff" },
        { slug: "bad}slug", label: "Bad", color: "#000" },
        { slug: "evil", label: "Evil", color: "red;} body{display:none" },
      ],
    });
    expect(cfg.businesses.map((row) => row.slug)).toEqual(["ok_1", "evil"]);
    const text = businessStyleText(cfg.businesses);
    expect(text).toContain("--biz-ok_1: #fff;");
    expect(text).not.toContain("display:none");
    expect(text).not.toContain("--biz-evil");
  });

  it("fills defaults for an empty payload", () => {
    const cfg = normalizeSiteConfig({}, { businesses: ["all", "alpha", "beta"] });
    expect(cfg.product).toBe("Books");
    expect(cfg.wordmark).toBe("Books");
    expect(cfg.features).toEqual({ whmcs: false, margins: false, business: true, personal: true });
    expect(cfg.businesses.map((row) => [row.slug, row.label])).toEqual([
      ["alpha", "alpha"],
      ["beta", "beta"],
    ]);
    expect(cfg.default_business).toBe("beta");
    expect(cfg.operating_account).toBeNull();
  });
});

describe("sign-in", () => {
  it("refetches the config after sign-in, when the business keys appear", async () => {
    let authed = false;
    const signedOut = { ok: true as const, product: "Example Books", company: "Example Co", csrf_token: fx.session.csrf_token, requires_login: true, authenticated: false };
    const publicConfig: RawSiteConfig = { ok: true, product: "Example Books", company: "Example Co", wordmark: "Example", features: { whmcs: true, margins: true } };
    let configCalls = 0;
    mockApi({
      "GET /api/session": () => (authed ? { ...fx.session, requires_login: true, authenticated: true } : signedOut),
      "GET /api/config": () => {
        configCalls += 1;
        return authed ? fx.siteConfig : publicConfig;
      },
      "POST /api/login": () => {
        authed = true;
        return { ok: true, authenticated: true };
      },
    });
    const user = userEvent.setup();
    renderApp("/");
    await user.type(await screen.findByLabelText("Passphrase"), "correct-horse-battery");
    expect(document.querySelector(".login .wordmark__name")?.textContent).toBe("Example");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByText("Net margin");
    expect(configCalls).toBeGreaterThan(1);
    const options = [...(screen.getAllByLabelText("Business")[0] as HTMLSelectElement).options].map((option) => option.textContent);
    expect(options).toEqual(["All businesses", "Brand A", "Consulting", "General"]);
  });
});

describe("one-mode installs", () => {
  it("personal off: no mode toggle, and /personal falls back to the business dashboard", async () => {
    const calls = mockApi({ "GET /api/config": () => ({ ...fx.siteConfig, features: { ...fx.siteConfig.features, personal: false } }) });
    renderApp("/personal");
    await screen.findByText("Net margin");
    expect(screen.queryByRole("group", { name: "Mode" })).toBeNull();
    expect(calls.some((call) => call.path.startsWith("/api/personal"))).toBe(false);
  });

  it("business off: no mode toggle, and / goes to the personal dashboard", async () => {
    const calls = mockApi({ "GET /api/config": () => ({ ...fx.siteConfig, features: { ...fx.siteConfig.features, business: false } }) });
    renderApp("/");
    await waitFor(() => expect(calls.some((call) => call.path.startsWith("/api/personal"))).toBe(true));
    expect(screen.queryByRole("group", { name: "Mode" })).toBeNull();
  });

  it("both on: the toggle offers both modes", async () => {
    mockApi({});
    renderApp("/");
    const toggles = await screen.findAllByRole("group", { name: "Mode" });
    expect(within(toggles[0]).getAllByRole("button").map((button) => button.textContent)).toEqual(["Business", "Personal"]);
  });

  it("normalizes the mode flags; both off falls back to business", () => {
    expect(normalizeSiteConfig({ features: { personal: false } }).features).toMatchObject({ business: true, personal: false });
    expect(normalizeSiteConfig({ features: { business: false, personal: false } }).features).toMatchObject({ business: true, personal: false });
  });
});
