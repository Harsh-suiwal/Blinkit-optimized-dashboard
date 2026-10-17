import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import {
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
  InventorySummary,
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
    return this.get<{ date: string | null; rows: ProductRow[] }>('/api/products');
  }

  inventorySummary() {
    return this.get<InventorySummary>('/api/summary');
  }

  uploadInventory(file: File) {
    return this.upload<{ ok: boolean; date: string; rowCount: number }>('/api/upload', file);
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

  cityPerformance() {
    return this.get<{ date: string | null; cityRows: CityRow[] }>('/api/city-performance');
  }

  salesSummary() {
    return this.get<SalesSummary>('/api/sales-summary');
  }

  productSales(product: string) {
    return this.get<{ date: string | null; row: ProductSalesRow | null }>(`/api/product-sales?product=${encodeURIComponent(product)}`);
  }

  productCitySales() {
    return this.get<{ date: string | null; productRows: (ProductSalesRow & { cities: ProductCitySalesRow[] })[] }>('/api/product-city-sales');
  }

  brandSales(brand: string) {
    return this.get<{ date: string | null; cityRows: CityRow[] }>(`/api/brand-sales?brand=${encodeURIComponent(brand)}`);
  }

  uploadSales(file: File) {
    return this.upload<{ ok: boolean; date: string; cityCount: number; orderRowCount: number }>('/api/sales-upload', file);
  }

  deleteCity(city: string) {
    return this.delete<{ ok: boolean; removedRow: CityRow; index: number; removedHistorySnapshots: unknown[] }>(`/api/city-performance/${encodeURIComponent(city)}`);
  }

  restoreCity(cityRow: CityRow, index: number, historySnapshots: unknown[]) {
    return this.post<{ ok: boolean }>('/api/city-performance/restore', { cityRow, index, historySnapshots });
  }

  clearSalesHistory() {
    return this.delete<{ ok: boolean }>('/api/sales-history');
  }

  campaignData(periodKey?: string, brand?: string, sheetType?: CampaignSheetFilter) {
    return this.get<{ date: string | null; periods: CampaignPeriod[]; periodKey: string | null; latestPeriodKey: string | null; campaigns: CampaignRow[]; brandSummaries: CampaignBrandRow[] }>(`/api/campaign-analysis${this.campaignQuery(periodKey, brand, sheetType)}`);
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

  private campaignQuery(periodKey?: string, brand?: string, sheetType?: CampaignSheetFilter) {
    const query = new URLSearchParams();
    if (periodKey) query.set('periodKey', periodKey);
    if (brand) query.set('brand', brand);
    if (sheetType && sheetType !== 'ALL') query.set('sheetType', sheetType);
    const text = query.toString();
    return text ? `?${text}` : '';
  }

  private async get<T>(url: string): Promise<T> {
    return this.call(this.http.get<T>(url));
  }

  private async post<T>(url: string, body: unknown): Promise<T> {
    return this.call(this.http.post<T>(url, body));
  }

  private async delete<T>(url: string, body?: unknown): Promise<T> {
    return this.call(this.http.delete<T>(url, body === undefined ? {} : { body }));
  }

  private async upload<T>(url: string, file: File): Promise<T> {
    const body = new FormData();
    body.append('report', file);
    return this.call(this.http.post<T>(url, body));
  }

  private async call<T>(request: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request);
    } catch (error) {
      const httpError = error as HttpErrorResponse;
      const message = typeof httpError.error?.error === 'string' ? httpError.error.error : httpError.message;
      throw new Error(message || 'The request failed.');
    }
  }
}
