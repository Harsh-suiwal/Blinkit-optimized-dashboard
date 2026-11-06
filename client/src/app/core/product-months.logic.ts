import { ProductMonthRow } from './models';

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
