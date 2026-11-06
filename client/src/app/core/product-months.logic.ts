import { ProductMonthBrandRow, ProductMonthRow } from './models';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

export type Tier = 'top' | 'low' | 'mid';

/** "Oct 26" */
export function shortMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${SHORT_MONTHS[month - 1]} ${String(year).slice(-2)}`;
}

/** "October" */
export function monthName(monthKey: string): string {
  return MONTH_NAMES[Number(monthKey.slice(5, 7)) - 1];
}

/** ₹1.24L / ₹68.8k / ₹950, the way Indian sales teams read figures. */
export function compactMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10000000) return `₹${(value / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `₹${(value / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `₹${(value / 1000).toFixed(1)}k`;
  return `₹${Math.round(value)}`;
}

/** Rupees with a minus sign in front of the ₹ for a loss: -₹1,200. */
export function signedMoney(value: number, digits = 0): string {
  const text = `₹${Math.abs(value).toLocaleString('en-IN', { maximumFractionDigits: digits })}`;
  return value < 0 ? `-${text}` : text;
}

/** % change from `previous` to `current` to one decimal; null when there is nothing to compare with (previous is 0). */
export function percentChange(previous: number, current: number): number | null {
  return previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;
}

export interface MonthChange {
  kind: 'first' | 'partial' | 'no-sales' | 'change';
  pct: number | null;
  previousKey: string;
}

/** How month `index` compares with the month before it in the list. Partial months are never compared. */
export function monthChange(columns: ProductMonthRow[], index: number): MonthChange {
  if (index <= 0 || index >= columns.length) return { kind: 'first', pct: null, previousKey: '' };
  const previous = columns[index - 1];
  const current = columns[index];
  if (previous.partial || current.partial) return { kind: 'partial', pct: null, previousKey: previous.monthKey };
  const pct = percentChange(previous.revenue, current.revenue);
  return pct === null
    ? { kind: 'no-sales', pct: null, previousKey: previous.monthKey }
    : { kind: 'change', pct, previousKey: previous.monthKey };
}

/** Neutral wording: a decline reads "-5% vs Sep", never alarming. */
export function changeText(change: MonthChange): string {
  if (change.kind === 'first') return 'Starting month';
  if (change.kind === 'partial') return 'Partial month: not compared';
  if (change.kind === 'no-sales') return `No sales in ${shortMonth(change.previousKey)}`;
  const pct = change.pct ?? 0;
  return `${pct > 0 ? '+' : ''}${pct}% vs ${shortMonth(change.previousKey)}`;
}

/**
 * Tags rows 'top' (top 25% by revenue) or 'low' (bottom 25%), the same rule as the City wise
 * view on the Sales page. Fewer than 2 rows: no tiers.
 */
export function withTiers<T extends { revenue: number }>(rows: T[]): (T & { tier: Tier })[] {
  const n = rows.length;
  if (n < 2) return rows.map((row) => ({ ...row, tier: 'mid' as Tier }));
  const cutoff = Math.max(1, Math.ceil(n * 0.25));
  const tiers = new Map<T, Tier>();
  [...rows].sort((a, b) => b.revenue - a.revenue)
    .forEach((row, i) => tiers.set(row, i < cutoff ? 'top' : i >= n - cutoff ? 'low' : 'mid'));
  return rows.map((row) => ({ ...row, tier: tiers.get(row) ?? 'mid' }));
}
export interface Win {
  key: string;
  text: string;
}

// A win's percentage is rounded DOWN, never up, so a headline is never bigger than the truth.
const wholePct = (pct: number): number => Math.floor(pct);

/**
 * The good news for the latest selected month. A win is listed only when it is true:
 * partial months are never compared, a zero base is never used, declines are never listed.
 * `allMonths` is every month of the product (for "record month"), `columns` the selected ones.
 */
export function computeWins(input: { columns: ProductMonthRow[]; allMonths: ProductMonthRow[]; profitVisible: boolean }): Win[] {
  const { columns, allMonths, profitVisible } = input;
  const wins: Win[] = [];
  if (!columns.length) return wins;
  const first = columns[0];
  const last = columns[columns.length - 1];
  const previous = columns.length >= 2 ? columns[columns.length - 2] : null;

  if (allMonths.length >= 2 && !last.partial && last.revenue > 0
    && allMonths.every((m) => m.monthKey === last.monthKey || m.revenue < last.revenue)) {
    wins.push({ key: 'record', text: `Record month: ${signedMoney(last.revenue, 0)}` });
  }

  if (previous && !previous.partial && !last.partial) {
    const pct = percentChange(previous.revenue, last.revenue);
    if (pct !== null && wholePct(pct) >= 1) {
      wins.push({ key: 'vs-previous', text: `Up ${wholePct(pct)}% on ${monthName(previous.monthKey)}` });
    }
  }

  if (columns.length >= 3 && !first.partial && !last.partial) {
    const pct = percentChange(first.revenue, last.revenue);
    if (pct !== null && wholePct(pct) >= 1) {
      wins.push({ key: 'since-first', text: `Up ${wholePct(pct)}% since ${monthName(first.monthKey)}` });
    }
  }

  let streak = 0;
  for (let i = columns.length - 1; i > 0; i -= 1) {
    const before = columns[i - 1];
    const current = columns[i];
    if (before.partial || current.partial || !(before.revenue > 0) || !(current.revenue > before.revenue)) break;
    streak += 1;
  }
  if (streak >= 2) wins.push({ key: 'streak', text: `${streak} months of growth in a row` });

  if (previous && !previous.partial && !last.partial && !last.cityDataMissing && !previous.cityDataMissing) {
    const seen = new Set(previous.cities.map((c) => c.city));
    const fresh = last.cities.filter((c) => c.revenue > 0 && !seen.has(c.city)).map((c) => c.city);
    if (fresh.length) {
      const shown = fresh.slice(0, 3).join(', ');
      const more = fresh.length > 3 ? ` and ${fresh.length - 3} more` : '';
      wins.push({ key: 'new-city', text: `${fresh.length === 1 ? 'New city' : 'New cities'}: ${shown}${more}` });
    }
  }

  if (profitVisible && previous) {
    const now = last.profit?.profitPerUnit ?? null;
    const before = previous.profit?.profitPerUnit ?? null;
    if (now !== null && before !== null && now > before) {
      wins.push({ key: 'profit-per-unit', text: `Profit per unit up from ${signedMoney(before, 2)} to ${signedMoney(now, 2)}` });
    }
  }
  return wins;
}

export interface BrandStripTotal {
  profitBeforeAds: number;
  adSpend: number;
  profitAfterAds: number | null;
  marginPct: number | null;
  adDataMissing: boolean;
}

/**
 * Total of the whole-brand rows shown in the strip. Months without a cost sheet are left out.
 * When any month has no advertising upload, profit after ads and margin are not totalled (null).
 */
export function brandStripTotal(rows: ProductMonthBrandRow[]): BrandStripTotal | null {
  const counted = rows.filter((r) => r.status !== 'no-costs');
  if (!counted.length) return null;
  const adDataMissing = counted.some((r) => r.adDataMissing);
  const sum = (pick: (r: ProductMonthBrandRow) => number | null): number => counted.reduce((total, r) => total + (pick(r) ?? 0), 0);
  const netSales = sum((r) => r.netSales);
  const profitAfterAds = adDataMissing ? null : Math.round(sum((r) => r.profitAfterAds) * 100) / 100;
  return {
    profitBeforeAds: Math.round(sum((r) => r.profitBeforeAds) * 100) / 100,
    adSpend: Math.round(sum((r) => r.adSpend) * 100) / 100,
    profitAfterAds,
    marginPct: profitAfterAds !== null && netSales > 0 ? Math.round((profitAfterAds / netSales) * 1000) / 10 : null,
    adDataMissing,
  };
}
