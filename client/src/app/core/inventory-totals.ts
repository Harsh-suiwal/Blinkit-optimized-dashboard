import { ProductRow } from './models';

export interface StockTotals {
  rows: number;
  stock: number;
  sold7: number;
  sold15: number;
  sold30: number;
  sold45: number | null;
  sold60: number | null;
  incoming: number;
  lowOrOut: number;
}

/** Column totals of the rows shown. The 45 and 60 day totals are null (shown as n/a) when no row has that figure. */
export function stockTotals(rows: ProductRow[]): StockTotals {
  const sum = (pick: (row: ProductRow) => number): number => rows.reduce((total, row) => total + pick(row), 0);
  const sumKnown = (pick: (row: ProductRow) => number | null): number | null => {
    const known = rows.map(pick).filter((value): value is number => value !== null);
    return known.length ? known.reduce((total, value) => total + value, 0) : null;
  };
  return {
    rows: rows.length,
    stock: sum((row) => row.totalStockAvailable),
    sold7: sum((row) => row.unitsSold7),
    sold15: sum((row) => row.unitsSold15),
    sold30: sum((row) => row.unitsSold30),
    sold45: sumKnown((row) => row.unitsSold45),
    sold60: sumKnown((row) => row.unitsSold60),
    incoming: sum((row) => row.incomingInventory),
    lowOrOut: rows.filter((row) => row.stockStatus !== 'ok').length,
  };
}

/** Keeps each product's warehouse rows together: used while searching, when no column sort is chosen. */
export function byProductThenWarehouse(a: ProductRow, b: ProductRow): number {
  return a.productName.localeCompare(b.productName) || a.warehouseName.localeCompare(b.warehouseName);
}
