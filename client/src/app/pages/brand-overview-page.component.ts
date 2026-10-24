import { Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { money, number } from '../core/formatters';
import { BrandOverview, SalesMonth } from '../core/models';
import { UiStateService } from '../core/ui-state.service';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * One brand's dashboard for client meetings: sales, monthly trend, stock and advertising,
 * for the brand picked in the sidebar. Shows no other brand's data.
 */
@Component({
  selector: 'app-brand-overview-page',
  imports: [RouterLink],
  template: `
    <header class="topbar">
      <div class="topbar-left"><div><h1>{{ brand() || 'Brand overview' }}</h1><span class="muted">{{ brand() ? 'Brand overview' : 'Choose a brand to begin' }}</span></div></div>
      @if (brand()) {
        <div class="topbar-right"><a class="secondary-btn" routerLink="/monthly-comparison">Compare months</a></div>
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
      <section class="overview-section" aria-labelledby="ovSales">
        <div class="overview-head">
          <div><h2 id="ovSales">Sales</h2>@if (d.sales; as s) { <p class="muted">{{ sourceText(s.fileName, s.date) }}</p> }</div>
          <a class="overview-link" routerLink="/sales-performance">Open sales</a>
        </div>
        @if (d.sales; as s) {
          <div class="cards overview-cards">
            <div class="card"><div class="card-label">Revenue</div><div class="card-value">{{ money(s.totalRevenue, 0) }}</div></div>
            <div class="card"><div class="card-label">Orders</div><div class="card-value">{{ number(s.totalOrders) }}</div></div>
            <div class="card"><div class="card-label">Units sold</div><div class="card-value">{{ number(s.totalUnits) }}</div></div>
            <div class="card"><div class="card-label">Avg order value</div><div class="card-value">{{ money(s.avgOrderValue, 0) }}</div></div>
          </div>
          <div class="overview-split">
            <div class="overview-list">
              <h3>Top cities</h3>
              <ol class="rank-list">
                @for (c of s.topCities; track c.city) {
                  <li>
                    <span class="rank-name">{{ c.city }}</span><span class="rank-value">{{ money(c.revenue, 0) }}</span>
                    <span class="rank-bar" aria-hidden="true"><span [style.width.%]="barWidth(c.revenue, s.topCities[0].revenue)"></span></span>
                    <span class="rank-share">{{ c.sharePct }}% of revenue</span>
                  </li>
                }
              </ol>
              <p class="muted">Sold in {{ s.cityCount }} {{ s.cityCount === 1 ? 'city' : 'cities' }}</p>
            </div>
            <div class="overview-list">
              <h3>Top products</h3>
              <ol class="rank-list">
                @for (p of s.topProducts; track p.productName) {
                  <li>
                    <span class="rank-name">{{ p.productName }}</span><span class="rank-value">{{ money(p.revenue, 0) }}</span>
                    <span class="rank-bar" aria-hidden="true"><span [style.width.%]="barWidth(p.revenue, s.topProducts[0].revenue)"></span></span>
                    <span class="rank-share">{{ p.sharePct }}% of revenue, {{ number(p.units) }} units</span>
                  </li>
                }
              </ol>
              <p class="muted">{{ s.productCount }} {{ s.productCount === 1 ? 'product' : 'products' }} sold</p>
            </div>
          </div>
        } @else {
          <p class="overview-none">No sales report has been uploaded for {{ d.brand }} yet.</p>
        }
      </section>

      <section class="overview-section" aria-labelledby="ovMonths">
        <div class="overview-head">
          <div><h2 id="ovMonths">Monthly revenue</h2>@if (trendMonths().length) { <p class="muted">Last {{ trendMonths().length }} {{ trendMonths().length === 1 ? 'month' : 'months' }} on record</p> }</div>
          <a class="overview-link" routerLink="/monthly-comparison">Compare months</a>
        </div>
        @if (trendMonths().length) {
          <div class="month-bars" role="img" [attr.aria-label]="trendLabel()">
            @for (m of trendMonths(); track m.monthKey) {
              <div class="month-bar" [class.partial]="m.partial">
                <span class="month-bar-value">{{ money(m.revenue, 0) }}</span>
                <span class="month-bar-track"><span class="month-bar-fill" [style.height.%]="barWidth(m.revenue, trendMax())"></span></span>
                <span class="month-bar-label">{{ shortMonth(m.monthKey) }}{{ m.partial ? '*' : '' }}</span>
              </div>
            }
          </div>
          @if (hasPartial()) { <p class="muted overview-footnote">* Partial month: the uploaded orders don't cover every day of that month.</p> }
        } @else {
          <p class="overview-none">No monthly sales yet. Upload one sales report per month on the Monthly comparison page to see the trend.</p>
        }
      </section>

      <section class="overview-section" aria-labelledby="ovStock">
        <div class="overview-head">
          <div><h2 id="ovStock">Stock</h2>@if (d.inventory; as inv) { <p class="muted">{{ sourceText(inv.fileName, inv.date) }}</p> }</div>
          <a class="overview-link" routerLink="/inventory">Open inventory</a>
        </div>
        @if (d.inventory; as inv) {
          <div class="cards overview-cards">
            <div class="card"><div class="card-label">Products</div><div class="card-value">{{ number(inv.productCount) }}</div></div>
            <div class="card"><div class="card-label">Units in stock</div><div class="card-value">{{ number(inv.totalStock) }}</div></div>
            <div class="card"><div class="card-label">Sold in last 30 days</div><div class="card-value">{{ number(inv.unitsSold30) }}</div></div>
            <div class="card"><div class="card-label">Out of stock</div><div class="card-value">{{ number(inv.outOfStock) }}</div><span class="muted">{{ inv.lowStock }} running low, of {{ inv.listingCount }} warehouse listings</span></div>
          </div>
          <div class="table-wrap overview-table">
            <table>
              <thead><tr><th>Best sellers</th><th>Sold in last 30 days</th><th>Units in stock</th></tr></thead>
              <tbody>
                @for (p of inv.topSellers; track p.productName) { <tr><td>{{ p.productName }}</td><td>{{ number(p.unitsSold30) }}</td><td>{{ number(p.stock) }}</td></tr> }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="overview-none">No inventory report has been uploaded for {{ d.brand }} yet.</p>
        }
      </section>

      <section class="overview-section" aria-labelledby="ovAds">
        <div class="overview-head">
          <div><h2 id="ovAds">Advertising</h2>@if (d.campaign; as c) { <p class="muted">{{ c.periodLabel }}, all campaigns</p> }</div>
          <a class="overview-link" routerLink="/campaign-analysis">Open campaigns</a>
        </div>
        @if (d.campaign; as c) {
          <div class="cards overview-cards">
            <div class="card"><div class="card-label">Ad spend</div><div class="card-value">{{ money(c.adSpend, 0) }}</div></div>
            <div class="card"><div class="card-label">Sales from ads</div><div class="card-value">{{ money(c.sales, 0) }}</div></div>
            <div class="card"><div class="card-label">Return on ad spend</div><div class="card-value">{{ c.roas === null ? 'n/a' : c.roas + 'x' }}</div></div>
            <div class="card"><div class="card-label">Campaigns</div><div class="card-value">{{ number(c.campaignCount) }}</div></div>
          </div>
          @if (c.bestCampaign; as best) { <p class="overview-note">Best campaign: <strong>{{ best.name }}</strong>, returning {{ best.roas }}x its spend.</p> }
        } @else {
          <p class="overview-none">No campaign report has been uploaded for {{ d.brand }} yet.</p>
        }
      </section>
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
  readonly trendMonths = computed<SalesMonth[]>(() => (this.data()?.months ?? []).slice(-6));
  readonly trendMax = computed(() => Math.max(0, ...this.trendMonths().map((m) => m.revenue)));
  readonly hasPartial = computed(() => this.trendMonths().some((m) => m.partial));
  readonly trendLabel = computed(() =>
    this.trendMonths().map((m) => `${m.label}: ${money(m.revenue, 0)}`).join('; '));
  readonly money = money;
  readonly number = number;
  private requestId = 0;

  constructor() {
    effect(() => {
      const brand = this.ui.focusedBrand();
      untracked(() => void this.load(brand));
    });
  }

  async ngOnInit() {
    try {
      this.brands.set((await this.api.brandNames()).brands);
    } catch {
      // An empty list is expected before the first upload.
    }
  }

  private async load(brand: string) {
    const id = ++this.requestId;
    this.error.set('');
    if (!brand) {
      this.data.set(null);
      this.loading.set(false);
      return;
    }
    // Never show the previous brand's figures under the new brand's name.
    if (this.data()?.brand !== brand) this.data.set(null);
    this.loading.set(true);
    try {
      const result = await this.api.brandOverview(brand);
      if (id === this.requestId) this.data.set(result);
    } catch (error) {
      if (id === this.requestId) this.error.set(error instanceof Error ? error.message : 'The request failed.');
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  barWidth(value: number, max: number) {
    return max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  }

  shortMonth(monthKey: string) {
    const [year, month] = monthKey.split('-').map(Number);
    return `${SHORT_MONTHS[month - 1]} ${String(year).slice(-2)}`;
  }

  sourceText(fileName: string | null, date: string | null) {
    const when = date ? this.formatDate(date) : '';
    if (fileName && when) return `From ${fileName}, uploaded ${when}`;
    if (when) return `Uploaded ${when}`;
    return fileName ? `From ${fileName}` : '';
  }

  private formatDate(date: string) {
    const [year, month, day] = date.split('-').map(Number);
    return year && month && day ? `${day} ${SHORT_MONTHS[month - 1]} ${year}` : date;
  }
}
