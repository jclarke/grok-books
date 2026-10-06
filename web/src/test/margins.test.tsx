import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_SCENARIO, whatIf } from "../lib/margins";
import { margins } from "./marginsFixtures";
import { mockApi } from "./mockApi";
import { renderApp } from "./render";

const ids = Object.fromEntries(margins.servers.map((row) => [row.slug, row.id]));

describe("what-if arithmetic", () => {
  it("matches the server-side numbers for a merge", () => {
    const result = whatIf(margins, { ...EMPTY_SCENARIO, merge: [ids.VM, ids.DED] });
    expect(result.cost_saved_cents).toBe(500);
    expect(result.blended_margin_cents).toBe(10600);
    const ded = result.servers.find((row) => row.id === ids.DED)!;
    expect([ded.revenue_after_cents, ded.margin_after_cents]).toEqual([23000, 8000]);
    expect(result.servers.find((row) => row.id === ids.VM)?.removed).toBe(true);
  });

  it("combines merge, retire, a price increase, and overhead", () => {
    const customer = margins.whatif.customers.find((row) => row.key === "BrandA:2")!;
    const licenses = margins.overhead.find((line) => line.label === "Licenses")!.id;
    const result = whatIf(margins, { merge: [ids.VM, ids.DED], retire: ids.OLD, increase: { target: customer, mode: "pct", amount: 10 }, excluded: [licenses] });
    expect(result.revenue_added_cents).toBe(400);
    expect(result.blended_margin_cents).toBe(10100 + 500 + 5000 + 400 + 2500);
    const plan = margins.whatif.plans.find((row) => row.key === "BrandA:Starter")!;
    expect(whatIf(margins, { ...EMPTY_SCENARIO, increase: { target: plan, mode: "flat", amount: 100 } }).revenue_added_cents).toBe(300);
  });

  it("refuses to merge a server into itself or retire a merged one", () => {
    expect(whatIf(margins, { ...EMPTY_SCENARIO, merge: [ids.VM, ids.VM] }).error).toMatch(/two different/);
    expect(whatIf(margins, { ...EMPTY_SCENARIO, merge: [ids.VM, ids.DED], retire: ids.DED }).error).toMatch(/cannot also be retired/);
    expect(whatIf(margins, EMPTY_SCENARIO).blended_change_cents).toBe(0);
  });
});

describe("Server margins page", () => {
  beforeEach(() => {
    mockApi();
  });

  it("shows the headline, servers, flags, and rollups", async () => {
    renderApp("/whmcs/margins");
    expect(await screen.findByRole("heading", { level: 1, name: "Server margins" })).toBeInTheDocument();
    const servers = await screen.findByRole("table", { name: "Margin by server" });
    expect(within(servers).getByText("Fake pool box")).toBeInTheDocument();
    expect(within(servers).getByText("Retire candidate")).toBeInTheDocument();
    expect(within(servers).getByText("Loses money")).toBeInTheDocument();
    expect(screen.getAllByText("$101.00").length).toBeGreaterThan(0);
    const singles = screen.getByRole("table", { name: "Margin by customer on single-customer servers" });
    expect(within(singles).getAllByText("Third Co").length).toBe(2);
    expect(screen.getByRole("table", { name: "Largest unmapped services" })).toHaveTextContent("lost.fake-a.test");
    expect(screen.getByRole("table", { name: "Plan groups on shared servers" })).toHaveTextContent("Addons on Shared");
  });

  it("lists Server margins in the WHMCS sidebar section", async () => {
    renderApp("/whmcs/margins");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Server margins" })).toHaveAttribute("aria-current", "page");
  });

  it("asks for a sync, then for a seed", async () => {
    mockApi({ "GET /api/margins": () => ({ ok: true, ready: false, brands: [] }) });
    const first = renderApp("/whmcs/margins");
    expect(await screen.findByText("WHMCS has not been synced yet")).toBeInTheDocument();
    first.unmount();
    mockApi({ "GET /api/margins": () => ({ ...margins, seeded: false }) });
    renderApp("/whmcs/margins");
    expect(await screen.findByText("No servers yet")).toBeInTheDocument();
  });

  it("starts the what-if on the seeded merge and combines changes", async () => {
    const user = userEvent.setup();
    renderApp("/whmcs/margins");
    const result = await screen.findByRole("region", { name: "What-if result" });
    expect(within(result).getByText("+$5.00")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Retire"), String(ids.OLD));
    expect(within(result).getByText("+$55.00")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Licenses/ }));
    expect(within(result).getByText("+$80.00")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Customer"), "BrandA:2");
    await user.type(screen.getByLabelText("Percent"), "10");
    expect(within(result).getByText("+$84.00")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(within(result).getByText("$101.00")).toBeInTheDocument();
    expect(within(result).getAllByText("$0.00")).toHaveLength(3);
  });

  it("saves edits with the CSRF token and changes nothing for the what-if", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderApp("/whmcs/margins");
    await user.click(await screen.findByRole("button", { name: "Edit Fake pool box" }));
    const drawer = await screen.findByRole("dialog");
    await user.type(within(drawer).getByLabelText("Component"), "ip block");
    await user.type(within(drawer).getByLabelText("$/month"), "8.50");
    await user.click(within(drawer).getByRole("button", { name: "Add cost" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.path === `/api/margins/servers/${ids.POOL}/costs`)).toBe(true));
    const add = calls.find((call) => call.path === `/api/margins/servers/${ids.POOL}/costs`)!;
    expect(add.body).toEqual({ component: "ip block", monthly_cost: "8.50" });
    expect(add.headers["X-CSRF-Token"]).toBe("test-csrf-token-123456");

    await user.type(within(drawer).getByLabelText("Value"), "6104");
    await user.click(within(drawer).getByRole("button", { name: "Add rule" }));
    await waitFor(() => expect(calls.find((call) => call.path === "/api/margins/mappings")?.body).toEqual({ server_id: ids.POOL, rule_type: "service_id", rule_value: "6104", brand_scope: "BrandA", allocation: "by_revenue" }));
    await user.click(within(drawer).getByRole("button", { name: "Remove rule WHMCS server # 7" }));
    await waitFor(() => expect(calls.some((call) => call.path.endsWith("/delete") && call.path.startsWith("/api/margins/mappings/"))).toBe(true));
    await user.selectOptions(within(drawer).getByLabelText("Status"), "retire_candidate");
    await user.click(within(drawer).getByRole("button", { name: "Save status" }));
    await waitFor(() => expect(calls.find((call) => call.path === `/api/margins/servers/${ids.POOL}`)?.body).toMatchObject({ status: "retire_candidate" }));
    await user.keyboard("{Escape}");

    const before = calls.filter((call) => call.method === "POST").length;
    await user.selectOptions(screen.getByLabelText("Retire"), String(ids.OLD));
    expect(calls.filter((call) => call.method === "POST").length).toBe(before);

    await user.selectOptions(screen.getByLabelText("Counts as, Side project"), "shared");
    await waitFor(() => expect(calls.find((call) => call.path.startsWith("/api/margins/overhead/"))?.body).toEqual({ kind: "shared" }));
  });
});
