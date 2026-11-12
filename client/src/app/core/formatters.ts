/** Brand shown for a row. The server resolves it (parser/brandResolver.js); the client never guesses. */
export function brandFor(row: { brandName?: string }): string {
  return row.brandName?.trim() || 'Unknown';
}

export function money(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? 'n/a' : `₹${value.toLocaleString('en-IN', { maximumFractionDigits: digits })}`;
}

export function number(value: number | null | undefined, digits = 0): string {
  return value === null || value === undefined || Number.isNaN(value)
    ? 'n/a'
    : value.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function compareValues<T extends object>(a: T, b: T, key: keyof T): number {
  const left = a[key];
  const right = b[key];
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  return typeof left === 'string' && typeof right === 'string'
    ? left.localeCompare(right)
    : Number(left) - Number(right);
}

const SHORT_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1-31 Oct 2026", "28 Sep - 20 Oct 2026" or "28 Dec 2025 - 3 Jan 2026"; '' when a date is missing. */
export function periodText(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return '';
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return '';
  if (fy === ty && fm === tm) return fd === td ? `${fd} ${SHORT_MONTH_NAMES[fm - 1]} ${fy}` : `${fd}-${td} ${SHORT_MONTH_NAMES[fm - 1]} ${fy}`;
  if (fy === ty) return `${fd} ${SHORT_MONTH_NAMES[fm - 1]} - ${td} ${SHORT_MONTH_NAMES[tm - 1]} ${fy}`;
  return `${fd} ${SHORT_MONTH_NAMES[fm - 1]} ${fy} - ${td} ${SHORT_MONTH_NAMES[tm - 1]} ${ty}`;
}