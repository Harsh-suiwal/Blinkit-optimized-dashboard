import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from '../core/api.service';
import { money, number } from '../core/formatters';
import { ProductMonthBrandRow, ProductMonthDetail, ProductMonthRow } from '../core/models';
import { UiStateService } from '../core/ui-state.service';
import { brandStripTotal, changeText, compactMoney, computeWins, monthChange, shortMonth, signedMoney, withTiers } from '../core/product-months.logic';

const CITY_MISSING = "City split not available for this month. Re-upload that month's sales report.";

/**
 * Sales > Month by month: one product, month by month, for client presentations.
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
        <input id="pmSearch" class="styled-select" type="search" aria-label="Search products" placeholder="Search a product, e.g. Stainless Spoon" [value]="query()" (input)="onSearch($event)">
        <select id="pmProduct" class="styled-select" aria-label="Product" [value]="selectedName()" (change)="onPick($event)">
          @for (name of optionNames(); track name) { <option [value]="name" [selected]="name === selectedName()">{{ name }}</option> }
        </select>
        <span class="muted">{{ filteredNames().length }} of {{ names().length }} products</span>
      </section>
      @if (error()) { <p class="muted brand-note">{{ error() }}</p> }
      @if (detail(); as d) {
        @if (!d.months.length) {
          <section class="overview-empty">
            <h2>No sales yet for this product</h2>
            <p class="muted">{{ d.product }} has no sales in the uploaded monthly reports.</p>
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
                  <div><dt>Units</dt><dd>{{ number(m.units) }}</dd></div>
                  <div><dt>Orders</dt><dd>{{ number(m.orderCount) }}</dd></div>
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
              <thead><tr><th>Month</th><th>Revenue</th><th>Change</th><th>Units</th><th>Orders</th><th>Avg order value</th><th>Top city</th>@if (profitVisible()) { <th>Profit before ads</th><th>Margin</th><th>Profit per unit</th> }</tr></thead>
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
            @if (profitVisible()) { <p class="muted overview-footnote">Profit before ads: net sales minus product cost and Blinkit fees for this product. Advertising is brand level, so it is not split across products.</p> }
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
                <p class="muted">No city-level sales recorded for this product in {{ cm.label }}.</p>
              } @else {
                <p class="muted">Showing all {{ cityRows().length }} cities. Click a month card above to see another month.</p>
                <table id="productMonthCityTable"><thead><tr><th>Rank</th><th>City</th><th>Revenue</th><th>Share</th><th>Units sold</th><th>Orders</th><th>Avg order value</th></tr></thead><tbody>
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
  readonly selectedName = signal('');
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

  readonly filteredNames = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q ? this.names().filter((n) => n.toLowerCase().includes(q)) : this.names();
  });
  /** The filtered names, plus the picked product even when the search no longer matches it. */
  readonly optionNames = computed(() => {
    const filtered = this.filteredNames();
    const picked = this.selectedName();
    return picked && !filtered.includes(picked) ? [picked, ...filtered] : filtered;
  });
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
    this.selected.set(next);
  }

  onSearch(event: Event) { this.query.set((event.target as HTMLInputElement).value); }
  onPick(event: Event) { void this.choose((event.target as HTMLSelectElement).value); }

  changeLabel(index: number) { return changeText(monthChange(this.columns(), index)); }
  changeUp(index: number) {
    const change = monthChange(this.columns(), index);
    return change.kind === 'change' && (change.pct ?? 0) > 0;
  }

  profitText(m: ProductMonthRow) {
    const value = m.profit?.profitBeforeAds ?? null;
    return value === null ? 'No cost sheet row for this product' : signedMoney(value, 0);
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
    this.selectedName.set('');
    this.detail.set(null);
    this.selected.set([]);
    this.error.set('');
    this.loading.set(false);
    if (!brand) return;
    try {
      const result = await this.api.productMonthNames(brand);
      if (id !== this.namesRequest) return;
      this.names.set(result.products);
      if (result.products.length) await this.choose(result.products[0]);
    } catch (error) {
      if (id === this.namesRequest) this.error.set(error instanceof Error ? error.message : 'The request failed.');
    }
  }

  async choose(name: string) {
    const brand = this.brand();
    if (!brand || !name) return;
    const id = ++this.detailRequest;
    this.selectedName.set(name);
    this.error.set('');
    this.loading.set(true);
    try {
      const result = await this.api.productMonthDetail(brand, name);
      if (id !== this.detailRequest) return;
      this.detail.set(result);
      this.selected.set(result.months.map((m) => m.monthKey).slice(-12));
      this.cityMonth.set('');
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
