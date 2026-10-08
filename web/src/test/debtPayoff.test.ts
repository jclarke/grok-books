import { describe, expect, it } from "vitest";
import {
  addMonths,
  allocateProceeds,
  amortizedPayment,
  cardsPaidInFull,
  computedPayment,
  quoteCheck,
  simulateOffers,
  type LoanOffer,
  estimateMinimum,
  grossUp,
  monthsBetween,
  nextMonth,
  simulateBaseline,
  simulateConsolidation,
  type ConsolidationOptions,
  type Debt,
} from "../lib/debtPayoff";

const FIRST = "2026-11";

function card(id: string, balance: number, apr: number, minimum: number): Debt {
  return { id, label: `Fake ${id}`, balance, apr, minimum };
}

function exactPayment(p: number, apr: number, n: number): number {
  const r = apr / 1200;
  return (p * r) / (1 - (1 + r) ** -n);
}

const near = (a: number, b: number, cents = 2) => expect(Math.abs(a - b)).toBeLessThanOrEqual(cents / 100 + 1e-9);

describe("months", () => {
  it("adds and counts calendar months", () => {
    expect(addMonths("2026-11", 1)).toBe("2026-12");
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonths("2026-11", 59)).toBe("2031-10");
    expect(monthsBetween("2026-11", "2027-02")).toBe(3);
    expect(nextMonth("2026-10-07")).toBe("2026-11");
    expect(nextMonth("2026-12-31")).toBe("2027-01");
    expect(nextMonth(new Date(2026, 9, 7))).toBe("2026-11");
  });
});

describe("amortizedPayment", () => {
  it("matches the standard formula: 150k at 9.76% for 60 months is about $3,170", () => {
    const payment = amortizedPayment(150000, 9.76, 60);
    expect(Math.abs(payment - exactPayment(150000, 9.76, 60))).toBeLessThan(1);
    expect(payment).toBeGreaterThan(3169);
    expect(payment).toBeLessThan(3172);
  });

  it("handles a zero rate and empty loans", () => {
    expect(amortizedPayment(1200, 0, 12)).toBe(100);
    expect(amortizedPayment(0, 9.76, 60)).toBe(0);
    expect(amortizedPayment(1000, 10, 0)).toBe(0);
  });

  it("a 36-month term costs more a month than 60", () => {
    expect(amortizedPayment(10000, 10, 36)).toBeGreaterThan(amortizedPayment(10000, 10, 60));
  });
});

describe("estimateMinimum", () => {
  it("is 1% plus a month's interest, at least $25, never above the balance", () => {
    expect(estimateMinimum(10000, 12)).toBe(200);
    expect(estimateMinimum(500, 20)).toBe(25);
    expect(estimateMinimum(10, 20)).toBe(10);
    expect(estimateMinimum(0, 20)).toBe(0);
  });
});

describe("simulateBaseline: minimums", () => {
  it("pays a 0% card off in balance / minimum months with no interest", () => {
    const sim = simulateBaseline([card("a", 1000, 0, 100)], { strategy: "minimums", firstMonth: FIRST });
    expect(sim.months).toBe(10);
    expect(sim.payoffMonth).toBe("2027-08");
    expect(sim.totalInterest).toBe(0);
    expect(sim.totalPaid).toBe(1000);
    expect(sim.series[0]).toEqual({ month: "2026-10", total: 1000 });
    expect(sim.series[1]).toEqual({ month: "2026-11", total: 900 });
    expect(sim.series[sim.series.length - 1]).toEqual({ month: "2027-08", total: 0 });
    expect(sim.neverPaysOff).toBe(false);
  });

  it("charges APR / 12 a month and caps the last payment at what is owed", () => {
    const sim = simulateBaseline([card("a", 1000, 12, 300)], { strategy: "minimums", firstMonth: FIRST });
    // 1010 - 300 = 710; 717.10 - 300 = 417.10; 421.27 - 300 = 121.27; 122.48 paid in full.
    expect(sim.series.map((p) => p.total)).toEqual([1000, 710, 417.1, 121.27, 0]);
    expect(sim.totalInterest).toBeCloseTo(10 + 7.1 + 4.17 + 1.21, 6);
    expect(sim.months).toBe(4);
    near(sim.totalPaid, 1000 + sim.totalInterest, 0);
    expect(sim.firstMonthPayment).toBe(300);
  });

  it("flags a minimum that never beats the interest", () => {
    const sim = simulateBaseline([card("a", 10000, 24, 150), card("b", 500, 10, 100)], { strategy: "minimums", firstMonth: FIRST, maxMonths: 120 });
    expect(sim.neverPaysOff).toBe(true);
    expect(sim.months).toBeNull();
    expect(sim.payoffMonth).toBeNull();
    expect(sim.series).toHaveLength(121);
    expect(sim.paidOffAt.a).toBeNull();
    expect(sim.paidOffAt.b).toBe(6);
  });

  it("holds the minimum constant: freed minimums do not roll over", () => {
    const debts = [card("a", 300, 20, 100), card("b", 3000, 20, 100)];
    const sim = simulateBaseline(debts, { strategy: "minimums", firstMonth: FIRST });
    const afterA = sim.series[sim.paidOffAt.a! + 1].total - sim.series[sim.paidOffAt.a! + 2].total;
    expect(afterA).toBeLessThan(100); // only b's $100 minimum, less its interest
  });
});

describe("simulateBaseline: budget (avalanche)", () => {
  const debts = [card("low", 5000, 10, 100), card("high", 5000, 30, 150)];

  it("sends the extra to the highest APR first and beats minimums", () => {
    const mins = simulateBaseline(debts, { strategy: "minimums", firstMonth: FIRST });
    const budget = simulateBaseline(debts, { strategy: "budget", budget: 1000, firstMonth: FIRST });
    expect(budget.firstMonthPayment).toBe(1000);
    expect(budget.paidOffAt.high!).toBeLessThan(budget.paidOffAt.low!);
    expect(budget.totalInterest).toBeLessThan(mins.totalInterest);
    expect(budget.months!).toBeLessThan(mins.months!);
    near(budget.totalPaid, 10000 + budget.totalInterest, 1);
    // Month 1: high gets 1000 - 100 (low's minimum) after 125 of interest.
    expect(budget.series[1].total).toBe(round(10000 + 125 + 41.67 - 1000));
  });

  it("pays the highest APR first even when its balance is larger (avalanche, not snowball)", () => {
    const mixed = [card("low", 2000, 10, 50), card("high", 6000, 30, 150)];
    const avalanche = simulateBaseline(mixed, { strategy: "budget", budget: 600, firstMonth: FIRST });
    expect(avalanche.paidOffAt.high!).toBeLessThan(avalanche.paidOffAt.low!);
  });

  it("falls back to minimums with a warning when the budget is short", () => {
    const short = simulateBaseline(debts, { strategy: "budget", budget: 200, firstMonth: FIRST });
    const mins = simulateBaseline(debts, { strategy: "minimums", firstMonth: FIRST });
    expect(short.budgetBelowMinimums).toBe(true);
    expect(short.totalInterest).toBe(mins.totalInterest);
    expect(short.firstMonthPayment).toBe(250);
  });

  it("defaults the budget to the sum of minimums", () => {
    const sim = simulateBaseline(debts, { strategy: "budget", firstMonth: FIRST });
    expect(sim.firstMonthPayment).toBe(250);
    expect(sim.budgetBelowMinimums).toBe(false);
  });
});

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

describe("allocateProceeds and grossUp", () => {
  it("pays the highest APR first and reports paid, partial, unpaid", () => {
    const { allocations, surplus } = allocateProceeds([card("a", 4000, 20, 0), card("b", 3000, 30, 0), card("c", 2000, 10, 0)], 5000);
    expect(allocations.map((row) => [row.id, row.status, row.paidFromLoan, row.remaining])).toEqual([
      ["a", "partial", 2000, 2000],
      ["b", "paid", 3000, 0],
      ["c", "unpaid", 0, 2000],
    ]);
    expect(surplus).toBe(0);
    expect(allocateProceeds([card("a", 100, 20, 0)], 150).surplus).toBe(50);
  });

  it("grosses up so the net proceeds cover the balance", () => {
    expect(grossUp(10000, 3)).toBe(10309.28);
    expect(round(grossUp(10000, 3) * 0.97)).toBeGreaterThanOrEqual(10000);
    expect(grossUp(10000, 0)).toBe(10000);
  });
});

describe("simulateConsolidation", () => {
  const included = [card("a", 5000, 30, 150), card("b", 5000, 20, 100)];
  const base: ConsolidationOptions = { strategy: "minimums", firstMonth: FIRST, apr: 9.76, feePct: 3, feeDeducted: true, termMonths: 60 };

  it("takes the fee from the proceeds: highest APR paid, the rest partly left on the card", () => {
    const sim = simulateConsolidation(included, [], base);
    expect(sim.amount).toBe(10000);
    expect(sim.fee).toBe(300);
    expect(sim.proceeds).toBe(9700);
    expect(sim.amountNeeded).toBe(10309.28);
    expect(sim.allocations.map((row) => [row.id, row.status, row.remaining])).toEqual([
      ["a", "paid", 0],
      ["b", "partial", 300],
    ]);
    expect(sim.loanPayment).toBe(Math.ceil(amortizedPayment(10000, 9.76, 60) * 100) / 100);
    expect(sim.firstMonthPayment).toBe(round(sim.loanPayment + 100));
    expect(sim.series[0].total).toBe(10300);
    expect(sim.totalFees).toBe(300);
    near(sim.totalPaid, 10000 + sim.totalFees + sim.totalInterest, 5);
  });

  it("borrowing the gross-up covers every card", () => {
    const sim = simulateConsolidation(included, [], { ...base, amount: grossUp(10000, 3) });
    expect(sim.allocations.every((row) => row.status === "paid")).toBe(true);
    expect(sim.months).toBe(60);
    expect(sim.loanPayoffMonth).toBe(addMonths(FIRST, 59));
  });

  it("a separate fee gives full proceeds and is counted once in fees and total paid", () => {
    const sim = simulateConsolidation(included, [], { ...base, feeDeducted: false });
    expect(sim.proceeds).toBe(10000);
    expect(sim.allocations.every((row) => row.status === "paid")).toBe(true);
    expect(sim.totalFees).toBe(300);
    near(sim.totalPaid, 10000 + 300 + sim.totalInterest, 5);
    expect(sim.months).toBe(60);
  });

  it("keeps excluded cards going on the baseline strategy alongside the loan", () => {
    const excluded = [card("x", 2000, 25, 80)];
    const sim = simulateConsolidation(included, excluded, { ...base, feeDeducted: false });
    expect(sim.allocations.find((row) => row.id === "x")?.status).toBe("excluded");
    expect(sim.series[0].total).toBe(12000);
    expect(sim.firstMonthPayment).toBe(round(sim.loanPayment + 80));
    expect(sim.paidOffAt.x).not.toBeNull();
  });

  it("extra payments shorten the loan; a step-up only counts from its month", () => {
    const plain = simulateConsolidation(included, [], { ...base, feeDeducted: false });
    const extra = simulateConsolidation(included, [], { ...base, feeDeducted: false, extraMonthly: 200 });
    expect(extra.months!).toBeLessThan(plain.months!);
    expect(extra.totalInterest).toBeLessThan(plain.totalInterest);
    expect(extra.firstMonthPayment).toBe(round(plain.firstMonthPayment + 200));
    const soon = simulateConsolidation(included, [], { ...base, feeDeducted: false, stepUp: { amount: 500, startMonth: "2027-02" } });
    const later = simulateConsolidation(included, [], { ...base, feeDeducted: false, stepUp: { amount: 500, startMonth: "2028-02" } });
    expect(soon.firstMonthPayment).toBe(plain.firstMonthPayment);
    expect(soon.months!).toBeLessThan(later.months!);
    expect(later.months!).toBeLessThan(plain.months!);
    // Feb 2027 is the 4th payment from Nov 2026.
    const paid = (sim: typeof plain, m: number) => round(sim.series[m - 1].total - sim.series[m].total);
    expect(paid(soon, 3)).toBe(paid(plain, 3));
    expect(paid(soon, 4)).toBeGreaterThan(paid(plain, 4) + 400);
  });

  it("reports interest saved against the baseline, negative when it costs more", () => {
    const baseline = simulateBaseline(included, { strategy: "minimums", firstMonth: FIRST });
    const sim = simulateConsolidation(included, [], { ...base, baselineInterest: baseline.totalInterest });
    expect(sim.interestSaved).toBe(round(baseline.totalInterest - (sim.totalInterest + sim.totalFees)));
    expect(sim.interestSaved!).toBeGreaterThan(0);
    const cheap = [card("c", 5000, 5, 500)];
    const cheapBase = simulateBaseline(cheap, { strategy: "minimums", firstMonth: FIRST });
    const worse = simulateConsolidation(cheap, [], { ...base, feePct: 8, baselineInterest: cheapBase.totalInterest });
    expect(worse.interestSaved!).toBeLessThan(0);
  });

  it("with a budget, spends the same total and rolls freed money to the highest APR", () => {
    const excluded = [card("x", 3000, 28, 90)];
    const budget = 1200;
    const sim = simulateConsolidation(included, excluded, { ...base, strategy: "budget", budget, feeDeducted: false });
    expect(sim.firstMonthPayment).toBe(budget);
    expect(sim.budgetBelowMinimums).toBe(false);
    const mins = simulateConsolidation(included, excluded, { ...base, feeDeducted: false });
    expect(sim.months!).toBeLessThan(mins.months!);
    const short = simulateConsolidation(included, excluded, { ...base, strategy: "budget", budget: 100, feeDeducted: false });
    expect(short.budgetBelowMinimums).toBe(true);
  });

  it("clamps the fee to 0-10% and handles a 0% loan", () => {
    const sim = simulateConsolidation(included, [], { ...base, feePct: 25, apr: 0, termMonths: 36 });
    expect(sim.fee).toBe(1000);
    expect(sim.loanPayment).toBe(Math.ceil((10000 / 36) * 100) / 100);
  });
});

describe("several offers at once", () => {
  const included = [card("a", 6000, 29, 180), card("b", 4000, 22, 120), card("c", 2000, 15, 60)];
  const excluded = [card("x", 1500, 25, 50)];
  const common = { strategy: "minimums" as const, firstMonth: FIRST };
  const offer = (key: string, patch: Partial<LoanOffer> = {}): LoanOffer => ({ key, label: key, amount: 12000, apr: 10, feePct: 0, feeDeducted: true, termMonths: 60, ...patch });

  it("runs each offer against the same balances, in order", () => {
    const base = simulateBaseline([...included, ...excluded], common);
    const runs = simulateOffers(included, excluded, [offer("cheap", { apr: 7 }), offer("dear", { apr: 14 }), offer("short", { termMonths: 36 })], { ...common, baselineInterest: base.totalInterest });
    expect(runs.map((run) => run.offer.key)).toEqual(["cheap", "dear", "short"]);
    expect(runs[0].result.totalInterest).toBeLessThan(runs[1].result.totalInterest);
    expect(runs[2].result.loanPayment).toBeGreaterThan(runs[0].result.loanPayment);
    expect(runs[2].result.loanPayoffMonth).toBe(addMonths(FIRST, 35));
    for (const run of runs) {
      expect(run.result.interestSaved).toBe(round(base.totalInterest - (run.result.totalInterest + run.result.totalFees)));
      expect(run.result.allocations.find((row) => row.id === "x")?.status).toBe("excluded");
    }
  });

  it("counts the cards paid in full from net-of-fee proceeds", () => {
    const [full, fee, small, big] = simulateOffers(included, excluded, [
      offer("full"),
      offer("fee", { feePct: 5 }),
      offer("small", { amount: 7000 }),
      offer("big", { amount: 15000 }),
    ], common);
    expect([full.cardsPaid, full.cardsTotal]).toEqual([3, 3]);
    // 12,000 less 5% = 11,400: a (29%) and b (22%) paid, c (15%) short by 600.
    expect([fee.cardsPaid, fee.cardsTotal]).toEqual([2, 3]);
    expect(fee.result.allocations.find((row) => row.id === "c")).toMatchObject({ status: "partial", remaining: 600 });
    expect([small.cardsPaid, small.cardsTotal]).toEqual([1, 3]);
    expect(small.result.allocations.map((row) => row.status)).toEqual(["paid", "partial", "unpaid", "excluded"]);
    expect(big.result.surplus).toBe(3000);
    expect(cardsPaidInFull(big.result)).toEqual({ paid: 3, total: 3 });
  });

  it("checks a quoted payment against the computed one with a $5 tolerance", () => {
    const computed = computedPayment({ amount: 12000, apr: 10, termMonths: 60 });
    expect(computed).toBe(Math.ceil(amortizedPayment(12000, 10, 60) * 100) / 100);
    expect(quoteCheck(offer("none"))).toBeNull();
    expect(quoteCheck(offer("close", { quotedPayment: computed + 4.99 }))?.differs).toBe(false);
    const far = quoteCheck(offer("far", { quotedPayment: computed - 40 }))!;
    expect(far).toEqual({ quoted: computed - 40, computed, delta: -40, differs: true });
    const [run] = simulateOffers(included, [], [offer("far", { quotedPayment: computed - 40 })], common);
    expect(run.quote?.differs).toBe(true);
  });

  it("applies the extra and the step-up to every scenario, the baseline included", () => {
    const stepUp = { amount: 400, startMonth: "2027-02" };
    const plainBase = simulateBaseline(included, common);
    const base = simulateBaseline(included, { ...common, extraMonthly: 100, stepUp });
    expect(base.firstMonthPayment).toBe(round(plainBase.firstMonthPayment + 100));
    expect(base.months!).toBeLessThan(plainBase.months!);
    // The step-up starts with the 4th payment (Feb 2027) and goes to the highest APR first.
    const paid = (sim: typeof base, m: number) => round(sim.series[m - 1].total - sim.series[m].total);
    expect(paid(base, 3)).toBeLessThan(paid(base, 4) - 350);
    const plain = simulateOffers(included, [], [offer("a"), offer("b", { apr: 12 })], common);
    const extra = simulateOffers(included, [], [offer("a"), offer("b", { apr: 12 })], { ...common, extraMonthly: 100, stepUp });
    extra.forEach((run, index) => {
      expect(run.result.firstMonthPayment).toBe(round(plain[index].result.firstMonthPayment + 100));
      expect(run.result.months!).toBeLessThan(plain[index].result.months!);
      expect(paid(run.result, 4) - paid(run.result, 3)).toBeGreaterThan(350);
    });
  });
});
