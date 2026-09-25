import { Component, HostListener, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { compareValues, money } from '../core/formatters';
import { CityRow, SalesSummary } from '../core/models';
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
      <div class="card"><div class="card-label">Total Revenue</div><div class="card-value">{{ money(summary().totalRevenue) }}</div></div>
      <div class="card"><div class="card-label">Total Units Sold</div><div class="card-value">{{ summary().totalUnits }}</div></div>
      <div class="card"><div class="card-label">Total Orders</div><div class="card-value">{{ ordersLabel() }}</div></div>
      <div class="card"><div class="card-label">Top City</div><div class="card-value">{{ summary().topCity || '-' }}</div></div>
    </section>
    <section class="legend">
      <span class="legend-item"><span class="dot dot-top"></span> Top performer (top 25% by revenue)</span>
      <span class="legend-item"><span class="dot dot-low"></span> Needs attention (bottom 25% by revenue)</span>
      <span class="legend-item"><span class="dot dot-up"></span> Growing vs last upload</span>
      <span class="legend-item"><span class="dot dot-down"></span> Declining vs last upload</span>
      <span class="legend-item muted">Tip: Ctrl+Z undoes the last delete</span>
    </section>
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
  `,
})
export class SalesPageComponent implements OnInit {
  readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly ui = inject(UiStateService);
  readonly rows = signal<CityRow[]>([]);
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
    if (this.productMode()) return `No sales recorded for "${this.ui.focusedProduct()}".`;
    if (this.brandMode()) return `No sales recorded for brand "${this.ui.focusedBrand()}".`;
    return 'No sales data yet. Upload sales_summary.xlsx to get started.';
  }

  private async load() {
    const product = this.ui.focusedProduct();
    const brand = this.ui.focusedBrand();
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
