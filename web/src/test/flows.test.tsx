import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes, ROUTER_FUTURE, makeQueryClient } from "../App";
import { ToastProvider } from "../components/Toast";
import { CHECKING, session as sessionFixture } from "./fixtures";
import { pickOption } from "./combo";
import { MockResponse, mockApi } from "./mockApi";
import { renderApp } from "./render";

const signedOut = {
  ok: true as const,
  product: "Example Books",
  company: "Example Co",
  csrf_token: "test-csrf-token-123456",
  requires_login: true,
  authenticated: false,
};

const signedIn = { ...sessionFixture, requires_login: true, authenticated: true };

describe("classification flows", () => {
  it("saves an inline tag change with the CSRF header, updates the row at once, and can undo", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderApp("/transactions");
    const select = await screen.findByLabelText("Business tag for ZZZ QUEUE ONE");
    expect(select).toHaveValue("needs_review");
    await user.selectOptions(select, "general");
    await waitFor(() => expect(screen.getByLabelText("Business tag for ZZZ QUEUE ONE")).toHaveValue("general"));
    await screen.findByText(/Saved as General/);
    const post = calls.find((call) => call.method === "POST" && call.path === "/api/classify");
    expect(post?.headers["X-CSRF-Token"]).toBe("test-csrf-token-123456");
    expect(post?.body).toMatchObject({ txn_id: "q1", tag: "general", category: "Uncategorized" });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText("Change undone");
    await waitFor(() => expect(screen.getByLabelText("Business tag for ZZZ QUEUE ONE")).toHaveValue("needs_review"));
    const undo = calls.find((call) => call.path === "/api/classify/undo");
    expect(undo?.body).toMatchObject({ items: [{ txn_id: "q1", previous: { business_tag: "needs_review" } }] });
  });

  it("rolls back an inline change when the server refuses it", async () => {
    mockApi({
      "POST /api/classify": () => {
        throw new Error("nope");
      },
    });
    const user = userEvent.setup();
    renderApp("/transactions");
    const select = await screen.findByLabelText("Business tag for ZZZ QUEUE ONE");
    await user.selectOptions(select, "consulting");
    await screen.findByText("Couldn't save");
    await waitFor(() => expect(screen.getByLabelText("Business tag for ZZZ QUEUE ONE")).toHaveValue("needs_review"));
  });

  it("bulk-classifies selected rows", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderApp("/transactions");
    await screen.findByText("ZZZ QUEUE ONE");
    await user.click(screen.getByLabelText("Select all rows on this page"));
    const bar = screen.getByRole("region", { name: "Bulk classify" });
    await pickOption(user, within(bar).getByLabelText("Category for selected"), "Software & Licenses", "software");
    await user.click(within(bar).getByRole("button", { name: /Classify 2/ }));
    await screen.findByText("Classified 2 transactions");
    const bulk = calls.find((call) => call.path === "/api/classify/bulk");
    expect(bulk?.body).toMatchObject({ txn_ids: ["q1", "rev"], tag: "general", category: "Software & Licenses" });
  });

  it("creates a rule from a transaction with a live preview", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderApp("/transactions");
    await screen.findByText("ZZZ QUEUE ONE");
    await user.click(screen.getByRole("button", { name: "Create rule from ZZZ QUEUE ONE" }));
    const dialog = await screen.findByRole("dialog", { name: "Create a rule" });
    await waitFor(() => expect(within(dialog).getByLabelText(/Pattern/)).toHaveValue("ZZZ QUEUE"));
    await within(dialog).findByText("3 matches");
    await user.click(within(dialog).getByRole("button", { name: /Save rule/ }));
    await screen.findByText(/Rule created and applied to 2 more/);
    const post = calls.find((call) => call.path === "/api/classify" && call.method === "POST");
    expect(post?.body).toMatchObject({ txn_id: "q1", save_rule: true, pattern: "ZZZ QUEUE" });
  });

  it("works the review inbox from the keyboard", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderApp("/review");
    await screen.findByText("ZZZ QUEUE ONE");
    expect(screen.getByText(/2 of 2 earlier/)).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await screen.findByText(/Saved as General · Office\/Other/);
    const post = calls.find((call) => call.path === "/api/classify");
    expect(post?.body).toMatchObject({ txn_id: "q1", tag: "general", category: "Office/Other" });
    await waitFor(() => expect(screen.queryByText("ZZZ QUEUE ONE")).toBeNull());
  });
});

describe("other flows", () => {
  it("opens the command palette with Ctrl+K and searches", async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByText("Net margin");
    await user.keyboard("{Control>}k{/Control}");
    const input = await screen.findByRole("combobox", { name: "Search" });
    await user.type(input, "rent");
    expect(await screen.findByRole("option", { name: /ZZZ RENT/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox", { name: "Search" })).toBeNull();
  });

  it("drills into a P&L figure", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderApp("/reports/pnl");
    await user.click(await screen.findByRole("button", { name: "Software & Licenses, Sep 2026: show transactions" }));
    const dialog = await screen.findByRole("dialog", { name: "Software & Licenses" });
    expect(await within(dialog).findByText("ZZZ SOFTWARE")).toBeInTheDocument();
    const lines = calls.find((call) => call.path === "/api/pnl/lines");
    expect(lines?.query.get("label")).toBe("Software & Licenses");
    expect(lines?.query.get("month")).toBe("2026-09");
  });

  it("saves the cash reserve from the slider", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderApp("/calendar");
    const slider = await screen.findByLabelText("Cash reserve");
    fireEvent.change(slider, { target: { value: "250000" } });
    expect(screen.getByLabelText("Reserve amount in dollars")).toHaveValue("2500.00");
    await user.click(screen.getByRole("button", { name: "Save reserve" }));
    await screen.findByText("Reserve saved: $2,500.00");
    expect(calls.find((call) => call.path === "/api/settings" && call.method === "POST")?.body).toEqual({ reserve_cents: 250000 });
  });

  it("toggles a rule", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderApp("/rules");
    await user.click(await screen.findByRole("switch", { name: "Rule 2 active" }));
    await screen.findByText("Rule 2 enabled");
    expect(calls.find((call) => call.path === "/api/rules/2/active")?.body).toEqual({ active: true });
  });

  it("records a statement balance from the accounts page", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderApp("/accounts");
    await screen.findByRole("heading", { name: "Bank and cash" });
    expect(screen.getByText("Imported activity")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Update balance" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Update balance" });
    await user.type(within(dialog).getByLabelText("Statement balance"), "80.00");
    expect(within(dialog).getByLabelText("Statement date")).toHaveValue("2026-10-01");
    await user.click(within(dialog).getByRole("button", { name: "Save balance" }));
    await screen.findByText(/Balance saved/);
    const post = calls.find((call) => call.path === "/api/balances" && call.method === "POST");
    expect(post?.headers["X-CSRF-Token"]).toBe("test-csrf-token-123456");
    expect(post?.body).toMatchObject({ account_id: CHECKING, balance: "80.00", as_of: "2026-10-01", source: "statement" });
  });

  it("merges vendors and opens transactions for the canonical name", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderApp("/vendors");
    await screen.findByText("ZZZ SOFTWARE");
    await user.click(screen.getByLabelText("Select row 1"));
    await user.click(screen.getByLabelText("Select row 2"));
    await user.click(screen.getByRole("button", { name: "Merge…" }));
    const dialog = await screen.findByRole("dialog", { name: "Merge vendors" });
    expect(within(dialog).getByText("ZZZ RENT")).toBeInTheDocument();
    expect(within(dialog).getByText("ZZZ SOFTWARE")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Canonical name")).toHaveValue("ZZZ RENT");
    await user.click(within(dialog).getByRole("button", { name: "Merge vendors" }));
    await screen.findByText("Merged into ZZZ RENT");
    const post = calls.find((call) => call.path === "/api/vendors/merge");
    expect(post?.headers["X-CSRF-Token"]).toBe("test-csrf-token-123456");
    expect(post?.body).toEqual({ names: ["ZZZ RENT", "ZZZ SOFTWARE"], into: "ZZZ RENT" });

    await user.click(screen.getByText("ZZZ SOFTWARE"));
    await screen.findByRole("heading", { level: 1, name: "Transactions" });
    await waitFor(() => {
      const hit = calls.find((call) => call.path === "/api/transactions" && call.query.get("vendor") === "ZZZ SOFTWARE");
      expect(hit).toBeTruthy();
    });
    expect(screen.getByText("Vendor ZZZ SOFTWARE")).toBeInTheDocument();
  });

  it("keeps the business filter in the URL when navigating", async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp("/?business=consulting&start=2026-08-01&end=2026-08-31");
    await screen.findByText("Net margin");
    const link = screen.getAllByRole("link", { name: /Transactions/ })[0];
    expect(link.getAttribute("href")).toBe("/transactions?business=consulting&start=2026-08-01&end=2026-08-31");
    await user.click(link);
    expect(await screen.findByRole("heading", { level: 1, name: "Transactions" })).toBeInTheDocument();
    expect(screen.getByLabelText("Business")).toHaveValue("consulting");
  });
});

describe("tailnet sign-in", () => {
  it("hides the ledger until the passphrase is accepted", async () => {
    let authed = false;
    const calls = mockApi({
      "GET /api/session": () => (authed ? signedIn : signedOut),
      "POST /api/login": () => {
        authed = true;
        return { ok: true, authenticated: true };
      },
    });
    const user = userEvent.setup();
    renderApp("/");
    expect(await screen.findByLabelText("Passphrase")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryAllByText("Net revenue")).toHaveLength(0);
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();

    await user.type(screen.getByLabelText("Passphrase"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect((await screen.findAllByText("Net revenue")).length).toBeGreaterThan(0);
    const post = calls.find((call) => call.method === "POST" && call.path === "/api/login");
    expect(post?.headers["X-CSRF-Token"]).toBe("test-csrf-token-123456");
    expect(post?.body).toEqual({ passphrase: "correct-horse-battery" });
    expect(screen.getAllByRole("button", { name: "Sign out" })).toHaveLength(2);
  });

  it("shows a generic error and stays on the sign-in page", async () => {
    mockApi({
      "GET /api/session": () => signedOut,
      "POST /api/login": () => new MockResponse(401, { ok: false, error: "Sign-in failed" }),
    });
    const user = userEvent.setup();
    renderApp("/");
    await user.type(await screen.findByLabelText("Passphrase"), "wrong-passphrase-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Sign-in failed")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryAllByText("Net revenue")).toHaveLength(0);
    expect(screen.getByLabelText("Passphrase")).toBeInTheDocument();
  });

  it("shows the lockout message in an alert", async () => {
    mockApi({
      "GET /api/session": () => signedOut,
      "POST /api/login": () =>
        new MockResponse(429, {
          ok: false,
          error: "Too many attempts. Try again in 4 seconds.",
          retry_after_seconds: 4,
        }),
    });
    const user = userEvent.setup();
    renderApp("/");
    await user.type(await screen.findByLabelText("Passphrase"), "wrong-passphrase-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts. Try again in 4 seconds.");
    expect(screen.queryAllByText("Net revenue")).toHaveLength(0);
  });

  it("signs out and returns to the passphrase field", async () => {
    let authed = true;
    const calls = mockApi({
      "GET /api/session": () => (authed ? signedIn : signedOut),
      "POST /api/logout": () => {
        authed = false;
        return { ok: true, authenticated: false };
      },
    });
    const user = userEvent.setup();
    renderApp("/");
    expect((await screen.findAllByText("Net revenue")).length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: "Sign out" })[0]);
    expect(await screen.findByLabelText("Passphrase")).toBeInTheDocument();
    const post = calls.find((call) => call.method === "POST" && call.path === "/api/logout");
    expect(post?.headers["X-CSRF-Token"]).toBe("test-csrf-token-123456");
    expect(post?.body).toEqual({});
    expect(screen.queryAllByText("Net revenue")).toHaveLength(0);
  });

  it("keeps the local shell open without a sign-out control", async () => {
    mockApi();
    renderApp("/");
    expect((await screen.findAllByText("Net revenue")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(screen.getByText("Local only · 127.0.0.1")).toBeInTheDocument();
  });

  it("returns to the sign-in page when a later request is rejected", async () => {
    let sessions = 0;
    mockApi({
      "GET /api/session": () => {
        sessions += 1;
        return sessions === 1 ? signedIn : signedOut;
      },
      "GET /api/dashboard": () => new MockResponse(401, { ok: false, error: "sign in required" }),
    });
    const client = makeQueryClient();
    window.history.replaceState({}, "", "/");
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/"]} future={ROUTER_FUTURE}>
            <AppRoutes />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByLabelText("Passphrase")).toBeInTheDocument();
    expect(screen.queryAllByText("Net revenue")).toHaveLength(0);
    expect(sessions).toBeGreaterThan(1);
  });
});
