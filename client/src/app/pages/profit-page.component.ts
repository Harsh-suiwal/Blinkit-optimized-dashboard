import { Component, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { money, number } from '../core/formatters';
import { ProfitGroup, ProfitProductField, ProfitSettings, ProfitView, ProfitViewInputProduct } from '../core/models';
import { UiStateService } from '../core/ui-state.service';

/**
 * Net profit or loss for the brand picked in the sidebar, for any mix of months, products and cities. Admin only.
 * Sales come from the monthly sales uploads, ad spend from the Advertising uploads; COGS, GST %, commission %,
 * the per-unit fees and the monthly other expenses are typed here. The maths is in parser/profitView.js.
 */
@Component({
  selector: 'app-profit-page',
  template: `
    <header class="topbar">
      <div class="topbar-left"><div><h1>Profit</h1><span class="muted">{{ brand() || 'Pick a brand' }}</span></div></div>
      @if (isAdmin() && brand()) {
        <div class="topbar-right">
          <label class="feeder-option" title="Untick to leave the Advertising spend out of the costs"><input type="checkbox" [checked]="includeAds()" (change)="toggleAds()"><span>Include ad spend</span></label>
          <label class="upload-btn">Upload cost sheet<input type="file" accept=".xlsx,.xls" hidden (change)="uploadCosts($event)"></label>
        </div>
      }
    </header>
    <div class="upload-status" [class.success]="statusType() === 'success'" [class.error]="statusType() === 'error'">{{ status() }}</div>

    @if (!isAdmin()) {
      <section class="overview-empty"><h2>Admins only</h2><p class="muted">Profit and cost figures are visible to admins.</p></section>
    } @else if (!brand()) {
      <section class="overview-empty"><h2>Choose a brand</h2><p class="muted">Profit is shown for one brand at a time. Pick a brand in the sidebar.</p></section>
    } @else {
    @if (data(); as d) {
      @if (!d.available.months.length) {
        <section class="overview-empty">
          <h2>No monthly sales for {{ brand() }}</h2>
          <p class="muted">Upload the monthly sales reports on the Trends tab first. Profit is worked out from them.</p>
        </section>
      } @else {
        <section class="controls">
          <div class="sheet-tabs" role="tablist" aria-label="Group the table by">
            <button type="button" role="tab" class="sheet-tab" [class.active]="group() === 'month'" [attr.aria-selected]="group() === 'month'" (click)="setGroup('month')">By month</button>
            <button type="button" role="tab" class="sheet-tab" [class.active]="group() === 'product'" [attr.aria-selected]="group() === 'product'" (click)="setGroup('product')">By product</button>
            <button type="button" role="tab" class="sheet-tab" [class.active]="group() === 'city'" [attr.aria-selected]="group() === 'city'" (click)="setGroup('city')">By city</button>
          </div>
        </section>
        <section class="controls">
          <label class="filter-label">Months</label>
          <div class="month-chips" role="group" aria-label="Months to include">
            @for (m of d.available.months; track m.monthKey) {
              <button type="button" class="month-chip" [class.active]="isMonthOn(m.monthKey)" [attr.aria-pressed]="isMonthOn(m.monthKey)" (click)="toggleMonth(m.monthKey)">{{ m.label }}{{ m.partial ? '*' : '' }}</button>
            }
          </div>
        </section>
        <section class="controls">
          <div class="feeder-picker">
            <button type="button" class="secondary-btn feeder-picker-btn" [attr.aria-expanded]="menu() === 'products'" (click)="openMenu('products')">Products: {{ shownProductCount() }} of {{ productNames().length }} <span aria-hidden="true">▾</span></button>
            @if (menu() === 'products') {
              <div class="feeder-menu" role="group" aria-label="Products to include">
                <div class="feeder-menu-actions">
                  <button type="button" (click)="selectAllProducts()">Select all</button>
                  <button type="button" (click)="clearProducts()">Clear all</button>
                </div>
                @for (name of productNames(); track name) {
                  <label class="feeder-option"><input type="checkbox" [checked]="isProductOn(name)" (change)="toggleProduct(name)"><span>{{ name }}</span></label>
                }
              </div>
            }
          </div>
          <div class="feeder-picker">
            <button type="button" class="secondary-btn feeder-picker-btn" [attr.aria-expanded]="menu() === 'cities'" (click)="openMenu('cities')">Cities: {{ shownCityCount() }} of {{ cityNames().length }} <span aria-hidden="true">▾</span></button>
            @if (menu() === 'cities') {
              <div class="feeder-menu" role="group" aria-label="Cities to include">
                <div class="feeder-menu-actions">
                  <button type="button" (click)="selectAllCities()">Select all</button>
                  <button type="button" (click)="clearCities()">Clear all</button>
                </div>
                @for (name of cityNames(); track name) {
                  <label class="feeder-option"><input type="checkbox" [checked]="isCityOn(name)" (change)="toggleCity(name)"><span>{{ name }}</span></label>
                }
              </div>
            }
          </div>
          @if (productFilter() !== null || cityFilter() !== null) { <button type="button" class="secondary-btn" (click)="resetSlice()">Show everything</button> }
        </section>

        <section class="cards">
          <div class="card"><div class="card-label">Net profit / loss</div><div class="card-value" [class.trend-up]="d.totals.profit > 0" [class.trend-down]="d.totals.profit < 0">{{ signed(d.totals.profit) }}</div></div>
          <div class="card"><div class="card-label">Profit margin</div><div class="card-value">{{ percent(d.totals.marginPct) }}</div></div>
          <div class="card"><div class="card-label">Net sales</div><div class="card-value">{{ money(d.totals.net, 0) }}</div></div>
          <div class="card"><div class="card-label">Gross sales</div><div class="card-value">{{ money(d.totals.gross, 0) }}</div></div>
          <div class="card"><div class="card-label">Total costs</div><div class="card-value">{{ money(totalCosts(), 0) }}</div></div>
        </section>
        <p class="muted brand-note">{{ scopeText() }} Margin = profit ÷ net sales that have a COGS. Net sales = sales without GST.</p>

        @if (d.rows.length) {
          <section class="table-wrap compare-table">
            <h3>{{ groupTitle() }}</h3>
            <table id="profitViewTable">
              <thead><tr>
                <th>{{ groupColumn() }}</th><th>Units</th><th>Gross sales</th><th>GST</th><th>Net sales</th>
                @if (d.totals.leftOut > 0) { <th>No COGS yet</th> }
                <th>COGS</th><th>Blinkit fees</th><th>Storage</th><th>{{ adsHeader() }}</th><th>{{ otherHeader() }}</th><th>Net profit / loss</th><th>Margin</th>
                @if (group() === 'month') { <th>Sales change</th> }
              </tr></thead>
              <tbody>
                @for (r of d.rows; track r.key) {
                  <tr [class.row-low]="r.profit < 0">
                    <td>{{ r.label }}{{ r.partial ? '*' : '' }}{{ r.adMissing && includeAds() ? '†' : '' }}</td>
                    <td>{{ number(r.units) }}</td>
                    <td>{{ money(r.gross, 0) }}</td>
                    <td>{{ money(r.gst, 0) }}</td>
                    <td>{{ money(r.net, 0) }}</td>
                    @if (d.totals.leftOut > 0) { <td>{{ r.leftOut ? '-' + money(r.leftOut, 0) : '-' }}</td> }
                    <td>{{ money(r.cogs, 0) }}</td>
                    <td>{{ money(r.fees, 0) }}</td>
                    <td>{{ money(r.storage, 0) }}</td>
                    <td>{{ money(r.ads, 0) }}</td>
                    <td>{{ money(r.other, 0) }}</td>
                    <td><span [class.trend-up]="r.profit > 0" [class.trend-down]="r.profit < 0">{{ signed(r.profit) }}</span></td>
                    <td>{{ percent(r.marginPct) }}</td>
                    @if (group() === 'month') { <td>{{ change(r.changeGrossPct) }}</td> }
                  </tr>
                }
                <tr>
                  <td><strong>Total</strong></td>
                  <td><strong>{{ number(d.totals.units) }}</strong></td>
                  <td><strong>{{ money(d.totals.gross, 0) }}</strong></td>
                  <td><strong>{{ money(d.totals.gst, 0) }}</strong></td>
                  <td><strong>{{ money(d.totals.net, 0) }}</strong></td>
                  @if (d.totals.leftOut > 0) { <td><strong>-{{ money(d.totals.leftOut, 0) }}</strong></td> }
                  <td><strong>{{ money(d.totals.cogs, 0) }}</strong></td>
                  <td><strong>{{ money(d.totals.fees, 0) }}</strong></td>
                  <td><strong>{{ money(d.totals.storage, 0) }}</strong></td>
                  <td><strong>{{ money(d.totals.ads, 0) }}</strong></td>
                  <td><strong>{{ money(d.totals.other, 0) }}</strong></td>
                  <td><strong [class.trend-up]="d.totals.profit > 0" [class.trend-down]="d.totals.profit < 0">{{ signed(d.totals.profit) }}</strong></td>
                  <td><strong>{{ percent(d.totals.marginPct) }}</strong></td>
                  @if (group() === 'month') { <td></td> }
                </tr>
              </tbody>
            </table>
            <p class="muted overview-footnote">Net profit = net sales{{ d.totals.leftOut > 0 ? ' − no-COGS sales' : '' }} − COGS − Blinkit fees (commission, inward, fulfilment) − storage − ad spend − other expenses. Every number is rounded to the rupee and the rows add up to the total.</p>
            <p class="muted overview-footnote">Ad spend and other expenses belong to the whole brand. Each month's amount is shared across products and cities by their sales (only products with a COGS take a share), so the rows add up to the brand's full profit.</p>
            @if (d.notes.partialMonths.length) { <p class="muted overview-footnote">* Partial month ({{ d.notes.partialMonths.join(', ') }}): the uploaded orders don't cover every day of it.</p> }
            @if (d.notes.adMissingMonths.length && includeAds()) { <p class="muted overview-footnote">† No advertising upload for {{ d.notes.adMissingMonths.join(', ') }}, so ad spend counts as ₹0 there.</p> }
            @if (d.notes.cityGapMonths.length) { <p class="muted overview-footnote">City split is not stored for {{ d.notes.cityGapMonths.join(', ') }}, so that month is left out while a city is picked. Re-upload that month's sales report to get it.</p> }
            @for (u of d.notes.unallocated; track u.monthKey) { <p class="muted overview-footnote">{{ u.label }}: ads {{ money(u.ads, 0) }} and other expenses {{ money(u.other, 0) }} are not in the profit, because no product sold that month has a COGS yet.</p> }
          </section>
        } @else {
          <section class="overview-empty"><h2>Nothing matches these filters</h2><p class="muted">Pick at least one product and one city (or press "Show everything").</p></section>
        }

        @if (d.notes.leftOutProducts.length) {
          <section class="table-wrap compare-table">
            <h3>Sold, but no COGS yet</h3>
            <p class="muted">These sales are shown above but left out of profit, and they take no share of ads or other expenses. Type their COGS under "Your numbers" below.</p>
            <table>
              <thead><tr><th>Product</th><th>Units</th><th>Gross sales</th></tr></thead>
              <tbody>
                @for (u of d.notes.leftOutProducts; track u.productName) { <tr><td>{{ u.productName }}</td><td>{{ number(u.units) }}</td><td>{{ money(u.gross, 0) }}</td></tr> }
              </tbody>
            </table>
          </section>
        }

        <section class="table-wrap compare-table">
          <h3>Does it add up?</h3>
          <ul class="muted">
            @for (c of d.checks; track c.id) {
              <li><span [class.trend-up]="c.ok" [class.trend-down]="!c.ok">{{ c.ok ? '✓' : '✗' }}</span> {{ c.label }}: {{ money(c.actual, 0) }}{{ c.ok ? '' : ' (expected ' + money(c.expected, 0) + ')' }}</li>
            }
            @if (d.includeAds) {
              <li>Ad spend in this selection: {{ money(d.brandCosts.adSpend, 0) }}{{ d.brandCosts.wholeBrand && d.brandCosts.adSpendExact !== null ? ' (Advertising tab: ' + money(d.brandCosts.adSpendExact, 2) + ', rounded to the rupee)' : ' (brand total for these months)' }}</li>
            } @else {
              <li>Ad spend is switched off at the top, so it is not in the costs.</li>
            }
            <li>Other expenses for these months: {{ money(d.brandCosts.otherCosts, 0) }}{{ d.brandCosts.wholeBrand ? '' : ' (brand total; this slice carries its share)' }}</li>
          </ul>
        </section>

        <section class="table-wrap compare-table">
          <h3>Your numbers</h3>
          <p class="muted">These are typed by you (the brand supplies them). Change a box and press Enter or click away: it saves and the table above updates.</p>
          <button type="button" class="secondary-btn" [attr.aria-expanded]="showInputs()" (click)="showInputs.set(!showInputs())">{{ showInputs() ? 'Hide' : 'Show' }} your numbers</button>
          @if (showInputs()) {
            <h4>Defaults (used for every product unless typed below)</h4>
            <table>
              <thead><tr>
                @for (f of settingFields; track f.key) { <th>{{ f.label }}</th> }
              </tr></thead>
              <tbody><tr>
                @for (f of settingFields; track f.key) {
                  <td><input type="number" min="0" step="any" class="styled-select" [value]="d.inputs.settings[f.key]" [attr.aria-label]="f.label" (change)="saveSetting(f.key, $event)"></td>
                }
              </tr></tbody>
            </table>
            <p class="muted overview-footnote">Storage: Blinkit charges ₹1 per unit per day, so ₹30 assumes a unit sits 30 days. It is a rough number: change it when you know better.</p>

            <h4>Per product</h4>
            <table>
              <thead><tr><th>Product</th><th>Units sold</th><th>Gross sales</th><th>COGS ₹ / unit</th><th>GST %</th><th>Commission %</th></tr></thead>
              <tbody>
                @for (p of d.inputs.products; track p.productName) {
                  <tr [class.row-low]="!p.hasCogs">
                    <td>{{ p.productName }}@if (!p.hasCogs) { <span class="muted"> (needs COGS)</span> }</td>
                    <td>{{ number(p.units) }}</td>
                    <td>{{ money(p.gross, 0) }}</td>
                    <td><input type="number" min="0" step="any" class="styled-select" placeholder="required" [value]="p.cogs ?? ''" [attr.aria-label]="'COGS per unit for ' + p.productName" (change)="saveProductField(p, 'cogs', $event)"></td>
                    <td><input type="number" min="0" max="100" step="any" class="styled-select" [value]="p.taxPct" [attr.title]="p.taxIsDefault ? 'Default GST %' : 'Typed GST %'" [attr.aria-label]="'GST % for ' + p.productName" (change)="saveProductField(p, 'taxPct', $event)"></td>
                    <td><input type="number" min="0" max="100" step="any" class="styled-select" [value]="p.commissionPct" [attr.title]="p.commissionIsDefault ? 'Default commission %' : 'Typed commission %'" [attr.aria-label]="'Commission % for ' + p.productName" (change)="saveProductField(p, 'commissionPct', $event)"></td>
                  </tr>
                }
              </tbody>
            </table>

            <h4>Other expenses per month (rent, salary, transport and so on)</h4>
            <table>
              <thead><tr><th>Month</th><th>Other expenses ₹</th></tr></thead>
              <tbody>
                @for (m of d.inputs.otherCosts; track m.monthKey) {
                  <tr>
                    <td>{{ m.label }}{{ m.partial ? '*' : '' }}</td>
                    <td><input type="number" min="0" step="any" class="styled-select" [value]="m.amount" [attr.aria-label]="'Other expenses for ' + m.label" (change)="saveOtherCost(m, $event)"></td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>
      }
    } @else if (loading()) {
      <section class="overview-empty"><p class="muted">Loading profit…</p></section>
    }
    }
  `,
})
export class ProfitPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly ui = inject(UiStateService);
  readonly brand = computed(() => this.ui.focusedBrand());
  readonly data = signal<ProfitView | null>(null);
  readonly loading = signal(false);
  readonly status = signal('');
  readonly statusType = signal<'success' | 'error' | ''>('');
  readonly money = money;
  readonly number = number;

  /** What the table is grouped by. */
  readonly group = signal<ProfitGroup>('month');
  /** Months included; empty until the first answer (the server then picks the latest full month). */
  readonly months = signal<string[]>([]);
  /** Names included; null = all of them, [] = none. */
  readonly productFilter = signal<string[] | null>(null);
  readonly cityFilter = signal<string[] | null>(null);
  readonly includeAds = signal(true);
  readonly menu = signal<'' | 'products' | 'cities'>('');
  readonly showInputs = signal(false);
  private requestId = 0;

  readonly settingFields: { key: keyof ProfitSettings; label: string }[] = [
    { key: 'defaultTaxPct', label: 'GST % (default)' },
    { key: 'defaultCommissionPct', label: 'Commission % (default)' },
    { key: 'inwardFee', label: 'Inward ₹ / unit' },
    { key: 'fulfilmentFee', label: 'Fulfilment ₹ / unit' },
    { key: 'storageFee', label: 'Storage ₹ / unit' },
  ];

  readonly productNames = computed(() => (this.data()?.available.products ?? []).map((p) => p.productName));
  readonly cityNames = computed(() => (this.data()?.available.cities ?? []).map((c) => c.city));
  readonly shownProductCount = computed(() => this.productFilter()?.length ?? this.productNames().length);
  readonly shownCityCount = computed(() => this.cityFilter()?.length ?? this.cityNames().length);
  readonly totalCosts = computed(() => {
    const t = this.data()?.totals;
    return t ? t.cogs + t.fees + t.storage + t.ads + t.other : 0;
  });

  constructor() {
    effect(() => {
      this.ui.focusedBrand(); // runs again whenever the brand changes
      untracked(() => {
        // A new brand starts with no filters.
        this.months.set([]);
        this.productFilter.set(null);
        this.cityFilter.set(null);
        this.menu.set('');
        void this.load();
      });
    });
  }

  isAdmin() { return this.auth.isAdmin(); }
  signed(value: number) { return value < 0 ? `-${money(-value, 0)}` : money(value, 0); }
  percent(value: number | null) {
    return value === null ? 'n/a' : `${value.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
  }
  change(value: number | null | undefined) {
    if (value === null || value === undefined) return '-';
    return `${value > 0 ? '+' : ''}${value.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
  }

  groupTitle() { return { month: 'Month by month', product: 'Product by product', city: 'City by city' }[this.group()]; }
  groupColumn() { return { month: 'Month', product: 'Product', city: 'City' }[this.group()]; }
  /** Month rows of the whole brand carry the full amounts; every other row carries a share. */
  private carriesShare() { return this.group() !== 'month' || !(this.data()?.brandCosts.wholeBrand ?? true); }
  adsHeader() { return this.carriesShare() ? 'Ad spend (share)' : 'Ad spend'; }
  otherHeader() { return this.carriesShare() ? 'Other expenses (share)' : 'Other expenses'; }

  scopeText() {
    const d = this.data();
    if (!d) return '';
    const months = d.filters.months.length;
    const slice = d.brandCosts.wholeBrand ? 'the whole brand' : 'the products and cities you picked';
    return `Showing ${slice} across ${months} ${months === 1 ? 'month' : 'months'}.`;
  }

  private setStatus(text: string, type: 'success' | 'error' | '' = '') {
    this.status.set(text);
    this.statusType.set(type);
  }

  private async load(quiet = false) {
    const brand = this.brand();
    const id = ++this.requestId;
    if (!brand || !this.isAdmin()) { this.data.set(null); return; }
    if (!quiet) this.loading.set(true);
    try {
      const result = await this.api.profitView(brand, {
        groupBy: this.group(),
        months: this.months(),
        products: this.productFilter(),
        cities: this.cityFilter(),
        includeAds: this.includeAds(),
      });
      if (id === this.requestId) {
        this.data.set(result);
        this.months.set(result.filters.months); // the server's pick when none was chosen
      }
    } catch (error) {
      if (id === this.requestId) {
        this.data.set(null);
        this.setStatus((error as Error).message, 'error');
      }
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  setGroup(group: ProfitGroup) { this.group.set(group); void this.load(true); }
  toggleAds() { this.includeAds.set(!this.includeAds()); void this.load(true); }

  isMonthOn(key: string) { return this.months().includes(key); }
  toggleMonth(key: string) {
    const current = this.months();
    if (current.includes(key)) {
      if (current.length === 1) return; // at least one month stays on
      this.months.set(current.filter((m) => m !== key));
    } else {
      this.months.set([...current, key].sort());
    }
    void this.load(true);
  }

  openMenu(which: 'products' | 'cities') { this.menu.set(this.menu() === which ? '' : which); }
  @HostListener('document:click', ['$event'])
  closeMenu(event: Event) {
    const target = event.target as HTMLElement | null;
    if (this.menu() && !target?.closest('.feeder-picker')) this.menu.set('');
  }
  @HostListener('document:keydown.escape')
  closeMenuOnEscape() { this.menu.set(''); }

  isProductOn(name: string) { const f = this.productFilter(); return f === null || f.includes(name); }
  toggleProduct(name: string) { this.productFilter.set(this.toggled(this.productFilter(), this.productNames(), name)); void this.load(true); }
  selectAllProducts() { this.productFilter.set(null); void this.load(true); }
  clearProducts() { this.productFilter.set([]); void this.load(true); }

  isCityOn(name: string) { const f = this.cityFilter(); return f === null || f.includes(name); }
  toggleCity(name: string) { this.cityFilter.set(this.toggled(this.cityFilter(), this.cityNames(), name)); void this.load(true); }
  selectAllCities() { this.cityFilter.set(null); void this.load(true); }
  clearCities() { this.cityFilter.set([]); void this.load(true); }

  resetSlice() { this.productFilter.set(null); this.cityFilter.set(null); void this.load(true); }

  /** The new filter after ticking or unticking one name; everything ticked counts as "no filter". */
  private toggled(filter: string[] | null, all: string[], name: string): string[] | null {
    const current = filter ?? all;
    const next = current.includes(name) ? current.filter((n) => n !== name) : [...current, name];
    return next.length === all.length ? null : next;
  }

  async uploadCosts(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const brand = this.brand();
    if (!file || !brand) return;
    this.setStatus('Uploading cost sheet…');
    try {
      const result = await this.api.uploadBrandCosts(brand, file);
      const skipped = result.skippedRows ? `, ${result.skippedRows} rows skipped` : '';
      this.setStatus(`Saved costs for ${result.productCount} products${skipped}.`, 'success');
      await this.load(true);
    } catch (error) {
      this.setStatus((error as Error).message, 'error');
    } finally {
      input.value = '';
    }
  }

  /** Reads a number box: empty -> null (clears), a bad value -> undefined. */
  private readNumber(input: HTMLInputElement): number | null | undefined {
    const text = input.value.trim();
    if (text === '') return null;
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  async saveProductField(product: ProfitViewInputProduct, field: ProfitProductField, event: Event) {
    const input = event.target as HTMLInputElement;
    const brand = this.brand();
    const value = this.readNumber(input);
    if (!brand) return;
    if (value === undefined) {
      this.setStatus('Type a number of 0 or more.', 'error');
      await this.load(true); // puts the saved value back in the box
      return;
    }
    try {
      await this.api.setProfitProductCost(brand, product.productName, field, value);
      this.setStatus(`Saved ${product.productName}.`, 'success');
      await this.load(true);
    } catch (error) {
      this.setStatus((error as Error).message, 'error');
      await this.load(true);
    }
  }

  async saveSetting(key: keyof ProfitSettings, event: Event) {
    const input = event.target as HTMLInputElement;
    const brand = this.brand();
    const value = this.readNumber(input);
    if (!brand) return;
    if (value === null || value === undefined) {
      this.setStatus('Type a number of 0 or more.', 'error');
      await this.load(true);
      return;
    }
    try {
      const patch: Partial<ProfitSettings> = {};
      patch[key] = value;
      await this.api.setProfitSettings(brand, patch);
      this.setStatus('Saved.', 'success');
      await this.load(true);
    } catch (error) {
      this.setStatus((error as Error).message, 'error');
      await this.load(true);
    }
  }

  async saveOtherCost(month: { monthKey: string; label: string }, event: Event) {
    const input = event.target as HTMLInputElement;
    const brand = this.brand();
    const amount = this.readNumber(input);
    if (!brand) return;
    if (amount === undefined) {
      this.setStatus('Other expenses must be a number of 0 or more.', 'error');
      await this.load(true);
      return;
    }
    try {
      await this.api.setOtherCost(brand, month.monthKey, amount ?? 0);
      this.setStatus(`Saved other expenses for ${month.label}.`, 'success');
      await this.load(true);
    } catch (error) {
      this.setStatus((error as Error).message, 'error');
      await this.load(true);
    }
  }
}
