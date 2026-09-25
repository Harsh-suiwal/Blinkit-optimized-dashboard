import { Component, HostListener, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { compareValues, money } from '../core/formatters';
import { CityRow, ProductCitySalesRow, ProductSalesRow, SalesSummary } from '../core/models';
import { UiStateService } from '../core/ui-state.service';
import { feederCities } from '../core/feeder-map';

@Component({
  selector: 'app-sales-page',
  template: `
    <header class="topbar">
      <div class="topbar-left"><div><h1>Sales Performance - City Wise</h1><span class="muted">{{ lastUpdated() }}</span></div></div>
      <div class="topbar-right">
        <span class="user-info muted">{{ auth.user()?.email }}</span>
        @if (isAdmin()) {
          <label class="upload-btn">Upload Sales Report<input type="file" accept=".xlsx" hidden (change)="upload($event)"></label>
          @if (!isFocused()) { <button class="secondary-btn danger-btn" (click)="clearAll()">🗑️ Clear All Data</button> }
        }
      </div>
    </header>
    <div class="upload-status" [class.success]="statusType() === 'success'" [class.error]="statusType() === 'error'">{{ status() }}</div>
    <section class="cards">
      <div class="card"><div class="card-label">{{ ui.focusedFeeder() ? 'Feeder Revenue' : 'Total Revenue' }}</div><div class="card-value">{{ money(ui.focusedFeeder() ? feederSummary().revenue : summary().totalRevenue) }}</div></div>
      <div class="card"><div class="card-label">Total Units Sold</div><div class="card-value">{{ ui.focusedFeeder() ? feederSummary().units : summary().totalUnits }}</div></div>
      <div class="card"><div class="card-label">{{ ui.focusedFeeder() ? 'Product Orders*' : 'Total Orders' }}</div><div class="card-value">{{ ui.focusedFeeder() ? (feederOrderMetricsReady() ? feederSummary().orders : 'N/A') : ordersLabel() }}</div></div>
      <div class="card"><div class="card-label">{{ ui.focusedFeeder() ? 'Cities in Feeder' : 'Top City' }}</div><div class="card-value">{{ ui.focusedFeeder() ? feederSummary().cities : (summary().topCity || '-') }}</div></div>
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
      <span class="legend-item"><span class="dot dot-top"></span> Top performer (top 25% by revenue)</span>
      <span class="legend-item"><span class="dot dot-low"></span> Needs attention (bottom 25% by revenue)</span>
      <span class="legend-item"><span class="dot dot-up"></span> Growing vs last upload</span>
      <span class="legend-item"><span class="dot dot-down"></span> Declining vs last upload</span>
      <span class="legend-item muted">Tip: Ctrl+Z undoes the last delete</span>
    </section>
    @if (ui.focusedFeeder()) {
    <section class="table-wrap">
      <table id="feederProductTable"><thead><tr><th (click)="sortFeederBy('city')">City {{ feederSortIndicator('city') }}</th><th (click)="sortFeederBy('productName')">Product {{ feederSortIndicator('productName') }}</th><th (click)="sortFeederBy('revenue')">Revenue {{ feederSortIndicator('revenue') }}</th><th (click)="sortFeederBy('units')">Units Sold {{ feederSortIndicator('units') }}</th><th (click)="sortFeederBy('orderCount')">Orders {{ feederSortIndicator('orderCount') }}</th><th (click)="sortFeederBy('avgOrderValue')">Avg Order Value {{ feederSortIndicator('avgOrderValue') }}</th></tr></thead><tbody>
        @for (row of displayedFeederRows(); track row.city + '::' + row.productName) { <tr><td>{{ row.city }}</td><td>{{ row.productName }}</td><td>{{ money(row.revenue) }}</td><td>{{ row.units }}</td><td>{{ row.orderCount ?? 'N/A' }}</td><td>@if (row.avgOrderValue === undefined) { <span class="na">N/A</span> } @else { {{ money(row.avgOrderValue) }} }</td></tr> }
      </tbody></table>
      @if (!displayedFeederRows().length) { <p class="muted">{{ emptyMessage() }}</p> }
    </section>
    } @else {
    <section class="table-wrap">
      <table id="cityTable"><thead><tr><th>Rank</th><th (click)="sortBy('city')">City {{ sortIndicator('city') }}</th><th (click)="sortBy('revenue')">Revenue {{ sortIndicator('revenue') }}</th><th (click)="sortBy('units')">Units Sold {{ sortIndicator('units') }}</th><th (click)="sortBy('orderCount')">Orders {{ sortIndicator('orderCount') }}</th><th (click)="sortBy('avgOrderValue')">Avg Order Value {{ sortIndicator('avgOrderValue') }}</th><th (click)="sortBy('topProduct')">Best-Selling Product {{ sortIndicator('topProduct') }}</th><th>Trend vs Last Upload</th><th></th></tr></thead><tbody>
        @for (row of displayedRows(); track row.city; let index = $index) {
          <tr [class.row-top]="row.tier === 'top'" [class.row-low]="row.tier === 'low'">
            <td>{{ index + 1 }}</td><td>{{ row.city }}</td><td>{{ money(row.revenue) }}</td><td>{{ row.units }}</td>
            <td>@if (productMode()) { <span class="na">n/a</span> } @else { {{ row.orderCount ?? 'N/A' }} }</td>
            <td>@if (productMode() || row.avgOrderValue === undefined) { <span class="na">n/a</span> } @else { {{ money(row.avgOrderValue) }} }</td>
            <td>@if (productMode()) { <span class="na">n/a</span> } @else { {{ row.topProduct || 'No data' }} }</td>
            <td><span [class.na]="row.revenueChangePct === null || row.revenueChangePct === undefined" [class.trend-up]="(row.revenueChangePct ?? 0) > 0" [class.trend-down]="(row.revenueChangePct ?? 0) < 0">{{ trend(row) }}</span></td>
            <td>@if (isAdmin() && !isFocused()) { <button class="delete-btn" [class.confirming]="pendingDelete() === row.city" (click)="deleteCity(row)">{{ pendingDelete() === row.city ? 'Confirm?' : '🗑️' }}</button> }</td>
          </tr>
        }
      </tbody></table>
      @if (!displayedRows().length) { <p class="muted">{{ emptyMessage() }}</p> }
    </section>
    }
  `,
})
export class SalesPageComponent implements OnInit {
  readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly ui = inject(UiStateService);
  readonly rows = signal<CityRow[]>([]);
  readonly feederProductRows = signal<ProductSalesRow[]>([]);
  readonly selectedFeederProduct = signal('');
  readonly feederSortKey = signal<keyof ProductCitySalesRow>('revenue');
  readonly feederSortAsc = signal(false);
  readonly summary = signal<SalesSummary>({ totalRevenue: 0, totalUnits: 0, totalOrders: 0, cityCount: 0, topCity: null });
  readonly lastUpdated = signal('No report uploaded yet');
  readonly status = signal('');
  readonly statusType = signal<'success' | 'error' | ''>('');
  readonly pendingDelete = signal('');
  readonly productMode = signal(false);
  readonly brandMode = signal(false);
  readonly filteredRows = computed(() => {
    const feeder = this.ui.focusedFeeder();
    if (!feeder) return this.rows();
    const cities = new Set(feederCities(feeder).map((city) => city.toLocaleLowerCase()));
    return this.rows().filter((row) => cities.has(row.city.trim().toLocaleLowerCase()));
  });
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
    return [...this.feederBreakdown()].sort((a, b) => {
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
  private undoStack: { cityRow: CityRow; index: number; historySnapshots: unknown[] }[] = [];

  constructor() {
    effect(() => {
      this.ui.focusedProduct();
      this.ui.focusedBrand();
      this.ui.focusedFeeder();
      if (this.initialized) void this.load();
    });
  }

  async ngOnInit() { this.initialized = true; await this.load(); }
  isAdmin() { return this.auth.user()?.role === 'admin'; }
  isFocused() { return this.productMode() || this.brandMode() || Boolean(this.ui.focusedFeeder()); }
  ordersLabel() { return this.brandMode() ? 'N/A' : this.summary().totalOrders; }
  sortBy(key: keyof CityRow) { this.sortAsc.set(this.sortKey() === key ? !this.sortAsc() : true); this.sortKey.set(key); }
  sortIndicator(key: keyof CityRow) { return this.sortKey() === key ? (this.sortAsc() ? '↑' : '↓') : ''; }
  feederCities(feeder: string) { return feederCities(feeder); }
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
      this.setStatus(`Uploaded successfully - ${result.cityCount} cities, ${result.orderRowCount} order rows processed.`, 'success');
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
      const index = this.rows().findIndex((item) => item.city === row.city);
      this.rows.update((items) => items.filter((item) => item.city !== row.city));
      this.undoStack.push({ cityRow: result.removedRow, index: result.index ?? index, historySnapshots: result.removedHistorySnapshots || [] });
      if (this.undoStack.length > 15) this.undoStack.shift();
      this.setStatus('City deleted. Press Ctrl+Z to undo.', 'success');
      this.calculateSummary();
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  async clearAll() {
    if (!window.confirm('This permanently deletes the current sales upload AND all trend history. This cannot be undone. Continue?')) return;
    try {
      await this.api.clearSalesHistory();
      this.rows.set([]);
      this.undoStack = [];
      this.lastUpdated.set('No report uploaded yet');
      this.calculateSummary();
      this.setStatus('All sales data and history cleared.', 'success');
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  @HostListener('document:keydown', ['$event'])
  async undo(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z' || this.isFocused() || this.isTyping(event.target)) return;
    const record = this.undoStack.pop();
    if (!record) return;
    event.preventDefault();
    try {
      await this.api.restoreCity(record.cityRow, record.index, record.historySnapshots);
      this.rows.update((items) => { const next = [...items]; next.splice(Math.max(0, Math.min(record.index, next.length)), 0, record.cityRow); return next; });
      this.calculateSummary();
      this.setStatus('Restored.', 'success');
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  emptyMessage() {
    if (this.ui.focusedFeeder() && this.selectedFeederProduct()) return `No sales recorded for "${this.selectedFeederProduct()}" in the ${this.ui.focusedFeeder()} feeder cities.`;
    if (this.ui.focusedFeeder()) return `No product sales found in the ${this.ui.focusedFeeder()} feeder cities. Upload the sales report to refresh product-level details.`;
    if (this.productMode()) return `No sales recorded for "${this.ui.focusedProduct()}".`;
    if (this.brandMode()) return `No sales recorded for brand "${this.ui.focusedBrand()}".`;
    return 'No sales data yet. Upload sales_summary.xlsx to get started.';
  }

  private async load() {
    const product = this.ui.focusedProduct();
    const brand = this.ui.focusedBrand();
    const feeder = this.ui.focusedFeeder();
    if (feeder) {
      this.productMode.set(false);
      this.brandMode.set(false);
      try {
        const data = await this.api.productCitySales();
        this.feederProductRows.set(data.productRows || []);
        if (this.selectedFeederProduct() && !this.feederProductNames().includes(this.selectedFeederProduct())) this.selectedFeederProduct.set('');
        this.lastUpdated.set(data.date ? `Last updated: ${data.date} · product sales by city in ${feeder} feeder` : 'No report uploaded yet');
      } catch (error) { this.setStatus(this.message(error), 'error'); }
      return;
    }
    this.productMode.set(Boolean(product));
    this.brandMode.set(!product && Boolean(brand));
    try {
      if (product) {
        const data = await this.api.productSales(product);
        const productRow = data.row;
        this.rows.set(productRow?.cities || []);
        this.lastUpdated.set(data.date ? `Last updated: ${data.date} - showing "${product}" across cities` : `No sales data yet for "${product}"`);
        this.calculateSummary();
        return;
      }
      if (brand) {
        const data = await this.api.brandSales(brand);
        this.rows.set(data.cityRows || []);
        this.lastUpdated.set(data.date ? `Last updated: ${data.date} - showing brand "${brand}" across cities` : `No sales data yet for brand "${brand}"`);
        this.calculateSummary();
        return;
      }
      const [performance, summary] = await Promise.all([this.api.cityPerformance(), this.api.salesSummary()]);
      this.rows.set(performance.cityRows || []);
      this.lastUpdated.set(performance.date ? `Last updated: ${performance.date}` : 'No report uploaded yet');
      if (this.ui.focusedFeeder()) this.calculateSummary();
      else this.summary.set(summary);
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  private sortRows() { return [...this.filteredRows()].sort((a, b) => (this.sortAsc() ? 1 : -1) * compareValues(a, b, this.sortKey())); }
  private calculateSummary() {
    const rows = this.filteredRows();
    this.summary.set({ totalRevenue: rows.reduce((sum, row) => sum + row.revenue, 0), totalUnits: rows.reduce((sum, row) => sum + row.units, 0), totalOrders: rows.reduce((sum, row) => sum + (row.orderCount || 0), 0), cityCount: rows.length, topCity: [...rows].sort((a, b) => b.revenue - a.revenue)[0]?.city || null });
  }
  private setStatus(value: string, type: 'success' | 'error' | '') { this.status.set(value); this.statusType.set(type); }
  private message(error: unknown) { return error instanceof Error ? error.message : 'The request failed.'; }
  private isTyping(target: EventTarget | null) { const tag = (target as HTMLElement | null)?.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'; }
}
