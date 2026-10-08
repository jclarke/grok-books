/**
 * Debt payoff what-if: keep paying the cards vs one consolidation loan.
 * Pure arithmetic in dollars, no React. Month by month: interest accrues on each
 * balance at APR / 12, then payments come off. Estimates only.
 */

export interface Debt {
  id: string;
  label: string;
  balance: number;
  /** Percent, e.g. 22.99. */
  apr: number;
  /** Monthly minimum, held constant. */
  minimum: number;
}

export type Strategy = "minimums" | "budget";

export interface BaselineOptions {
  strategy: Strategy;
  /** Fixed total a month for 'budget': all minimums, then the rest to the highest APR (avalanche). */
  budget?: number;
  /** First payment month, YYYY-MM (next month from today). */
  firstMonth: string;
  maxMonths?: number;
  /** Paid on top every month. On the cards: highest APR first. On a consolidation: to the loan, then the rest. */
  extraMonthly?: number;
  /** A further extra from a given month (e.g. when another loan ends). Same targets as extraMonthly. */
  stepUp?: StepUp | null;
}

export interface SeriesPoint {
  /** YYYY-MM. The first point is the month before the first payment, at the starting balance. */
  month: string;
  total: number;
}

export interface SimResult {
  series: SeriesPoint[];
  firstMonthPayment: number;
  /** Months until everything is paid, or null when it never is within maxMonths. */
  months: number | null;
  payoffMonth: string | null;
  totalInterest: number;
  totalFees: number;
  totalPaid: number;
  neverPaysOff: boolean;
  /** The budget was below the sum of minimums, so minimums were used instead. */
  budgetBelowMinimums: boolean;
  /** Month index (1 = first payment) each debt was paid off, null if never. */
  paidOffAt: Record<string, number | null>;
}

export type CardStatus = "paid" | "partial" | "unpaid" | "excluded";

export interface CardAllocation {
  id: string;
  label: string;
  balance: number;
  paidFromLoan: number;
  remaining: number;
  status: CardStatus;
}

export interface StepUp {
  amount: number;
  /** YYYY-MM the extra starts. */
  startMonth: string;
}

export interface ConsolidationOptions extends BaselineOptions {
  /** Loan principal. Defaults to the sum of the included balances. */
  amount?: number;
  apr: number;
  /** Origination fee, percent of the loan (0-10). */
  feePct: number;
  /** True: the fee comes out of the proceeds. False: full proceeds, fee paid separately. */
  feeDeducted: boolean;
  termMonths: number;
  /** Baseline interest to compare against, for interestSaved. */
  baselineInterest?: number;
}

export interface ConsolidationResult extends SimResult {
  amount: number;
  fee: number;
  /** Cash that reaches the cards. */
  proceeds: number;
  /** Loan needed so the net proceeds cover every included balance. */
  amountNeeded: number;
  /** Proceeds above the included balances (handed back to you). */
  surplus: number;
  loanPayment: number;
  loanPayoffMonth: string | null;
  allocations: CardAllocation[];
  /** baseline interest - (consolidation interest + fees); negative means it costs more. */
  interestSaved: number | null;
}

export const DEFAULT_MAX_MONTHS = 600;
export const LOAN_ID = "__consolidation_loan__";

const EPS = 0.005;

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** YYYY-MM plus n months. */
export function addMonths(month: string, n: number): string {
  const [year, mon] = month.split("-").map(Number);
  const index = year * 12 + (mon - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Whole months from a to b (YYYY-MM). */
export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/** The month after today's (YYYY-MM-DD or a Date): when the first payment lands. */
export function nextMonth(today: string | Date): string {
  const iso = typeof today === "string" ? today : `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  return addMonths(iso.slice(0, 7), 1);
}

/** Standard amortized monthly payment; APR 0 is straight-line. */
export function amortizedPayment(principal: number, aprPct: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  const rate = aprPct / 100 / 12;
  if (rate === 0) return principal / months;
  return (principal * rate) / (1 - Math.pow(1 + rate, -months));
}

/** A rough minimum for a card whose minimum is unknown: 1% of the balance plus a month's interest, at least $25. */
export function estimateMinimum(balance: number, aprPct: number): number {
  if (balance <= 0) return 0;
  return Math.min(balance, Math.ceil(Math.max(25, balance * 0.01 + (balance * aprPct) / 1200)));
}

interface RunDebt extends Debt {
  /** Extra aimed at this debt in month m (1-based); what it does not need spills to the rest. */
  extra?: (month: number) => number;
}

interface RunOptions {
  budget: number | null;
  firstMonth: string;
  maxMonths: number;
  /** Extra money in month m that goes to the highest APR first. */
  poolExtra?: (month: number) => number;
}

interface RunResult {
  series: SeriesPoint[];
  payments: number[];
  totalInterest: number;
  totalPaid: number;
  months: number | null;
  paidOffAt: Record<string, number | null>;
}

/** Highest APR first; smaller balance breaks ties. */
function avalancheOrder(debts: { apr: number; balance: number }[]): number[] {
  return debts
    .map((_, index) => index)
    .sort((a, b) => debts[b].apr - debts[a].apr || debts[a].balance - debts[b].balance);
}

function run(input: RunDebt[], options: RunOptions): RunResult {
  const debts = input.map((debt) => ({ ...debt, balance: round2(Math.max(0, debt.balance)) }));
  const paidOffAt: Record<string, number | null> = Object.fromEntries(debts.map((debt) => [debt.id, debt.balance > EPS ? null : 0]));
  const series: SeriesPoint[] = [{ month: addMonths(options.firstMonth, -1), total: round2(sum(debts.map((debt) => debt.balance))) }];
  const payments: number[] = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let months: number | null = series[0].total <= EPS ? 0 : null;
  for (let m = 1; m <= options.maxMonths && months === null; m += 1) {
    let paid = 0;
    const pay = (index: number, amount: number) => {
      const debt = debts[index];
      const applied = Math.min(Math.max(0, amount), debt.balance);
      debt.balance = round2(debt.balance - applied);
      if (debt.balance <= EPS) debt.balance = 0;
      paid += applied;
      return applied;
    };
    for (const debt of debts) {
      if (debt.balance <= 0) continue;
      const interest = round2((debt.balance * debt.apr) / 1200);
      debt.balance = round2(debt.balance + interest);
      totalInterest += interest;
    }
    const active = debts.map((debt) => debt.balance > 0);
    let pool = 0;
    debts.forEach((debt, index) => {
      if (active[index]) pay(index, debt.minimum);
    });
    if (options.budget !== null) pool += Math.max(0, options.budget - paid);
    if (options.poolExtra) pool += Math.max(0, options.poolExtra(m));
    debts.forEach((debt, index) => {
      const extra = active[index] && debt.extra ? Math.max(0, debt.extra(m)) : 0;
      if (extra > 0) pool += extra - pay(index, extra);
      else if (!active[index] && debt.extra) pool += Math.max(0, debt.extra(m));
    });
    for (const index of avalancheOrder(debts)) {
      if (pool <= EPS) break;
      if (debts[index].balance > 0) pool -= pay(index, pool);
    }
    debts.forEach((debt, index) => {
      if (active[index] && debt.balance === 0 && paidOffAt[debt.id] === null) paidOffAt[debt.id] = m;
    });
    totalPaid += paid;
    payments.push(round2(paid));
    const total = round2(sum(debts.map((debt) => debt.balance)));
    series.push({ month: addMonths(options.firstMonth, m - 1), total });
    if (total <= EPS) months = m;
  }
  return { series, payments, totalInterest: round2(totalInterest), totalPaid: round2(totalPaid), months, paidOffAt };
}

function result(runResult: RunResult, firstMonth: string, extra: { totalFees?: number; budgetBelowMinimums?: boolean } = {}): SimResult {
  const fees = extra.totalFees ?? 0;
  const { months } = runResult;
  return {
    series: runResult.series,
    firstMonthPayment: runResult.payments[0] ?? 0,
    months,
    payoffMonth: months === null ? null : months === 0 ? addMonths(firstMonth, -1) : addMonths(firstMonth, months - 1),
    totalInterest: runResult.totalInterest,
    totalFees: round2(fees),
    totalPaid: round2(runResult.totalPaid + fees),
    neverPaysOff: months === null,
    budgetBelowMinimums: extra.budgetBelowMinimums ?? false,
    paidOffAt: runResult.paidOffAt,
  };
}

function budgetFor(options: BaselineOptions, minimums: number): { budget: number | null; short: boolean } {
  if (options.strategy !== "budget") return { budget: null, short: false };
  const budget = Math.max(0, options.budget ?? minimums);
  if (budget + EPS < minimums) return { budget: null, short: true };
  return { budget, short: false };
}

/** Monthly extra (fixed plus step-up) in payment month m (1 = firstMonth). */
export function extraFor(options: Pick<BaselineOptions, "extraMonthly" | "stepUp" | "firstMonth">): (month: number) => number {
  const extraMonthly = Math.max(0, options.extraMonthly ?? 0);
  const stepUp = options.stepUp && options.stepUp.amount > 0 ? options.stepUp : null;
  const stepUpFrom = stepUp ? monthsBetween(options.firstMonth, stepUp.startMonth) + 1 : Infinity;
  return (m) => extraMonthly + (stepUp && m >= stepUpFrom ? stepUp.amount : 0);
}

/** Keep paying the cards: minimums only, or a fixed monthly budget (avalanche). Extras go to the highest APR. */
export function simulateBaseline(debts: Debt[], options: BaselineOptions): SimResult {
  const live = debts.filter((debt) => debt.balance > EPS);
  const { budget, short } = budgetFor(options, sum(live.map((debt) => Math.min(debt.minimum, debt.balance))));
  const runResult = run(live, { budget, firstMonth: options.firstMonth, maxMonths: options.maxMonths ?? DEFAULT_MAX_MONTHS, poolExtra: extraFor(options) });
  return result(runResult, options.firstMonth, { budgetBelowMinimums: short });
}

/** How the net proceeds pay the included balances, highest APR first. */
export function allocateProceeds(included: Debt[], proceeds: number): { allocations: CardAllocation[]; surplus: number } {
  let cash = Math.max(0, proceeds);
  const order = avalancheOrder(included);
  const allocations: CardAllocation[] = new Array(included.length);
  for (const index of order) {
    const debt = included[index];
    const paidFromLoan = round2(Math.min(cash, debt.balance));
    cash = round2(cash - paidFromLoan);
    const remaining = round2(debt.balance - paidFromLoan);
    allocations[index] = {
      id: debt.id,
      label: debt.label,
      balance: debt.balance,
      paidFromLoan,
      remaining,
      status: remaining <= EPS ? "paid" : paidFromLoan > 0 ? "partial" : "unpaid",
    };
  }
  return { allocations, surplus: round2(cash) };
}

/** Loan that nets `balance` after a fee of feePct percent taken from the proceeds. */
export function grossUp(balance: number, feePct: number): number {
  const fraction = 1 - feePct / 100;
  return fraction <= 0 ? Infinity : Math.ceil((balance / fraction) * 100) / 100;
}

/**
 * One loan pays off the included cards (and any included loans); excluded cards
 * and whatever the proceeds do not cover keep going on the baseline strategy.
 * With a budget, the same total a month goes to the loan payment and every
 * minimum first, then the rest to the highest APR (the loan included).
 */
export function simulateConsolidation(included: Debt[], excluded: Debt[], options: ConsolidationOptions): ConsolidationResult {
  const includedLive = included.filter((debt) => debt.balance > EPS);
  const excludedLive = excluded.filter((debt) => debt.balance > EPS);
  const includedTotal = round2(sum(includedLive.map((debt) => debt.balance)));
  const amount = round2(Math.max(0, options.amount ?? includedTotal));
  const feePct = Math.min(10, Math.max(0, options.feePct));
  const fee = round2((amount * feePct) / 100);
  const proceeds = options.feeDeducted ? round2(amount - fee) : amount;
  const { allocations, surplus } = allocateProceeds(includedLive, proceeds);
  const amountNeeded = options.feeDeducted ? grossUp(includedTotal, feePct) : includedTotal;
  // Rounded up to the cent, as lenders do, so the loan ends on its term (the last payment is a little smaller).
  const loanPayment = Math.ceil(amortizedPayment(amount, options.apr, options.termMonths) * 100 - 1e-6) / 100;
  const extra = extraFor(options);
  const loan: RunDebt = { id: LOAN_ID, label: "Consolidation loan", balance: amount, apr: options.apr, minimum: loanPayment, extra };
  const leftovers: Debt[] = allocations
    .filter((row) => row.remaining > EPS)
    .map((row) => ({ ...includedLive.find((debt) => debt.id === row.id)!, balance: row.remaining }));
  const debts: RunDebt[] = amount > 0 ? [loan, ...leftovers, ...excludedLive] : [...leftovers, ...excludedLive];
  const { budget, short } = budgetFor(options, sum(debts.map((debt) => Math.min(debt.minimum, debt.balance))));
  // With no loan the extras have nothing to aim at, so they go to the cards like the baseline.
  const runResult = run(debts, {
    budget,
    firstMonth: options.firstMonth,
    maxMonths: options.maxMonths ?? DEFAULT_MAX_MONTHS,
    poolExtra: amount > 0 ? undefined : extra,
  });
  const totalFees = fee;
  // A fee taken from the proceeds is repaid inside the loan; a separate fee is paid on top.
  const base = result(runResult, options.firstMonth, { totalFees: options.feeDeducted ? 0 : fee, budgetBelowMinimums: short });
  const loanMonths = runResult.paidOffAt[LOAN_ID];
  const excludedAllocations: CardAllocation[] = excludedLive.map((debt) => ({
    id: debt.id,
    label: debt.label,
    balance: debt.balance,
    paidFromLoan: 0,
    remaining: debt.balance,
    status: "excluded",
  }));
  const interestSaved = options.baselineInterest === undefined ? null : round2(options.baselineInterest - (base.totalInterest + totalFees));
  const paidOffAt = { ...runResult.paidOffAt };
  delete paidOffAt[LOAN_ID];
  return {
    ...base,
    totalFees,
    paidOffAt,
    amount,
    fee,
    proceeds,
    amountNeeded,
    surplus,
    loanPayment,
    loanPayoffMonth: amount > 0 && loanMonths !== null && loanMonths !== undefined ? addMonths(options.firstMonth, loanMonths - 1) : null,
    allocations: [...allocations, ...excludedAllocations],
    interestSaved,
  };
}

// --- several offers at once -------------------------------------------------------------

/** A loan to compare: a saved offer or the custom what-if inputs. */
export interface LoanOffer {
  key: string;
  label: string;
  amount: number;
  apr: number;
  feePct: number;
  feeDeducted: boolean;
  termMonths: number;
  /** Monthly payment as the lender quoted it, if known. */
  quotedPayment?: number | null;
}

export interface QuoteCheck {
  quoted: number;
  computed: number;
  /** quoted - computed */
  delta: number;
  /** More than $5 apart. */
  differs: boolean;
}

export interface OfferScenario {
  offer: LoanOffer;
  result: ConsolidationResult;
  /** Included balances the net proceeds pay in full, and how many there are. */
  cardsPaid: number;
  cardsTotal: number;
  quote: QuoteCheck | null;
}

export const QUOTE_TOLERANCE = 5;

/** The loan payment this app computes for an offer (standard amortization, rounded up to the cent). */
export function computedPayment(offer: Pick<LoanOffer, "amount" | "apr" | "termMonths">): number {
  return Math.ceil(amortizedPayment(offer.amount, offer.apr, offer.termMonths) * 100 - 1e-6) / 100;
}

export function quoteCheck(offer: LoanOffer): QuoteCheck | null {
  if (offer.quotedPayment === null || offer.quotedPayment === undefined || offer.quotedPayment <= 0) return null;
  const computed = computedPayment(offer);
  const delta = round2(offer.quotedPayment - computed);
  return { quoted: offer.quotedPayment, computed, delta, differs: Math.abs(delta) > QUOTE_TOLERANCE };
}

/** Included balances paid in full by the proceeds. */
export function cardsPaidInFull(result: ConsolidationResult): { paid: number; total: number } {
  const included = result.allocations.filter((row) => row.status !== "excluded");
  return { paid: included.filter((row) => row.status === "paid").length, total: included.length };
}

/**
 * Every offer against the same included/excluded balances and the same
 * baseline strategy, extra, and step-up. The offer's own amount is used, so
 * the proceeds may fall short (cards left, highest APR paid first) or exceed
 * the balances (surplus).
 */
export function simulateOffers(included: Debt[], excluded: Debt[], offers: LoanOffer[], common: BaselineOptions & { baselineInterest?: number }): OfferScenario[] {
  return offers.map((offer) => {
    const result = simulateConsolidation(included, excluded, {
      ...common,
      amount: offer.amount,
      apr: offer.apr,
      feePct: offer.feePct,
      feeDeducted: offer.feeDeducted,
      termMonths: offer.termMonths,
    });
    const { paid, total } = cardsPaidInFull(result);
    return { offer, result, cardsPaid: paid, cardsTotal: total, quote: quoteCheck(offer) };
  });
}
