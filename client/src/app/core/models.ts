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
  revenue: number;
  units: number;
  orderCount: number;
  topCity?: string | null;
  cities: CityRow[];
}

export interface CampaignPeriod {
  periodKey: string;
  periodLabel: string;
}

export interface CampaignRow {
  storeIndex: number;
  campaignName: string;
  campaignDetail: string;
  status: string;
  brandName?: string;
  adSpend: number;
  sales: number;
  roas: number | null;
  roiPct: number | null;
  rosPerUnit: number | null;
  impressions: number;
  atc: number;
  qtySold: number;
  tier?: 'top' | 'low' | string;
}

export interface CampaignSummary {
  totalAdSpend: number;
  totalSales: number;
  overallRoas: number | null;
  roiPct: number | null;
  totalUnits: number;
  activeCampaigns: number;
  totalCampaigns: number;
  bestCampaign: { name: string; roas: number } | null;
  worstCampaign: { name: string; roas: number } | null;
  totalImpressions: number;
  totalAtc: number;
}
