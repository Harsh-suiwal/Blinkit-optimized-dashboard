import { Component, HostListener, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { brandFor, compareValues } from '../core/formatters';
import { byProductThenWarehouse, stockTotals } from '../core/inventory-totals';
import { BrandUpload, InventorySummary, ProductRow } from '../core/models';
import { UiStateService } from '../core/ui-state.service';
import { BrandFilterComponent, mergeKnownBrands } from '../shared/brand-filter.component';
import { ClearDataDialogComponent } from '../shared/clear-data-dialog.component';

const HIDDEN_FEEDERS_KEY = 'blinkitHiddenFeeders';
// Status chips, most urgent first. Keys and labels match parser/stockStatus.js.
// 'zero' is a group: both of its statuses mean the stock is 0, so they share one parent chip.
const STATUS_ORDER = ['urgent', 'now', 'zero', 'covered', 'healthy', 'nosales'];
const STATUS_GROUPS: Record<string, string[]> = { zero: ['awaiting', 'out'] };
const STATUS_LABELS: Record<string, string> = {
  urgent: 'Reorder Urgently', now: 'Reorder Now', zero: 'Out of Stock', awaiting: 'Awaiting Incoming', out: 'Out of Stock',
  covered: 'Covered by Incoming', healthy: 'Healthy', nosales: 'No Recent Sales',
};
interface StatusOption { key: string; label: string; count: number; children?: StatusOption[]; }
// The urgent statuses, in plain words, for the list under the "Products Needing Urgent Action" card.
const URGENT_TAGS = [
  { key: 'urgent', label: 'Low stock' },
  { key: 'awaiting', label: 'Out, awaiting incoming' },
  { key: 'out', label: 'Out of stock' },
];

function readHiddenFeeders(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(HIDDEN_FEEDERS_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter((name) => typeof name === 'string') : [];
  } catch { return []; }
}

@Component({
  selector: 'app-inventory-page',
  imports: [FormsModule, BrandFilterComponent, ClearDataDialogComponent],
  template: `
    <header class="topbar topbar-static">
      <div class="topbar-left"><div><h1>Stock</h1><span class="muted">{{ lastUpdated() }}</span></div></div>
      <div class="topbar-right">
        @if (isAdmin()) { <label class="upload-btn">Upload Inventory<input type="file" accept=".xlsx" hidden (change)="upload($event)"></label> }
        @if (!ui.presenting()) { <button class="secondary-btn" (click)="download('/api/export')">Get Sheet</button> }
        <button class="secondary-btn full-report-btn" (click)="download('/api/export-all')">📊 Full Report</button>
        @if (isAdmin()) { <button class="secondary-btn danger-btn" (click)="clearOpen.set(true)">🗑️ Clear Data</button> }
      </div>
    </header>
    <div class="upload-status" [class.success]="statusType() === 'success'" [class.error]="statusType() === 'error'">{{ status() }}</div>

    @if (brandChips().length && !ui.focusedBrand()) {
      <section class="brand-bar"><app-brand-filter unit="units" [brands]="brandChips()" [selected]="ui.focusedBrand()" (select)="ui.setBrand($event)" /></section>
    }

    <section class="cards">
      <div class="card"><div class="card-label">Units Sold (30 days)</div><div class="card-value">{{ summary().totalUnitsSold30 }}</div></div>
      <div class="card"><div class="card-label">Total Stock Available</div><div class="card-value">{{ summary().totalStock }}</div></div>
      <div class="card card-hover-list" [attr.tabindex]="productList().length ? 0 : null">
        <div class="card-label">Products @if (productList().length) { <span class="card-info" aria-hidden="true">ⓘ</span> }</div><div class="card-value">{{ summary().productCount }}</div>
        @if (productList().length) {
          <div class="card-popover" role="tooltip">
            <div class="card-popover-body">
              <div class="card-popover-title">Each product is counted once, however many feeders stock it.</div>
              @for (product of productList(); track product.productName) {
                <div class="card-popover-row">
                  <span class="card-popover-name">{{ product.productName }}</span>
                  <span class="card-popover-meta">{{ product.feeders }} {{ product.feeders === 1 ? 'feeder' : 'feeders' }}</span>
                </div>
              }
            </div>
          </div>
        }
      </div>
      <div class="card card-hover-list" [attr.tabindex]="urgentProducts().length ? 0 : null">
        <div class="card-label">Products Needing Urgent Action @if (urgentProducts().length) { <span class="card-info" aria-hidden="true">ⓘ</span> }</div><div class="card-value">{{ summary().lowOrOutCount }}</div>
        @if (urgentProducts().length) {
          <div class="card-popover" role="tooltip">
            <div class="card-popover-body">
              <div class="card-popover-title">Low or out of stock in at least one feeder. Low stock runs out before a reorder can arrive.</div>
              @for (product of urgentProducts(); track product.productName) {
                <div class="card-popover-row">
                  <span class="card-popover-name">{{ product.productName }}</span>
                  <span class="card-popover-tags">@for (tag of product.tags; track tag.key) { <span class="status-pill" [class]="'status-' + tag.key">{{ tag.label }}: {{ tag.count }} {{ tag.count === 1 ? 'feeder' : 'feeders' }}</span> }</span>
                </div>
              }
            </div>
          </div>
        }
      </div>
    </section>

    <section class="controls stock-controls">
      <input id="searchBox" type="search" aria-label="Search products and warehouses" [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Search product or warehouse...">
      <div class="feeder-picker">
        <button type="button" class="secondary-btn feeder-picker-btn" [attr.aria-expanded]="feederOpen()" (click)="feederOpen.set(!feederOpen())">Feeders: {{ shownFeederCount() }} of {{ feederNames().length }} <span aria-hidden="true">▾</span></button>
        @if (feederOpen()) {
          <div class="feeder-menu" role="group" aria-label="Feeders shown">
            <div class="feeder-menu-actions">
              <button type="button" (click)="showAllFeeders()">Select all</button>
              <button type="button" (click)="hideAllFeeders()">Clear all</button>
            </div>
            @for (name of feederNames(); track name) {
              <label class="feeder-option"><input type="checkbox" [checked]="!isFeederHidden(name)" (change)="toggleFeeder(name)"><span>{{ name }}</span></label>
            }
            @if (!feederNames().length) { <p class="muted">No feeders in this report.</p> }
          </div>
        }
      </div>
      @if (hiddenFeederCount()) { <span class="muted">{{ hiddenFeederCount() }} hidden</span> }
    </section>
    @if (statusOptions().length) {
      <section class="controls status-filter" role="group" aria-label="Filter by status">
        <button type="button" class="status-chip status-chip-all" [class.active]="!statusFilter()" [attr.aria-pressed]="!statusFilter()" (click)="statusFilter.set('')">All <span class="status-chip-count">{{ searchedRows().length }}</span></button>
        @for (option of statusOptions(); track option.key) {
          @if (option.children; as kids) {
            <!-- A parent chip with its statuses under it as a small tree (hover, or click to keep it open) -->
            <div class="status-group" [class.open]="groupOpen() === option.key">
              <button type="button" class="status-chip status-out" [class.active]="isGroupActive(option.key)" [attr.aria-pressed]="isGroupActive(option.key)" [attr.aria-expanded]="groupOpen() === option.key" (click)="pickGroup(option.key)">{{ groupLabel(option) }} <span class="status-chip-count">{{ groupCount(option) }}</span> <span aria-hidden="true">▾</span></button>
              <div class="status-tree" role="group" [attr.aria-label]="option.label + ' statuses'">
                @for (kid of kids; track kid.key) {
                  <button type="button" class="status-chip" [class]="'status-' + kid.key" [class.active]="statusFilter() === kid.key" [attr.aria-pressed]="statusFilter() === kid.key" (click)="pickChild(kid.key)">{{ kid.label }} <span class="status-chip-count">{{ kid.count }}</span></button>
                }
              </div>
            </div>
          } @else {
            <button type="button" class="status-chip" [class]="'status-' + option.key" [class.active]="statusFilter() === option.key" [attr.aria-pressed]="statusFilter() === option.key" (click)="toggleStatus(option.key)">{{ option.label }} <span class="status-chip-count">{{ option.count }}</span></button>
          }
        }
      </section>
    }
    <section class="table-wrap table-wrap-page">
      <table id="productTable" class="stock-table">
        <colgroup>
          <col class="col-product"><col class="col-warehouse"><col class="col-num"><col class="col-num"><col class="col-num"><col class="col-num"><col class="col-num"><col class="col-num"><col class="col-incoming"><col class="col-status"><col class="col-detail"><col class="col-action">
        </colgroup>
        <thead><tr>
        <th (click)="sortBy('productName')">Product {{ sortIndicator('productName') }}</th><th (click)="sortBy('warehouseName')">Warehouse {{ sortIndicator('warehouseName') }}</th><th (click)="sortBy('totalStockAvailable')">Stock {{ sortIndicator('totalStockAvailable') }}</th><th (click)="sortBy('unitsSold7')">Sold 7d {{ sortIndicator('unitsSold7') }}</th><th (click)="sortBy('unitsSold15')">Sold 15d {{ sortIndicator('unitsSold15') }}</th><th (click)="sortBy('unitsSold30')">Sold 30d {{ sortIndicator('unitsSold30') }}</th><th (click)="sortBy('unitsSold45')">Sold 45d {{ sortIndicator('unitsSold45') }}</th><th (click)="sortBy('unitsSold60')">Sold 60d {{ sortIndicator('unitsSold60') }}</th><th (click)="sortBy('incomingInventory')">Incoming {{ sortIndicator('incomingInventory') }}</th><th>Status</th><th>What to do</th><th></th>
      </tr></thead><tbody>
        @for (row of displayedRows(); track rowKey(row)) { <tr>
          <td [title]="row.productName"><div class="cell-clamp">{{ row.productName }}</div></td><td [title]="row.warehouseName"><div class="cell-clamp">{{ row.warehouseName }}</div></td><td>{{ row.totalStockAvailable }}</td><td>{{ row.unitsSold7 }}</td><td>{{ row.unitsSold15 }}</td><td>{{ row.unitsSold30 }}</td><td><span [class.na]="row.unitsSold45 === null">{{ row.unitsSold45 ?? 'n/a' }}</span></td><td><span [class.na]="row.unitsSold60 === null">{{ row.unitsSold60 ?? 'n/a' }}</span></td><td>{{ row.incomingInventory }}</td>
          <td class="status-cell">
            @if (row.stockHealth; as h) {
              <span class="status-pill" [class]="'status-' + h.key" [title]="h.tip">{{ h.label }}</span>
              @if (h.surgeBadge) { <span class="surge-badge" [title]="h.surgeLine ?? ''">{{ h.surgeBadge }}</span> }
            } @else {
              <span class="status-pill" [class.status-ok]="row.stockStatus === 'ok'" [class.status-low]="row.stockStatus === 'low'" [class.status-out]="row.stockStatus === 'out'">{{ row.stockStatus === 'ok' ? 'OK' : row.stockStatus === 'low' ? 'Low' : 'Out' }}</span>
            }
          </td>
          <td class="detail-cell" [title]="row.stockHealth?.tip ?? ''">
            @if (row.stockHealth; as h) {
              <div class="cell-clamp cell-detail">{{ h.line }}</div>
            }
          </td>
          <td>@if (isAdmin()) { <button class="delete-btn" [class.confirming]="pendingDelete() === rowKey(row)" (click)="deleteRow(row)">{{ pendingDelete() === rowKey(row) ? 'Sure?' : '🗑️' }}</button> }</td>
        </tr> }
      </tbody>
      @if (displayedRows().length) {
        <tfoot><tr>
          <td><strong>Total</strong></td><td><strong>{{ totals().rows }} rows</strong></td>
          <td><strong>{{ totals().stock }}</strong></td><td><strong>{{ totals().sold7 }}</strong></td><td><strong>{{ totals().sold15 }}</strong></td><td><strong>{{ totals().sold30 }}</strong></td>
          <td><strong>{{ totals().sold45 ?? 'n/a' }}</strong></td><td><strong>{{ totals().sold60 ?? 'n/a' }}</strong></td><td><strong>{{ totals().incoming }}</strong></td>
          <td colspan="2"><strong>{{ totals().lowOrOut }} rows need action</strong></td><td></td>
        </tr></tfoot>
      }
      </table>
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
  // Derived from the loaded rows so the cards follow the brand, product and search filters instantly,
  // even if a reload fails (e.g. a 401 after a server restart).
  readonly summary = computed<InventorySummary>(() => this.summarize(this.statusRows()));
  readonly status = signal('');
  readonly statusType = signal<'success' | 'error' | ''>('');
  readonly pendingDelete = signal('');
  readonly searchedRows = computed(() => this.searchRows());
  // Status filter: '' = every status, else one status key (e.g. 'urgent'). Not saved: a reload shows everything again.
  readonly statusFilter = signal('');
  /** The searched rows narrowed to the picked status; the cards, the table and the totals all follow it. */
  readonly statusRows = computed(() => {
    const key = this.statusFilter();
    if (!key) return this.searchedRows();
    const keys = STATUS_GROUPS[key] ?? [key]; // a group (e.g. 'zero') covers several statuses
    return this.searchedRows().filter((row) => !!row.stockHealth && keys.includes(row.stockHealth.key));
  });
  /** The unique products behind the "Products" card, A to Z, each with how many feeders stock it. Shown on hover or focus. */
  readonly productList = computed(() => {
    const feeders = new Map<string, number>();
    for (const row of this.statusRows()) feeders.set(row.productName, (feeders.get(row.productName) ?? 0) + 1);
    return Array.from(feeders, ([productName, count]) => ({ productName, feeders: count })).sort((a, b) => a.productName.localeCompare(b.productName));
  });
  /**
   * The products behind the "Products Needing Urgent Action" card, worst first, each with how many of its
   * feeders are low (Reorder Urgently) or out of stock. Shown when the card is hovered or focused.
   */
  readonly urgentProducts = computed(() => {
    const byProduct = new Map<string, Map<string, number>>();
    for (const row of this.statusRows()) {
      const h = row.stockHealth;
      if (!h?.urgentAction) continue;
      const counts = byProduct.get(row.productName) ?? new Map<string, number>();
      counts.set(h.key, (counts.get(h.key) ?? 0) + 1);
      byProduct.set(row.productName, counts);
    }
    return Array.from(byProduct, ([productName, counts]) => ({
      productName,
      total: Array.from(counts.values()).reduce((sum, n) => sum + n, 0),
      tags: URGENT_TAGS.filter((tag) => counts.has(tag.key)).map((tag) => ({ ...tag, count: counts.get(tag.key)! })),
    })).sort((a, b) => b.total - a.total || a.productName.localeCompare(b.productName));
  });
  /** Which group's tree is pinned open by a click ('' = none); hovering shows it too. */
  readonly groupOpen = signal('');
  /**
   * The chips, most urgent first, each with its row count in the rows in view. Statuses that belong to a group
   * (Awaiting Incoming and Out of Stock are both zero stock) sit under one parent chip as `children`.
   * The picked status stays listed even at 0 rows, so it can be un-picked.
   */
  readonly statusOptions = computed<StatusOption[]>(() => {
    const counts = new Map<string, StatusOption>();
    for (const row of this.searchedRows()) {
      const h = row.stockHealth;
      if (!h) continue;
      const entry = counts.get(h.key) ?? { key: h.key, label: h.label, count: 0 };
      entry.count += 1;
      counts.set(h.key, entry);
    }
    const picked = this.statusFilter();
    if (picked && !STATUS_GROUPS[picked] && !counts.has(picked)) counts.set(picked, { key: picked, label: STATUS_LABELS[picked] ?? picked, count: 0 });
    const options: StatusOption[] = [];
    for (const key of STATUS_ORDER) {
      const members = STATUS_GROUPS[key];
      if (!members) {
        if (counts.has(key)) options.push(counts.get(key)!);
        continue;
      }
      const children = members.filter((member) => counts.has(member)).map((member) => counts.get(member)!);
      if (children.length || picked === key) {
        options.push({ key, label: STATUS_LABELS[key] ?? key, count: children.reduce((sum, child) => sum + child.count, 0), children });
      }
    }
    return options;
  });
  readonly displayedRows = computed(() => this.filterRows());
  readonly totals = computed(() => stockTotals(this.displayedRows()));
  readonly query = signal('');
  // Feeders (the report's warehouses) the user has switched off. Saved in this browser, so a new feeder shows by default.
  readonly hiddenFeeders = signal<string[]>(readHiddenFeeders());
  readonly feederOpen = signal(false);
  /** Every feeder in the rows for the brand and product in view, A to Z. */
  readonly feederNames = computed(() => Array.from(new Set(this.brandRows().map((row) => row.warehouseName))).sort((a, b) => a.localeCompare(b)));
  readonly hiddenFeederCount = computed(() => this.feederNames().filter((name) => this.hiddenFeeders().includes(name)).length);
  readonly shownFeederCount = computed(() => this.feederNames().length - this.hiddenFeederCount());
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

  isAdmin() { return this.auth.isAdmin(); }
  rowKey(row: ProductRow) { return `${row.productName}::${row.warehouseName}`; }
  /** Clicking the picked status again goes back to all statuses. */
  toggleStatus(key: string) { this.statusFilter.set(this.statusFilter() === key ? '' : key); this.groupOpen.set(''); }
  /** Parent chip: shows every status in the group and pins its tree open; a second click un-picks it and closes the tree. */
  pickGroup(key: string) {
    const wasPicked = this.statusFilter() === key;
    this.statusFilter.set(wasPicked ? '' : key);
    this.groupOpen.set(wasPicked ? '' : key);
  }
  /** A status inside a group's tree: shows only that status and closes the tree. */
  pickChild(key: string) { this.statusFilter.set(this.statusFilter() === key ? '' : key); this.groupOpen.set(''); }
  /** The parent is lit when it, or one of its statuses, is the filter. */
  isGroupActive(key: string) { return this.statusFilter() === key || (STATUS_GROUPS[key] ?? []).includes(this.statusFilter()); }
  /** "Out of Stock", or "Out of Stock › Awaiting Incoming" when one of its statuses is picked. */
  groupLabel(option: StatusOption) {
    const child = (option.children ?? []).find((kid) => kid.key === this.statusFilter());
    return child ? `${option.label} › ${child.label}` : option.label;
  }
  groupCount(option: StatusOption) {
    const child = (option.children ?? []).find((kid) => kid.key === this.statusFilter());
    return child ? child.count : option.count;
  }
  isFeederHidden(name: string) { return this.hiddenFeeders().includes(name); }
  toggleFeeder(name: string) { this.saveHiddenFeeders(this.isFeederHidden(name) ? this.hiddenFeeders().filter((n) => n !== name) : [...this.hiddenFeeders(), name]); }
  /** Shows every feeder in view (feeders hidden under another brand stay hidden). */
  showAllFeeders() { const inView = new Set(this.feederNames()); this.saveHiddenFeeders(this.hiddenFeeders().filter((n) => !inView.has(n))); }
  hideAllFeeders() { this.saveHiddenFeeders(Array.from(new Set([...this.hiddenFeeders(), ...this.feederNames()]))); }
  private saveHiddenFeeders(names: string[]) {
    this.hiddenFeeders.set(names);
    try { localStorage.setItem(HIDDEN_FEEDERS_KEY, JSON.stringify(names)); } catch { /* private mode: the choice lasts until reload */ }
  }
  /** A click outside the feeder menu, or Escape, closes it. */
  @HostListener('document:click', ['$event'])
  closeFeederMenu(event: Event) {
    const target = event.target as HTMLElement | null;
    if (this.feederOpen() && !target?.closest('.feeder-picker')) this.feederOpen.set(false);
    if (this.groupOpen() && !target?.closest('.status-group')) this.groupOpen.set('');
  }
  @HostListener('document:keydown.escape')
  closeFeederMenuOnEscape() { this.feederOpen.set(false); this.groupOpen.set(''); }
  sortBy(key: keyof ProductRow) { this.sortAsc.set(this.sortKey() === key ? !this.sortAsc() : true); this.sortKey.set(key); }
  sortIndicator(key: keyof ProductRow) { return this.sortKey() === key ? (this.sortAsc() ? '↑' : '↓') : ''; }
  /** Downloads through the app so a failure shows a message instead of raw JSON. The Stock sheet is limited to the brand picked in the sidebar. */
  async download(url: string) {
    const brand = this.ui.focusedBrand();
    const target = brand && url === '/api/export' ? `${url}?brand=${encodeURIComponent(brand)}` : url;
    try {
      await this.api.download(target, 'Stock_report.xlsx');
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

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
    if (this.feederNames().length && !this.shownFeederCount()) return 'No feeders are selected. Tick at least one in the Feeders menu.';
    if (this.statusFilter() && this.searchedRows().length) return `No rows are "${STATUS_LABELS[this.statusFilter()] ?? this.statusFilter()}" right now. Pick another status, or All.`;
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

  /** The rows shown: the search applied, then sorted. While searching with no column sort, a product's warehouse rows stay together. */
  private filterRows() {
    let values = this.statusRows();
    const sortKey = this.sortKey();
    if (sortKey) values = [...values].sort((a, b) => (this.sortAsc() ? 1 : -1) * compareValues(a, b, sortKey));
    else if (this.query().trim()) values = [...values].sort(byProductThenWarehouse);
    return values;
  }

  /** Rows narrowed by the focused brand and product, then by the search box. */
  private searchRows() {
    const query = this.query().trim().toLowerCase();
    return this.scopedRows().filter((row) => row.productName.toLowerCase().includes(query) || row.warehouseName.toLowerCase().includes(query));
  }

  /** Rows narrowed by the focused brand and product, with the switched-off feeders removed (not the search box). */
  private scopedRows() {
    const hidden = new Set(this.hiddenFeeders());
    return hidden.size ? this.brandRows().filter((row) => !hidden.has(row.warehouseName)) : this.brandRows();
  }

  /** Rows narrowed by the focused brand and product only: the feeder menu lists the feeders found here. */
  private brandRows() {
    const brand = this.ui.focusedBrand().toLowerCase();
    const product = this.ui.focusedProduct();
    let values = this.rows();
    if (brand) values = values.filter((row) => brandFor(row).toLowerCase() === brand);
    if (product) values = values.filter((row) => row.productName === product);
    return values;
  }

  private summarize(rows: ProductRow[]): InventorySummary {
    return { totalUnitsSold30: rows.reduce((sum, row) => sum + row.unitsSold30, 0), totalStock: rows.reduce((sum, row) => sum + row.totalStockAvailable, 0), productCount: new Set(rows.map((row) => row.productName)).size, lowOrOutCount: new Set(rows.filter((row) => row.stockHealth?.urgentAction).map((row) => row.productName)).size }; // products with a warehouse that is Reorder Urgently, Awaiting Incoming or Out of Stock
  }

  private setStatus(value: string, type: 'success' | 'error' | '') { this.status.set(value); this.statusType.set(type); }
  private message(error: unknown) { return error instanceof Error ? error.message : 'The request failed.'; }
  private isTyping(target: EventTarget | null) { const tag = (target as HTMLElement | null)?.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'; }
}