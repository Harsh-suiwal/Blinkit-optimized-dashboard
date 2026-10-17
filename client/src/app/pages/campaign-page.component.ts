import { Component, HostListener, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { brandFor, compareValues, money, number } from '../core/formatters';
import {
  CampaignBrandRow, CampaignDailyRow, CampaignPeriod, CampaignRow, CampaignSheetFilter,
  CampaignSheetType, CampaignSummary, CampaignTargetingRow, CampaignUploadPlanItem,
} from '../core/models';
import { UiStateService } from '../core/ui-state.service';
import { BrandFilterComponent } from '../shared/brand-filter.component';

const SHEET_LABELS: Record<CampaignSheetFilter, string> = {
  ALL: 'All',
  PRODUCT_BOOSTING: 'Product Boosting',
  PRODUCT_RECOMMENDATION: 'Product Recommendation',
};

@Component({
  selector: 'app-campaign-page',
  imports: [FormsModule, BrandFilterComponent],
  template: `
    <header class="topbar">
      <div class="topbar-left"><div><h1>Campaign Analysis</h1><span class="muted">{{ lastUpdated() }}</span></div></div>
      <div class="topbar-right"><span class="user-info muted">{{ auth.user()?.email }}</span>
        @if (isAdmin()) { <label class="upload-btn">Upload Campaign Sheet<input type="file" accept=".xls,.xlsx" hidden (change)="upload($event)"></label> }
        <button class="secondary-btn" (click)="exportCampaign()">Export Sheet</button>
      </div>
    </header>
    <div class="upload-status" [class.success]="statusType() === 'success'" [class.error]="statusType() === 'error'">{{ status() }}</div>

    <section class="controls campaign-controls">
      <label class="filter-label" for="periodSelect">Period</label>
      <select id="periodSelect" [ngModel]="selectedPeriod()" (ngModelChange)="changePeriod($event)">@for (period of periods(); track period.periodKey) { <option [value]="period.periodKey">{{ period.periodLabel }}</option> }</select>
      <div class="sheet-tabs" role="tablist">@for (tab of sheetTabs; track tab) { <button type="button" role="tab" class="sheet-tab" [class.active]="sheetType() === tab" (click)="changeSheetType(tab)">{{ sheetLabel(tab) }}</button> }</div>
      <input type="text" [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Search campaign..."><span class="muted undo-hint">Tip: Ctrl+Z undoes the last delete</span>
    </section>

    @if (brandSummaries().length) {
      <section class="brand-bar"><app-brand-filter [brands]="brandSummaries()" [selected]="ui.focusedBrand()" (select)="ui.setBrand($event)" /></section>
    }
    @if (hasUnknownBrand() && isAdmin()) {
      <p class="muted brand-note">Some campaigns couldn't be matched to a brand ("Unknown"). Teach the resolver with <code>POST /api/brand-alias</code> or by editing <code>data/brandAliases.json</code>, then re-upload.</p>
    }
    @if (focusNote()) { <p class="muted brand-note">{{ focusNote() }}</p> }

    <section class="cards campaign-kpis">
      <div class="card"><div class="card-label">Total Ad Spend</div><div class="card-value">{{ money(totals().totalAdSpend) }}</div></div>
      <div class="card"><div class="card-label">Total Sales</div><div class="card-value">{{ money(totals().totalSales) }}</div></div>
      <div class="card"><div class="card-label">Overall ROAS</div><div class="card-value">{{ roas(totals().overallRoas) }}</div></div>
      <div class="card"><div class="card-label">Overall ROI</div><div class="card-value">{{ percent(totals().roiPct) }}</div></div>
      <div class="card"><div class="card-label">Qty Sold</div><div class="card-value">{{ number(totals().totalUnits) }}</div></div>
      <div class="card"><div class="card-label">Impressions</div><div class="card-value">{{ number(totals().totalImpressions) }}</div></div>
      <div class="card"><div class="card-label">Add to Cart</div><div class="card-value">{{ number(totals().totalAtc) }}</div></div>
      <div class="card"><div class="card-label">New Users</div><div class="card-value">{{ number(totals().totalNewUsers) }}</div></div>
    </section>

    <section class="campaign-highlights">
      <div class="highlight-card highlight-best"><div class="highlight-label">Best Campaign</div><div class="highlight-name">{{ totals().bestCampaign?.name || '-' }}</div><div class="highlight-metric">{{ totals().bestCampaign ? 'ROAS ' + roas(totals().bestCampaign?.roas) : '-' }}</div></div>
      <div class="highlight-card highlight-worst"><div class="highlight-label">Needs Attention</div><div class="highlight-name">{{ totals().worstCampaign?.name || '-' }}</div><div class="highlight-metric">{{ totals().worstCampaign ? 'ROAS ' + roas(totals().worstCampaign?.roas) : '-' }}</div></div>
      <div class="funnel-card"><div class="highlight-label">Campaign Funnel</div>
        <div class="funnel-row">
          <div><strong>{{ number(totals().totalImpressions) }}</strong><span>Impressions</span></div>
          <div class="funnel-arrow">→ <small>{{ rate(totals().totalAtc, totals().totalImpressions) }}</small></div>
          <div><strong>{{ number(totals().totalAtc) }}</strong><span>ATC ({{ number(totals().totalDirectAtc) }} direct + {{ number(totals().totalIndirectAtc) }} indirect)</span></div>
          <div class="funnel-arrow">→ <small>{{ rate(totals().totalUnits, totals().totalAtc) }}</small></div>
          <div><strong>{{ number(totals().totalUnits) }}</strong><span>Qty Sold</span></div>
          <div class="funnel-arrow">→</div>
          <div><strong>{{ money(totals().totalSales, 0) }}</strong><span>Sales</span></div>
        </div>
      </div>
    </section>

    @if (brandSummaries().length > 1) {
      <section class="table-wrap">
        <h2 class="section-title">Brand Performance <span class="muted">(click a brand to drill in; tick 2+ to compare)</span></h2>
        <table id="brandTable"><thead><tr><th></th>
          <th (click)="sortBrands('brandName')">Brand {{ brandIndicator('brandName') }}</th>
          @for (col of brandColumns; track col.key) { <th class="num" (click)="sortBrands(col.key)">{{ col.label }} {{ brandIndicator(col.key) }}</th> }
        </tr></thead><tbody>
          @for (brand of sortedBrands(); track brand.brandName) {
            <tr class="clickable" [class.row-selected]="isFocusedBrand(brand.brandName)" (click)="ui.setBrand(brand.brandName)">
              <td (click)="$event.stopPropagation()"><input type="checkbox" [checked]="compareSet().has(brand.brandName)" (change)="toggleCompare(brand.brandName)" aria-label="Compare {{ brand.brandName }}"></td>
              <td>{{ brand.brandName }}</td>
              <td class="num">{{ money(brand.adSpend) }}</td><td class="num">{{ money(brand.sales) }}</td><td class="num">{{ roas(brand.roas) }}</td><td class="num">{{ percent(brand.roiPct) }}</td>
              <td class="num">{{ number(brand.impressions) }}</td><td class="num">{{ number(brand.atc) }}</td><td class="num">{{ number(brand.qtySold) }}</td><td class="num">{{ brand.campaignCount }}</td>
            </tr>
          }
        </tbody></table>
      </section>
    }
    @if (comparedBrands().length > 1) {
      <section class="compare-card">
        <h2 class="section-title">Brand Comparison</h2>
        <table><thead><tr><th>Metric</th>@for (brand of comparedBrands(); track brand.brandName) { <th class="num">{{ brand.brandName }}</th> }</tr></thead><tbody>
          @for (metric of compareMetrics; track metric.label) { <tr><td>{{ metric.label }}</td>@for (brand of comparedBrands(); track brand.brandName) { <td class="num">{{ metric.format(brand) }}</td> }</tr> }
        </tbody></table>
      </section>
    }

    <section class="legend"><span class="legend-item"><span class="dot dot-top"></span> Top performer (top 25% by ROAS)</span><span class="legend-item"><span class="dot dot-low"></span> Needs attention (bottom 25% by ROAS)</span><span class="legend-item muted">Click a campaign for its keyword/category breakdown and daily trend.</span></section>
    <section class="table-wrap">
      <table id="campaignListTable"><thead><tr>
        <th>#</th>
        <th (click)="sortBy('campaignName')">Campaign {{ sortIndicator('campaignName') }}</th>
        <th (click)="sortBy('brandName')">Brand {{ sortIndicator('brandName') }}</th>
        <th (click)="sortBy('sheetType')">Type {{ sortIndicator('sheetType') }}</th>
        <th>Targeting</th>
        @for (col of campaignColumns; track col.key) { <th class="num" (click)="sortBy(col.key)">{{ col.label }} {{ sortIndicator(col.key) }}</th> }
        <th></th>
      </tr></thead><tbody>
        @for (row of displayedRows(); track rowKey(row); let index = $index) {
          <tr class="clickable" [class.row-top]="row.tier === 'top'" [class.row-low]="row.tier === 'low'" (click)="toggleExpand(row)">
            <td>{{ index + 1 }}</td><td [title]="row.campaignName">{{ row.campaignName }}</td><td>{{ row.brandName }}</td><td>{{ sheetLabel(row.sheetType) }}</td><td>{{ row.targetingTypes.join(', ') }}</td>
            <td class="num">{{ money(row.adSpend) }}</td><td class="num">{{ money(row.sales) }}</td><td class="num">{{ roas(row.roas) }}</td><td class="num">{{ roas(row.directRoas) }}</td><td class="num">{{ percent(row.roiPct) }}</td>
            <td class="num">{{ number(row.impressions) }}</td><td class="num">{{ number(row.directAtc) }} / {{ number(row.indirectAtc) }}</td><td class="num">{{ number(row.directQtySold) }} / {{ number(row.indirectQtySold) }}</td><td class="num">{{ number(row.newUsersAcquired) }}</td>
            <td (click)="$event.stopPropagation()">@if (isAdmin()) { <button class="delete-btn" [class.confirming]="pendingDelete() === rowKey(row)" (click)="deleteCampaign(row)">{{ pendingDelete() === rowKey(row) ? 'Confirm?' : '🗑️' }}</button> }</td>
          </tr>
          @if (expandedKey() === rowKey(row)) {
            <tr class="detail-row"><td colspan="15">
              @if (detailLoading()) { <span class="muted">Loading…</span> } @else {
                <div class="detail-grid">
                  <div>
                    <h3 class="section-title">Daily spend vs sales</h3>
                    <svg class="sparkline" viewBox="0 0 300 70" preserveAspectRatio="none" role="img" aria-label="Daily spend and sales">
                      <polyline class="spark-sales" [attr.points]="sparkPoints(detailDaily(), 'sales')" /><polyline class="spark-spend" [attr.points]="sparkPoints(detailDaily(), 'adSpend')" />
                    </svg>
                    <div class="spark-legend"><span class="spark-key spark-key-sales">Sales</span><span class="spark-key spark-key-spend">Ad spend</span><span class="muted">{{ detailDaily().length }} days</span></div>
                  </div>
                  <div>
                    <h3 class="section-title">Targeting breakdown</h3>
                    <table class="detail-table"><thead><tr><th>Type</th><th>Keyword / category</th><th class="num">Spend</th><th class="num">Sales</th><th class="num">ROAS</th><th class="num">Impr.</th><th class="num">ATC</th><th class="num">Qty</th></tr></thead><tbody>
                      @for (t of detailTargeting(); track t.targetingType + '|' + t.targetingValue) { <tr><td>{{ t.targetingType }}</td><td>{{ t.targetingValue || '-' }}</td><td class="num">{{ money(t.adSpend) }}</td><td class="num">{{ money(t.sales) }}</td><td class="num">{{ roas(t.roas) }}</td><td class="num">{{ number(t.impressions) }}</td><td class="num">{{ number(t.atc) }}</td><td class="num">{{ number(t.qtySold) }}</td></tr> }
                    </tbody></table>
                  </div>
                </div>
              }
            </td></tr>
          }
        }
      </tbody></table>
      @if (!displayedRows().length) { <p class="muted">{{ emptyMessage() }}</p> }
    </section>
  `,
})
export class CampaignPageComponent implements OnInit {
  readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly ui = inject(UiStateService);

  readonly sheetTabs: CampaignSheetFilter[] = ['ALL', 'PRODUCT_BOOSTING', 'PRODUCT_RECOMMENDATION'];
  readonly campaignColumns: { key: keyof CampaignRow; label: string }[] = [
    { key: 'adSpend', label: 'Spend' }, { key: 'sales', label: 'Sales' }, { key: 'roas', label: 'ROAS' },
    { key: 'directRoas', label: 'Direct ROAS' }, { key: 'roiPct', label: 'ROI' }, { key: 'impressions', label: 'Impressions' },
    { key: 'atc', label: 'ATC (D / I)' }, { key: 'qtySold', label: 'Qty (D / I)' }, { key: 'newUsersAcquired', label: 'New Users' },
  ];
  readonly brandColumns: { key: keyof CampaignBrandRow; label: string }[] = [
    { key: 'adSpend', label: 'Spend' }, { key: 'sales', label: 'Sales' }, { key: 'roas', label: 'ROAS' }, { key: 'roiPct', label: 'ROI' },
    { key: 'impressions', label: 'Impressions' }, { key: 'atc', label: 'ATC' }, { key: 'qtySold', label: 'Qty Sold' }, { key: 'campaignCount', label: 'Campaigns' },
  ];
  readonly compareMetrics: { label: string; format: (b: CampaignBrandRow) => string }[] = [
    { label: 'Ad spend', format: (b) => money(b.adSpend) }, { label: 'Sales', format: (b) => money(b.sales) },
    { label: 'ROAS', format: (b) => this.roas(b.roas) }, { label: 'Direct ROAS', format: (b) => this.roas(b.directRoas) },
    { label: 'ROI', format: (b) => this.percent(b.roiPct) }, { label: 'Impressions', format: (b) => number(b.impressions) },
    { label: 'ATC (direct / indirect)', format: (b) => `${number(b.directAtc)} / ${number(b.indirectAtc)}` },
    { label: 'Qty sold (direct / indirect)', format: (b) => `${number(b.directQtySold)} / ${number(b.indirectQtySold)}` },
    { label: 'New users', format: (b) => number(b.newUsersAcquired) }, { label: 'Campaigns', format: (b) => String(b.campaignCount) },
  ];

  readonly rows = signal<CampaignRow[]>([]);
  readonly brandSummaries = signal<CampaignBrandRow[]>([]);
  readonly periods = signal<CampaignPeriod[]>([]);
  readonly selectedPeriod = signal('');
  readonly sheetType = signal<CampaignSheetFilter>('ALL');
  readonly query = signal('');
  readonly lastUpdated = signal('No campaign report uploaded yet');
  readonly status = signal('');
  readonly statusType = signal<'success' | 'error' | ''>('');
  readonly pendingDelete = signal<string | null>(null);
  readonly sortKey = signal<keyof CampaignRow>('roas');
  readonly sortAsc = signal(false);
  readonly brandSortKey = signal<keyof CampaignBrandRow>('adSpend');
  readonly brandSortAsc = signal(false);
  readonly compareSet = signal<Set<string>>(new Set());
  readonly expandedKey = signal<string | null>(null);
  readonly detailLoading = signal(false);
  readonly detailTargeting = signal<CampaignTargetingRow[]>([]);
  readonly detailDaily = signal<CampaignDailyRow[]>([]);

  // Product focus matches by campaign name; brand focus is resolved server-side.
  private readonly productMatch = computed(() => {
    const product = this.ui.focusedProduct().trim().toLowerCase();
    if (!product) return { rows: this.rows(), note: '' };
    const matching = this.rows().filter((row) => row.campaignName.toLowerCase().includes(product));
    return matching.length
      ? { rows: matching, note: `Showing campaigns matching "${this.ui.focusedProduct()}".` }
      : { rows: this.rows(), note: `No campaign explicitly mentions "${this.ui.focusedProduct()}" - showing all campaigns instead.` };
  });
  readonly focusNote = computed(() => this.productMatch().note);
  readonly hasUnknownBrand = computed(() => this.brandSummaries().some((brand) => brandFor(brand) === 'Unknown'));
  readonly displayedRows = computed(() => {
    const query = this.query().trim().toLowerCase();
    const values = this.productMatch().rows.filter((row) =>
      !query || row.campaignName.toLowerCase().includes(query) || row.brandName.toLowerCase().includes(query) || row.targetingTypes.some((t) => t.toLowerCase().includes(query)));
    const direction = this.sortAsc() ? 1 : -1;
    return [...values].sort((a, b) => direction * compareValues(a, b, this.sortKey()));
  });
  readonly totals = computed<CampaignSummary>(() => this.summarise(this.productMatch().rows));
  readonly sortedBrands = computed(() => {
    const direction = this.brandSortAsc() ? 1 : -1;
    return [...this.brandSummaries()].sort((a, b) => direction * compareValues(a, b, this.brandSortKey()));
  });
  readonly comparedBrands = computed(() => this.sortedBrands().filter((brand) => this.compareSet().has(brand.brandName)));
  readonly emptyMessage = computed(() => {
    if (!this.periods().length) return 'No campaign data yet. Upload the Blinkit campaign export (.xls or .xlsx) to get started.';
    const brand = this.ui.focusedBrand();
    return brand ? `No campaigns found for brand "${brand}" in this period.` : 'No campaigns match the current filters.';
  });

  readonly money = money;
  readonly number = number;
  private initialized = false;
  private timer?: ReturnType<typeof setTimeout>;
  private undoStack: { periodKey: string; undoToken: string }[] = [];

  constructor() {
    effect(() => {
      this.ui.focusedBrand();
      if (this.initialized) void this.load(this.selectedPeriod() || undefined);
    });
  }

  async ngOnInit() { this.initialized = true; await this.load(); }
  isAdmin() { return this.auth.user()?.role === 'admin'; }
  sheetLabel(type: CampaignSheetFilter) { return SHEET_LABELS[type] ?? type; }
  rowKey(row: CampaignRow) { return `${row.sheetType}|${row.campaignId}`; }
  isFocusedBrand(name: string) { return this.ui.focusedBrand().toLowerCase() === name.toLowerCase(); }
  roas(value: number | null | undefined) { return value === null || value === undefined ? 'n/a' : `${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}x`; }
  percent(value: number | null | undefined) { return value === null || value === undefined ? 'n/a' : `${value.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`; }
  rate(part: number, whole: number) { return whole > 0 ? `${((part / whole) * 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%` : 'n/a'; }
  sortBy(key: keyof CampaignRow) { this.sortAsc.set(this.sortKey() === key ? !this.sortAsc() : true); this.sortKey.set(key); }
  sortIndicator(key: keyof CampaignRow) { return this.sortKey() === key ? (this.sortAsc() ? '↑' : '↓') : ''; }
  sortBrands(key: keyof CampaignBrandRow) { this.brandSortAsc.set(this.brandSortKey() === key ? !this.brandSortAsc() : true); this.brandSortKey.set(key); }
  brandIndicator(key: keyof CampaignBrandRow) { return this.brandSortKey() === key ? (this.brandSortAsc() ? '↑' : '↓') : ''; }

  toggleCompare(name: string) {
    this.compareSet.update((current) => { const next = new Set(current); if (!next.delete(name)) next.add(name); return next; });
  }

  /** SVG polyline points for one metric; spend and sales share one scale so they compare. */
  sparkPoints(daily: CampaignDailyRow[], key: 'sales' | 'adSpend') {
    if (daily.length < 2) return '';
    const max = Math.max(1, ...daily.map((d) => Math.max(d.sales, d.adSpend)));
    return daily.map((d, i) => `${((i / (daily.length - 1)) * 300).toFixed(1)},${(66 - (d[key] / max) * 62).toFixed(1)}`).join(' ');
  }

  async changePeriod(periodKey: string) { this.collapse(); await this.load(periodKey); }
  async changeSheetType(type: CampaignSheetFilter) { this.sheetType.set(type); this.collapse(); await this.load(this.selectedPeriod() || undefined); }

  async toggleExpand(row: CampaignRow) {
    const key = this.rowKey(row);
    if (this.expandedKey() === key) { this.collapse(); return; }
    this.expandedKey.set(key);
    this.detailLoading.set(true);
    try {
      const detail = await this.api.campaignDetail(this.selectedPeriod(), row.sheetType, row.campaignId);
      if (this.expandedKey() !== key) return;
      this.detailTargeting.set(detail.targeting);
      this.detailDaily.set(detail.daily);
    } catch (error) { this.setStatus(this.message(error), 'error'); this.collapse(); }
    finally { if (this.expandedKey() === key) this.detailLoading.set(false); }
  }

  exportCampaign() {
    if (!this.selectedPeriod()) { this.setStatus('Upload a campaign report first.', 'error'); return; }
    const query = new URLSearchParams({ periodKey: this.selectedPeriod() });
    if (this.ui.focusedBrand()) query.set('brand', this.ui.focusedBrand());
    if (this.sheetType() !== 'ALL') query.set('sheetType', this.sheetType());
    window.location.assign(`/api/export-campaign?${query}`);
  }

  async upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.setStatus('Checking file...', '');
    try {
      const preview = await this.api.previewCampaignUpload(file);
      const warning = this.replaceWarning(preview.plan);
      if (warning && !window.confirm(warning)) { this.setStatus('Upload cancelled.', ''); return; }
      this.setStatus('Uploading...', '');
      const result = await this.api.uploadCampaign(file);
      this.setStatus(`Uploaded successfully - ${result.rowCount} daily rows across ${result.periodKeys.length} period(s) and ${result.sheetTypes.length} sheet type(s).`, 'success');
      await this.load(result.latestPeriodKey);
    } catch (error) { this.setStatus(this.message(error), 'error'); }
    finally { input.value = ''; }
  }

  async deleteCampaign(row: CampaignRow) {
    const key = this.rowKey(row);
    if (this.pendingDelete() !== key) {
      this.pendingDelete.set(key);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.pendingDelete.set(null), 3000);
      return;
    }
    clearTimeout(this.timer);
    this.pendingDelete.set(null);
    try {
      const result = await this.api.deleteCampaign(this.selectedPeriod(), row.sheetType, row.campaignId);
      this.undoStack.push({ periodKey: this.selectedPeriod(), undoToken: result.undoToken });
      if (this.undoStack.length > 15) this.undoStack.shift();
      this.collapse();
      await this.load(this.selectedPeriod());
      this.setStatus('Campaign deleted. Press Ctrl+Z to undo.', 'success');
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  @HostListener('document:keydown', ['$event'])
  async undo(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z' || this.isTyping(event.target)) return;
    const record = this.undoStack[this.undoStack.length - 1];
    if (!record || record.periodKey !== this.selectedPeriod()) return;
    event.preventDefault();
    this.undoStack.pop();
    try {
      await this.api.restoreCampaign(record.undoToken);
      await this.load(record.periodKey);
      this.setStatus('Restored.', 'success');
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  private async load(periodKey?: string) {
    try {
      const data = await this.api.campaignData(periodKey, this.ui.focusedBrand(), this.sheetType());
      this.periods.set(data.periods || []);
      this.selectedPeriod.set(data.periodKey || data.latestPeriodKey || '');
      this.rows.set(data.campaigns || []);
      this.brandSummaries.set(data.brandSummaries || []);
      this.lastUpdated.set(data.date ? `Last updated: ${data.date}` : 'No campaign report uploaded yet');
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  /** KPI totals over the rows on screen. Sums are additive; ratios are recomputed, never averaged. */
  private summarise(rows: CampaignRow[]): CampaignSummary {
    const sum = (pick: (row: CampaignRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
    const spend = sum((r) => r.adSpend);
    const sales = sum((r) => r.sales);
    const ranked = rows.filter((row) => row.adSpend > 0 && row.roas !== null);
    const best = ranked.reduce<CampaignRow | null>((acc, row) => !acc || (row.roas ?? 0) > (acc.roas ?? 0) ? row : acc, null);
    const worst = ranked.reduce<CampaignRow | null>((acc, row) => !acc || (row.roas ?? 0) < (acc.roas ?? 0) ? row : acc, null);
    return {
      totalAdSpend: spend,
      totalSales: sales,
      overallRoas: spend > 0 ? Math.round((sales / spend) * 100) / 100 : null,
      directRoas: spend > 0 ? Math.round((sum((r) => r.directSales) / spend) * 100) / 100 : null,
      roiPct: spend > 0 ? Math.round(((sales - spend) / spend) * 1000) / 10 : null,
      totalUnits: sum((r) => r.qtySold),
      totalCampaigns: rows.length,
      bestCampaign: best ? { name: best.campaignName, roas: best.roas ?? 0 } : null,
      worstCampaign: worst && worst !== best ? { name: worst.campaignName, roas: worst.roas ?? 0 } : null,
      totalImpressions: sum((r) => r.impressions),
      totalAtc: sum((r) => r.atc),
      totalDirectAtc: sum((r) => r.directAtc),
      totalIndirectAtc: sum((r) => r.indirectAtc),
      totalNewUsers: sum((r) => r.newUsersAcquired),
    };
  }

  /** Confirmation text when an upload would overwrite stored data; empty when nothing is replaced. */
  private replaceWarning(plan: CampaignUploadPlanItem[]) {
    const replacing = plan.filter((item) => item.existing);
    if (!replacing.length) return '';
    const lines = replacing.map((item) => {
      const shrinks = item.incoming.rowCount < (item.existing?.rowCount ?? 0) ? '  (FEWER rows than stored!)' : '';
      return `- ${item.periodLabel} / ${this.sheetLabel(item.sheetType)}: ${item.existing?.rowCount} rows (${item.existing?.from} to ${item.existing?.to}) -> ${item.incoming.rowCount} rows (${item.incoming.from} to ${item.incoming.to})${shrinks}`;
    });
    return `This upload replaces data already stored:\n\n${lines.join('\n')}\n\nContinue?`;
  }

  private collapse() { this.expandedKey.set(null); this.detailTargeting.set([]); this.detailDaily.set([]); }
  private setStatus(value: string, type: 'success' | 'error' | '') { this.status.set(value); this.statusType.set(type); }
  private message(error: unknown) { return error instanceof Error ? error.message : 'The request failed.'; }
  private isTyping(target: EventTarget | null) { const tag = (target as HTMLElement | null)?.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'; }
}
