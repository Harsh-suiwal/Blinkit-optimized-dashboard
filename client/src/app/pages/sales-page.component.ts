import { Component, HostListener, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { compareValues, money } from '../core/formatters';
import { BrandUpload, CityRow, ProductCitySalesRow, ProductSalesRow, SalesBrandRow, SalesSummary } from '../core/models';
import { UiStateService } from '../core/ui-state.service';
import { BrandFilterComponent, mergeKnownBrands } from '../shared/brand-filter.component';
import { ClearDataDialogComponent } from '../shared/clear-data-dialog.component';
import { FEEDER_CITY_MAP, feederCities } from '../core/feeder-map';

@Component({
  selector: 'app-sales-page',
  imports: [BrandFilterComponent, ClearDataDialogComponent],
  template: `
    <header class="topbar">
      <div class="topbar-left"><div><h1>Sales Performance - City Wise</h1><span class="muted">{{ lastUpdated() }}</span></div></div>
      <div class="topbar-right">
        @if (isAdmin()) { <label class="upload-btn">Upload Sales Report<input type="file" accept=".xlsx" hidden (change)="upload($event)"></label> }
        <button class="secondary-btn" (click)="getSheet()">Get Sheet</button>
        @if (isAdmin()) { <button class="secondary-btn danger-btn" (click)="clearOpen.set(true)">🗑️ Clear Data</button> }
      </div>
    </header>
    <div class="upload-status" [class.success]="statusType() === 'success'" [class.error]="statusType() === 'error'">{{ status() }}</div>
    @if (brandChips().length) {
      <section class="brand-bar"><app-brand-filter [brands]="brandChips()" [selected]="ui.focusedBrand()" (select)="ui.setBrand($event)" /></section>
    }
    <section class="cards">
      <div class="card"><div class="card-label">{{ ui.focusedFeeder() ? 'Feeder Revenue' : 'Total Revenue' }}</div><div class="card-value">{{ money(ui.focusedFeeder() ? feederSummary().revenue : summary().totalRevenue) }}</div></div>
      <div class="card"><div class="card-label">Total Units Sold</div><div class="card-value">{{ ui.focusedFeeder() ? feederSummary().units : summary().totalUnits }}</div></div>
      <div class="card"><div class="card-label">{{ ui.focusedFeeder() ? 'Product Orders*' : 'Total Orders' }}</div><div class="card-value">{{ ui.focusedFeeder() ? (feederOrderMetricsReady() ? feederSummary().orders : 'N/A') : ordersLabel() }}</div></div>
      <div class="card"><div class="card-label">{{ ui.focusedFeeder() ? 'Cities in Feeder' : 'Top City' }}</div><div class="card-value">{{ ui.focusedFeeder() ? feederSummary().cities : (summary().topCity || '-') }}</div></div>
    </section>
    <section class="controls">
      <label class="filter-label" for="feederSelect">Feeder city</label>
      <select id="feederSelect" class="styled-select" [value]="ui.focusedFeeder()" (change)="selectFeeder($event)">
        <option value="">All feeder cities</option>
        @for (feeder of feederNames; track feeder) { <option [value]="feeder" [selected]="feeder === ui.focusedFeeder()">{{ feeder }}</option> }
      </select>
    </section>
    @if (ui.focusedFeeder()) {
      <section class="controls feeder-product-filter">
        <label for="feederProductFilter">Product breakdown</label>
        <select id="feederProductFilter" [value]="selectedFeederProduct()" (change)="selectFeederProduct($event)">
          <option value="">All Products</option>
          @for (product of feederProductNames(); track product) { <option [value]="product">{{ product }}</option> }
        </select>
        <span class="muted">{{ ui.focusedFeeder() }} feeder · {{ feederCities(ui.focusedFeeder()).length }} mapped cities</span>
        @if (!feederOrderMetricsReady()) { <span class="muted">Re-upload the sales report to populate product-level orders and AOV.</span> }
        @else { <span class="muted">* Orders and AOV are counted per product per city.</span> }
      </section>
    }
    <section class="legend">
      <span class="legend-item"><span class="dot dot-top"></span> Top 25%</span>
      <span class="legend-item"><span class="dot dot-low"></span> Bottom 25%</span>
    </section>
    @if (ui.focusedFeeder()) {
    <section class="table-wrap">
      <h3>City totals</h3>
      <p class="muted">All products, per mapped city. A city that belongs to several feeders (e.g. Delhi) shows its full city total here, not a share for this feeder.</p>
      <table id="feederCityTotals"><thead><tr><th>City</th><th>Revenue</th><th>Units Sold</th><th>Orders</th><th>Avg Order Value</th></tr></thead><tbody>
        @for (row of feederCityTotals(); track row.city) { <tr><td>{{ row.city }}</td><td>{{ money(row.revenue) }}</td><td>{{ row.units }}</td><td>{{ row.orderCount ?? 'N/A' }}</td><td>@if (row.avgOrderValue === undefined) { <span class="na">N/A</span> } @else { {{ money(row.avgOrderValue) }} }</td></tr> }
      </tbody></table>
      @if (!feederCityTotals().length) { <p class="muted">No sales for this feeder's cities.</p> }
    </section>
    <section class="table-wrap">
      <table id="feederProductTable"><thead><tr><th (click)="sortFeederBy('city')">City {{ feederSortIndicator('city') }}</th><th (click)="sortFeederBy('productName')">Product {{ feederSortIndicator('productName') }}</th><th (click)="sortFeederBy('revenue')">Revenue {{ feederSortIndicator('revenue') }}</th><th (click)="sortFeederBy('units')">Units Sold {{ feederSortIndicator('units') }}</th><th (click)="sortFeederBy('orderCount')">Orders {{ feederSortIndicator('orderCount') }}</th><th (click)="sortFeederBy('avgOrderValue')">Avg Order Value {{ feederSortIndicator('avgOrderValue') }}</th></tr></thead><tbody>
        @for (row of displayedFeederRows(); track row.city + '::' + row.productName) { <tr [class.row-top]="row.tier === 'top'" [class.row-low]="row.tier === 'low'"><td>{{ row.city }}</td><td>{{ row.productName }}</td><td>{{ money(row.revenue) }}</td><td>{{ row.units }}</td><td>{{ row.orderCount ?? 'N/A' }}</td><td>@if (row.avgOrderValue === undefined) { <span class="na">N/A</span> } @else { {{ money(row.avgOrderValue) }} }</td></tr> }
      </tbody></table>
      @if (!displayedFeederRows().length) { <p class="muted">{{ emptyMessage() }}</p> }
    </section>
    } @else {
    <section class="table-wrap">
      <table id="cityTable"><thead><tr><th>Rank</th><th (click)="sortBy('city')">City {{ sortIndicator('city') }}</th><th (click)="sortBy('revenue')">Revenue {{ sortIndicator('revenue') }}</th><th (click)="sortBy('units')">Units Sold {{ sortIndicator('units') }}</th><th (click)="sortBy('orderCount')">Orders {{ sortIndicator('orderCount') }}</th><th (click)="sortBy('avgOrderValue')">Avg Order Value {{ sortIndicator('avgOrderValue') }}</th><th (click)="sortBy('topProduct')">Best-Selling Product {{ sortIndicator('topProduct') }}</th><th>Trend vs Last Upload</th><th></th></tr></thead><tbody>
        @for (row of displayedRows(); track row.city; let index = $index) {
          <tr [class.row-top]="row.tier === 'top'" [class.row-low]="row.tier === 'low'">
            <td>{{ index + 1 }}</td><td>{{ row.city }}</td><td>{{ money(row.revenue) }}</td><td>{{ row.units }}</td>
            <td>{{ row.orderCount ?? 'N/A' }}</td>
            <td>@if (row.avgOrderValue === undefined) { <span class="na">n/a</span> } @else { {{ money(row.avgOrderValue) }} }</td>
            <td>{{ row.topProduct || 'No data' }}</td>
            <td><span [class.na]="row.revenueChangePct === null || row.revenueChangePct === undefined" [class.trend-up]="(row.revenueChangePct ?? 0) > 0" [class.trend-down]="(row.revenueChangePct ?? 0) < 0">{{ trend(row) }}</span></td>
            <td>@if (isAdmin() && !isFocused()) { <button class="delete-btn" [class.confirming]="pendingDelete() === row.city" (click)="deleteCity(row)">{{ pendingDelete() === row.city ? 'Confirm?' : '🗑️' }}</button> }</td>
          </tr>
        }
      </tbody></table>
      @if (!displayedRows().length) { <p class="muted">{{ emptyMessage() }}</p> }
    </section>
    }
    @if (clearOpen()) {
      <app-clear-data-dialog scope="sales" note="Its trend history is removed too." [brands]="brandNames()" [initialBrand]="ui.focusedBrand()" (confirm)="clearData($event)" (cancel)="clearOpen.set(false)" />
    }
  `,
})
export class SalesPageComponent implements OnInit {
  readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly ui = inject(UiStateService);
  readonly rows = signal<CityRow[]>([]);
  readonly feederNames = Object.keys(FEEDER_CITY_MAP);
  readonly feederProductRows = signal<ProductSalesRow[]>([]);
  readonly selectedFeederProduct = signal('');
  readonly feederSortKey = signal<keyof ProductCitySalesRow>('revenue');
  readonly feederSortAsc = signal(false);
  readonly summary = signal<SalesSummary>({ totalRevenue: 0, totalUnits: 0, totalOrders: 0, cityCount: 0, topCity: null });
  readonly brandSummaries = signal<SalesBrandRow[]>([]);
  readonly brandUploads = signal<Record<string, BrandUpload>>({});
  readonly lastDate = signal<string | null>(null);
  readonly clearOpen = signal(false);
  readonly knownBrands = signal<string[]>([]);
  readonly brandChips = computed(() => mergeKnownBrands(this.brandSummaries().map((b) => ({ brandName: b.brandName, value: b.revenue })), this.knownBrands()));
  readonly brandNames = computed(() => this.brandSummaries().map((b) => b.brandName));
  readonly lastUpdated = computed(() => this.describeUpdate());
  readonly status = signal('');
  readonly statusType = signal<'success' | 'error' | ''>('');
  readonly pendingDelete = signal('');
  readonly filteredRows = computed(() => {
    const feeder = this.ui.focusedFeeder();
    if (!feeder) return this.rows();
    const cities = new Set(feederCities(feeder).map((city) => city.toLocaleLowerCase()));
    return this.rows().filter((row) => cities.has(row.city.trim().toLocaleLowerCase()));
  });
  // City-level rows (all products, brand-filtered by the API) for the feeder's cities, biggest first.
  // Uses the city rows rather than summing product rows, since one order can hold several products.
  readonly feederCityTotals = computed(() => [...this.filteredRows()].sort((a, b) => b.revenue - a.revenue));
  readonly feederProductNames = computed(() => {
    const cities = new Set(feederCities(this.ui.focusedFeeder()).map((city) => city.trim().toLocaleLowerCase()));
    return this.feederProductRows()
      .filter((product) => product.cities.some((city) => cities.has(city.city.trim().toLocaleLowerCase())))
      .map((product) => product.productName)
      .sort((a, b) => a.localeCompare(b));
  });
  readonly feederBreakdown = computed<ProductCitySalesRow[]>(() => {
    const cities = new Set(feederCities(this.ui.focusedFeeder()).map((city) => city.trim().toLocaleLowerCase()));
    const productFilter = this.selectedFeederProduct();
    return this.feederProductRows().flatMap((product) => {
      if (productFilter && product.productName !== productFilter) return [];
      return product.cities
        .filter((city) => cities.has(city.city.trim().toLocaleLowerCase()))
        .map((city) => ({ ...city, productName: product.productName, brandName: product.brandName }));
    });
  });
  readonly displayedFeederRows = computed(() => {
    const key = this.feederSortKey();
    const direction = this.feederSortAsc() ? 1 : -1;
    return this.withTiers(this.feederBreakdown()).sort((a, b) => {
      const left = a[key];
      const right = b[key];
      const order = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left ?? '').localeCompare(String(right ?? ''));
      return direction * order;
    });
  });
  readonly feederSummary = computed(() => {
    const rows = this.feederBreakdown();
    return {
      revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
      units: rows.reduce((sum, row) => sum + row.units, 0),
      orders: rows.reduce((sum, row) => sum + (row.orderCount || 0), 0),
      cities: new Set(rows.map((row) => row.city)).size,
    };
  });
  readonly feederOrderMetricsReady = computed(() => {
    const rows = this.feederBreakdown();
    return rows.length > 0 && rows.every((row) => row.orderCount !== undefined && row.avgOrderValue !== undefined);
  });
  readonly displayedRows = computed(() => this.sortRows());
  readonly money = money;
  readonly sortKey = signal<keyof CityRow>('revenue');
  readonly sortAsc = signal(false);
  private initialized = false;
  private timer?: ReturnType<typeof setTimeout>;
  private undoStack: { cityRows: CityRow[]; historySnapshots: unknown[] }[] = [];

  constructor() {
    effect(() => {
      this.ui.focusedBrand();
      this.ui.focusedFeeder();
      if (this.initialized) void this.load();
    });
  }

  async ngOnInit() { this.initialized = true; await this.load(); }
  isAdmin() { return this.auth.user()?.role === 'admin'; }
  // Deleting a city removes it for every brand, so it is only offered in the unfiltered view.
  isFocused() { return Boolean(this.ui.focusedBrand()) || Boolean(this.ui.focusedFeeder()); }
  ordersLabel() { return this.summary().totalOrders; }
  sortBy(key: keyof CityRow) { this.sortAsc.set(this.sortKey() === key ? !this.sortAsc() : true); this.sortKey.set(key); }
  sortIndicator(key: keyof CityRow) { return this.sortKey() === key ? (this.sortAsc() ? '↑' : '↓') : ''; }
  feederCities(feeder: string) { return feederCities(feeder); }
  selectFeeder(event: Event) { this.ui.setFeeder((event.target as HTMLSelectElement).value); }
  selectFeederProduct(event: Event) { this.selectedFeederProduct.set((event.target as HTMLSelectElement).value); }
  sortFeederBy(key: keyof ProductCitySalesRow) {
    this.feederSortAsc.set(this.feederSortKey() === key ? !this.feederSortAsc() : key === 'city' || key === 'productName');
    this.feederSortKey.set(key);
  }
  feederSortIndicator(key: keyof ProductCitySalesRow) { return this.feederSortKey() === key ? (this.feederSortAsc() ? '↑' : '↓') : ''; }

  trend(row: CityRow) {
    if (row.revenueChangePct === null || row.revenueChangePct === undefined) return 'First upload';
    const arrow = row.revenueChangePct > 0 ? '↑' : row.revenueChangePct < 0 ? '↓' : '→';
    return `${arrow} ${Math.abs(row.revenueChangePct)}%`;
  }

  async upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.setStatus('Uploading...', '');
    try {
      const result = await this.api.uploadSales(file);
      this.setStatus(`Uploaded successfully - ${result.orderRowCount} order rows for ${(result.brands ?? []).join(', ') || 'your brands'}.`, 'success');
      this.ui.refreshLookups();
      await this.load();
    } catch (error) { this.setStatus(this.message(error), 'error'); }
    finally { input.value = ''; }
  }

  async deleteCity(row: CityRow) {
    if (this.pendingDelete() !== row.city) {
      this.pendingDelete.set(row.city);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.pendingDelete.set(''), 3000);
      return;
    }
    clearTimeout(this.timer);
    this.pendingDelete.set('');
    try {
      const result = await this.api.deleteCity(row.city);
      this.rows.update((items) => items.filter((item) => item.city !== row.city));
      this.undoStack.push({ cityRows: result.removedRows, historySnapshots: result.removedHistorySnapshots || [] });
      if (this.undoStack.length > 15) this.undoStack.shift();
      this.setStatus('City deleted. Press Ctrl+Z to undo.', 'success');
      this.calculateSummary();
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  getSheet() { window.location.assign('/api/export-sales'); }

  /** Deletes one brand's sales data (or all brands when brand is empty). */
  async clearData(brand: string) {
    this.clearOpen.set(false);
    try {
      await this.api.clearSalesHistory(brand || undefined);
      if (!brand || this.ui.focusedBrand().toLowerCase() === brand.toLowerCase()) this.ui.setBrand('');
      this.ui.refreshLookups();
      this.undoStack = [];
      await this.load();
      this.setStatus(brand ? `Sales data for ${brand} cleared.` : 'All sales data and history cleared.', 'success');
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  @HostListener('document:keydown', ['$event'])
  async undo(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z' || this.isFocused() || this.isTyping(event.target)) return;
    const record = this.undoStack.pop();
    if (!record) return;
    event.preventDefault();
    try {
      await this.api.restoreCity(record.cityRows, record.historySnapshots);
      await this.load();
      this.setStatus('Restored.', 'success');
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  emptyMessage() {
    if (this.ui.focusedFeeder() && this.selectedFeederProduct()) return `No sales recorded for "${this.selectedFeederProduct()}" in the ${this.ui.focusedFeeder()} feeder cities.`;
    if (this.ui.focusedFeeder()) return `No product sales found in the ${this.ui.focusedFeeder()} feeder cities. Upload the sales report to refresh product-level details.`;
    if (this.ui.focusedBrand()) return `No sales recorded for brand "${this.ui.focusedBrand()}". Upload its sales report, or pick another brand.`;
    return 'No sales data yet. Upload sales_summary.xlsx to get started.';
  }

  // The brand filter applies on every path: the city table, the summary cards and the feeder breakdown.
  private async load() {
    const brand = this.ui.focusedBrand();
    try {
      const data = await this.api.cityPerformance(brand || undefined);
      this.rows.set(data.cityRows || []);
      this.brandSummaries.set(data.brandSummaries || []);
      this.brandUploads.set(data.brandUploads || {});
      this.lastDate.set(data.date);
      // Brand chips only; a failure here must not stop the summary below.
      this.knownBrands.set(await this.api.brandNames().then((r) => r.brands, () => this.knownBrands()));
      if (this.ui.focusedFeeder()) {
        const products = await this.api.productCitySales(brand || undefined);
        this.feederProductRows.set(products.productRows || []);
        if (this.selectedFeederProduct() && !this.feederProductNames().includes(this.selectedFeederProduct())) this.selectedFeederProduct.set('');
      }
      this.calculateSummary();
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  private describeUpdate() {
    const uploads = this.brandUploads();
    const brand = Object.keys(uploads).find((name) => name.toLowerCase() === this.ui.focusedBrand().toLowerCase());
    if (brand) return `${brand} last updated: ${uploads[brand].date}`;
    return this.lastDate() ? `Last updated: ${this.lastDate()}` : 'No report uploaded yet';
  }

  /**
   * Tags rows 'top' (top 25% by revenue) or 'low' (bottom 25%) within whatever is on
   * screen - all cities, one brand, one product or one feeder - so the colour coding
   * never depends on which endpoint supplied the rows. Fewer than 2 rows: no tiers.
   */
  private withTiers<T extends CityRow>(rows: T[]): T[] {
    const n = rows.length;
    if (n < 2) return rows.map((row) => ({ ...row, tier: 'mid' }));
    const cutoff = Math.max(1, Math.ceil(n * 0.25));
    const tiers = new Map<T, string>();
    [...rows].sort((a, b) => b.revenue - a.revenue).forEach((row, i) => tiers.set(row, i < cutoff ? 'top' : i >= n - cutoff ? 'low' : 'mid'));
    return rows.map((row) => ({ ...row, tier: tiers.get(row) }));
  }
  private sortRows() { return this.withTiers(this.filteredRows()).sort((a, b) => (this.sortAsc() ? 1 : -1) * compareValues(a, b, this.sortKey())); }
  private calculateSummary() {
    const rows = this.filteredRows();
    this.summary.set({ totalRevenue: rows.reduce((sum, row) => sum + row.revenue, 0), totalUnits: rows.reduce((sum, row) => sum + row.units, 0), totalOrders: rows.reduce((sum, row) => sum + (row.orderCount || 0), 0), cityCount: rows.length, topCity: [...rows].sort((a, b) => b.revenue - a.revenue)[0]?.city || null });
  }
  private setStatus(value: string, type: 'success' | 'error' | '') { this.status.set(value); this.statusType.set(type); }
  private message(error: unknown) { return error instanceof Error ? error.message : 'The request failed.'; }
  private isTyping(target: EventTarget | null) { const tag = (target as HTMLElement | null)?.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'; }
}
