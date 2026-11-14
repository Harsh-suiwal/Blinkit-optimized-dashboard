import { Component, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from '../core/api.service';
import { money, number } from '../core/formatters';
import { ProductMonthBrandRow, ProductMonthDetail, ProductMonthRow } from '../core/models';
import { UiStateService } from '../core/ui-state.service';
import { brandStripTotal, changeText, compactMoney, computeWins, monthChange, shortMonth, signedMoney, withTiers } from '../core/product-months.logic';

const CITY_MISSING = "City split not available for this month. Re-upload that month's sales report.";

/**
 * Sales > Month by month: the ticked product(s), month by month, for client presentations. One ticked
 * product shows that product; several ticked products are added together.
 * Money first. Profit is always "profit before ads" (advertising is brand level) and is
 * drawn only when the server says profitVisible.
 */
@Component({
  selector: 'app-product-months',
  template: `
    @if (!brand()) {
      <p class="muted brand-note">Pick a brand to see its products by month</p>
    } @else {
      <section class="controls product-months-controls">
        <label class="filter-label" for="pmSearch">Product</label>
        <input id="pmSearch" class="styled-select" type="search" aria-label="Search products" placeholder="Search a product, e.g. Stainless Spoon" [value]="query()" (input)="onSearch($event)" (focus)="menuOpen.set(true)">
        <!-- Tick the products to show. One tick = that product; several = added together. -->
        <div class="feeder-picker pm-picker">
          <button type="button" class="secondary-btn feeder-picker-btn pm-picker-btn" [attr.aria-expanded]="menuOpen()" [title]="pickedTitle()" (click)="menuOpen.set(!menuOpen())"><span class="pm-picker-text">{{ pickedLabel() }}</span> <span aria-hidden="true">▾</span></button>
          @if (menuOpen()) {
            <div class="feeder-menu pm-menu" role="group" aria-label="Products to show">
              @if (filteredNames().length) {
                <label class="feeder-option pm-all"><input type="checkbox" [checked]="allShownPicked()" [indeterminate]="someShownPicked() && !allShownPicked()" (change)="toggleAllShown()"><span>{{ query().trim() ? 'All ' + filteredNames().length + ' matching products' : 'All products' }}</span></label>
                @for (name of filteredNames(); track name) {
                  <div class="pm-row">
                    <label class="feeder-option"><input type="checkbox" [checked]="isPicked(name)" (change)="togglePick(name)"><span [title]="name">{{ name }}</span></label>
                    <button type="button" class="pm-only" title="Show only this product" (click)="pickOnly(name)">Only</button>
                  </div>
                }
              } @else {
                <p class="muted pm-none">No product matches "{{ query() }}".</p>
              }
            </div>
          }
        </div>
        <span class="muted">{{ picked().length }} of {{ names().length }} products ticked</span>
      </section>
      @if (error()) { <p class="muted brand-note">{{ error() }}</p> }
      @if (names().length && !picked().length) { <p class="muted brand-note">Tick at least one product to see it month by month.</p> }
      @if (detail(); as d) {
        @if (!d.months.length) {
          <section class="overview-empty">
            <h2>{{ isSet() ? 'No sales yet for these products' : 'No sales yet for this product' }}</h2>
            <p class="muted">{{ d.product }} {{ isSet() ? 'have' : 'has' }} no sales in the uploaded monthly reports.</p>
          </section>
        } @else {
          <section class="controls month-controls">
            <div class="month-chips" role="group" aria-label="Months to show">
              @for (m of allMonths(); track m.monthKey) {
                <button type="button" class="month-chip" [class.active]="isSelected(m.monthKey)" [attr.aria-pressed]="isSelected(m.monthKey)" (click)="toggleMonth(m.monthKey)">{{ shortMonth(m.monthKey) }}{{ m.partial ? '*' : '' }}</button>
              }
            </div>
          </section>
          @if (wins().length) {
            <section class="wins-strip" aria-label="Highlights">
              @for (w of wins(); track w.key) { <span class="win-item">{{ w.text }}</span> }
            </section>
          }
          <section class="cards month-cards" aria-label="Revenue by month">
            @for (m of columns(); track m.monthKey; let i = $index) {
              <div class="card month-card month-card-pick" role="button" tabindex="0" [class.picked]="m.monthKey === cityMonthKey()" [attr.aria-pressed]="m.monthKey === cityMonthKey()" (click)="cityMonth.set(m.monthKey)" (keydown.enter)="cityMonth.set(m.monthKey)">
                <div class="card-label">{{ m.label }}@if (m.partial) { <span class="badge-partial">Partial month</span> }</div>
                <div class="card-value">{{ money(m.revenue, 0) }}</div>
                <span class="delta" [class.up]="changeUp(i)">{{ changeLabel(i) }}</span>
                <dl class="month-card-stats">
                  <div><dt>Total units sold</dt><dd>{{ number(m.units) }}</dd></div>
                  <div><dt>{{ ordersLabel() }}</dt><dd>{{ number(m.orderCount) }}</dd></div>
                  <div><dt>Avg order</dt><dd>{{ money(m.avgOrderValue, 0) }}</dd></div>
                  <div><dt>Top city</dt><dd>@if (m.topCity; as top) { {{ top.city }} ({{ top.sharePct }}%) } @else { - }</dd></div>
                  @if (profitVisible()) { <div class="month-card-wide"><dt>Profit before ads</dt><dd>{{ profitText(m) }}</dd></div> }
                </dl>
                @if (m.cityDataMissing) { <p class="muted month-card-note">{{ cityMissingText }}</p> }
              </div>
            }
          </section>
          <section class="overview-section" aria-labelledby="pmChart">
            <div class="overview-head"><div><h2 id="pmChart">Revenue by month</h2></div></div>
            <div class="month-bars" role="img" [attr.aria-label]="chartLabel()">
              @for (m of columns(); track m.monthKey) {
                <div class="month-bar" [class.partial]="m.partial">
                  <span class="month-bar-value">{{ compactMoney(m.revenue) }}</span>
                  <span class="month-bar-track"><span class="month-bar-fill" [style.height.%]="barHeight(m.revenue)"></span></span>
                  <span class="month-bar-label">{{ shortMonth(m.monthKey) }}{{ m.partial ? '*' : '' }}</span>
                </div>
              }
            </div>
          </section>
          <section class="table-wrap compare-table">
            <h3>{{ d.product }} by month</h3>
            <table id="productMonthsTable">
              <thead><tr><th>Month</th><th>Revenue</th><th>Change</th><th>Total units sold</th><th>{{ ordersLabel() }}</th><th>Avg order value</th><th>Top city</th>@if (profitVisible()) { <th>Profit before ads</th><th>Margin</th><th>Profit per unit</th> }</tr></thead>
              <tbody>
                @for (m of columns(); track m.monthKey; let i = $index) {
                  <tr>
                    <td>{{ m.label }}{{ m.partial ? '*' : '' }}</td>
                    <td>{{ money(m.revenue, 0) }}</td>
                    <td><span class="delta" [class.up]="changeUp(i)">{{ changeLabel(i) }}</span></td>
                    <td>{{ number(m.units) }}</td>
                    <td>{{ number(m.orderCount) }}</td>
                    <td>{{ money(m.avgOrderValue, 0) }}</td>
                    <td>@if (m.topCity; as top) { {{ top.city }} ({{ top.sharePct }}%) } @else { - }</td>
                    @if (profitVisible()) {
                      <td>{{ profitText(m) }}</td>
                      <td>{{ marginText(m) }}</td>
                      <td>{{ perUnitText(m) }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
            @if (d.ordersOverlap) { <p class="muted overview-footnote">Orders: each ticked product's orders added together, so an order that holds two of the ticked products is counted once for each. Revenue and units are exact.</p> }
            @if (profitVisible()) { <p class="muted overview-footnote">Profit before ads: net sales minus product cost and Blinkit fees for {{ isSet() ? 'the ticked products' : 'this product' }}. Advertising is brand level, so it is not split across products.</p> }
            @if (profitVisible() && (d.profitMissing ?? 0) > 0) { <p class="muted overview-footnote">Profit covers {{ (d.productCount ?? 0) - (d.profitMissing ?? 0) }} of the {{ d.productCount }} ticked products: {{ d.profitMissing }} {{ d.profitMissing === 1 ? 'has' : 'have' }} no cost sheet row, so {{ d.profitMissing === 1 ? 'its' : 'their' }} profit is not counted.</p> }
            @if (hasPartial()) { <p class="muted overview-footnote">* Partial month: the uploaded orders don't cover every day of that month, so it is not compared.</p> }
          </section>
          @if (cityMonthRow(); as cm) {
            @if (cityRows().length) {
              <section class="legend">
                <span class="legend-item"><span class="dot dot-top"></span> Top 25% cities</span>
                <span class="legend-item"><span class="dot dot-low"></span> Bottom 25% cities</span>
              </section>
            }
            <section class="table-wrap compare-table">
              <h3>{{ d.product }} in {{ cm.label }} - revenue by city</h3>
              @if (cm.cityDataMissing) {
                <p class="muted">{{ cityMissingText }}</p>
              } @else if (!cityRows().length) {
                <p class="muted">No city-level sales recorded for {{ isSet() ? 'these products' : 'this product' }} in {{ cm.label }}.</p>
              } @else {
                <p class="muted">Showing all {{ cityRows().length }} cities. Click a month card above to see another month.</p>
                <table id="productMonthCityTable"><thead><tr><th>Rank</th><th>City</th><th>Revenue</th><th>Share</th><th>Total units sold</th><th>{{ ordersLabel() }}</th><th>Avg order value</th></tr></thead><tbody>
                  @for (row of cityRows(); track row.city; let index = $index) {
                    <tr [class.row-top]="row.tier === 'top'" [class.row-low]="row.tier === 'low'"><td>{{ index + 1 }}</td><td>{{ row.city }}</td><td>{{ money(row.revenue) }}</td><td>{{ row.sharePct }}%</td><td>{{ number(row.units) }}</td><td>{{ number(row.orderCount) }}</td><td>{{ money(row.avgOrderValue) }}</td></tr>
                  }
                </tbody></table>
              }
            </section>
          }
          @if (profitVisible() && brandRows().length) {
            <section class="table-wrap compare-table brand-strip">
              <h3>Brand total (all products)</h3>
              <p class="muted">This is the whole brand, not {{ d.product }}. Advertising is brand level.</p>
              <table id="productMonthsBrandTable">
                <thead><tr><th>Month</th><th>Profit before ads</th><th>Ad spend</th><th>Profit after ads</th><th>Margin</th></tr></thead>
                <tbody>
                  @for (r of brandRows(); track r.monthKey) {
                    <tr>
                      <td>{{ r.label }}{{ r.partial ? '*' : '' }}</td>
                      <td>{{ r.profitBeforeAds === null ? 'No cost sheet' : signedMoney(r.profitBeforeAds, 0) }}</td>
                      <td>{{ r.adDataMissing ? 'Ad spend not uploaded' : money(r.adSpend, 0) }}</td>
                      <td>{{ afterAdsText(r) }}</td>
                      <td>{{ marginAfterText(r) }}</td>
                    </tr>
                  }
                  @if (brandTotal(); as t) {
                    <tr>
                      <td><strong>Total</strong></td>
                      <td><strong>{{ signedMoney(t.profitBeforeAds, 0) }}</strong></td>
                      <td><strong>{{ t.adDataMissing ? 'Not for every month' : money(t.adSpend, 0) }}</strong></td>
                      <td><strong>{{ t.profitAfterAds === null ? 'n/a' : signedMoney(t.profitAfterAds, 0) }}</strong></td>
                      <td><strong>{{ t.marginPct === null ? 'n/a' : t.marginPct + '%' }}</strong></td>
                    </tr>
                  }
                </tbody>
              </table>
              <p class="muted overview-footnote">Profit after ads also takes off the other costs entered on the Profit tab. Months without a cost sheet are not counted.</p>
            </section>
          }
        }
      } @else if (loading()) {
        <p class="muted overview-loading">Loading…</p>
      }
    }
  `,
})
export class ProductMonthsComponent {
  private readonly api = inject(ApiService);
  readonly ui = inject(UiStateService);
  readonly brand = computed(() => this.ui.focusedBrand());
  readonly names = signal<string[]>([]);
  readonly query = signal('');
  /** The ticked product names (their order does not matter). */
  readonly picked = signal<string[]>([]);
  readonly menuOpen = signal(false);
  readonly detail = signal<ProductMonthDetail | null>(null);
  readonly selected = signal<string[]>([]);
  readonly cityMonth = signal('');
  readonly loading = signal(false);
  readonly error = signal('');
  readonly money = money;
  readonly number = number;
  readonly shortMonth = shortMonth;
  readonly signedMoney = signedMoney;
  readonly cityMissingText = CITY_MISSING;
  private namesRequest = 0;
  private detailRequest = 0;
  /** True once the user picked months by hand; their choice then survives a change of ticked products. */
  private monthsTouched = false;

  readonly filteredNames = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q ? this.names().filter((n) => n.toLowerCase().includes(q)) : this.names();
  });
  /** Several products are ticked, so the figures are those products added together. */
  readonly isSet = computed(() => (this.detail()?.productCount ?? 1) > 1);
  /** "Unique orders" for one product; for several it is the per-product orders added up, so it is not called unique. */
  readonly ordersLabel = computed(() => (this.detail()?.ordersOverlap ? 'Orders (per product)' : 'Unique orders'));
  readonly allShownPicked = computed(() => {
    const shown = this.filteredNames();
    const picked = new Set(this.picked());
    return shown.length > 0 && shown.every((n) => picked.has(n));
  });
  readonly someShownPicked = computed(() => {
    const picked = new Set(this.picked());
    return this.filteredNames().some((n) => picked.has(n));
  });
  /** The button text: the product's name for one tick, a count for several. */
  readonly pickedLabel = computed(() => {
    const picked = this.picked();
    if (!picked.length) return 'Tick a product';
    if (picked.length === 1) return picked[0];
    return picked.length === this.names().length ? `All products (${picked.length})` : `${picked.length} products`;
  });
  readonly pickedTitle = computed(() => this.picked().join('\n'));
  readonly profitVisible = computed(() => this.detail()?.profitVisible === true && !this.ui.presenting());
  readonly allMonths = computed(() => this.detail()?.months ?? []);
  readonly columns = computed(() => {
    const keys = this.selected();
    return this.allMonths().filter((m) => keys.includes(m.monthKey));
  });
  readonly hasPartial = computed(() => this.columns().some((m) => m.partial));
  /** The month whose cities are listed: the one clicked, else the latest selected. */
  readonly cityMonthKey = computed(() => {
    const columns = this.columns();
    const picked = this.cityMonth();
    return columns.some((m) => m.monthKey === picked) ? picked : (columns.length ? columns[columns.length - 1].monthKey : '');
  });
  readonly cityMonthRow = computed(() => this.columns().find((m) => m.monthKey === this.cityMonthKey()) ?? null);
  readonly cityRows = computed(() => {
    const row = this.cityMonthRow();
    return row ? withTiers(row.cities) : [];
  });
  readonly wins = computed(() => computeWins({ columns: this.columns(), allMonths: this.allMonths(), profitVisible: this.profitVisible() }));
  readonly chartMax = computed(() => Math.max(0, ...this.columns().map((m) => m.revenue)));
  readonly chartLabel = computed(() => this.columns().map((m) => `${m.label}: ${money(m.revenue, 0)}`).join('; '));
  readonly compactMoney = compactMoney;
  readonly brandRows = computed<ProductMonthBrandRow[]>(() => {
    const keys = this.selected();
    return (this.detail()?.brandMonths ?? []).filter((r) => keys.includes(r.monthKey));
  });
  readonly brandTotal = computed(() => brandStripTotal(this.brandRows()));

  constructor() {
    effect(() => {
      const brand = this.ui.focusedBrand();
      untracked(() => void this.loadNames(brand));
    });
  }

  isSelected(monthKey: string) { return this.selected().includes(monthKey); }

  toggleMonth(monthKey: string) {
    const current = this.selected();
    const next = current.includes(monthKey) ? current.filter((k) => k !== monthKey) : [...current, monthKey];
    if (!next.length) return; // keep at least one month selected
    this.monthsTouched = true;
    this.selected.set(next);
  }

  onSearch(event: Event) { this.query.set((event.target as HTMLInputElement).value); this.menuOpen.set(true); }

  isPicked(name: string) { return this.picked().includes(name); }

  togglePick(name: string) {
    const current = this.picked();
    void this.setPicked(current.includes(name) ? current.filter((n) => n !== name) : [...current, name]);
  }

  /** Shows just this one product and closes the menu. */
  pickOnly(name: string) {
    this.menuOpen.set(false);
    void this.setPicked([name]);
  }

  /** The tick at the top: ticks every product in the list (after the search), or unticks them when all are ticked. */
  toggleAllShown() {
    const shown = this.filteredNames();
    const shownSet = new Set(shown);
    const rest = this.picked().filter((n) => !shownSet.has(n));
    void this.setPicked(this.allShownPicked() ? rest : [...rest, ...shown]);
  }

  /** A click anywhere outside the product menu, or Esc, closes it. */
  @HostListener('document:click', ['$event'])
  closeMenu(event: Event) {
    const target = event.target as HTMLElement | null;
    if (this.menuOpen() && !target?.closest('.pm-picker, #pmSearch')) this.menuOpen.set(false);
  }
  @HostListener('document:keydown.escape')
  closeMenuOnEscape() { this.menuOpen.set(false); }

  changeLabel(index: number) { return changeText(monthChange(this.columns(), index)); }
  changeUp(index: number) {
    const change = monthChange(this.columns(), index);
    return change.kind === 'change' && (change.pct ?? 0) > 0;
  }

  profitText(m: ProductMonthRow) {
    const value = m.profit?.profitBeforeAds ?? null;
    return value === null ? (this.isSet() ? 'No cost sheet row for these products' : 'No cost sheet row for this product') : signedMoney(value, 0);
  }
  marginText(m: ProductMonthRow) {
    const value = m.profit?.marginPct ?? null;
    return value === null ? '-' : `${value}%`;
  }
  perUnitText(m: ProductMonthRow) {
    const value = m.profit?.profitPerUnit ?? null;
    return value === null ? '-' : signedMoney(value, 2);
  }
  barHeight(value: number) {
    const max = this.chartMax();
    return max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  }
  afterAdsText(r: ProductMonthBrandRow) {
    return r.adDataMissing || r.profitAfterAds === null ? 'n/a' : signedMoney(r.profitAfterAds, 0);
  }
  marginAfterText(r: ProductMonthBrandRow) {
    return r.adDataMissing || r.marginPct === null ? 'n/a' : `${r.marginPct}%`;
  }

  private async loadNames(brand: string) {
    const id = ++this.namesRequest;
    this.detailRequest += 1; // a product still loading for the previous brand must not land here
    this.names.set([]);
    this.query.set('');
    this.picked.set([]);
    this.menuOpen.set(false);
    this.monthsTouched = false;
    this.detail.set(null);
    this.selected.set([]);
    this.error.set('');
    this.loading.set(false);
    if (!brand) return;
    try {
      const result = await this.api.productMonthNames(brand);
      if (id !== this.namesRequest) return;
      this.names.set(result.products);
      if (result.products.length) await this.setPicked([result.products[0]]); // the best seller, as before
    } catch (error) {
      if (id === this.namesRequest) this.error.set(error instanceof Error ? error.message : 'The request failed.');
    }
  }

  /** Sets the ticked products and loads them: one product as before, several added together by the server. */
  async setPicked(names: string[]) {
    const brand = this.brand();
    if (!brand) return;
    // Keep the list's own order (best seller first), so the same ticks always give the same request.
    const wanted = new Set(names);
    const picked = this.names().filter((n) => wanted.has(n));
    const id = ++this.detailRequest;
    this.picked.set(picked);
    this.error.set('');
    if (!picked.length) {
      this.detail.set(null);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      const result = picked.length === 1
        ? await this.api.productMonthDetail(brand, picked[0])
        : await this.api.productMonthSet(brand, picked);
      if (id !== this.detailRequest) return;
      this.detail.set(result);
      // Months: keep the ones the user chose by hand when they still exist; otherwise show the latest 12.
      const keys = result.months.map((m) => m.monthKey);
      const kept = this.monthsTouched ? this.selected().filter((k) => keys.includes(k)) : [];
      if (!kept.length) this.monthsTouched = false;
      this.selected.set(kept.length ? kept : keys.slice(-12));
      if (!keys.includes(this.cityMonth())) this.cityMonth.set('');
    } catch (error) {
      if (id === this.detailRequest) {
        this.detail.set(null);
        this.error.set(error instanceof Error ? error.message : 'The request failed.');
      }
    } finally {
      if (id === this.detailRequest) this.loading.set(false);
    }
  }
}
