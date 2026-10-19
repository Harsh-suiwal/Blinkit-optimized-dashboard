import { Component, HostListener, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { brandFor, compareValues } from '../core/formatters';
import { BrandUpload, InventorySummary, ProductRow } from '../core/models';
import { UiStateService } from '../core/ui-state.service';
import { BrandFilterComponent, mergeKnownBrands } from '../shared/brand-filter.component';
import { ClearDataDialogComponent } from '../shared/clear-data-dialog.component';

@Component({
  selector: 'app-inventory-page',
  imports: [FormsModule, BrandFilterComponent, ClearDataDialogComponent],
  template: `
    <header class="topbar topbar-static">
      <div class="topbar-left"><div><h1>Blinkit Inventory Dashboard</h1><span class="muted">{{ lastUpdated() }}</span></div></div>
      <div class="topbar-right">
        @if (isAdmin()) { <label class="upload-btn">Upload Inventory<input type="file" accept=".xlsx" hidden (change)="upload($event)"></label> }
        <button class="secondary-btn" (click)="download('/api/export')">Get Sheet</button>
        <button class="secondary-btn full-report-btn" (click)="download('/api/export-all')">📊 Full Report</button>
        @if (isAdmin()) { <button class="secondary-btn danger-btn" (click)="clearOpen.set(true)">🗑️ Clear Data</button> }
      </div>
    </header>
    <div class="upload-status" [class.success]="statusType() === 'success'" [class.error]="statusType() === 'error'">{{ status() }}</div>

    @if (brandChips().length) {
      <section class="brand-bar"><app-brand-filter unit="units" [brands]="brandChips()" [selected]="ui.focusedBrand()" (select)="ui.setBrand($event)" /></section>
    }

    <section class="cards">
      <div class="card"><div class="card-label">Units Sold (30 days)</div><div class="card-value">{{ summary().totalUnitsSold30 }}</div></div>
      <div class="card"><div class="card-label">Total Stock Available</div><div class="card-value">{{ summary().totalStock }}</div></div>
      <div class="card"><div class="card-label">Products</div><div class="card-value">{{ summary().productCount }}</div></div>
      <div class="card"><div class="card-label">Low / Out of Stock</div><div class="card-value">{{ summary().lowOrOutCount }}</div></div>
    </section>

    <section class="controls"><input id="searchBox" type="search" aria-label="Search products and warehouses" [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Search product or warehouse..."></section>
    <section class="table-wrap table-wrap-page">
      <table id="productTable"><thead><tr>
        <th (click)="sortBy('productName')">Product {{ sortIndicator('productName') }}</th><th (click)="sortBy('warehouseName')">Warehouse {{ sortIndicator('warehouseName') }}</th><th (click)="sortBy('totalStockAvailable')">Stock {{ sortIndicator('totalStockAvailable') }}</th><th (click)="sortBy('unitsSold7')">Sold - 7d {{ sortIndicator('unitsSold7') }}</th><th (click)="sortBy('unitsSold15')">Sold - 15d {{ sortIndicator('unitsSold15') }}</th><th (click)="sortBy('unitsSold30')">Sold - 30d {{ sortIndicator('unitsSold30') }}</th><th (click)="sortBy('unitsSold45')">Sold - 45d {{ sortIndicator('unitsSold45') }}</th><th (click)="sortBy('unitsSold60')">Sold - 60d {{ sortIndicator('unitsSold60') }}</th><th (click)="sortBy('incomingInventory')">Incoming {{ sortIndicator('incomingInventory') }}</th><th>Status</th><th></th>
      </tr></thead><tbody>
        @for (row of displayedRows(); track rowKey(row)) { <tr>
          <td>{{ row.productName }}</td><td>{{ row.warehouseName }}</td><td>{{ row.totalStockAvailable }}</td><td>{{ row.unitsSold7 }}</td><td>{{ row.unitsSold15 }}</td><td>{{ row.unitsSold30 }}</td><td><span [class.na]="row.unitsSold45 === null">{{ row.unitsSold45 ?? 'n/a' }}</span></td><td><span [class.na]="row.unitsSold60 === null">{{ row.unitsSold60 ?? 'n/a' }}</span></td><td>{{ row.incomingInventory }}</td>
          <td><span class="status-pill" [class.status-ok]="row.stockStatus === 'ok'" [class.status-low]="row.stockStatus === 'low'" [class.status-out]="row.stockStatus === 'out'">{{ row.stockStatus === 'ok' ? 'OK' : row.stockStatus === 'low' ? 'Low' : 'Out' }}</span></td>
          <td>@if (isAdmin()) { <button class="delete-btn" [class.confirming]="pendingDelete() === rowKey(row)" (click)="deleteRow(row)">{{ pendingDelete() === rowKey(row) ? 'Confirm?' : '🗑️' }}</button> }</td>
        </tr> }
      </tbody></table>
      @if (!displayedRows().length) { <p class="muted">{{ emptyMessage() }}</p> }
    </section>
    @if (clearOpen()) {
      <app-clear-data-dialog scope="inventory" note="Upload history (used for 45/60-day sold) is kept." [brands]="brandNames()" [initialBrand]="ui.focusedBrand()" (confirm)="clearData($event)" (cancel)="clearOpen.set(false)" />
    }
  `,
})
export class InventoryPageComponent implements OnInit {
  readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly ui = inject(UiStateService);
  readonly rows = signal<ProductRow[]>([]);
  readonly clearOpen = signal(false);
  readonly brandUploads = signal<Record<string, BrandUpload>>({});
  readonly lastDate = signal<string | null>(null);
  // One chip per brand, weighted by total stock on hand.
  readonly knownBrands = signal<string[]>([]);
  private readonly brandStock = computed(() => {
    const totals = new Map<string, number>();
    for (const row of this.rows()) totals.set(brandFor(row), (totals.get(brandFor(row)) ?? 0) + row.totalStockAvailable);
    return Array.from(totals, ([brandName, value]) => ({ brandName, value })).sort((a, b) => b.value - a.value);
  });
  readonly brandChips = computed(() => mergeKnownBrands(this.brandStock(), this.knownBrands()));
  readonly brandNames = computed(() => this.brandStock().map((chip) => chip.brandName));
  readonly lastUpdated = computed(() => this.describeUpdate());
  // Derived from the loaded rows so the cards follow the brand/product filter instantly,
  // even if a reload fails (e.g. a 401 after a server restart).
  readonly summary = computed<InventorySummary>(() => this.summarize(this.scopedRows()));
  readonly status = signal('');
  readonly statusType = signal<'success' | 'error' | ''>('');
  readonly pendingDelete = signal('');
  readonly displayedRows = computed(() => this.filterRows());
  readonly query = signal('');
  readonly sortKey = signal<keyof ProductRow | null>(null);
  readonly sortAsc = signal(true);
  private undoStack: { row: ProductRow; index: number }[] = [];
  private initialized = false;
  private loadSeq = 0;
  private pendingTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      this.ui.focusedProduct();
      this.ui.focusedBrand();
      if (this.initialized) void this.load();
    });
  }

  async ngOnInit() {
    this.initialized = true;
    await this.load();
  }

  isAdmin() { return this.auth.user()?.role === 'admin'; }
  rowKey(row: ProductRow) { return `${row.productName}::${row.warehouseName}`; }
  sortBy(key: keyof ProductRow) { this.sortAsc.set(this.sortKey() === key ? !this.sortAsc() : true); this.sortKey.set(key); }
  sortIndicator(key: keyof ProductRow) { return this.sortKey() === key ? (this.sortAsc() ? '↑' : '↓') : ''; }
  download(url: string) { window.location.assign(url); }

  async upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.setStatus('Uploading...', '');
    try {
      const result = await this.api.uploadInventory(file);
      this.setStatus(`Uploaded successfully - ${result.rowCount} rows for ${(result.brands ?? []).join(', ') || 'your brands'}.`, 'success');
      this.ui.refreshLookups();
      await this.load();
    } catch (error) { this.setStatus(this.message(error), 'error'); }
    finally { input.value = ''; }
  }

  /** Deletes one brand's inventory (or all brands when brand is empty). */
  async clearData(brand: string) {
    this.clearOpen.set(false);
    try {
      await this.api.clearInventory(brand || undefined);
      if (brand && this.ui.focusedBrand().toLowerCase() === brand.toLowerCase()) this.ui.setBrand('');
      if (!brand) this.ui.setBrand('');
      this.ui.refreshLookups();
      this.undoStack = [];
      await this.load();
      this.setStatus(brand ? `Inventory data for ${brand} cleared.` : 'All inventory data cleared.', 'success');
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  async deleteRow(row: ProductRow) {
    const key = this.rowKey(row);
    if (this.pendingDelete() !== key) {
      this.pendingDelete.set(key);
      clearTimeout(this.pendingTimer);
      this.pendingTimer = setTimeout(() => this.pendingDelete.set(''), 3000);
      return;
    }
    clearTimeout(this.pendingTimer);
    this.pendingDelete.set('');
    try {
      const result = await this.api.deleteProduct(row);
      const index = this.rows().findIndex((item) => this.rowKey(item) === key);
      this.rows.update((items) => items.filter((item) => this.rowKey(item) !== key));
      this.undoStack.push({ row: result.removedRow || row, index: result.index ?? index });
      if (this.undoStack.length > 15) this.undoStack.shift();
      this.setStatus('Row deleted. Press Ctrl+Z to undo.', 'success');
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  @HostListener('document:keydown', ['$event'])
  async undo(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z' || this.isTyping(event.target)) return;
    const record = this.undoStack.pop();
    if (!record) return;
    event.preventDefault();
    try {
      await this.api.restoreProduct(record.row, record.index);
      this.rows.update((items) => { const next = [...items]; next.splice(Math.max(0, Math.min(record.index, next.length)), 0, record.row); return next; });
      this.setStatus('Restored.', 'success');
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  emptyMessage() {
    if (this.ui.focusedProduct()) return `No warehouse rows found for product "${this.ui.focusedProduct()}".`;
    if (this.ui.focusedBrand()) return `No warehouse rows found for brand "${this.ui.focusedBrand()}".`;
    return 'No data yet. Upload a report to get started.';
  }

  private async load() {
    const seq = ++this.loadSeq; // only the newest load may write state
    try {
      const data = await this.api.products();
      if (seq !== this.loadSeq) return;
      this.rows.set(data.rows || []);
      this.brandUploads.set(data.brandUploads || {});
      this.lastDate.set(data.date);
    } catch (error) {
      if (seq === this.loadSeq) this.setStatus(this.message(error), 'error');
      return;
    }
    // Brand chips only; a failure here must not affect the rows or cards.
    try {
      const { brands } = await this.api.brandNames();
      if (seq === this.loadSeq) this.knownBrands.set(brands);
    } catch { /* keep the previous chips */ }
  }

  private describeUpdate() {
    const uploads = this.brandUploads();
    const brand = Object.keys(uploads).find((name) => name.toLowerCase() === this.ui.focusedBrand().toLowerCase());
    if (brand) return `${brand} last updated: ${uploads[brand].date}`;
    return this.lastDate() ? `Last updated: ${this.lastDate()}` : 'No report uploaded yet';
  }

  private filterRows() {
    const query = this.query().trim().toLowerCase();
    let values = this.scopedRows().filter((row) => row.productName.toLowerCase().includes(query) || row.warehouseName.toLowerCase().includes(query));
    const sortKey = this.sortKey();
    if (sortKey) values = [...values].sort((a, b) => (this.sortAsc() ? 1 : -1) * compareValues(a, b, sortKey));
    return values;
  }

  /** Rows narrowed by the focused brand and product (not the search box). */
  private scopedRows() {
    const brand = this.ui.focusedBrand().toLowerCase();
    const product = this.ui.focusedProduct();
    let values = this.rows();
    if (brand) values = values.filter((row) => brandFor(row).toLowerCase() === brand);
    if (product) values = values.filter((row) => row.productName === product);
    return values;
  }

  private summarize(rows: ProductRow[]): InventorySummary {
    return { totalUnitsSold30: rows.reduce((sum, row) => sum + row.unitsSold30, 0), totalStock: rows.reduce((sum, row) => sum + row.totalStockAvailable, 0), productCount: new Set(rows.map((row) => row.productName)).size, lowOrOutCount: rows.filter((row) => row.stockStatus !== 'ok').length };
  }

  private setStatus(value: string, type: 'success' | 'error' | '') { this.status.set(value); this.statusType.set(type); }
  private message(error: unknown) { return error instanceof Error ? error.message : 'The request failed.'; }
  private isTyping(target: EventTarget | null) { const tag = (target as HTMLElement | null)?.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'; }
}
