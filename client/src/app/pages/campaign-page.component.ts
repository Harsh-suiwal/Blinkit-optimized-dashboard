import { Component, HostListener, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { brandFor, compareValues, money, number } from '../core/formatters';
import {
  CampaignBrandRow, CampaignDailyRow, CampaignPeriod, CampaignRow, CampaignSheetFilter,
  CampaignSheetType, CampaignSummary, CampaignTargetingRow, CampaignUploadPlanItem, CampaignUploadPreview, CampaignUploadResult,
} from '../core/models';
import { UiStateService } from '../core/ui-state.service';
import { BrandFilterComponent, mergeKnownBrands } from '../shared/brand-filter.component';
import { ClearDataDialogComponent } from '../shared/clear-data-dialog.component';

/** One campaign (by name) waiting for a brand; detail lists the sheet(s) and ID(s) it appears under. */
interface UnresolvedItem { campaignName: string; detail: string; }

const SHEET_LABELS: Record<CampaignSheetFilter, string> = {
  ALL: 'All',
  PRODUCT_BOOSTING: 'Product Boosting',
  PRODUCT_RECOMMENDATION: 'Product Recommendation',
};

@Component({
  selector: 'app-campaign-page',
  imports: [FormsModule, BrandFilterComponent, ClearDataDialogComponent],
  template: `
    <header class="topbar">
      <div class="topbar-left"><div><h1>Campaign Analysis</h1><span class="muted">{{ lastUpdated() }}</span></div></div>
      <div class="topbar-right">
        @if (isAdmin()) { <label class="upload-btn">Upload Campaign Sheet<input type="file" accept=".xls,.xlsx" hidden (change)="upload($event)"></label> }
        <button class="secondary-btn" (click)="exportCampaign()">Get Sheet</button>
        @if (isAdmin()) { <button class="secondary-btn danger-btn" (click)="clearOpen.set(true)">🗑️ Clear Data</button> }
      </div>
    </header>
    <div class="upload-status" [class.success]="statusType() === 'success'" [class.error]="statusType() === 'error'">{{ status() }}</div>
    @if (pendingUpload(); as pending) {
      <section class="controls unresolved-panel">
        @if (currentItem(); as item) {
          <p><strong>Campaign {{ queueIndex() + 1 }} of {{ pending.items.length }}</strong> has no recognisable brand:</p>
          <p>{{ item.campaignName }} <span class="muted">({{ item.detail }})</span></p>
          <label for="queueBrand">Brand for this campaign</label>
          <input id="queueBrand" list="queueBrandOptions" [(ngModel)]="queueInput" (keydown.enter)="queueNext()" placeholder="Pick or type a brand">
          <datalist id="queueBrandOptions">@for (b of queueSuggestions(); track b) { <option [value]="b"></option> }</datalist>
          <button class="upload-btn" [disabled]="!queueInput.trim()" (click)="queueNext()">Next</button>
          <button class="secondary-btn" (click)="queueSkip()">Skip (keep Unknown)</button>
          <button class="secondary-btn" [disabled]="!queueInput.trim()" (click)="queueApplyRest()">Apply to all remaining ({{ pending.items.length - queueIndex() }})</button>
          <button class="secondary-btn" [disabled]="queueIndex() === 0" (click)="queueBack()">Back</button>
          <button class="secondary-btn" (click)="cancelPendingUpload()">Cancel</button>
        } @else {
          <p><strong>All {{ pending.items.length }} campaign(s) reviewed.</strong></p>
          <ul>@for (item of pending.items; track item.campaignName) { <li>{{ item.campaignName }} -> <strong>{{ labelFor(item.campaignName) || 'Unknown' }}</strong></li> }</ul>
          <button class="upload-btn" (click)="confirmPendingUpload()">Upload</button>
          <button class="secondary-btn" (click)="queueBack()">Back</button>
          <button class="secondary-btn" (click)="cancelPendingUpload()">Cancel</button>
        }
      </section>
    }

    <section class="controls campaign-controls">
      <label class="filter-label" for="periodSelect">Period</label>
      <select id="periodSelect" [ngModel]="selectedPeriod()" (ngModelChange)="changePeriod($event)">@for (period of periods(); track period.periodKey) { <option [value]="period.periodKey">{{ period.periodLabel }}</option> }</select>
      <div class="sheet-tabs" role="tablist">@for (tab of sheetTabs; track tab) { <button type="button" role="tab" class="sheet-tab" [class.active]="sheetType() === tab" (click)="changeSheetType(tab)">{{ sheetLabel(tab) }}</button> }</div>
      <input id="campaignSearch" type="search" aria-label="Search campaigns" [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Search campaign...">    </section>

    @if (brandChips().length) {
      <section class="brand-bar"><app-brand-filter [brands]="brandChips()" [selected]="ui.focusedBrand()" (select)="ui.setBrand($event)" /></section>
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

    <section class="legend"><span class="legend-item"><span class="dot dot-top"></span> Top 25%</span><span class="legend-item"><span class="dot dot-low"></span> Bottom 25%</span><span class="legend-item muted">Click a campaign for its keyword/category breakdown and daily trend.</span></section>
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
    @if (clearOpen()) {
      <app-clear-data-dialog scope="campaign" note="Applies to every month." [brands]="allBrands()" [initialBrand]="ui.focusedBrand()" (confirm)="clearData($event)" (cancel)="clearOpen.set(false)" />
    }
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
  readonly allBrands = signal<string[]>([]);
  readonly clearOpen = signal(false);
  readonly periods = signal<CampaignPeriod[]>([]);
  readonly selectedPeriod = signal('');
  readonly sheetType = signal<CampaignSheetFilter>('ALL');
  readonly query = signal('');
  readonly lastUpdated = signal('No campaign report uploaded yet');
  readonly status = signal('');
  // Upload waiting while the admin labels, one campaign at a time, the campaigns that resolve to "Unknown".
  readonly pendingUpload = signal<{ file: File; items: UnresolvedItem[] } | null>(null);
  readonly queueIndex = signal(0);
  readonly queueLabels = signal<Record<string, string>>({}); // campaign name -> brand
  queueInput = '';
  readonly currentItem = computed(() => this.pendingUpload()?.items[this.queueIndex()] ?? null);
  readonly queueSuggestions = computed(() =>
    Array.from(new Set([...Object.values(this.queueLabels()), ...this.brandOptions()])).filter((b) => b && b !== 'Unknown').sort());
  readonly brandOptions = computed(() => Array.from(new Set([...this.allBrands(), ...this.knownBrands()].filter((b) => b && b !== 'Unknown'))).sort());
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
  readonly knownBrands = signal<string[]>([]);
  readonly brandChips = computed(() => mergeKnownBrands(this.brandSummaries().map((brand) => ({ brandName: brand.brandName, value: brand.adSpend })), this.knownBrands()));
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
      if (preview.unresolved?.length) {
        // Label the unknown campaigns first; the replace warning is shown afterwards, with the chosen brands applied.
        this.startQueue(file, preview.unresolved);
        this.setStatus('Choose a brand for each unrecognised campaign below.', '');
        return;
      }
      await this.confirmAndUpload(file, preview, {});
    } catch (error) { this.setStatus(this.message(error), 'error'); }
    finally { input.value = ''; }
  }

  labelFor(campaignName: string) { return this.queueLabels()[campaignName] ?? ''; }

  private startQueue(file: File, unresolved: CampaignUploadPreview['unresolved']) {
    const byName = new Map<string, string[]>();
    for (const c of unresolved) {
      const where = byName.get(c.campaignName) ?? [];
      where.push(`${this.sheetLabel(c.sheetType)}, ID ${c.campaignId}`);
      byName.set(c.campaignName, where);
    }
    const items: UnresolvedItem[] = Array.from(byName, ([campaignName, where]) => ({ campaignName, detail: where.join(' | ') }));
    this.queueLabels.set({});
    this.pendingUpload.set({ file, items });
    this.showQueueItem(0);
  }

  private showQueueItem(index: number) {
    this.queueIndex.set(index);
    const item = this.pendingUpload()?.items[index];
    this.queueInput = item ? this.labelFor(item.campaignName) : '';
  }

  queueNext() {
    const item = this.currentItem();
    const brand = this.queueInput.trim();
    if (!item || !brand) return;
    this.queueLabels.update((labels) => ({ ...labels, [item.campaignName]: brand }));
    this.showQueueItem(this.queueIndex() + 1);
  }

  queueSkip() {
    const item = this.currentItem();
    if (!item) return;
    this.queueLabels.update((labels) => { const next = { ...labels }; delete next[item.campaignName]; return next; });
    this.showQueueItem(this.queueIndex() + 1);
  }

  /** Gives the typed brand to this campaign and every one after it in the queue. */
  queueApplyRest() {
    const pending = this.pendingUpload();
    const brand = this.queueInput.trim();
    if (!pending || !brand) return;
    const labels = { ...this.queueLabels() };
    for (const item of pending.items.slice(this.queueIndex())) labels[item.campaignName] = brand;
    this.queueLabels.set(labels);
    this.showQueueItem(pending.items.length);
  }

  queueBack() {
    if (this.queueIndex() > 0) this.showQueueItem(this.queueIndex() - 1);
  }

  async confirmPendingUpload() {
    const pending = this.pendingUpload();
    if (!pending) return;
    const labels = this.queueLabels();
    this.pendingUpload.set(null);
    try {
      this.setStatus('Checking file...', '');
      const preview = await this.api.previewCampaignUpload(pending.file, labels);
      await this.confirmAndUpload(pending.file, preview, labels);
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  cancelPendingUpload() {
    this.pendingUpload.set(null);
    this.queueLabels.set({});
    this.setStatus('Upload cancelled.', '');
  }

  private async confirmAndUpload(file: File, preview: CampaignUploadPreview, labels: Record<string, string>) {
    const warning = this.replaceWarning(preview.plan);
    if (warning && !window.confirm(warning)) { this.setStatus('Upload cancelled.', ''); return; }
    await this.doUpload(file, labels);
  }

  private async doUpload(file: File, campaignBrands: Record<string, string>) {
    this.setStatus('Uploading...', '');
    const result: CampaignUploadResult = await this.api.uploadCampaign(file, campaignBrands);
    if (result.duplicate) {
      this.setStatus('This exact file was already uploaded today - nothing changed.', 'success');
      return;
    }
    const notes = [
      result.skippedRows ? `${result.skippedRows} row(s) skipped (missing date, campaign ID or name)` : '',
      result.unrecognisedSheets?.length ? `sheet(s) not recognised: ${result.unrecognisedSheets.join(', ')}` : '',
    ].filter(Boolean);
    this.setStatus(
      `Uploaded successfully - ${result.rowCount} daily rows across ${result.periodKeys.length} period(s) and ${result.sheetTypes.length} sheet type(s).` +
        (notes.length ? ` Note: ${notes.join('; ')}.` : ''),
      notes.length ? 'error' : 'success'
    );
    this.ui.refreshLookups();
    await this.load(result.latestPeriodKey);
  }

  /** Deletes one brand's campaign data across all months (or everything when brand is empty). */
  async clearData(brand: string) {
    this.clearOpen.set(false);
    try {
      await this.api.clearCampaignData(brand || undefined);
      if (!brand || this.ui.focusedBrand().toLowerCase() === brand.toLowerCase()) this.ui.setBrand('');
      this.ui.refreshLookups();
      this.undoStack = [];
      this.collapse();
      await this.load();
      this.setStatus(brand ? `Campaign data for ${brand} cleared.` : 'All campaign data cleared.', 'success');
    } catch (error) { this.setStatus(this.message(error), 'error'); }
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
      this.allBrands.set(data.allBrands || []);
      this.knownBrands.set((await this.api.brandNames()).brands);
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
      const removed = (item.removedCampaigns ?? []).length
        ? `\n    Removed (not in this file): ${item.removedCampaigns.map((c) => `${c.campaignName} (ID ${c.campaignId})`).join(', ')}`
        : '';
      return `- ${item.periodLabel} / ${this.sheetLabel(item.sheetType)} / ${item.brandName}: ${item.existing?.rowCount} rows (${item.existing?.from} to ${item.existing?.to}) -> ${item.incoming.rowCount} rows (${item.incoming.from} to ${item.incoming.to})${shrinks}${removed}`;
    });
    return `This upload replaces data already stored:\n\n${lines.join('\n')}\n\nContinue?`;
  }

  private collapse() { this.expandedKey.set(null); this.detailTargeting.set([]); this.detailDaily.set([]); }
  private setStatus(value: string, type: 'success' | 'error' | '') { this.status.set(value); this.statusType.set(type); }
  private message(error: unknown) { return error instanceof Error ? error.message : 'The request failed.'; }
  private isTyping(target: EventTarget | null) { const tag = (target as HTMLElement | null)?.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'; }
}
