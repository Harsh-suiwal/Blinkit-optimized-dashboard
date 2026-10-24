export interface User {
  id?: string;
  email: string;
  role: 'admin' | string;
}

export interface ProductRow {
  productName: string;
  brandName?: string;
  warehouseName: string;
  totalStockAvailable: number;
  unitsSold7: number;
  unitsSold15: number;
  unitsSold30: number;
  unitsSold45: number | null;
  unitsSold60: number | null;
  incomingInventory: number;
  stockStatus: 'ok' | 'low' | 'out';
}

export interface BrandUpload {
  date: string;
  fileName: string;
}

export interface InventorySummary {
  date?: string | null;
  totalUnitsSold30: number;
  totalStock: number;
  productCount: number;
  lowOrOutCount: number;
}

export interface CityRow {
  city: string;
  revenue: number;
  units: number;
  orderCount?: number;
  avgOrderValue?: number;
  topProduct?: string | null;
  topProductRevenue?: number;
  tier?: 'top' | 'low' | string;
  revenueChangePct?: number | null;
  previousRevenue?: number | null;
}

export interface SalesBrandRow {
  brandName: string;
  revenue: number;
  units: number;
}

export interface SalesSummary {
  date?: string | null;
  totalRevenue: number;
  totalUnits: number;
  totalOrders: number;
  cityCount: number;
  topCity: string | null;
}

export interface ProductSalesRow {
  productName: string;
  brandName?: string;
  revenue: number;
  units: number;
  orderCount: number;
  topCity?: string | null;
  cities: CityRow[];
}

export interface ProductCitySalesRow extends CityRow {
  productName: string;
  brandName?: string;
}

export interface CampaignPeriod {
  periodKey: string;
  periodLabel: string;
}

export type CampaignSheetType = 'PRODUCT_BOOSTING' | 'PRODUCT_RECOMMENDATION';
export type CampaignSheetFilter = CampaignSheetType | 'ALL';

/** Summed metrics; ratios are recomputed from the sums on the server. */
export interface CampaignMetrics {
  adSpend: number;
  sales: number;
  directSales: number;
  indirectSales: number;
  roas: number | null;
  directRoas: number | null;
  roiPct: number | null;
  rosPerUnit: number | null;
  cpm: number | null;
  impressions: number;
  directAtc: number;
  indirectAtc: number;
  atc: number;
  directQtySold: number;
  indirectQtySold: number;
  qtySold: number;
  newUsersAcquired: number;
}

export interface CampaignRow extends CampaignMetrics {
  campaignId: string;
  campaignName: string;
  brandName: string;
  sheetType: CampaignSheetType;
  targetingTypes: string[];
  activeDays: number;
  tier?: 'top' | 'low' | 'mid' | string;
}

export interface CampaignBrandRow extends CampaignMetrics {
  brandName: string;
  campaignCount: number;
}

export interface CampaignTargetingRow extends CampaignMetrics {
  targetingType: string;
  targetingValue: string;
}

export interface CampaignDailyRow extends CampaignMetrics {
  date: string;
}

export interface CampaignSummary {
  totalAdSpend: number;
  totalSales: number;
  overallRoas: number | null;
  directRoas: number | null;
  roiPct: number | null;
  totalUnits: number;
  totalCampaigns: number;
  bestCampaign: { name: string; roas: number } | null;
  worstCampaign: { name: string; roas: number } | null;
  totalImpressions: number;
  totalAtc: number;
  totalDirectAtc: number;
  totalIndirectAtc: number;
  totalNewUsers: number;
}

export interface CampaignUploadPlanItem {
  periodKey: string;
  periodLabel: string;
  sheetType: CampaignSheetType;
  brandName: string;
  incoming: { rowCount: number; from: string; to: string };
  existing: { rowCount: number; from: string; to: string } | null;
  /** Stored campaigns of this period/sheet that are not in the new file (they will be removed). */
  removedCampaigns: { campaignId: string; campaignName: string }[];
}

export interface CampaignUploadPreview {
  ok: boolean;
  dryRun: true;
  plan: CampaignUploadPlanItem[];
  rowCount: number;
  /** Campaigns whose brand resolves to "Unknown". */
  unresolved: { campaignId: string; campaignName: string; sheetType: CampaignSheetType }[];
  skippedRows: number;
  unrecognisedSheets: string[];
}

export interface CampaignUploadResult {
  ok: boolean;
  duplicate?: boolean;
  skipped?: boolean;
  periodKeys: string[];
  sheetTypes: CampaignSheetType[];
  rowCount: number;
  skippedRows: number;
  unrecognisedSheets: string[];
  latestPeriodKey: string;
}

/** One month of sales for a brand (or all brands combined), from GET /api/sales-months. */
export interface SalesMonth {
  monthKey: string;      // YYYY-MM
  label: string;         // e.g. "October 2026"
  from: string;          // first order date in that month (YYYY-MM-DD)
  to: string;            // last order date in that month
  partial: boolean;      // the orders don't cover every day of the month
  revenue: number;
  units: number;
  orderCount: number;
  avgOrderValue: number;
  brands: string[];
}

export interface MonthMetrics {
  revenue: number;
  units: number;
  orderCount: number;
  avgOrderValue: number;
}

export interface SalesMonthColumn extends MonthMetrics {
  monthKey: string;
  label: string;
  from: string;
  to: string;
  partial: boolean;
}

/** GET /api/sales-month-compare: months oldest first; byMonth is keyed by monthKey (missing = no sales). */
export interface SalesMonthComparison {
  months: SalesMonthColumn[];
  cities: { city: string; byMonth: Record<string, MonthMetrics> }[];
  products: { productName: string; brandName: string; byMonth: Record<string, MonthMetrics> }[];
}

export interface SalesMonthUploadResult {
  ok: boolean;
  duplicate?: boolean;
  skipped?: boolean;
  months?: { brandName: string; monthKey: string; label: string; orderCount: number; revenue: number }[];
  skippedRows?: number;
}

/** GET /api/brand-overview: a section is null when nothing was uploaded for the brand. */
export interface BrandOverview {
  brand: string;
  sales: {
    date: string | null;
    fileName: string | null;
    totalRevenue: number;
    totalUnits: number;
    totalOrders: number;
    avgOrderValue: number;
    cityCount: number;
    productCount: number;
    topCities: { city: string; revenue: number; sharePct: number }[];
    topProducts: { productName: string; revenue: number; units: number; sharePct: number }[];
  } | null;
  inventory: {
    date: string | null;
    fileName: string | null;
    productCount: number;
    listingCount: number;
    totalStock: number;
    unitsSold30: number;
    outOfStock: number;
    lowStock: number;
    topSellers: { productName: string; unitsSold30: number; stock: number }[];
  } | null;
  campaign: {
    periodKey: string;
    periodLabel: string;
    adSpend: number;
    sales: number;
    roas: number | null;
    roiPct: number | null;
    campaignCount: number;
    bestCampaign: { name: string; roas: number } | null;
  } | null;
  months: SalesMonth[];
}
