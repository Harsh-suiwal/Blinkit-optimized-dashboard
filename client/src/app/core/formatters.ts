export function brandFor(row: { brandName?: string; productName?: string; topProduct?: string; campaignName?: string }): string {
  if (row.brandName?.trim()) return row.brandName.trim();
  const name = row.productName || row.topProduct || row.campaignName || '';
  if (!name) return '';
  const clean = name.trim();
  if (clean.toLowerCase().includes('oicia')) return 'Oicia';
  if (clean.toLowerCase().includes('smarteez')) return 'Smarteez';
  const match = clean.match(/^([A-Za-z0-9&'-]+)/);
  if (!match) return '';
  const value = match[1].split(/[_-]/)[0];
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
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
