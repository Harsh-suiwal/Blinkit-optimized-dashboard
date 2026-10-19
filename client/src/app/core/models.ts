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
