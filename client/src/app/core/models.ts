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
  stockHealth?: StockHealth;
}

/** What the stock is doing against demand, worked out by the server (parser/stockStatus.js). */
export interface StockHealth {
  key: 'healthy' | 'covered' | 'now' | 'urgent' | 'awaiting' | 'out' | 'nosales';
  label: string;          // the pill, e.g. "Reorder Now"
  needsAction: boolean;   // Reorder Now, Reorder Urgently, Awaiting Incoming or Out of Stock
  urgentAction: boolean;  // Reorder Urgently, Awaiting Incoming or Out of Stock (what the card counts)
  daysOfStock: number | null;
  pacePerDay: number;
  surge: boolean;
  line: string;           // the line under the pill
  surgeLine: string | null;   // the full surge sentence (also in the hover text)
  surgeBadge: string | null;  // the short version under the pill, e.g. "↑ Surge · 3.4 days left"
  tip: string;            // the working, shown on hover
}

export interface BrandUpload {
  date: string;
  fileName: string;
  from?: string | null;  // first / last order date this upload covers
  to?: string | null;
}

/** What the Sales tab is showing: the latest upload, or one chosen month (GET /api/city-performance). */
export interface SalesView {
  mode: 'latest' | 'month';
  monthKey: string;      // YYYY-MM, '' when the latest upload spans several months
  label: string;         // e.g. "October 2026"
  from: string | null;   // first / last order date in the numbers shown
  to: string | null;
  partial: boolean;      // the orders don't cover every day of that month
  fileNames: string[];
  comparesPrevious: boolean;
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
    from: string | null;   // first order date covered (null for uploads made before this was recorded)
    to: string | null;     // last order date covered
    monthKey?: string;     // only when a month was requested
    partial?: boolean;     // only when a month was requested: its orders don't cover every day
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

/** GET /api/brand-profit (admin). Money fields are null for a month where no sold product has a cost row. */
export interface ProfitUnmatchedProduct {
  productName: string;
  revenue: number;
  units: number;
}

export interface ProfitMonth {
  monthKey: string;
  label: string;
  from: string;
  to: string;
  partial: boolean;
  status: 'ok' | 'incomplete' | 'no-costs';
  grossSales: number;
  units: number;
  matchedUnits: number;
  matchedRevenuePct: number | null;
  netSales: number | null;
  productCost: number | null;
  fees: number | null;
  adSpend: number;
  adDataMissing: boolean;
  otherCosts: number;
  totalCosts: number | null;
  profit: number | null;
  marginPct: number | null;
  roiPct: number | null;
  unmatchedProducts: ProfitUnmatchedProduct[];
}

export interface ProfitTotals {
  months: number;
  incompleteMonths: number;
  grossSales: number;
  units: number;
  netSales: number;
  productCost: number;
  fees: number;
  adSpend: number;
  otherCosts: number;
  totalCosts: number;
  profit: number;
  marginPct: number | null;
  roiPct: number | null;
}

export interface ProfitProduct {
  productName: string;
  units: number;
  grossSales: number;
  netSales: number;
  productCost: number;
  fees: number;
  profitBeforeAds: number;
  profitPerUnit: number | null;
  sellingPrice: number;
  taxPct: number;
  commissionPct: number;
  listUnitProfit: number;
}

export interface BrandProfit {
  brand: string;
  hasCosts: boolean;
  costsUpload: { fileName: string; uploadedAt: string; productCount: number } | null;
  months: ProfitMonth[];
  totals: ProfitTotals | null;
  products: ProfitProduct[];
  unmatchedProducts: ProfitUnmatchedProduct[];
}

export interface BrandCostsUploadResult {
  ok: boolean;
  productCount: number;
  skippedRows: number;
}

/** GET /api/profit-view: the Profit tab. Every money figure is a whole rupee; rows add up to `totals`. */
export type ProfitGroup = 'month' | 'product' | 'city';

export interface ProfitSettings {
  defaultTaxPct: number;
  defaultCommissionPct: number;
  inwardFee: number;
  fulfilmentFee: number;
  storageFee: number;
}

export interface ProfitViewFigures {
  units: number;
  gross: number;
  gst: number;
  net: number;
  /** Net sales of products with no COGS yet: shown, but left out of the profit. */
  leftOut: number;
  leftOutGross: number;
  leftOutUnits: number;
  cogs: number;
  /** Blinkit fees without storage: commission + inward + fulfilment. */
  fees: number;
  storage: number;
  ads: number;
  other: number;
  profit: number;
  marginPct: number | null;
}

export interface ProfitViewRow extends ProfitViewFigures {
  key: string;
  label: string;
  partial: boolean;
  adMissing: boolean;
  changeGrossPct?: number | null;
  changeProfitPct?: number | null;
}

export interface ProfitViewCheck {
  id: string;
  label: string;
  expected: number;
  actual: number;
  ok: boolean;
}

export interface ProfitViewMonthCost {
  monthKey: string;
  label: string;
  partial: boolean;
  adSpend: number;
  adSpendExact: number | null;
  adMissing: boolean;
  otherCosts: number;
  adShare: number;
  otherShare: number;
}

export interface ProfitViewInputProduct {
  productName: string;
  units: number;
  gross: number;
  cogs: number | null;
  cogsSource: 'typed' | 'sheet' | null;
  hasCogs: boolean;
  taxPct: number;
  taxIsDefault: boolean;
  commissionPct: number;
  commissionIsDefault: boolean;
}

export interface ProfitView {
  brand: string;
  groupBy: ProfitGroup;
  includeAds: boolean;
  filters: { months: string[]; products: string[] | null; cities: string[] | null };
  available: {
    months: { monthKey: string; label: string; partial: boolean; cityDataMissing: boolean; gross: number }[];
    products: { key: string; productName: string; gross: number; hasCogs: boolean }[];
    cities: { city: string; gross: number }[];
  };
  rows: ProfitViewRow[];
  totals: ProfitViewFigures;
  brandCosts: { adSpend: number; adSpendExact: number | null; otherCosts: number; wholeBrand: boolean; months: ProfitViewMonthCost[] };
  notes: {
    leftOutProducts: { productName: string; units: number; gross: number }[];
    partialMonths: string[];
    adMissingMonths: string[];
    cityGapMonths: string[];
    unallocated: { monthKey: string; label: string; ads: number; other: number }[];
  };
  checks: ProfitViewCheck[];
  inputs: {
    settings: ProfitSettings;
    defaults: ProfitSettings;
    products: ProfitViewInputProduct[];
    otherCosts: { monthKey: string; label: string; partial: boolean; amount: number }[];
  };
}

export interface ProfitViewQuery {
  groupBy: ProfitGroup;
  /** Months to include; empty lets the server pick the latest full month. */
  months: string[];
  /** Names to keep; null = every product / city. */
  products: string[] | null;
  cities: string[] | null;
  includeAds: boolean;
}

export type ProfitProductField = 'cogs' | 'taxPct' | 'commissionPct';
/** GET /api/product-month-detail: the Sales > Month by month tab. Without `product` it returns only the names. */
export interface ProductMonthNames {
  products: string[];
}

export interface ProductMonthCity {
  city: string;
  revenue: number;
  units: number;
  orderCount: number;
  avgOrderValue: number;
  sharePct: number;
}

/** This product only, before ad spend. Null when the product has no cost-sheet row or the server hides profit. */
export interface ProductMonthProfit {
  netSales: number | null;
  productCost: number | null;
  fees: number | null;
  profitBeforeAds: number | null;
  profitPerUnit: number | null;
  marginPct: number | null;
}

export interface ProductMonthRow {
  monthKey: string;
  label: string;
  from: string;
  to: string;
  partial: boolean;
  revenue: number;
  units: number;
  orderCount: number;
  avgOrderValue: number;
  cityDataMissing: boolean;
  topCity: { city: string; revenue: number; sharePct: number } | null;
  cities: ProductMonthCity[];
  profit: ProductMonthProfit | null;
}

/** The whole brand's month (not the product): profit before and after ad spend. */
export interface ProductMonthBrandRow {
  monthKey: string;
  label: string;
  partial: boolean;
  status: 'ok' | 'incomplete' | 'no-costs';
  netSales: number | null;
  profitBeforeAds: number | null;
  adSpend: number;
  adDataMissing: boolean;
  otherCosts: number;
  profitAfterAds: number | null;
  marginPct: number | null;
}

export interface ProductMonthBrandTotals {
  months: number;
  incompleteMonths: number;
  netSales: number;
  profitBeforeAds: number;
  adSpend: number;
  otherCosts: number;
  profitAfterAds: number;
  marginPct: number | null;
}

export interface ProductMonthDetail {
  brand: string;
  product: string;
  profitVisible: boolean;
  months: ProductMonthRow[];
  brandMonths: ProductMonthBrandRow[];
  brandTotals: ProductMonthBrandTotals | null;
}

/** GET /api/uploads-overview (admin): what is uploaded for each brand, and which uploads can still be undone. */
export type UploadKind = 'inventory' | 'sales' | 'salesMonthly' | 'campaign' | 'costs';

export interface UploadsBrandRow {
  brand: string;
  stock: { fileName: string; date: string } | null;
  sales: { fileName: string; date: string; from: string | null; to: string | null } | null;
  monthly: { months: number; first: string; last: string; fileName: string; date: string } | null;
  advertising: { periods: string[]; fileName: string; date: string } | null;
  costs: { fileName: string; date: string; productCount: number } | null;
}

export interface UploadsUndoItem {
  kind: UploadKind;
  label: string;
  fileName: string;
  at: string;
  brands: string[];
}

export interface UploadsOverview {
  brands: UploadsBrandRow[];
  undo: UploadsUndoItem[];
}

export interface UploadUndoResult {
  ok: boolean;
  kind: UploadKind;
  label: string;
  fileName: string;
  brands: string[];
}

/** GET /api/brand-report: everything the client Report slides need for one brand. A section is null when its data was not uploaded. */
export interface ReportMonthRef { monthKey: string; label: string; hasSales: boolean; hasAds: boolean; units: number | null; }
export interface ReportSalesMonth {
  monthKey: string; label: string; from: string; to: string; days: number; fullDays: number; partial: boolean;
  units: number; revenue: number; orders: number; aov: number; unitsPerDay: number;
  products: { name: string; units: number; revenue: number; orders: number }[];
  cities: { city: string; revenue: number; units: number }[]; cityCount: number;
}
export interface ReportProductRow {
  name: string; perMonth: number[]; prevPerDay: number | null; latestPerDay: number; rateChangePct: number | null;
  mixPct: number; runRate: number; latestUnits: number;
}
export interface ReportShareSplit { label: string; units: number; topUnits: number; restUnits: number; top1: number | null; top2: number | null; rest: number | null; topShare: number | null; }
export interface ReportSales {
  months: ReportSalesMonth[]; latest: ReportSalesMonth; previous: ReportSalesMonth | null;
  rows: ReportProductRow[]; rateChangePct: number | null; multiple: number | null;
  projection: { units: number; perDay: number; days: number } | null;
  concentration: {
    top: string[]; previous: ReportShareSplit; latest: ReportShareSplit; topPerDay: { previous: number; latest: number };
    restPerDay: { previous: number; latest: number }; totalPerDay: { previous: number; latest: number }; topChange: number; restChange: number; netChange: number;
  } | null;
  productCount: number;
}
export interface ReportCampaign { name: string; type: string; spend: number; units: number; sales: number; roas: number | null; spendPerUnit: number | null; status: string; }
export interface ReportAdsMonth {
  periodKey: string; label: string; from: string; to: string; days: number; activeDays: number;
  spend: number; sales: number; units: number; impressions: number; atc: number; roas: number | null;
  spendPerUnit: number | null; spendPerRupee: number | null; spendPer1000: number | null; revenuePer1000: number | null; salesPerUnit: number | null;
  byType: { sheetType: string; label: string; spend: number }[]; campaigns: ReportCampaign[]; campaignCount: number;
}
export interface ReportAds {
  months: ReportAdsMonth[]; latest: ReportAdsMonth | null; previous: ReportAdsMonth | null;
  change: { spend: number | null; impressions: number | null; units: number | null; sales: number | null; roas: number | null; spendPerUnit: number | null; spendPerRupee: number | null; spendPer1000: number | null; revenuePer1000: number | null } | null;
}
export interface ReportWeekdayRow { weekday: string; short: string; daysWithData: number; impressions: number; atc: number; units: number; revenue: number; spend: number; roas: number | null; spendPerUnit: number | null; }
export interface ReportWeekday {
  days: ReportWeekdayRow[]; totals: { daysWithData: number; impressions: number; atc: number; units: number; revenue: number; spend: number; roas: number | null };
  winners: string[]; priorities: string[]; winnerShare: { spend: number; units: number }; priorityShare: { spend: number; units: number };
}
export interface ReportFunnel { impressions: number; atc: number; units: number; spend: number; atcRatePct: number | null; unitsPerAtcPct: number | null; spendPerAtc: number | null; spendPerUnit: number | null; }
export interface ReportKeyword { keyword: string; spend: number; units: number; sales: number; roas: number | null; impressions: number; decision: string; tone: 'red' | 'amber' | 'grey'; evidence: string; signal: string; action: string; }
export interface ReportStock { products: { name: string; stock: number; sold30: number; lowOrOut: number; rows: number }[]; totals: { stock: number; sold30: number; listings: number; lowOrOut: number; products: number }; }
export interface ReportProfit {
  months: { label: string; partial: boolean; netSales: number | null; productCost: number | null; fees: number | null; adSpend: number; otherCosts: number; totalCosts: number | null; profit: number | null; marginPct: number | null; roiPct: number | null; adDataMissing: boolean }[];
  totals: { netSales: number; totalCosts: number; profit: number; adSpend: number };
  contributionMarginPct: number | null; breakEvenRoas: number | null;
  products: { name: string; units: number; profitPerUnit: number | null; listUnitProfit: number; marginPct: number | null }[];
}
export interface BrandReport {
  brand: string; generatedOn: string; availableMonths: ReportMonthRef[]; selectedMonths: string[];
  sales: ReportSales | null; ads: ReportAds | null; weekday: ReportWeekday | null; funnel: ReportFunnel | null;
  keywords: { list: ReportKeyword[]; total: number } | null; stock: ReportStock | null; profit: ReportProfit | null;
  coverage: { sales: { from: string; to: string } | null; ads: { label: string; from: string; to: string }[]; adDays: number };
  insights: {
    decisions: string[]; management: { continue: string[]; optimize: string[]; restrict: string[]; fix: string[]; measure: string[] };
    trajectory?: string; products?: string; concentration?: string; ads?: Record<string, string>; efficiency?: string; weekday?: string; funnel?: string;
  };
  available: { sales: boolean; trajectory: boolean; concentration: boolean; ads: boolean; efficiency: boolean; weekday: boolean; funnel: boolean; keywords: boolean; stock: boolean; profit: boolean };
}