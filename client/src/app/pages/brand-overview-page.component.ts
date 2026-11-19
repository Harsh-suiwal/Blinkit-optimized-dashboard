import { Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { money, number } from '../core/formatters';
import { BrandOverview, SalesMonth } from '../core/models';
import { UiStateService } from '../core/ui-state.service';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A card's second line: a change vs last month (up / down) or a plain note. */
interface KpiNote { text: string; tone: '' | 'up' | 'down'; }

/**
 * One brand's dashboard for client meetings: headline numbers, monthly revenue, top cities,
 * top products and best sellers, for the brand picked in the sidebar. Shows no other brand.
 * Every headline card opens its detail page.
 */
@Component({
  selector: 'app-brand-overview-page',
  imports: [RouterLink],
  template: `
    <header class="topbar">
      <div class="topbar-left"><div><h1>{{ brand() || 'Brand overview' }}</h1><span class="muted">{{ brand() ? 'Overview' : 'Choose a brand to begin' }}</span></div></div>
      @if (brand()) {
        <div class="topbar-right overview-context">
          @if (!ui.presenting()) {
            <nav class="platform-tabs" aria-label="Platform" hidden>
              <a routerLink="/platforms/all">All</a>
              <a class="active" aria-current="page">Blinkit</a>
              <a routerLink="/platforms/zepto">Zepto</a>
              <a routerLink="/platforms/flipkart-minutes">Flipkart Minutes</a>
            </nav>
          }
          @if (data()) {
            <label class="context-pill" for="overviewMonth" title="Period"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12z"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M4 11h16"/></svg>
              <select id="overviewMonth" class="context-select" aria-label="Month shown" [value]="selectedMonth()" (change)="selectMonth($event)">
                <option value="" [selected]="selectedMonth() === ''">{{ latestOptionLabel() }}</option>
                @for (m of monthOptions(); track m.monthKey) { <option [value]="m.monthKey" [selected]="m.monthKey === selectedMonth()">{{ m.label }}{{ m.partial ? ' (partial)' : '' }}</option> }
              </select>
            </label>
          }
          @if (!ui.presenting()) {
            <button type="button" class="secondary-btn overview-action" (click)="ui.startPresenting()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4l18 0"/><path d="M4 4v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-10"/><path d="M12 16l0 4"/><path d="M9 20l6 0"/><path d="M8 12l3 -3l2 2l3 -3"/></svg>Present</button>
            <a class="secondary-btn overview-action" routerLink="/reports"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M11.5 21h-4.5a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v5m-5 6h7m-3 -3l3 3l-3 3"/></svg>Create report</a>
          }
        </div>
      }
    </header>
    <div class="upload-status" [class.error]="!!error()">{{ error() }}</div>

    @if (!brand()) {
      <section class="overview-empty">
        <h2>Choose a brand to open its dashboard</h2>
        <p class="muted">Each brand gets its own view of sales, stock and advertising. You can switch brands at any time from the sidebar.</p>
        @if (brands().length) {
          <div class="brand-picker">
            @for (name of brands(); track name) { <button type="button" class="brand-picker-item" (click)="ui.setBrand(name)">{{ name }}</button> }
          </div>
        } @else {
          <p class="muted">No brands yet. Upload a sales, inventory or campaign report first.</p>
        }
      </section>
    } @else if (loading() && !data()) {
      <p class="muted overview-loading">Loading {{ brand() }}…</p>
    } @else {
      @if (data(); as d) {
        <section class="kpi-row" aria-label="Headline numbers" [class.is-loading]="loading()">
          <a class="card overview-card-link" routerLink="/sales-performance" title="Open sales">
            <div class="card-label">Revenue</div>
            <div class="card-value">{{ d.sales ? money(d.sales.totalRevenue, 0) : '-' }}</div>
            <span class="kpi-note" [class.up]="revenueNote().tone === 'up'" [class.down]="revenueNote().tone === 'down'">{{ revenueNote().text }}</span>
          </a>
          <a class="card overview-card-link" routerLink="/sales-performance" title="Open sales">
            <div class="card-label">Units sold</div>
            <div class="card-value">{{ d.sales ? number(d.sales.totalUnits) : '-' }}</div>
            <span class="kpi-note" [class.up]="unitsNote().tone === 'up'" [class.down]="unitsNote().tone === 'down'">{{ unitsNote().text }}</span>
          </a>
          <a class="card overview-card-link" routerLink="/inventory" title="Open stock">
            <div class="card-label">Units in stock <span class="stock-tag">Current stock</span></div>
            <div class="card-value">{{ d.inventory ? number(d.inventory.totalStock) : '-' }}</div>
            @if (d.inventory; as inv) {
              <span class="kpi-note" [class.down]="inv.outOfStock > 0" [class.up]="inv.outOfStock === 0">{{ inv.outOfStock > 0 ? number(inv.outOfStock) + ' out of stock' : 'Nothing out of stock' }}</span>
            } @else {
              <span class="kpi-note">No stock report yet</span>
            }
          </a>
          <a class="card overview-card-link" routerLink="/campaign-analysis" title="Open advertising">
            <div class="card-label">Return on ad spend</div>
            <div class="card-value">{{ d.campaign ? (d.campaign.roas === null ? 'n/a' : d.campaign.roas + 'x') : '-' }}</div>
            @if (d.campaign; as c) {
              <span class="kpi-note">{{ money(c.adSpend, 0) }} spent in {{ c.periodLabel }}</span>
            } @else {
              <span class="kpi-note">{{ loadedMonth() ? 'No ads data for ' + monthLabel(loadedMonth()) : 'No campaign report yet' }}</span>
            }
          </a>
        </section>

        <section class="overview-panels">
          <div class="overview-list" [class.is-loading]="loading()">
            <div class="panel-head"><h3>Revenue by month</h3><a class="overview-link" routerLink="/monthly-comparison">Compare months</a></div>
            @if (trendMonths().length) {
              <div class="month-bars" role="img" [attr.aria-label]="trendLabel()">
                @for (m of trendMonths(); track m.monthKey; let last = $last) {
                  <div class="month-bar" [class.partial]="m.partial">
                    <span class="month-bar-value">{{ compactMoney(m.revenue) }}</span>
                    <span class="month-bar-track"><span class="month-bar-fill" [style.height.%]="barWidth(m.revenue, trendMax())" [style.opacity]="barOpacity(m.monthKey, last)"></span></span>
                    <span class="month-bar-label">{{ shortMonth(m.monthKey) }}{{ m.partial ? '*' : '' }}</span>
                  </div>
                }
              </div>
              @if (hasPartial()) { <p class="muted overview-footnote">* Partial month: the uploaded orders don't cover every day of that month.</p> }
            } @else {
              <p class="muted">Upload one sales report per month on the Monthly Comparison page to see the trend.</p>
            }
          </div>
          <div class="overview-list" [class.is-loading]="loading()">
            <div class="panel-head"><h3>Top cities</h3><a class="overview-link" routerLink="/sales-performance">View all</a></div>
            @if (d.sales; as s) {
              <ol class="rank-list">
                @for (c of s.topCities; track c.city) {
                  <li>
                    <span class="rank-name">{{ c.city }}</span><span class="rank-value">{{ compactMoney(c.revenue) }}</span>
                    <span class="rank-bar" aria-hidden="true"><span [style.width.%]="barWidth(c.revenue, s.topCities[0].revenue)"></span></span>
                  </li>
                }
              </ol>
            } @else {
              <p class="muted">{{ loadedMonth() ? 'No sales for ' + monthLabel(loadedMonth()) : 'No sales report has been uploaded for ' + d.brand + ' yet.' }}</p>
            }
          </div>
        </section>

        <section class="overview-panels">
          <div class="overview-list" [class.is-loading]="loading()">
            <div class="panel-head"><h3>Top products</h3><a class="overview-link" routerLink="/sales-performance">View all</a></div>
            @if (d.sales; as s) {
              <ol class="rank-list">
                @for (p of s.topProducts; track p.productName) {
                  <li>
                    <span class="rank-name">{{ p.productName }}</span><span class="rank-value">{{ compactMoney(p.revenue) }}</span>
                    <span class="rank-bar" aria-hidden="true"><span [style.width.%]="barWidth(p.revenue, s.topProducts[0].revenue)"></span></span>
                    <span class="rank-share">{{ p.sharePct }}% of revenue, {{ number(p.units) }} units</span>
                  </li>
                }
              </ol>
            } @else {
              <p class="muted">{{ loadedMonth() ? 'No sales for ' + monthLabel(loadedMonth()) : 'No sales report has been uploaded for ' + d.brand + ' yet.' }}</p>
            }
          </div>
          <div class="overview-list">
            <div class="panel-head"><h3>Best sellers in stock <span class="stock-tag">Current stock</span></h3><a class="overview-link" routerLink="/inventory">View all</a></div>
            @if (d.inventory; as inv) {
              <ol class="rank-list">
                @for (p of inv.topSellers; track p.productName) {
                  <li>
                    <span class="rank-name">{{ p.productName }}</span><span class="rank-value">{{ number(p.unitsSold30) }} sold</span>
                    <span class="rank-bar" aria-hidden="true"><span [style.width.%]="barWidth(p.unitsSold30, inv.topSellers[0].unitsSold30)"></span></span>
                    <span class="rank-share">{{ number(p.stock) }} in stock, sold in the last 30 days</span>
                  </li>
                }
              </ol>
              <p class="muted">{{ inv.lowStock }} running low{{ inv.date ? ', stock as of ' + dateText(inv.date) : '' }}</p>
            } @else {
              <p class="muted">No stock report has been uploaded for {{ d.brand }} yet.</p>
            }
          </div>
        </section>

        @if (d.campaign; as c) {
          @if (c.bestCampaign; as best) {
            <p class="overview-note-row">Best campaign in {{ c.periodLabel }}: <strong>{{ best.name }}</strong>, returning {{ best.roas }}x its spend.</p>
          }
        }
        <div class="overview-end" aria-hidden="true"></div>
      }
    }
  `,
})
export class BrandOverviewPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly ui = inject(UiStateService);
  readonly brand = computed(() => this.ui.focusedBrand());
  readonly brands = signal<string[]>([]);
  readonly data = signal<BrandOverview | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  /** The last 6 months; when a chosen month is older than that, the 6 months ending at it. */
  readonly trendMonths = computed<SalesMonth[]>(() => {
    const months = this.data()?.months ?? [];
    const month = this.loadedMonth();
    const index = month ? months.findIndex((m) => m.monthKey === month) : -1;
    const end = index >= 0 && index < months.length - 6 ? index + 1 : months.length;
    return months.slice(Math.max(0, end - 6), end);
  });
  readonly trendMax = computed(() => Math.max(0, ...this.trendMonths().map((m) => m.revenue)));
  readonly hasPartial = computed(() => this.trendMonths().some((m) => m.partial));
  readonly trendLabel = computed(() =>
    this.trendMonths().map((m) => `${m.label}: ${money(m.revenue, 0)}`).join('; '));
  /** The month whose figures are on screen ('' = the latest upload). Set only once that month's data has arrived. */
  readonly loadedMonth = signal('');
  /** What the dropdown shows ('' = Latest upload). It differs from loadedMonth only while a month is loading. */
  readonly selectedMonth = signal('');
  /** Period of the latest upload, kept while a month is shown: "1-20 Oct 2026". */
  readonly latestPeriod = signal('');
  readonly latestOptionLabel = computed(() => (this.latestPeriod() ? `Latest upload (${this.latestPeriod()})` : 'Latest upload'));
  /** Months for the dropdown, newest first. */
  readonly monthOptions = computed<SalesMonth[]>(() => [...(this.data()?.months ?? [])].reverse());
  readonly revenueNote = computed(() => this.kpiNote('revenue'));
  readonly unitsNote = computed(() => this.kpiNote('units'));
  readonly money = money;
  readonly number = number;
  private requestId = 0;

  constructor() {
    effect(() => {
      const brand = this.ui.focusedBrand();
      untracked(() => {
        this.selectedMonth.set(''); // a new brand starts on its latest upload
        void this.load(brand, '');
      });
    });
  }

  async ngOnInit() {
    try {
      this.brands.set((await this.api.brandNames()).brands);
    } catch {
      // An empty list is expected before the first upload.
    }
  }

  private async load(brand: string, month: string) {
    const id = ++this.requestId;
    this.error.set('');
    if (!brand) {
      this.data.set(null);
      this.loading.set(false);
      return;
    }
    // Never show the previous brand's figures under the new brand's name.
    if (this.data()?.brand !== brand) {
      this.data.set(null);
      this.loadedMonth.set('');
      this.latestPeriod.set('');
    }
    this.loading.set(true);
    try {
      const result = await this.api.brandOverview(brand, month);
      if (id === this.requestId) {
        this.data.set(result);
        this.loadedMonth.set(month);
        if (!month) this.latestPeriod.set(this.latestPeriodOf(result));
      }
    } catch (error) {
      if (id === this.requestId) {
        this.error.set(error instanceof Error ? error.message : 'The request failed.');
        this.selectedMonth.set(this.loadedMonth()); // the dropdown goes back to what is still on screen
      }
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  /**
   * "+12% vs Sep" when the latest sales upload is the latest full month on record and the month
   * before it exists; otherwise the period the numbers cover. Never compares a partial month.
   */
  private kpiNote(metric: 'revenue' | 'units'): KpiNote {
    const month = this.loadedMonth();
    if (month) return this.monthNote(metric, month);
    const d = this.data();
    if (!d?.sales) return { text: 'No sales report yet', tone: '' };
    const period = d.sales.from && d.sales.to ? this.periodText(d.sales.from, d.sales.to) : '';
    const months = d.months;
    if (months.length >= 2 && d.sales.to) {
      const last = months[months.length - 1];
      const prev = months[months.length - 2];
      const sameMonth = d.sales.to.slice(0, 7) === last.monthKey;
      if (sameMonth && !last.partial && prev[metric] > 0) {
        const change = Math.round(((last[metric] - prev[metric]) / prev[metric]) * 1000) / 10;
        const prevName = SHORT_MONTHS[Number(prev.monthKey.slice(5, 7)) - 1];
        return { text: `${change > 0 ? '+' : ''}${change}% vs ${prevName}`, tone: change > 0 ? 'up' : change < 0 ? 'down' : '' };
      }
    }
    return { text: period ? `Sales from ${period}` : 'Latest sales report', tone: '' };
  }

  selectMonth(event: Event) {
    const month = (event.target as HTMLSelectElement).value;
    this.selectedMonth.set(month);
    void this.load(this.brand(), month);
  }

  /** Period of the latest upload, else the latest month on record. */
  private latestPeriodOf(d: BrandOverview) {
    if (d.sales?.from && d.sales.to) return this.periodText(d.sales.from, d.sales.to);
    return d.months.length ? d.months[d.months.length - 1].label : '';
  }

  monthLabel(monthKey: string) {
    return this.data()?.months.find((m) => m.monthKey === monthKey)?.label ?? monthKey;
  }

  private previousMonthKey(monthKey: string) {
    const [year, month] = monthKey.split('-').map(Number);
    return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  }

  /**
   * A selected month's second line: "+12% vs Sep" against the calendar month before it when that month
   * is on record, "Partial month" when either month is partial (never compared), else the dates covered.
   */
  private monthNote(metric: 'revenue' | 'units', month: string): KpiNote {
    const d = this.data();
    if (!d?.sales) return { text: `No sales for ${this.monthLabel(month)}`, tone: '' };
    const current = d.months.find((m) => m.monthKey === month);
    const previous = d.months.find((m) => m.monthKey === this.previousMonthKey(month));
    if (current?.partial || previous?.partial) return { text: 'Partial month', tone: '' };
    if (current && previous && previous[metric] > 0) {
      const change = Math.round(((current[metric] - previous[metric]) / previous[metric]) * 1000) / 10;
      const prevName = SHORT_MONTHS[Number(previous.monthKey.slice(5, 7)) - 1];
      return { text: `${change > 0 ? '+' : ''}${change}% vs ${prevName}`, tone: change > 0 ? 'up' : change < 0 ? 'down' : '' };
    }
    const period = this.periodText(d.sales.from, d.sales.to);
    return { text: period ? `Sales from ${period}` : this.monthLabel(month), tone: '' };
  }

  /** Latest upload: the newest bar stands out, as before. A chosen month: that month's bar stands out. */
  barOpacity(monthKey: string, last: boolean) {
    const month = this.loadedMonth();
    return (month ? monthKey === month : last) ? 1 : 0.45;
  }

  barWidth(value: number, max: number) {
    return max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  }

  /** ₹3.29L / ₹68.8k / ₹950, the way Indian sales teams read figures. */
  compactMoney(value: number) {
    const abs = Math.abs(value);
    if (abs >= 10000000) return `₹${(value / 10000000).toFixed(2)}Cr`;
    if (abs >= 100000) return `₹${(value / 100000).toFixed(2)}L`;
    if (abs >= 1000) return `₹${(value / 1000).toFixed(1)}k`;
    return money(value, 0);
  }

  shortMonth(monthKey: string) {
    const [year, month] = monthKey.split('-').map(Number);
    return `${SHORT_MONTHS[month - 1]} ${String(year).slice(-2)}`;
  }

  /** "1-20 Oct 2026", "28 Sep - 20 Oct 2026" or "28 Dec 2025 - 3 Jan 2026". */
  periodText(from: string | null, to: string | null) {
    if (!from || !to) return '';
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    if (!fy || !fm || !fd || !ty || !tm || !td) return '';
    if (fy === ty && fm === tm) return fd === td ? `${fd} ${SHORT_MONTHS[fm - 1]} ${fy}` : `${fd}-${td} ${SHORT_MONTHS[fm - 1]} ${fy}`;
    if (fy === ty) return `${fd} ${SHORT_MONTHS[fm - 1]} - ${td} ${SHORT_MONTHS[tm - 1]} ${fy}`;
    return `${this.formatDate(from)} - ${this.formatDate(to)}`;
  }

  dateText(date: string | null) {
    return date ? this.formatDate(date) : '';
  }

  private formatDate(date: string) {
    const [year, month, day] = date.split('-').map(Number);
    return year && month && day ? `${day} ${SHORT_MONTHS[month - 1]} ${year}` : date;
  }
}