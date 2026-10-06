import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Badge, CountBadge, TagBadge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card, CardHeader } from "../components/Card";
import { BarList } from "../components/charts/BarList";
import { ComboChart } from "../components/charts/ComboChart";
import { DonutChart } from "../components/charts/DonutChart";
import { AreaChart } from "../components/charts/AreaChart";
import { niceTicks } from "../components/charts/scale";
import { DataTable, type Column } from "../components/DataTable";
import { DateRangePicker } from "../components/DateRangePicker";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { KpiCard } from "../components/KpiCard";
import { Drawer, Modal } from "../components/Modal";
import { Money, MoneyCell } from "../components/MoneyCell";
import { Select } from "../components/Select";
import { Skeleton, SkeletonTable } from "../components/Skeleton";
import { ToastProvider, useToast } from "../components/Toast";
import { presets } from "../lib/dates";

describe("Money", () => {
  it("uses tabular figures and marks negatives red", () => {
    render(
      <div>
        <Money cents={-1234} />
        <Money cents={500} colorPositive signed />
        <Money cents={null} />
      </div>,
    );
    expect(screen.getByText("-$12.34")).toHaveClass("money", "money--neg");
    const positive = screen.getByText(/\$5\.00/);
    expect(positive).toHaveClass("money--pos");
    expect(positive.textContent).toBe("+$5.00");
    expect(screen.getByText("—")).toHaveClass("money--empty");
  });
  it("renders as a right-aligned cell", () => {
    render(
      <table>
        <tbody>
          <tr>
            <MoneyCell cents={100} />
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByRole("cell")).toHaveClass("num");
  });
});

describe("Badge and Button", () => {
  it("renders tag labels and counts", () => {
    render(
      <div>
        <TagBadge tag="needs_review" />
        <Badge tone="pos">Ok</Badge>
        <CountBadge count={0} label="to review" />
      </div>,
    );
    expect(screen.getByText("Needs review").closest(".badge")).toHaveClass("badge--warn");
    expect(screen.getByLabelText("0 to review")).toHaveClass("count-badge--zero");
  });
  it("disables while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});

describe("Card and KpiCard", () => {
  it("renders a card header", () => {
    render(
      <Card>
        <CardHeader title="Title" subtitle="Sub" actions={<button type="button">Act</button>} />
      </Card>,
    );
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Act" })).toBeInTheDocument();
  });
  it("marks a rise in expenses as unfavorable and a rise in revenue as favorable", () => {
    const { rerender } = render(<KpiCard label="Expenses" cents={4000} delta={1000} pct={33.3} inverse comparisonLabel="vs Aug" />);
    expect(screen.getByText("33.3%").closest(".trend")).toHaveClass("trend--bad");
    expect(screen.getByText(/unfavorable/)).toBeInTheDocument();
    rerender(<KpiCard label="Revenue" cents={4000} delta={1000} pct={33.3} />);
    expect(screen.getByText("33.3%").closest(".trend")).toHaveClass("trend--good");
    expect(screen.getByText("$40.00")).toBeInTheDocument();
  });
  it("shows a skeleton while loading", () => {
    render(<KpiCard label="x" loading />);
    expect(document.querySelector(".kpi[aria-busy='true']")).not.toBeNull();
  });
});

interface Row {
  id: string;
  name: string;
  amount: number;
}
const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, name: `Vendor ${String.fromCharCode(65 + (i % 26))}${i}`, amount: (i - 10) * 100 }));
const columns: Column<Row>[] = [
  { key: "name", header: "Name", accessor: (r) => r.name, sortable: true },
  { key: "amount", header: "Amount", accessor: (r) => r.amount, format: "money", sortable: true },
];

describe("DataTable", () => {
  it("sorts, filters, and paginates on the client", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DataTable caption="Test" columns={columns} rows={rows} rowKey={(r) => r.id} pageSize={10} />);
    expect(screen.getAllByRole("row")).toHaveLength(11);
    expect(screen.getByRole("navigation", { name: "Pagination" })).toHaveTextContent("1–10 of 30");
    await user.click(screen.getByRole("button", { name: /Amount/ }));
    const firstAmount = within(screen.getAllByRole("row")[1]).getAllByRole("cell")[1];
    expect(firstAmount.textContent).toBe("$19.00");
    expect(screen.getByRole("columnheader", { name: /Amount/ })).toHaveAttribute("aria-sort", "descending");
    await user.click(screen.getByRole("button", { name: /Next/ }));
    expect(within(screen.getAllByRole("row")[1]).getAllByRole("cell")[1].textContent).toBe("$9.00");
    rerender(<DataTable caption="Test" columns={columns} rows={rows} rowKey={(r) => r.id} pageSize={10} filter="Vendor B1" />);
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });
  it("shows negatives in red and an empty state", () => {
    const { rerender } = render(<DataTable caption="Test" columns={columns} rows={rows.slice(0, 1)} rowKey={(r) => r.id} />);
    expect(screen.getByText("-$10.00")).toHaveClass("money--neg");
    rerender(<DataTable caption="Test" columns={columns} rows={[]} rowKey={(r) => r.id} empty="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });
  it("selects rows and supports j/k/enter/x keyboard navigation", async () => {
    const onOpen = vi.fn();
    function Harness() {
      const [selected, setSelected] = useState<Set<string>>(new Set());
      return (
        <>
          <span data-testid="count">{selected.size}</span>
          <DataTable caption="Test" columns={columns} rows={rows.slice(0, 5)} rowKey={(r) => r.id} selectable selected={selected} onSelectedChange={setSelected} onRowClick={onOpen} keyboard />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByLabelText("Select all rows on this page"));
    expect(screen.getByTestId("count").textContent).toBe("5");
    await user.click(screen.getByLabelText("Select all rows on this page"));
    expect(screen.getByTestId("count").textContent).toBe("0");
    await user.keyboard("j");
    await user.keyboard("j");
    expect(screen.getAllByRole("row")[2]).toHaveClass("is-active");
    await user.keyboard("k");
    expect(screen.getAllByRole("row")[1]).toHaveClass("is-active");
    await user.keyboard("x");
    expect(screen.getByTestId("count").textContent).toBe("1");
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(rows[0]);
  });
  it("hands sorting to the server when controlled", async () => {
    const onSort = vi.fn();
    const user = userEvent.setup();
    render(<DataTable caption="Test" columns={columns} rows={rows.slice(0, 3)} rowKey={(r) => r.id} sort={{ key: "name", dir: "asc" }} onSortChange={onSort} pagination={{ offset: 0, limit: 3, total: 30, onChange: vi.fn() }} />);
    await user.click(screen.getByRole("button", { name: /Name/ }));
    expect(onSort).toHaveBeenCalledWith({ key: "name", dir: "desc" });
    expect(screen.getByRole("navigation", { name: "Pagination" })).toHaveTextContent("1–3 of 30");
  });
});

describe("DateRangePicker", () => {
  const list = presets("2026-10-01", "2026-09", "2026-01");
  it("applies a preset", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DateRangePicker value={{ start: "2026-09-01", end: "2026-09-30" }} presets={list} onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: /Current month/ });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: /Year to date/ }));
    expect(onChange).toHaveBeenCalledWith({ start: "2026-01-01", end: "2026-10-01" });
  });
  it("validates a custom range", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DateRangePicker value={{ start: "2026-09-01", end: "2026-09-30" }} presets={list} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /Current month/ }));
    const from = screen.getByLabelText("From");
    fireEvent.change(from, { target: { value: "2026-10-15" } });
    expect(screen.getByText("Pick a start on or before the end.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.change(from, { target: { value: "2026-09-10" } });
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith({ start: "2026-09-10", end: "2026-09-30" });
  });
});

describe("Modal and Drawer", () => {
  it("closes on Escape and labels the dialog", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal open onClose={onClose} title="Hello" description="World">
        <button type="button">Inside</button>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Hello" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("World");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
  it("renders nothing when closed", () => {
    render(
      <Drawer open={false} onClose={() => undefined} title="Hidden">
        x
      </Drawer>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Toast", () => {
  it("shows a message with an Undo action", async () => {
    const undo = vi.fn();
    function Trigger() {
      const { toast } = useToast();
      return (
        <button type="button" onClick={() => toast({ title: "Saved", tone: "success", action: { label: "Undo", onClick: undo } })}>
          go
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "go" }));
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalled();
    expect(screen.queryByText("Saved")).toBeNull();
  });
  it("dismisses itself", () => {
    vi.useFakeTimers();
    function Trigger() {
      const { toast } = useToast();
      return (
        <button type="button" onClick={() => toast({ title: "Bye", duration: 1000 })}>
          go
        </button>
      );
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(screen.getByText("Bye")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.queryByText("Bye")).toBeNull();
    vi.useRealTimers();
  });
});

describe("EmptyState, ErrorState, ErrorBoundary, Skeleton, Select", () => {
  it("renders empty and error states", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(
      <div>
        <EmptyState title="Nothing yet">Import something.</EmptyState>
        <ErrorState error={new Error("boom")} onRetry={retry} />
      </div>,
    );
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
  });
  it("catches render errors", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Broken(): JSX.Element {
      throw new Error("kaput");
    }
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByText("This page hit an error")).toBeInTheDocument();
    expect(screen.getByText("kaput")).toBeInTheDocument();
    spy.mockRestore();
  });
  it("renders skeletons hidden from assistive tech", () => {
    render(
      <div>
        <Skeleton width={10} />
        <SkeletonTable rows={2} cols={2} />
      </div>,
    );
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });
  it("labels a select and reports changes", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Select label="Pick" value="a" onChange={onChange} options={[{ value: "a", label: "A" }, { value: "b", label: "B", group: "G" }]} />);
    await user.selectOptions(screen.getByLabelText("Pick"), "b");
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.getByRole("group", { name: "G" })).toBeInTheDocument();
  });
});

describe("charts", () => {
  it("computes nice ticks that include zero", () => {
    const { ticks, lo, hi } = niceTicks(-1234, 98765, 4);
    expect(ticks).toContain(0);
    expect(lo).toBeLessThanOrEqual(-1234);
    expect(hi).toBeGreaterThanOrEqual(98765);
  });
  it("draws the combo chart with a legend, an accessible table, and a hover tooltip", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ComboChart
        label="Trend"
        points={[
          { key: "2026-08", label: "Aug", bars: [5000, 3000], line: 2000 },
          { key: "2026-09", label: "Sep", bars: [10000, -4000], line: 6000 },
        ]}
        barLabels={["Revenue", "Expenses"]}
        barTones={["rev", "exp"]}
        lineLabel="Net"
        lineTone="net"
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole("img", { name: "Trend" })).toBeInTheDocument();
    expect(container.querySelectorAll("rect.chart-bar")).toHaveLength(4);
    expect(screen.getAllByText("Revenue").length).toBeGreaterThan(0);
    const hits = container.querySelectorAll("rect.chart-hit");
    fireEvent.mouseEnter(hits[1]);
    expect(screen.getByRole("status")).toHaveTextContent("Sep 2026");
    expect(screen.getByRole("status")).toHaveTextContent("$60.00");
    fireEvent.click(hits[1]);
    expect(onSelect).toHaveBeenCalledWith("2026-09");
  });
  it("draws bar lists, donuts, and the outlook area chart", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <div>
        <BarList label="Bars" items={[{ key: "a", label: "Alpha", cents: 300 }, { key: "b", label: "Beta", cents: 100 }]} onSelect={onSelect} showShare />
        <DonutChart label="Split" slices={[{ key: "h", label: "Hosting", cents: 800, tone: "rev" }, { key: "c", label: "Consulting", cents: 200, tone: "net" }]} />
        <AreaChart label="Outlook" points={[{ date: "2026-10-01", value: 500 }, { date: "2026-10-02", value: -100 }]} threshold={{ value: 50, label: "Reserve", tone: "reserve" }} />
      </div>,
    );
    expect(screen.getByText("75.0%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Alpha/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: "a" }));
    expect(screen.getByRole("img", { name: "Split" })).toBeInTheDocument();
    expect(screen.getByText("80.0%")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Outlook" })).toBeInTheDocument();
    expect(container.querySelector(".chart-threshold")).not.toBeNull();
  });
});
