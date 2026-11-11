import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { money, number } from '../core/formatters';
import { BrandProfit, ProfitMonth } from '../core/models';
import { UiStateService } from '../core/ui-state.service';

/** Monthly profit / loss and ROI for the brand picked in the sidebar. Admin only. */
@Component({
  selector: 'app-profit-page',
  template: `
    <header class="topbar">
      <div class="topbar-left"><div><h1>Profit</h1><span class="muted">{{ brand() || 'Pick a brand' }}</span></div></div>
      @if (isAdmin() && brand()) {
        <div class="topbar-right"><label class="upload-btn">Upload cost sheet<input type="file" accept=".xlsx,.xls" hidden (change)="uploadCosts($event)"></label></div>
      }
    </header>
    <div class="upload-status" [class.success]="statusType() === 'success'" [class.error]="statusType() === 'error'">{{ status() }}</div>

    @if (!isAdmin()) {
      <section class="overview-empty"><h2>Admins only</h2><p class="muted">Profit and cost figures are visible to admins.</p></section>
    } @else if (!brand()) {
      <section class="overview-empty"><h2>Choose a brand</h2><p class="muted">Profit is shown for one brand at a time. Pick a brand in the sidebar.</p></section>
    } @else {
    @if (data(); as d) {
      @if (!d.hasCosts) {
        <section class="overview-empty">
          <h2>No costs yet for {{ brand() }}</h2>
          <p class="muted">Upload a cost sheet with one row per product: Product Name, MRP, Selling Price, Tax %, Product COGS, Blinkit Inward Fee, Blinkit Storage Fee, Blinkit Fulfilment Fee and Blinkit Commission Fee. Fees are rupees per unit sold. Net sales, profit and ROI appear once costs are in.</p>
        </section>
      }

      @if (d.totals; as t) {
        <section class="cards">
          <div class="card"><div class="card-label">Profit / Loss</div><div class="card-value" [class.trend-up]="t.profit > 0" [class.trend-down]="t.profit < 0">{{ signed(t.profit) }}</div></div>
          <div class="card"><div class="card-label">Overall ROI</div><div class="card-value" [class.trend-up]="(t.roiPct ?? 0) > 0" [class.trend-down]="(t.roiPct ?? 0) < 0">{{ percent(t.roiPct) }}</div></div>
          <div class="card"><div class="card-label">Profit margin</div><div class="card-value">{{ percent(t.marginPct) }}</div></div>
          <div class="card"><div class="card-label">Net sales</div><div class="card-value">{{ money(t.netSales, 0) }}</div></div>
          <div class="card"><div class="card-label">Total costs</div><div class="card-value">{{ money(t.totalCosts, 0) }}</div></div>
        </section>
        <p class="muted brand-note">Across {{ t.months }} {{ t.months === 1 ? 'month' : 'months' }}. ROI = profit ÷ total costs. Margin = profit ÷ net sales (sales without tax).</p>
      }

      @if (d.months.length) {
        <section class="table-wrap">
          <h3>Month by month</h3>
          <table id="profitTable">
            <thead><tr>
              <th>Month</th><th>Gross sales</th><th>Net sales</th><th>Product cost</th><th>Blinkit fees</th><th>Ad spend</th><th>Other costs</th><th>Profit / Loss</th><th>Margin</th><th>ROI</th>
            </tr></thead>
            <tbody>
              @for (m of d.months; track m.monthKey) {
                <tr [class.row-low]="(m.profit ?? 0) < 0">
                  <td>{{ m.label }}{{ m.partial ? '*' : '' }}@if (m.status === 'incomplete') { <span class="muted"> (some products have no cost)</span> } @else if (m.status === 'no-costs') { <span class="muted"> (no costs for these products)</span> }</td>
                  <td>{{ money(m.grossSales, 0) }}</td>
                  <td>{{ cell(m.netSales) }}</td>
                  <td>{{ cell(m.productCost) }}</td>
                  <td>{{ cell(m.fees) }}</td>
                  <td>{{ money(m.adSpend, 0) }}{{ m.adDataMissing ? '†' : '' }}</td>
                  <td>
                    @if (isAdmin()) { <input type="number" min="0" step="1" class="styled-select" [value]="m.otherCosts" [attr.aria-label]="'Other costs for ' + m.label" (change)="saveOtherCost(m, $event)"> }
                    @else { {{ money(m.otherCosts, 0) }} }
                  </td>
                  <td><span [class.trend-up]="(m.profit ?? 0) > 0" [class.trend-down]="(m.profit ?? 0) < 0">{{ m.profit === null ? 'n/a' : signed(m.profit) }}</span></td>
                  <td>{{ percent(m.marginPct) }}</td>
                  <td>{{ percent(m.roiPct) }}</td>
                </tr>
              }
              @if (d.totals; as t) {
                <tr>
                  <td><strong>Total</strong></td>
                  <td><strong>{{ money(t.grossSales, 0) }}</strong></td>
                  <td><strong>{{ money(t.netSales, 0) }}</strong></td>
                  <td><strong>{{ money(t.productCost, 0) }}</strong></td>
                  <td><strong>{{ money(t.fees, 0) }}</strong></td>
                  <td><strong>{{ money(t.adSpend, 0) }}</strong></td>
                  <td><strong>{{ money(t.otherCosts, 0) }}</strong></td>
                  <td><strong [class.trend-up]="t.profit > 0" [class.trend-down]="t.profit < 0">{{ signed(t.profit) }}</strong></td>
                  <td><strong>{{ percent(t.marginPct) }}</strong></td>
                  <td><strong>{{ percent(t.roiPct) }}</strong></td>
                </tr>
              }
            </tbody>
          </table>
          <p class="muted overview-footnote">Net sales = sales without tax. Blinkit fees = commission, inward, fulfilment and storage. Ad spend comes from the Advertising uploads. Other costs are typed in by you for each month.</p>
          @if (hasPartial()) { <p class="muted overview-footnote">* Partial month: the uploaded orders don't cover every day of that month.</p> }
          @if (hasMissingAds()) { <p class="muted overview-footnote">† No advertising upload for this month, so ad spend counts as ₹0.</p> }
        </section>
      } @else {
        <section class="overview-empty">
          <h2>No monthly sales for {{ brand() }}</h2>
          <p class="muted">Upload the monthly sales reports on the Trends tab first. Profit is worked out month by month from them.</p>
        </section>
      }

      @if (d.products.length) {
        <section class="table-wrap">
          <h3>Products</h3>
          <p class="muted">Profit before ad spend. "At list price" is what one unit earns at the selling price in the cost sheet.</p>
          <table id="profitProductTable">
            <thead><tr><th>Product</th><th>Units sold</th><th>Net sales</th><th>Product cost</th><th>Blinkit fees</th><th>Profit before ads</th><th>Per unit sold</th><th>At list price</th></tr></thead>
            <tbody>
              @for (p of d.products; track p.productName) {
                <tr [class.row-low]="p.listUnitProfit < 0 || (p.units > 0 && p.profitBeforeAds < 0)">
                  <td>{{ p.productName }}</td>
                  <td>{{ number(p.units) }}</td>
                  <td>{{ p.units ? money(p.netSales, 0) : '-' }}</td>
                  <td>{{ p.units ? money(p.productCost, 0) : '-' }}</td>
                  <td>{{ p.units ? money(p.fees, 0) : '-' }}</td>
                  <td>@if (p.units) { <span [class.trend-up]="p.profitBeforeAds > 0" [class.trend-down]="p.profitBeforeAds < 0">{{ signed(p.profitBeforeAds) }}</span> } @else { - }</td>
                  <td>@if (p.profitPerUnit !== null) { <span [class.trend-up]="p.profitPerUnit > 0" [class.trend-down]="p.profitPerUnit < 0">{{ signed(p.profitPerUnit) }}</span> } @else { - }</td>
                  <td><span [class.trend-up]="p.listUnitProfit > 0" [class.trend-down]="p.listUnitProfit < 0">{{ signed(p.listUnitProfit) }}</span></td>
                </tr>
              }
            </tbody>
          </table>
          @if (d.costsUpload; as u) { <p class="muted overview-footnote">Costs from {{ u.fileName || 'the uploaded sheet' }} ({{ u.productCount }} products){{ u.uploadedAt ? ', uploaded ' + u.uploadedAt : '' }}.</p> }
        </section>
      }

      @if (d.unmatchedProducts.length) {
        <section class="table-wrap">
          <h3>Sold but not in the cost sheet</h3>
          <p class="muted">These products are left out of net sales, costs and profit. Add them to the cost sheet and upload it again. Names must match the sales report.</p>
          <table>
            <thead><tr><th>Product</th><th>Units sold</th><th>Gross sales</th></tr></thead>
            <tbody>
              @for (u of d.unmatchedProducts; track u.productName) {
                <tr><td>{{ u.productName }}</td><td>{{ number(u.units) }}</td><td>{{ money(u.revenue, 0) }}</td></tr>
              }
            </tbody>
          </table>
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
  readonly data = signal<BrandProfit | null>(null);
  readonly loading = signal(false);
  readonly status = signal('');
  readonly statusType = signal<'success' | 'error' | ''>('');
  readonly money = money;
  readonly number = number;
  readonly hasPartial = computed(() => (this.data()?.months ?? []).some((m) => m.partial));
  readonly hasMissingAds = computed(() => (this.data()?.months ?? []).some((m) => m.adDataMissing));
  private requestId = 0;

  constructor() {
    effect(() => {
      const brand = this.ui.focusedBrand();
      untracked(() => void this.load(brand));
    });
  }

  isAdmin() { return this.auth.isAdmin(); }
  cell(value: number | null) { return value === null ? 'n/a' : money(value, 0); }
  signed(value: number) { return value < 0 ? `-${money(-value, 0)}` : money(value, 0); }
  percent(value: number | null) {
    return value === null ? 'n/a' : `${value.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
  }

  private setStatus(text: string, type: 'success' | 'error' | '' = '') {
    this.status.set(text);
    this.statusType.set(type);
  }

  private async load(brand: string, quiet = false) {
    const id = ++this.requestId;
    if (!brand || !this.isAdmin()) { this.data.set(null); return; }
    if (!quiet) this.loading.set(true);
    try {
      const result = await this.api.brandProfit(brand);
      if (id === this.requestId) this.data.set(result);
    } catch (error) {
      if (id === this.requestId) {
        this.data.set(null);
        this.setStatus((error as Error).message, 'error');
      }
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
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
      await this.load(brand, true);
    } catch (error) {
      this.setStatus((error as Error).message, 'error');
    } finally {
      input.value = '';
    }
  }

  async saveOtherCost(month: ProfitMonth, event: Event) {
    const input = event.target as HTMLInputElement;
    const brand = this.brand();
    const amount = Number(input.value || 0);
    if (!brand) return;
    if (!Number.isFinite(amount) || amount < 0) {
      input.value = String(month.otherCosts);
      this.setStatus('Other costs must be a number of 0 or more.', 'error');
      return;
    }
    try {
      await this.api.setOtherCost(brand, month.monthKey, amount);
      this.setStatus(`Saved other costs for ${month.label}.`, 'success');
      await this.load(brand, true);
    } catch (error) {
      input.value = String(month.otherCosts);
      this.setStatus((error as Error).message, 'error');
    }
  }
}