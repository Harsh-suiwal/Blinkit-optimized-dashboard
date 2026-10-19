import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import {
  BrandUpload,
  CampaignBrandRow,
  CampaignDailyRow,
  CampaignPeriod,
  CampaignRow,
  CampaignSheetFilter,
  CampaignSheetType,
  CampaignSummary,
  CampaignTargetingRow,
  CampaignUploadPlanItem,
  CityRow,
  SalesBrandRow,
  ProductRow,
  ProductCitySalesRow,
  ProductSalesRow,
  SalesSummary,
  User,
} from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  me() {
    return this.get<{ user: User }>('/api/me');
  }

  logout() {
    return this.post<{ ok: boolean }>('/api/logout', {});
  }

  products() {
    return this.get<{ date: string | null; brandUploads?: Record<string, BrandUpload>; rows: ProductRow[] }>('/api/products');
  }


  uploadInventory(file: File) {
    return this.upload<{ ok: boolean; date: string; rowCount: number; totalRowCount: number; brands: string[] }>('/api/upload', file);
  }

  clearInventory(brand?: string) {
    return this.delete<{ ok: boolean }>(`/api/inventory-data${this.brandQuery(brand)}`);
  }

  clearCampaignData(brand?: string) {
    return this.delete<{ ok: boolean }>(`/api/campaign-data${this.brandQuery(brand)}`);
  }

  deleteProduct(row: ProductRow) {
    const query = new URLSearchParams({ productName: row.productName, warehouseName: row.warehouseName });
    return this.delete<{ ok: boolean; removedRow: ProductRow; index: number }>(`/api/products?${query}`);
  }

  restoreProduct(row: ProductRow, index: number) {
    return this.post<{ ok: boolean }>('/api/products/restore', { row, index });
  }

  productNames() {
    return this.get<{ names: string[] }>('/api/product-names');
  }

  brandNames() {
    return this.get<{ brands: string[] }>('/api/brand-names');
  }

  cityPerformance(brand?: string) {
    return this.get<{ date: string | null; brandUploads: Record<string, BrandUpload>; cityRows: CityRow[]; brandSummaries: SalesBrandRow[] }>(`/api/city-performance${this.brandQuery(brand)}`);
  }

  salesSummary(brand?: string) {
    return this.get<SalesSummary>(`/api/sales-summary${this.brandQuery(brand)}`);
  }

  productSales(product: string) {
    return this.get<{ date: string | null; row: ProductSalesRow | null }>(`/api/product-sales?product=${encodeURIComponent(product)}`);
  }

  productCitySales(brand?: string) {
    return this.get<{ date: string | null; productRows: (ProductSalesRow & { cities: ProductCitySalesRow[] })[] }>(`/api/product-city-sales${this.brandQuery(brand)}`);
  }

  brandSales(brand: string) {
    return this.get<{ date: string | null; cityRows: CityRow[] }>(`/api/brand-sales?brand=${encodeURIComponent(brand)}`);
  }

  uploadSales(file: File) {
    return this.upload<{ ok: boolean; date: string; brands: string[]; cityCount: number; totalCityCount: number; orderRowCount: number }>('/api/sales-upload', file);
  }

  deleteCity(city: string) {
    return this.delete<{ ok: boolean; removedRows: CityRow[]; removedHistorySnapshots: unknown[] }>(`/api/city-performance/${encodeURIComponent(city)}`);
  }

  restoreCity(cityRows: CityRow[], historySnapshots: unknown[]) {
    return this.post<{ ok: boolean }>('/api/city-performance/restore', { cityRows, historySnapshots });
  }

  /** Clears one brand's sales data, or everything when no brand is given. */
  clearSalesHistory(brand?: string) {
    return this.delete<{ ok: boolean }>(`/api/sales-history${this.brandQuery(brand)}`);
  }

  campaignData(periodKey?: string, brand?: string, sheetType?: CampaignSheetFilter) {
    return this.get<{ date: string | null; periods: CampaignPeriod[]; periodKey: string | null; latestPeriodKey: string | null; campaigns: CampaignRow[]; brandSummaries: CampaignBrandRow[]; allBrands: string[] }>(`/api/campaign-analysis${this.campaignQuery(periodKey, brand, sheetType)}`);
  }

  campaignSummary(periodKey: string, brand?: string, sheetType?: CampaignSheetFilter) {
    return this.get<CampaignSummary>(`/api/campaign-summary${this.campaignQuery(periodKey, brand, sheetType)}`);
  }

  campaignBrands(periodKey?: string, sheetType?: CampaignSheetFilter) {
    return this.get<{ periodKey: string | null; brands: { brandName: string; adSpend: number; campaignCount: number }[] }>(`/api/campaign-brands${this.campaignQuery(periodKey, undefined, sheetType)}`);
  }

  campaignDetail(periodKey: string, sheetType: CampaignSheetType, campaignId: string) {
    const query = new URLSearchParams({ periodKey, sheetType, campaignId });
    return this.get<{ periodKey: string | null; targeting: CampaignTargetingRow[]; daily: CampaignDailyRow[] }>(`/api/campaign-detail?${query}`);
  }

  /** Dry run: what an upload would replace, without storing anything. */
  previewCampaignUpload(file: File) {
    return this.upload<{ ok: boolean; dryRun: true; plan: CampaignUploadPlanItem[]; rowCount: number }>('/api/campaign-upload?dryRun=1', file);
  }

  uploadCampaign(file: File) {
    return this.upload<{ ok: boolean; periodKeys: string[]; sheetTypes: CampaignSheetType[]; rowCount: number; latestPeriodKey: string }>('/api/campaign-upload', file);
  }

  deleteCampaign(periodKey: string, sheetType: CampaignSheetType, campaignId: string) {
    return this.delete<{ ok: boolean; removedRows: number; undoToken: string }>('/api/campaign-analysis', { periodKey, sheetType, campaignId });
  }

  restoreCampaign(undoToken: string) {
    return this.post<{ ok: boolean; restoredRows: number }>('/api/campaign-analysis/restore', { undoToken });
  }

  addBrandAlias(raw: string, canonical: string) {
    return this.post<{ ok: boolean }>('/api/brand-alias', { raw, canonical });
  }

  private brandQuery(brand?: string) {
    return brand ? `?brand=${encodeURIComponent(brand)}` : '';
  }

  private campaignQuery(periodKey?: string, brand?: string, sheetType?: CampaignSheetFilter) {
    const query = new URLSearchParams();
    if (periodKey) query.set('periodKey', periodKey);
    if (brand) query.set('brand', brand);
    if (sheetType && sheetType !== 'ALL') query.set('sheetType', sheetType);
    const text = query.toString();
    return text ? `?${text}` : '';
  }

  private async get<T>(url: string): Promise<T> {
    return this.call(this.http.get<T>(url), url);
  }

  private async post<T>(url: string, body: unknown): Promise<T> {
    return this.call(this.http.post<T>(url, body), url);
  }

  private async delete<T>(url: string, body?: unknown): Promise<T> {
    return this.call(this.http.delete<T>(url, body === undefined ? {} : { body }), url);
  }

  private async upload<T>(url: string, file: File): Promise<T> {
    const body = new FormData();
    body.append('report', file);
    return this.call(this.http.post<T>(url, body), url);
  }

  private async call<T>(request: Observable<T>, url: string): Promise<T> {
    try {
      return await firstValueFrom(request);
    } catch (error) {
      const httpError = error as HttpErrorResponse;
      // Session gone (e.g. the server restarted): back to the login page. /api/me and
      // /api/login are left to the auth guard / login page to avoid double redirects.
      const path = url.split('?')[0];
      if (httpError.status === 401 && path !== '/api/me' && path !== '/api/login') {
        window.location.assign('/login');
      }
      const message = typeof httpError.error?.error === 'string' ? httpError.error.error : httpError.message;
      throw new Error(message || 'The request failed.');
    }
  }
}
