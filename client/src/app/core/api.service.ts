import { HttpClient, HttpErrorResponse, HttpResponse } from '@angular/common/http';
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
  CampaignUploadPreview,
  CampaignUploadResult,
  CityRow,
  SalesBrandRow,
  ProductRow,
  ProductCitySalesRow,
  ProductSalesRow,
  SalesSummary,
  User,
  BrandOverview,
  SalesMonth,
  SalesMonthComparison,
  SalesMonthUploadResult,
  BrandCostsUploadResult,
  BrandProfit,
  ProductMonthDetail,
  ProductMonthNames,
  UploadKind,
  UploadsOverview,
  UploadUndoResult,
  BrandReport,
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

  /** Dry run: what an upload would replace, without storing anything. campaignBrands (campaign name -> brand) is applied before planning. */
  previewCampaignUpload(file: File, campaignBrands: Record<string, string> = {}) {
    return this.upload<CampaignUploadPreview>('/api/campaign-upload?dryRun=1', file, this.campaignFields(campaignBrands));
  }

  /** campaignBrands labels campaigns whose brand can't be resolved; sending labels forces past the same-day duplicate guard. */
  uploadCampaign(file: File, campaignBrands: Record<string, string> = {}) {
    const labelled = Object.keys(campaignBrands).length > 0;
    const url = labelled ? '/api/campaign-upload?force=1' : '/api/campaign-upload';
    return this.upload<CampaignUploadResult>(url, file, this.campaignFields(campaignBrands));
  }

  private campaignFields(campaignBrands: Record<string, string>): Record<string, string> {
    return Object.keys(campaignBrands).length ? { campaignBrands: JSON.stringify(campaignBrands) } : {};
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

  /** Everything for one brand on one screen (Brand Overview page). */
  brandOverview(brand: string, month = '') {
    const monthQuery = month ? `&month=${encodeURIComponent(month)}` : '';
    return this.get<BrandOverview>(`/api/brand-overview?brand=${encodeURIComponent(brand)}${monthQuery}`);
  }

  salesMonths(brand?: string) {
    return this.get<{ months: SalesMonth[] }>(`/api/sales-months${this.brandQuery(brand)}`);
  }

  salesMonthCompare(months: string[], brand?: string) {
    const query = new URLSearchParams({ months: months.join(',') });
    if (brand) query.set('brand', brand);
    return this.get<SalesMonthComparison>(`/api/sales-month-compare?${query}`);
  }

  /** Adds months to the Monthly Comparison only; the Sales tab's current view is not changed. */
  uploadSalesMonth(file: File) {
    return this.upload<SalesMonthUploadResult>('/api/sales-month-upload', file);
  }

  deleteSalesMonth(brand: string, month: string) {
    const query = new URLSearchParams({ brand, month });
    return this.delete<{ ok: boolean; removed: unknown }>(`/api/sales-month?${query}`);
  }

  restoreSalesMonth(slot: unknown) {
    return this.post<{ ok: boolean }>('/api/sales-month/restore', { slot });
  }

  /** Monthly profit / loss and ROI for one brand (admin only). */
  brandProfit(brand: string) {
    return this.get<BrandProfit>(`/api/brand-profit?brand=${encodeURIComponent(brand)}`);
  }

  /** Cost sheet (one row per product); replaces the brand's product costs. */
  uploadBrandCosts(brand: string, file: File) {
    return this.upload<BrandCostsUploadResult>(`/api/brand-costs-upload?brand=${encodeURIComponent(brand)}`, file);
  }

  /** One month's other costs in rupees; 0 clears it. */
  setOtherCost(brand: string, monthKey: string, amount: number) {
    return this.post<{ ok: boolean }>('/api/brand-other-costs', { brand, monthKey, amount });
  }

  /** Names of the products that have monthly data for a brand (the Month by month selector). */
  productMonthNames(brand: string) {
    return this.get<ProductMonthNames>(`/api/product-month-detail?brand=${encodeURIComponent(brand)}`);
  }

  /** One product month by month, plus the brand's monthly profit. Profit fields are empty when the server hides them. */
  productMonthDetail(brand: string, product: string) {
    const query = new URLSearchParams({ brand, product });
    return this.get<ProductMonthDetail>(`/api/product-month-detail?${query}`);
  }

  /** What is uploaded for each brand, and which uploads can be undone (admin only). */
  uploadsOverview() {
    return this.get<UploadsOverview>('/api/uploads-overview');
  }

  /** Puts the report back as it was before its latest upload (admin only). */
  undoUpload(kind: UploadKind) {
    return this.post<UploadUndoResult>('/api/uploads/undo', { kind });
  }

  /**
   * Downloads a file through the app. A plain link shows raw JSON when something goes wrong (for
   * example an expired login); here a failure becomes a readable message.
   */
  async download(url: string, fallbackName: string): Promise<void> {
    let response: HttpResponse<Blob>;
    try {
      response = await firstValueFrom(this.http.get(url, { responseType: 'blob', observe: 'response' }));
    } catch (error) {
      const httpError = error as HttpErrorResponse;
      if (httpError.status === 401) window.location.assign('/login');
      throw new Error(await this.downloadErrorMessage(httpError));
    }
    if (!response.body) throw new Error('The download was empty.');
    const objectUrl = URL.createObjectURL(response.body);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = this.fileNameFrom(response.headers.get('Content-Disposition')) || fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  /** With responseType 'blob' the server's JSON error arrives as a Blob. */
  private async downloadErrorMessage(error: HttpErrorResponse): Promise<string> {
    if (error.error instanceof Blob) {
      try {
        const parsed = JSON.parse(await error.error.text());
        if (parsed && typeof parsed.error === 'string') return parsed.error;
      } catch { /* not JSON: use the generic message */ }
    }
    return error.message || 'The download failed.';
  }

  private fileNameFrom(header: string | null): string {
    const match = header ? /filename="?([^";]+)"?/i.exec(header) : null;
    return match ? match[1] : '';
  }

  /** Everything the client Report needs for one brand. Profit is included only when asked for, and only for an admin. */
  brandReport(brand: string, months: string[] = [], includeProfit = false) {
    const query = new URLSearchParams({ brand });
    if (months.length) query.set('months', months.join(','));
    if (includeProfit) query.set('profit', '1');
    return this.get<BrandReport>(`/api/brand-report?${query}`);
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

  private async upload<T>(url: string, file: File, fields: Record<string, string> = {}): Promise<T> {
    const body = new FormData();
    // Text fields before the file, so multer has them when it reads the file part.
    for (const [name, value] of Object.entries(fields)) body.append(name, value);
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
