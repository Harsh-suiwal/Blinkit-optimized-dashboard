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
