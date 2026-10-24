import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { money, number } from '../core/formatters';
import { MonthMetrics, SalesMonth, SalesMonthColumn, SalesMonthComparison } from '../core/models';
import { UiStateService } from '../core/ui-state.service';

type Metric = 'revenue' | 'orderCount' | 'units' | 'avgOrderValue';
type SortKey = 'name' | 'change' | string; // string = a month key

interface CompareRow {
  key: string;
  name: string;
  sub: string;
  values: Record<string, number>;
  change: number | null; // % from the first to the last selected month
  isNew: boolean;        // nothing in the first month, something in the last
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const METRICS: { key: Metric; label: string }[] = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'orderCount', label: 'Orders' },
  { key: 'units', label: 'Units sold' },
  { key: 'avgOrderValue', label: 'Avg order value' },
];

/** Month-on-month sales for the brand picked in the sidebar (or all brands combined). */
@Component({
  selector: 'app-monthly-page',
  template: `
    <header class="topbar">
      <div class="topbar-left"><div><h1>Trends</h1><span class="muted">{{ brand() || 'All brands combined' }}</span></div></div>
      @if (isAdmin()) {
        <div class="topbar-right"><label class="upload-btn">Upload monthly sales report<input type="file" accept=".xlsx,.xls" hidden (change)="upload($event)"></label></div>
      }
    </header>
    <div class="upload-status" [class.success]="statusType() === 'success'" [class.error]="statusType() === 'error'">
      {{ status() }}@if (undoSlot()) { <button type="button" class="link-btn" (click)="undoDelete()">Undo</button> }
    </div>

    @if (!loading() && !months().length) {
      <section class="overview-empty">
        <h2>No monthly sales yet{{ brand() ? ' for ' + brand() : '' }}</h2>
        <p class="muted">Upload one sales report per month, for example August, September and October. Each order is filed under the month of its order date, so a report that spans two months is split automatically.</p>
        @if (!isAdmin()) { <p class="muted">Ask an admin to upload the monthly reports.</p> }
      </section>
    } @else if (months().length) {
      <section class="controls month-controls">
        <div class="month-chips" role="group" aria-label="Months to compare">
          @for (m of months(); track m.monthKey) {
            <button type="button" class="month-chip" [class.active]="isSelected(m.monthKey)" [attr.aria-pressed]="isSelected(m.monthKey)" (click)="toggleMonth(m.monthKey)">{{ shortMonth(m.monthKey) }}</button>
          }
        </div>
        <div class="sheet-tabs" role="tablist" aria-label="Measure">
          @for (option of metricOptions; track option.key) {
            <button type="button" role="tab" class="sheet-tab" [class.active]="metric() === option.key" [attr.aria-selected]="metric() === option.key" (click)="metric.set(option.key)">{{ option.label }}</button>
          }
        </div>
      </section>
      @if (columns().length === 1) { <p class="muted brand-note">Select another month to compare it with {{ columns()[0].label }}.</p> }

      <section class="cards month-cards">
        @for (m of columns(); track m.monthKey; let i = $index) {
          <div class="card month-card">
            <div class="card-label">{{ m.label }}</div>
            <div class="card-value">{{ format(m[metric()]) }}</div>
            @if (i > 0) {
              <span class="delta" [class.up]="(monthChange(i) ?? 0) > 0" [class.down]="(monthChange(i) ?? 0) < 0">{{ changeText(monthChange(i), false) }} vs {{ shortMonth(columns()[i - 1].monthKey) }}</span>
            } @else {
              <span class="delta">Starting month</span>
            }
            <dl class="month-card-stats">
              <div><dt>Revenue</dt><dd>{{ money(m.revenue, 0) }}</dd></div>
              <div><dt>Orders</dt><dd>{{ number(m.orderCount) }}</dd></div>
              <div><dt>Units</dt><dd>{{ number(m.units) }}</dd></div>
              <div><dt>Avg order</dt><dd>{{ money(m.avgOrderValue, 0) }}</dd></div>
            </dl>
            <p class="muted month-card-range">{{ rangeText(m) }}</p>
          </div>
        }
      </section>

      @if (columns().length) {
        <section class="overview-section" aria-labelledby="mcChart">
          <div class="overview-head"><div><h2 id="mcChart">{{ metricLabel() }} by month</h2></div></div>
          <div class="month-bars" role="img" [attr.aria-label]="chartLabel()">
            @for (m of columns(); track m.monthKey) {
              <div class="month-bar" [class.partial]="m.partial">
                <span class="month-bar-value">{{ format(m[metric()]) }}</span>
                <span class="month-bar-track"><span class="month-bar-fill" [style.height.%]="barHeight(m[metric()])"></span></span>
                <span class="month-bar-label">{{ shortMonth(m.monthKey) }}{{ m.partial ? '*' : '' }}</span>
              </div>
            }
          </div>
          @if (hasPartial()) { <p class="muted overview-footnote">* Partial month: the uploaded orders don't cover every day of that month, so compare it with care.</p> }
        </section>

        <section class="table-wrap compare-table">
          <h3>Cities</h3>
          <p class="muted">{{ metricLabel() }} in each city. {{ changeCaption() }}</p>
          <table>
            <thead><tr>
              <th (click)="sortCities('name')">City {{ indicator(citySort(), 'name') }}</th>
              @for (m of columns(); track m.monthKey) { <th (click)="sortCities(m.monthKey)">{{ shortMonth(m.monthKey) }} {{ indicator(citySort(), m.monthKey) }}</th> }
              @if (columns().length > 1) { <th (click)="sortCities('change')">Change {{ indicator(citySort(), 'change') }}</th> }
            </tr></thead>
            <tbody>
              @for (row of cityRows(); track row.key) {
                <tr>
                  <td>{{ row.name }}</td>
                  @for (m of columns(); track m.monthKey) { <td>{{ format(row.values[m.monthKey]) }}</td> }
                  @if (columns().length > 1) { <td><span class="delta" [class.up]="row.isNew || (row.change ?? 0) > 0" [class.down]="(row.change ?? 0) < 0">{{ row.isNew ? 'New' : changeText(row.change, true) }}</span></td> }
                </tr>
              }
            </tbody>
          </table>
        </section>

        <section class="table-wrap compare-table">
          <h3>Products</h3>
          <p class="muted">{{ metricLabel() }} for each product. {{ changeCaption() }}</p>
          <table>
            <thead><tr>
              <th (click)="sortProducts('name')">Product {{ indicator(productSort(), 'name') }}</th>
              @for (m of columns(); track m.monthKey) { <th (click)="sortProducts(m.monthKey)">{{ shortMonth(m.monthKey) }} {{ indicator(productSort(), m.monthKey) }}</th> }
              @if (columns().length > 1) { <th (click)="sortProducts('change')">Change {{ indicator(productSort(), 'change') }}</th> }
            </tr></thead>
            <tbody>
              @for (row of productRows(); track row.key) {
                <tr>
                  <td>{{ row.name }}@if (row.sub) { <span class="muted"> ({{ row.sub }})</span> }</td>
                  @for (m of columns(); track m.monthKey) { <td>{{ format(row.values[m.monthKey]) }}</td> }
                  @if (columns().length > 1) { <td><span class="delta" [class.up]="row.isNew || (row.change ?? 0) > 0" [class.down]="(row.change ?? 0) < 0">{{ row.isNew ? 'New' : changeText(row.change, true) }}</span></td> }
                </tr>
              }
            </tbody>
          </table>
        </section>
      }

      @if (isAdmin()) {
        <details class="manage-months">
          <summary>Manage uploaded months</summary>
          @if (brand()) {
            <ul>
              @for (m of months(); track m.monthKey) {
                <li><span>{{ m.label }}<span class="muted"> {{ rangeText(m) }}, {{ number(m.orderCount) }} orders</span></span><button type="button" class="secondary-btn danger-btn" (click)="deleteMonth(m)">Delete</button></li>
              }
            </ul>
          } @else {
            <p class="muted">Pick a brand in the sidebar to delete one of its months.</p>
          }
        </details>
      }
    }
  `,
})
export class MonthlyPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly ui = inject(UiStateService);
  readonly brand = computed(() => this.ui.focusedBrand());
  readonly months = signal<SalesMonth[]>([]);
  readonly selected = signal<string[]>([]);
  readonly comparison = signal<SalesMonthComparison | null>(null);
  readonly metric = signal<Metric>('revenue');
  readonly loading = signal(false);
  readonly status = signal('');
  readonly statusType = signal<'success' | 'error' | ''>('');
  readonly undoSlot = signal<unknown>(null);
  readonly citySort = signal<{ key: SortKey; asc: boolean }>({ key: 'last', asc: false });
  readonly productSort = signal<{ key: SortKey; asc: boolean }>({ key: 'last', asc: false });
  readonly metricOptions = METRICS;
  readonly money = money;
  readonly number = number;
  private requestId = 0;

  readonly columns = computed<SalesMonthColumn[]>(() => this.comparison()?.months ?? []);
  readonly metricLabel = computed(() => METRICS.find((m) => m.key === this.metric())?.label ?? 'Revenue');
  readonly hasPartial = computed(() => this.columns().some((m) => m.partial));
  readonly chartMax = computed(() => Math.max(0, ...this.columns().map((m) => m[this.metric()])));
  readonly chartLabel = computed(() =>
    this.columns().map((m) => `${m.label}: ${this.format(m[this.metric()])}`).join('; '));
  readonly changeCaption = computed(() => {
    const cols = this.columns();
    return cols.length > 1 ? `Change compares ${cols[0].label} with ${cols[cols.length - 1].label}.` : '';
  });
  readonly cityRows = computed(() => this.sortRows(
    (this.comparison()?.cities ?? []).map((c) => this.toRow(c.city, c.city, '', c.byMonth)), this.citySort()));
  readonly productRows = computed(() => {
    const showBrand = !this.brand();
    return this.sortRows(
      (this.comparison()?.products ?? []).map((p) =>
        this.toRow(`${p.productName}::${p.brandName}`, p.productName, showBrand ? p.brandName : '', p.byMonth)),
      this.productSort());
  });

  constructor() {
    effect(() => {
      const brand = this.ui.focusedBrand();
      untracked(() => void this.loadMonths(brand, false));
    });
  }

  isAdmin() { return this.auth.user()?.role === 'admin'; }
  isSelected(monthKey: string) { return this.selected().includes(monthKey); }

  toggleMonth(monthKey: string) {
    const current = this.selected();
    const next = current.includes(monthKey) ? current.filter((k) => k !== monthKey) : [...current, monthKey].sort();
    if (!next.length) return; // keep at least one month selected
    this.selected.set(next);
    void this.refreshComparison();
  }

  monthChange(index: number) {
    const cols = this.columns();
    return this.percentChange(cols[index - 1][this.metric()], cols[index][this.metric()]);
  }

  barHeight(value: number) {
    const max = this.chartMax();
    return max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  }

  format(value: number | undefined) {
    const v = value ?? 0;
    const metric = this.metric();
    return metric === 'revenue' || metric === 'avgOrderValue' ? money(v, 0) : number(v);
  }

  changeText(change: number | null, blankIfNone: boolean) {
    if (change === null) return blankIfNone ? '-' : 'No change data';
    if (change === 0) return '0%';
    return `${change > 0 ? '+' : ''}${change}%`;
  }

  shortMonth(monthKey: string) {
    const [year, month] = monthKey.split('-').map(Number);
    return `${SHORT_MONTHS[month - 1]} ${String(year).slice(-2)}`;
  }

  rangeText(m: { from: string; to: string; partial: boolean }) {
    const day = (date: string) => Number(date.split('-')[2]);
    const [year, month] = m.from.split('-').map(Number);
    const range = `${day(m.from)}-${day(m.to)} ${SHORT_MONTHS[month - 1]} ${year}`;
    return m.partial ? `Partial month, orders from ${range}` : `Full month, ${range}`;
  }

  indicator(sort: { key: SortKey; asc: boolean }, key: SortKey) {
    const active = sort.key === key || (sort.key === 'last' && key === this.lastMonthKey());
    return active ? (sort.asc ? '↑' : '↓') : '';
  }

  sortCities(key: SortKey) { this.citySort.set(this.nextSort(this.citySort(), key)); }
  sortProducts(key: SortKey) { this.productSort.set(this.nextSort(this.productSort(), key)); }

  async upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.undoSlot.set(null);
    this.setStatus('Uploading…', '');
    try {
      const result = await this.api.uploadSalesMonth(file);
      if (result.duplicate) {
        this.setStatus('This file was already uploaded today, so nothing changed.', '');
        return;
      }
      const saved = (result.months ?? []).map((m) => `${m.label} for ${m.brandName} (${number(m.orderCount)} orders)`).join(', ');
      const skipped = result.skippedRows ? ` ${result.skippedRows} rows had no readable order date and were left out.` : '';
      this.setStatus(`Saved ${saved}.${skipped}`, 'success');
      this.ui.refreshLookups();
      await this.loadMonths(this.brand(), false);
    } catch (error) {
      this.setStatus(this.message(error), 'error');
    } finally {
      input.value = '';
    }
  }

  async deleteMonth(month: SalesMonth) {
    const brand = this.brand();
    if (!brand || !window.confirm(`Delete ${month.label} for ${brand}? You can undo this right after.`)) return;
    try {
      const result = await this.api.deleteSalesMonth(brand, month.monthKey);
      this.undoSlot.set(result.removed);
      this.setStatus(`Deleted ${month.label} for ${brand}.`, 'success');
      this.ui.refreshLookups();
      await this.loadMonths(brand, true);
    } catch (error) {
      this.setStatus(this.message(error), 'error');
    }
  }

  async undoDelete() {
    const slot = this.undoSlot();
    if (!slot) return;
    try {
      await this.api.restoreSalesMonth(slot);
      this.undoSlot.set(null);
      this.setStatus('Restored.', 'success');
      this.ui.refreshLookups();
      await this.loadMonths(this.brand(), true);
    } catch (error) {
      this.setStatus(this.message(error), 'error');
    }
  }

  private async loadMonths(brand: string, keepSelection: boolean) {
    const id = ++this.requestId;
    this.loading.set(true);
    try {
      const { months } = await this.api.salesMonths(brand || undefined);
      if (id !== this.requestId) return;
      this.months.set(months);
      const available = months.map((m) => m.monthKey);
      const kept = keepSelection ? this.selected().filter((k) => available.includes(k)) : [];
      this.selected.set(kept.length ? kept : available.slice(-3));
      await this.loadComparison(id, brand);
    } catch (error) {
      if (id === this.requestId) this.setStatus(this.message(error), 'error');
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  private async refreshComparison() {
    const id = ++this.requestId;
    try {
      await this.loadComparison(id, this.brand());
    } catch (error) {
      if (id === this.requestId) this.setStatus(this.message(error), 'error');
    }
  }

  private async loadComparison(id: number, brand: string) {
    const months = this.selected();
    if (!months.length) {
      this.comparison.set(null);
      return;
    }
    const result = await this.api.salesMonthCompare(months, brand || undefined);
    if (id === this.requestId) this.comparison.set(result);
  }

  private toRow(key: string, name: string, sub: string, byMonth: Record<string, MonthMetrics>): CompareRow {
    const metric = this.metric();
    const cols = this.columns();
    const values: Record<string, number> = {};
    cols.forEach((m) => { values[m.monthKey] = byMonth[m.monthKey]?.[metric] ?? 0; });
    const first = cols.length ? values[cols[0].monthKey] : 0;
    const last = cols.length ? values[cols[cols.length - 1].monthKey] : 0;
    return { key, name, sub, values, change: this.percentChange(first, last), isNew: cols.length > 1 && first === 0 && last > 0 };
  }

  private percentChange(from: number, to: number): number | null {
    if (from === 0) return null;
    return Math.round(((to - from) / from) * 1000) / 10;
  }

  private lastMonthKey() {
    const cols = this.columns();
    return cols.length ? cols[cols.length - 1].monthKey : '';
  }

  private nextSort(current: { key: SortKey; asc: boolean }, key: SortKey) {
    const currentKey = current.key === 'last' ? this.lastMonthKey() : current.key;
    if (currentKey === key) return { key, asc: !current.asc };
    return { key, asc: key === 'name' };
  }

  private sortRows(rows: CompareRow[], sort: { key: SortKey; asc: boolean }) {
    const key = sort.key === 'last' ? this.lastMonthKey() : sort.key;
    const direction = sort.asc ? 1 : -1;
    const valueOf = (row: CompareRow) => {
      if (key === 'change') return row.isNew ? Number.POSITIVE_INFINITY : (row.change ?? Number.NEGATIVE_INFINITY);
      return row.values[key] ?? 0;
    };
    return [...rows].sort((a, b) => {
      if (key === 'name') return direction * a.name.localeCompare(b.name);
      const diff = valueOf(a) - valueOf(b);
      // Infinity - Infinity is NaN: treat equal sort values as a tie and fall back to the name.
      return (Number.isNaN(diff) || diff === 0) ? a.name.localeCompare(b.name) : direction * diff;
    });
  }

  private setStatus(value: string, type: 'success' | 'error' | '') { this.status.set(value); this.statusType.set(type); }
  private message(error: unknown) { return error instanceof Error ? error.message : 'The request failed.'; }
}
