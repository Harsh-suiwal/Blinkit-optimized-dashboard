import { CampaignRow } from './models';

export interface SelectionTotals {
  count: number;
  adSpend: number;
  sales: number;
  roas: number | null;
  roiPct: number | null;
  impressions: number;
  atc: number;
  qtySold: number;
  newUsers: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Combined figures for the campaigns ticked in the table. ROAS and ROI are recomputed from the sums (same formulas as the server), never averaged. */
export function selectionTotals(rows: CampaignRow[]): SelectionTotals {
  const sum = (pick: (row: CampaignRow) => number): number => rows.reduce((total, row) => total + pick(row), 0);
  const adSpend = sum((row) => row.adSpend);
  const sales = sum((row) => row.sales);
  return {
    count: rows.length,
    adSpend: round2(adSpend),
    sales: round2(sales),
    roas: adSpend > 0 ? round2(sales / adSpend) : null,
    roiPct: adSpend > 0 ? round1(((sales - adSpend) / adSpend) * 100) : null,
    impressions: sum((row) => row.impressions),
    atc: sum((row) => row.atc),
    qtySold: sum((row) => row.qtySold),
    newUsers: sum((row) => row.newUsersAcquired),
  };
}
