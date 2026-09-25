import { Component, HostListener, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { brandFor, compareValues } from '../core/formatters';
import { InventorySummary, ProductRow } from '../core/models';
import { UiStateService } from '../core/ui-state.service';

@Component({
  selector: 'app-inventory-page',
  imports: [FormsModule],
  template: `
    <header class="topbar">
      <div class="topbar-left"><div><h1>Blinkit Inventory Dashboard</h1><span class="muted">{{ lastUpdated() }}</span></div></div>
      <div class="topbar-right">
        <span class="user-info muted">{{ auth.user()?.email }}</span>
        @if (isAdmin()) { <label class="upload-btn">Upload Report<input type="file" accept=".xlsx" hidden (change)="upload($event)"></label> }
        <button class="secondary-btn" (click)="download('/api/export')">Export Sheet</button>
        <button class="secondary-btn full-report-btn" (click)="download('/api/export-all')">📊 Full Report</button>
        <button class="logout-btn" (click)="auth.logout()">Logout</button>
      </div>
    </header>
    <div class="upload-status" [class.success]="statusType() === 'success'" [class.error]="statusType() === 'error'">{{ status() }}</div>

    <section class="cards">
      <div class="card"><div class="card-label">Units Sold (30 days)</div><div class="card-value">{{ summary().totalUnitsSold30 }}</div></div>
      <div class="card"><div class="card-label">Total Stock Available</div><div class="card-value">{{ summary().totalStock }}</div></div>
      <div class="card"><div class="card-label">Products</div><div class="card-value">{{ summary().productCount }}</div></div>
      <div class="card"><div class="card-label">Low / Out of Stock</div><div class="card-value">{{ summary().lowOrOutCount }}</div></div>
    </section>

    <section class="controls"><input id="searchBox" type="search" aria-label="Search products and warehouses" [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Search product or warehouse..."><span class="muted undo-hint">Tip: Ctrl+Z undoes the last delete</span></section>
    <section class="table-wrap">
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
  `,
})
export class InventoryPageComponent implements OnInit {
  readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly ui = inject(UiStateService);
  readonly rows = signal<ProductRow[]>([]);
  readonly summary = signal<InventorySummary>({ totalUnitsSold30: 0, totalStock: 0, productCount: 0, lowOrOutCount: 0 });
  readonly lastUpdated = signal('No report uploaded yet');
  readonly status = signal('');
  readonly statusType = signal<'success' | 'error' | ''>('');
  readonly pendingDelete = signal('');
  readonly displayedRows = computed(() => this.filterRows());
  readonly query = signal('');
  readonly sortKey = signal<keyof ProductRow | null>(null);
  readonly sortAsc = signal(true);
  private undoStack: { row: ProductRow; index: number }[] = [];
  private initialized = false;
  private pendingTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      this.ui.focusedProduct();
      this.ui.focusedBrand();
      this.ui.focusedFeeder();
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
      this.setStatus(`Uploaded successfully - ${result.rowCount} rows processed.`, 'success');
      await this.load();
    } catch (error) { this.setStatus(this.message(error), 'error'); }
    finally { input.value = ''; }
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
      this.recalculateFocusedSummary();
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
      this.recalculateFocusedSummary();
      this.setStatus('Restored.', 'success');
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  emptyMessage() {
    if (this.ui.focusedProduct()) return `No warehouse rows found for product "${this.ui.focusedProduct()}".`;
    if (this.ui.focusedBrand()) return `No warehouse rows found for brand "${this.ui.focusedBrand()}".`;
    return 'No data yet. Upload a report to get started.';
  }

  private async load() {
    try {
      const data = await this.api.products();
      this.rows.set(data.rows || []);
      this.lastUpdated.set(data.date ? `Last updated: ${data.date}` : 'No report uploaded yet');
      if (this.ui.focusedProduct() || this.ui.focusedBrand() || this.ui.focusedFeeder()) this.recalculateFocusedSummary();
      else this.summary.set(await this.api.inventorySummary());
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  private filterRows() {
    const query = this.query().trim().toLowerCase();
    const brand = this.ui.focusedBrand().toLowerCase();
    const product = this.ui.focusedProduct();
    const feeder = this.ui.focusedFeeder().toLowerCase();
    let values = this.rows().filter((row) => row.productName.toLowerCase().includes(query) || row.warehouseName.toLowerCase().includes(query));
    if (brand) values = values.filter((row) => brandFor(row).toLowerCase() === brand);
    if (product) values = values.filter((row) => row.productName === product);
    if (feeder) values = values.filter((row) => row.warehouseName.trim().toLowerCase() === feeder);
    const sortKey = this.sortKey();
    if (sortKey) values = [...values].sort((a, b) => (this.sortAsc() ? 1 : -1) * compareValues(a, b, sortKey));
    return values;
  }

  private recalculateFocusedSummary() {
    const rows = this.filterRows();
    this.summary.set({ totalUnitsSold30: rows.reduce((sum, row) => sum + row.unitsSold30, 0), totalStock: rows.reduce((sum, row) => sum + row.totalStockAvailable, 0), productCount: new Set(rows.map((row) => row.productName)).size, lowOrOutCount: rows.filter((row) => row.stockStatus !== 'ok').length });
  }

  private setStatus(value: string, type: 'success' | 'error' | '') { this.status.set(value); this.statusType.set(type); }
  private message(error: unknown) { return error instanceof Error ? error.message : 'The request failed.'; }
  private isTyping(target: EventTarget | null) { const tag = (target as HTMLElement | null)?.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'; }
}
