import { Component, HostListener, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { selectionTotals } from '../core/campaign-selection';
import { brandFor, compareValues, money, number } from '../core/formatters';
import {
  CampaignBrandRow, CampaignDailyPoint, CampaignDailyRow, CampaignPeriod, CampaignRow, CampaignSheetFilter,
  CampaignSheetType, CampaignSummary, CampaignTargetingRow, CampaignUploadPlanItem, CampaignUploadPreview, CampaignUploadResult,
} from '../core/models';
import { UiStateService } from '../core/ui-state.service';
import { BrandFilterComponent, mergeKnownBrands } from '../shared/brand-filter.component';
import { ClearDataDialogComponent } from '../shared/clear-data-dialog.component';

/** One campaign (by name) waiting for a brand; detail lists the sheet(s) and ID(s) it appears under. */
interface UnresolvedItem { campaignName: string; detail: string; }

/** The three columns that can show direct / indirect, the table's two edges, and the right-click menu they open. */
type SplitKey = 'atc' | 'qtySold' | 'sales';
type MenuKind = 'left' | 'right' | SplitKey;
type TrendKey = 'adSpend' | 'impressions' | 'atc' | 'qtySold' | 'sales' | 'roas';
/** A number column of the campaign table: what it shows, and the value it sorts by (null sorts last). */
interface NumCol { key: string; label: string; splittable?: boolean; cell: (row: CampaignRow) => string; value: (row: CampaignRow) => number | null; }

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
      <div class="topbar-left"><div><h1>Advertising</h1><span class="muted">{{ lastUpdated() }}</span></div></div>
      <div class="topbar-right">
        @if (isAdmin()) { <label class="upload-btn">Upload Campaign Sheet<input type="file" accept=".xls,.xlsx" hidden (change)="upload($event)"></label> }
        @if (!ui.presenting()) { <button class="secondary-btn" (click)="exportCampaign()">Get Sheet</button> }
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

    @if (brandChips().length && !ui.focusedBrand()) {
      <section class="brand-bar"><app-brand-filter [brands]="brandChips()" [selected]="ui.focusedBrand()" (select)="ui.setBrand($event)" /></section>
    }
    @if (hasUnknownBrand() && isAdmin() && !ui.focusedBrand()) {
      <p class="muted brand-note">Some campaigns couldn't be matched to a brand ("Unknown"). Teach the resolver with <code>POST /api/brand-alias</code> or by editing <code>data/brandAliases.json</code>, then re-upload.</p>
    }
    @if (focusNote()) { <p class="muted brand-note">{{ focusNote() }}</p> }

    @if (selection().count) { <p class="ad-scope-note">Showing {{ selection().count }} of {{ scopeTotal() }} ads</p> }
    <section class="cards campaign-kpis ad-kpis">
      <div class="card"><div class="card-label">Total Ad Spend</div><div class="card-value">{{ money(totals().totalAdSpend) }}</div></div>
      <div class="card"><div class="card-label">Impressions</div><div class="card-value">{{ number(totals().totalImpressions) }}</div></div>
      <div class="card"><div class="card-label">Add to Cart</div><div class="card-value">{{ number(totals().totalAtc) }}</div></div>
      <div class="card"><div class="card-label">Qty Sold</div><div class="card-value">{{ number(totals().totalUnits) }}</div></div>
      <div class="card"><div class="card-label">Total Sales</div><div class="card-value">{{ money(totals().totalSales) }}</div></div>
      <div class="card"><div class="card-label">Overall ROAS</div><div class="card-value">{{ roas(totals().overallRoas) }}</div></div>
      <div class="card"><div class="card-label">New Users</div><div class="card-value">{{ number(totals().totalNewUsers) }}</div></div>
    </section>

    <section class="ad-trend">
      <div class="ad-trend-head">
        <h2 class="section-title">Trends <span class="muted">daily @if (selection().count) { - {{ selection().count }} selected }</span></h2>
        <div class="ad-trend-pills">@for (metric of trendMetrics; track metric.key) { <button type="button" class="ad-pill" [class.active]="trendMetric() === metric.key" (click)="trendMetric.set(metric.key)">{{ metric.label }}</button> }</div>
      </div>
      <div class="ad-trend-body">
        <div class="ad-trend-chart">
          @if (trend(); as t) {
            <div class="ad-plot" role="img" [attr.aria-label]="'Daily ' + t.label">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                @for (tick of t.ticks; track $index) { <line class="ad-grid" x1="0" x2="100" [attr.y1]="tick.y" [attr.y2]="tick.y" /> }
                <polyline class="ad-line" [attr.points]="t.points" />
              </svg>
              @for (tick of t.ticks; track $index) { <span class="ad-axis ad-axis-y" [style.top.%]="tick.y">{{ tick.label }}</span> }
              @for (label of t.labels; track $index) { <span class="ad-axis ad-axis-x" [style.left.%]="label.x">{{ label.text }}</span> }
              @for (dot of t.dots; track $index) { <span class="ad-dot" [style.left.%]="dot.x" [style.top.%]="dot.y" [title]="dot.title"></span> }
            </div>
          } @else { <p class="muted">No daily data to chart for this period.</p> }
        </div>
        <aside class="ad-trend-side">
          @if (totals().bestCampaign; as best) {
            <div class="ad-side-item"><span class="dot dot-top"></span><div class="ad-side-text"><span class="ad-side-label">Best campaign</span><span class="ad-side-name" [title]="best.name">{{ best.name }}</span></div><strong class="ad-side-value ad-good">{{ roas(best.roas) }}</strong></div>
          } @else { <span class="muted">No campaign with spend yet.</span> }
          @if (totals().worstCampaign; as worst) {
            <div class="ad-side-item"><span class="dot dot-low"></span><div class="ad-side-text"><span class="ad-side-label">Needs attention</span><span class="ad-side-name" [title]="worst.name">{{ worst.name }}</span></div><strong class="ad-side-value ad-bad">{{ roas(worst.roas) }}</strong></div>
          }
        </aside>
      </div>
    </section>

    <section class="legend"><span class="legend-item"><span class="dot dot-top"></span> Top 25%</span><span class="legend-item"><span class="dot dot-low"></span> Bottom 25%</span><span class="legend-item muted">Click a campaign for its keyword/category breakdown and daily trend.</span></section>
    @if (selection().count) {
      <section class="selection-bar" aria-live="polite">
        <strong>{{ selection().count }} of {{ scopeTotal() }} ads selected</strong>
        <label class="ad-apply" title="Keep these ads selected after the Select Ads column is hidden"><input type="checkbox" [checked]="applySelection()" (change)="setApply($any($event.target).checked)"> Apply</label>
        <button type="button" class="secondary-btn" (click)="clearSelection()">Clear selection</button>
      </section>
    }
    <section class="table-wrap">
      <table id="campaignListTable" [class.has-select]="showSelect()"><thead><tr>
        <th class="select-col" [class.col-hidden]="!showSelect()"><input type="checkbox" [checked]="allShownSelected()" [indeterminate]="selectedRows().length > 0 && !allShownSelected()" (change)="toggleSelectAll()" aria-label="Select all campaigns shown"></th>
        <th class="ad-edge ad-edge-left" [class.open]="showSelect()" aria-label="Select Ads" (click)="toggleSelectColumn()" (contextmenu)="openMenu($event, 'left')" (mouseenter)="showTip($event, 'Select Ads')" (mouseleave)="hideTip()">{{ showSelect() ? '→' : '←' }}</th>
        <th [style.width.px]="w('campaignName')" [style.min-width.px]="w('campaignName')" [style.max-width.px]="w('campaignName')" [class.ad-clip]="w('campaignName') !== null" (click)="sortBy('campaignName')">Campaign {{ sortIndicator('campaignName') }}<span class="col-resize" title="Drag to resize, double-click to reset" (mousedown)="startResize($event, 'campaignName')" (click)="$event.stopPropagation()" (dblclick)="resetWidth($event, 'campaignName')"></span></th>
        <th [style.width.px]="w('brandName')" [style.min-width.px]="w('brandName')" [style.max-width.px]="w('brandName')" [class.ad-clip]="w('brandName') !== null" (click)="sortBy('brandName')">Brand {{ sortIndicator('brandName') }}<span class="col-resize" title="Drag to resize, double-click to reset" (mousedown)="startResize($event, 'brandName')" (click)="$event.stopPropagation()" (dblclick)="resetWidth($event, 'brandName')"></span></th>
        <th [style.width.px]="w('sheetType')" [style.min-width.px]="w('sheetType')" [style.max-width.px]="w('sheetType')" [class.ad-clip]="w('sheetType') !== null" (click)="sortBy('sheetType')">Type {{ sortIndicator('sheetType') }}<span class="col-resize" title="Drag to resize, double-click to reset" (mousedown)="startResize($event, 'sheetType')" (click)="$event.stopPropagation()" (dblclick)="resetWidth($event, 'sheetType')"></span></th>
        <th [style.width.px]="w('targeting')" [style.min-width.px]="w('targeting')" [style.max-width.px]="w('targeting')" [class.ad-clip]="w('targeting') !== null">Targeting<span class="col-resize" title="Drag to resize, double-click to reset" (mousedown)="startResize($event, 'targeting')" (click)="$event.stopPropagation()" (dblclick)="resetWidth($event, 'targeting')"></span></th>
        @for (col of numCols(); track col.key) {
          <th class="num" [style.width.px]="w(col.key)" [style.min-width.px]="w(col.key)" [style.max-width.px]="w(col.key)" [class.ad-clip]="w(col.key) !== null" (click)="sortBy(col.key)" (contextmenu)="headerMenu($event, col)" (mouseenter)="col.splittable ? showTip($event, 'Open menu') : null" (mouseleave)="hideTip()">{{ col.label }} {{ sortIndicator(col.key) }}<span class="col-resize" title="Drag to resize, double-click to reset" (mousedown)="startResize($event, col.key)" (click)="$event.stopPropagation()" (dblclick)="resetWidth($event, col.key)"></span></th>
        }
        <th class="ad-edge ad-edge-right" [class.open]="anyExtra()" aria-label="Show more" (click)="toggleExtras()" (contextmenu)="openMenu($event, 'right')" (mouseenter)="showTip($event, 'Show more')" (mouseleave)="hideTip()">{{ anyExtra() ? '←' : '→' }}</th>
      </tr></thead><tbody>
        @for (row of displayedRows(); track rowKey(row); let index = $index) {
          <tr class="clickable" [class.row-top]="row.tier === 'top'" [class.row-low]="row.tier === 'low'" [class.row-selected]="isSelected(row)" (click)="toggleExpand(row)">
            <td class="select-col" [class.col-hidden]="!showSelect()" (click)="$event.stopPropagation()"><input type="checkbox" [checked]="isSelected(row)" (change)="toggleSelect(row)" [attr.aria-label]="'Select ' + row.campaignName"></td>
            <td>{{ index + 1 }}</td>
            <td [title]="row.campaignName" [style.max-width.px]="w('campaignName')" [class.ad-clip]="w('campaignName') !== null">{{ row.campaignName }}</td>
            <td [style.max-width.px]="w('brandName')" [class.ad-clip]="w('brandName') !== null">{{ row.brandName }}</td>
            <td [style.max-width.px]="w('sheetType')" [class.ad-clip]="w('sheetType') !== null">{{ sheetLabel(row.sheetType) }}</td>
            <td [style.max-width.px]="w('targeting')" [class.ad-clip]="w('targeting') !== null">{{ row.targetingTypes.join(', ') }}</td>
            @for (col of numCols(); track col.key) { <td class="num" [style.max-width.px]="w(col.key)" [class.ad-clip]="w(col.key) !== null">{{ col.cell(row) }}</td> }
            <td (click)="$event.stopPropagation()">@if (isAdmin()) { <button class="delete-btn" [class.confirming]="pendingDelete() === rowKey(row)" (click)="deleteCampaign(row)">{{ pendingDelete() === rowKey(row) ? 'Confirm?' : '🗑️' }}</button> }</td>
          </tr>
          @if (expandedKey() === rowKey(row)) {
            <tr class="detail-row"><td colspan="24">
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

    @if (brandSummaries().length > 1 && !ui.focusedBrand()) {
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
              <td class="num">{{ money(brand.adSpend) }}</td><td class="num">{{ money(brand.sales) }}</td><td class="num">{{ roas(brand.roas) }}</td>
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


    @if (menu(); as m) {
      <div class="ad-menu" role="menu" [style.left.px]="m.x" [style.top.px]="m.y" (click)="$event.stopPropagation()" (dblclick)="$event.stopPropagation()" (contextmenu)="$event.preventDefault()">
        @if (m.kind === 'left') {
          <label><input type="checkbox" [checked]="showSelect()" (change)="setShowSelect($any($event.target).checked); markMenuDirty()"> Select Ads</label>
        } @else if (m.kind === 'right') {
          <div class="ad-menu-title">Show more</div>
          <label><input type="checkbox" [checked]="extraCols().perUnit" (change)="setExtra('perUnit', $any($event.target).checked)"> Spend per unit sold</label>
          <label><input type="checkbox" [checked]="extraCols().perUser" (change)="setExtra('perUser', $any($event.target).checked)"> Spend per new user</label>
        } @else {
          <label><input type="checkbox" [checked]="menuSplitOn()" (change)="setMenuSplit($any($event.target).checked)"> Show direct / indirect</label>
        }
      </div>
    }
    @if (tip(); as hint) { <div class="ad-tip" role="tooltip" [style.left.px]="hint.x" [style.top.px]="hint.y">{{ hint.text }}</div> }
    @if (clearOpen()) {
      <app-clear-data-dialog scope="campaign" note="Applies to every month." [brands]="allBrands()" [initialBrand]="ui.focusedBrand()" (confirm)="clearData($event)" (cancel)="clearOpen.set(false)" />
    }
  `,
})
export class CampaignPageComponent implements OnInit, OnDestroy {
  readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly ui = inject(UiStateService);

  readonly sheetTabs: CampaignSheetFilter[] = ['ALL', 'PRODUCT_BOOSTING', 'PRODUCT_RECOMMENDATION'];
  readonly trendMetrics: { key: TrendKey; label: string }[] = [
    { key: 'adSpend', label: 'Spend' }, { key: 'impressions', label: 'Impressions' }, { key: 'atc', label: 'ATC' },
    { key: 'qtySold', label: 'Qty Sold' }, { key: 'sales', label: 'Sales' }, { key: 'roas', label: 'ROAS' },
  ];
  readonly brandColumns: { key: keyof CampaignBrandRow; label: string }[] = [
    { key: 'adSpend', label: 'Spend' }, { key: 'sales', label: 'Sales' }, { key: 'roas', label: 'ROAS' },
    { key: 'impressions', label: 'Impressions' }, { key: 'atc', label: 'ATC' }, { key: 'qtySold', label: 'Qty Sold' }, { key: 'campaignCount', label: 'Campaigns' },
  ];
  readonly compareMetrics: { label: string; format: (b: CampaignBrandRow) => string }[] = [
    { label: 'Ad spend', format: (b) => money(b.adSpend) }, { label: 'Sales', format: (b) => money(b.sales) },
    { label: 'ROAS', format: (b) => this.roas(b.roas) }, { label: 'Direct ROAS', format: (b) => this.roas(b.directRoas) },
    { label: 'Impressions', format: (b) => number(b.impressions) },
    { label: 'ATC (direct / indirect)', format: (b) => `${number(b.directAtc)} / ${number(b.indirectAtc)}` },
    { label: 'Qty sold (direct / indirect)', format: (b) => `${number(b.directQtySold)} / ${number(b.indirectQtySold)}` },
    { label: 'New users', format: (b) => number(b.newUsersAcquired) }, { label: 'Campaigns', format: (b) => String(b.campaignCount) },
  ];

  readonly rows = signal<CampaignRow[]>([]);
  /** Per campaign per day, for the trend chart. */
  readonly daily = signal<CampaignDailyPoint[]>([]);
  readonly trendMetric = signal<TrendKey>('adSpend');
  /** Left edge: the tick-box column, hidden until asked for. Apply keeps the ticks when it is hidden again. */
  readonly showSelect = signal(false);
  readonly applySelection = signal(false);
  /** Right edge: the two optional columns at the end of the table. */
  readonly extraCols = signal<{ perUnit: boolean; perUser: boolean }>({ perUnit: false, perUser: false });
  readonly anyExtra = computed(() => this.extraCols().perUnit || this.extraCols().perUser);
  /** ATC, Qty and Sales show one merged number unless direct / indirect is ticked for that column. */
  readonly split = signal<Record<SplitKey, boolean>>({ atc: false, qtySold: false, sales: false });
  /** The open right-click menu. Once a tick in it is changed (dirty) it closes only on a double click or Esc. */
  readonly menu = signal<{ kind: MenuKind; x: number; y: number; dirty: boolean } | null>(null);
  readonly tip = signal<{ text: string; x: number; y: number } | null>(null);
  /** Column widths set by dragging a header line (px); a column not listed sizes itself. Reset on reload. */
  readonly colWidths = signal<Record<string, number>>({});
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
  readonly sortKey = signal<string>('roas');
  readonly sortAsc = signal(false);
  readonly brandSortKey = signal<keyof CampaignBrandRow>('adSpend');
  readonly brandSortAsc = signal(false);
  readonly compareSet = signal<Set<string>>(new Set());
  /** Campaigns ticked in the table (by rowKey). Cleared whenever the list is reloaded. */
  readonly selectedKeys = signal<Set<string>>(new Set());
  readonly selectedRows = computed(() => this.productMatch().rows.filter((row) => this.selectedKeys().has(this.rowKey(row))));
  readonly selection = computed(() => selectionTotals(this.selectedRows()));
  readonly allShownSelected = computed(() => this.displayedRows().length > 0 && this.displayedRows().every((row) => this.selectedKeys().has(this.rowKey(row))));
  /** What the cards, the trend chart and its legend describe: the ticked campaigns, or all of them when none is ticked. */
  readonly scopeRows = computed(() => (this.selectedRows().length ? this.selectedRows() : this.productMatch().rows));
  readonly scopeTotal = computed(() => this.productMatch().rows.length);
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
    const key = this.sortKey();
    const col = this.numCols().find((c) => c.key === key);
    if (!col) return [...values].sort((a, b) => direction * compareValues(a, b, key as keyof CampaignRow));
    return [...values].sort((a, b) => {
      const left = col.value(a);
      const right = col.value(b);
      if (left === right) return 0;
      if (left === null) return 1; // no value sorts last either way
      if (right === null) return -1;
      return direction * (left - right);
    });
  });
  /** Number columns in Blinkit's order (Spend, Impressions, ATC, then ours), plus the optional ones from the right edge. */
  readonly numCols = computed<NumCol[]>(() => {
    const split = this.split();
    const extra = this.extraCols();
    const cols: NumCol[] = [
      { key: 'adSpend', label: 'Spend', cell: (r) => money(r.adSpend), value: (r) => r.adSpend },
      { key: 'impressions', label: 'Impressions', cell: (r) => number(r.impressions), value: (r) => r.impressions },
      { key: 'atc', label: split.atc ? 'ATC (D / I)' : 'ATC', splittable: true, value: (r) => r.atc,
        cell: (r) => (split.atc ? `${number(r.directAtc)} / ${number(r.indirectAtc)}` : number(r.atc)) },
      { key: 'qtySold', label: split.qtySold ? 'Qty (D / I)' : 'Qty', splittable: true, value: (r) => r.qtySold,
        cell: (r) => (split.qtySold ? `${number(r.directQtySold)} / ${number(r.indirectQtySold)}` : number(r.qtySold)) },
      { key: 'sales', label: split.sales ? 'Sales (D / I)' : 'Sales', splittable: true, value: (r) => r.sales,
        cell: (r) => (split.sales ? `${money(r.directSales)} / ${money(r.indirectSales)}` : money(r.sales)) },
      { key: 'roas', label: 'ROAS', cell: (r) => this.roas(r.roas), value: (r) => r.roas },
      { key: 'newUsersAcquired', label: 'New Users', cell: (r) => number(r.newUsersAcquired), value: (r) => r.newUsersAcquired },
    ];
    // Spend per unit sold / per new user; "n/a" when nothing was sold or no new user came.
    const per = (spend: number, count: number) => (count > 0 ? Math.round((spend / count) * 100) / 100 : null);
    if (extra.perUnit) cols.push({ key: 'spendPerUnit', label: 'Spend / unit', cell: (r) => money(per(r.adSpend, r.qtySold)), value: (r) => per(r.adSpend, r.qtySold) });
    if (extra.perUser) cols.push({ key: 'spendPerNewUser', label: 'Spend / new user', cell: (r) => money(per(r.adSpend, r.newUsersAcquired)), value: (r) => per(r.adSpend, r.newUsersAcquired) });
    return cols;
  });
  readonly totals = computed<CampaignSummary>(() => this.summarise(this.scopeRows()));
  /** The trend chart: one point per day for the campaigns in scope. Positions are percentages of the plot box (0 to 100), so the
   *  line stretches with the page while the labels and dots stay their normal size. Null when there is nothing to draw. */
  readonly trend = computed(() => {
    const keys = new Set(this.scopeRows().map((row) => this.rowKey(row)));
    const byDate = new Map<string, { adSpend: number; sales: number; impressions: number; atc: number; qtySold: number }>();
    for (const point of this.daily()) {
      if (!keys.has(point.key)) continue;
      const day = byDate.get(point.date) ?? { adSpend: 0, sales: 0, impressions: 0, atc: 0, qtySold: 0 };
      day.adSpend += point.adSpend; day.sales += point.sales; day.impressions += point.impressions; day.atc += point.atc; day.qtySold += point.qtySold;
      byDate.set(point.date, day);
    }
    const metric = this.trendMetric();
    // ROAS for a day is that day's sales / spend (recomputed from the sums, never averaged).
    const days = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, t]) => ({ date, value: metric === 'roas' ? (t.adSpend > 0 ? t.sales / t.adSpend : 0) : t[metric] }));
    if (!days.length) return null;

    const isMoney = metric === 'adSpend' || metric === 'sales';
    const top = this.niceCeiling(Math.max(...days.map((d) => d.value)));
    const x = (i: number) => Math.round((days.length === 1 ? 50 : (i / (days.length - 1)) * 100) * 100) / 100;
    const y = (value: number) => Math.round((100 - (value / top) * 100) * 100) / 100;
    const exact = (value: number) => (isMoney ? money(value, 0) : metric === 'roas' ? this.roas(Math.round(value * 100) / 100) : number(value));
    const short = (value: number) => {
      const trim = (n: number) => String(Math.round(n * 100) / 100);
      const text = value >= 100000 ? `${trim(value / 100000)}L` : value >= 1000 ? `${trim(value / 1000)}K` : trim(value);
      return isMoney ? `₹${text}` : metric === 'roas' ? `${text}x` : text;
    };
    const labelEvery = Math.max(1, Math.ceil(days.length / 8));
    return {
      label: this.trendMetrics.find((m) => m.key === metric)?.label ?? '',
      points: days.map((d, i) => `${x(i)},${y(d.value)}`).join(' '),
      dots: days.map((d, i) => ({ x: x(i), y: y(d.value), title: `${this.dayLabel(d.date)}: ${exact(d.value)}` })),
      ticks: [0, 1, 2, 3, 4].map((i) => ({ y: y((top * i) / 4), label: short((top * i) / 4) })),
      labels: days.map((d, i) => ({ x: x(i), text: this.dayLabel(d.date) })).filter((_, i) => i % labelEvery === 0),
    };
  });
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
  private resizing: { key: string; startX: number; startWidth: number; zoom: number } | null = null;
  private justResized = false;

  constructor() {
    effect(() => {
      this.ui.focusedBrand();
      if (this.initialized) void this.load(this.selectedPeriod() || undefined);
    });
  }

  async ngOnInit() { this.initialized = true; await this.load(); }
  ngOnDestroy() { this.stopResize(); }
  isAdmin() { return this.auth.isAdmin(); }
  sheetLabel(type: CampaignSheetFilter) { return SHEET_LABELS[type] ?? type; }
  rowKey(row: CampaignRow) { return `${row.sheetType}|${row.campaignId}`; }
  isFocusedBrand(name: string) { return this.ui.focusedBrand().toLowerCase() === name.toLowerCase(); }
  roas(value: number | null | undefined) { return value === null || value === undefined ? 'n/a' : `${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}x`; }
  sortBy(key: string) {
    if (this.justResized) return; // the click that ends a column drag is not a sort
    this.sortAsc.set(this.sortKey() === key ? !this.sortAsc() : true);
    this.sortKey.set(key);
  }
  sortIndicator(key: string) { return this.sortKey() === key ? (this.sortAsc() ? '↑' : '↓') : ''; }
  sortBrands(key: keyof CampaignBrandRow) { this.brandSortAsc.set(this.brandSortKey() === key ? !this.brandSortAsc() : true); this.brandSortKey.set(key); }
  brandIndicator(key: keyof CampaignBrandRow) { return this.brandSortKey() === key ? (this.brandSortAsc() ? '↑' : '↓') : ''; }

  isSelected(row: CampaignRow) { return this.selectedKeys().has(this.rowKey(row)); }

  toggleSelect(row: CampaignRow) {
    const key = this.rowKey(row);
    this.selectedKeys.update((current) => { const next = new Set(current); if (!next.delete(key)) next.add(key); return next; });
  }

  /** Ticks every campaign shown (after the search), or clears them when they are all ticked already. */
  toggleSelectAll() {
    const shown = this.displayedRows().map((row) => this.rowKey(row));
    this.selectedKeys.update((current) => {
      const next = new Set(current);
      if (shown.every((key) => next.has(key))) shown.forEach((key) => next.delete(key));
      else shown.forEach((key) => next.add(key));
      return next;
    });
  }

  clearSelection() { this.selectedKeys.set(new Set()); }

  // --- Left edge: the tick-box column ---
  toggleSelectColumn() { this.setShowSelect(!this.showSelect()); }

  /** Hiding the tick-box column clears the ticks, unless Apply is on. */
  setShowSelect(show: boolean) {
    this.showSelect.set(show);
    if (!show && !this.applySelection()) this.clearSelection();
  }

  /** Apply keeps the ticked ads after the column is hidden; turning it off while the column is hidden clears them. */
  setApply(on: boolean) {
    this.applySelection.set(on);
    if (!on && !this.showSelect()) this.clearSelection();
  }

  // --- Right edge: the optional columns ---
  /** A click on the right edge shows both optional columns, or hides whichever are showing. */
  toggleExtras() {
    const show = !this.anyExtra();
    this.extraCols.set({ perUnit: show, perUser: show });
    this.dropStaleSort();
  }

  setExtra(key: 'perUnit' | 'perUser', on: boolean) {
    this.extraCols.update((current) => ({ ...current, [key]: on }));
    this.dropStaleSort();
    this.markMenuDirty();
  }

  /** The direct / indirect tick of the header menu that is open (ATC, Qty or Sales). */
  menuSplitOn() {
    const kind = this.menu()?.kind;
    return kind === 'atc' || kind === 'qtySold' || kind === 'sales' ? this.split()[kind] : false;
  }

  setMenuSplit(on: boolean) {
    const kind = this.menu()?.kind;
    if (kind !== 'atc' && kind !== 'qtySold' && kind !== 'sales') return;
    this.split.update((current) => ({ ...current, [kind]: on }));
    this.markMenuDirty();
  }

  /** If the table was sorted by an optional column that is now hidden, go back to the default sort. */
  private dropStaleSort() {
    const key = this.sortKey();
    if ((key === 'spendPerUnit' || key === 'spendPerNewUser') && !this.numCols().some((col) => col.key === key)) {
      this.sortKey.set('roas');
      this.sortAsc.set(false);
    }
  }

  // --- Right-click menus (left edge, right edge, and the ATC / Qty / Sales headers) ---
  openMenu(event: MouseEvent, kind: MenuKind) {
    event.preventDefault();
    event.stopPropagation();
    this.hideTip();
    const zoom = this.cssZoom(event.currentTarget);
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - 240)) / zoom;
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - 130)) / zoom;
    this.menu.set({ kind, x, y, dirty: false });
  }

  /** Right-click on a number header: only ATC, Qty and Sales have a menu; the others keep the browser's own. */
  headerMenu(event: MouseEvent, col: NumCol) {
    if (col.splittable) this.openMenu(event, col.key as SplitKey);
  }

  markMenuDirty() { this.menu.update((current) => (current ? { ...current, dirty: true } : current)); }

  /** One click outside closes a menu nobody changed; after a tick was changed it takes a double click (or Esc). */
  @HostListener('document:click')
  closeCleanMenu() { if (this.menu() && !this.menu()?.dirty) this.menu.set(null); }

  @HostListener('document:dblclick')
  @HostListener('document:keydown.escape')
  closeMenu() { if (this.menu()) this.menu.set(null); }

  showTip(event: MouseEvent, text: string) {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const zoom = this.cssZoom(event.currentTarget);
    this.tip.set({ text, x: Math.round((box.left + box.width / 2) / zoom), y: Math.round((box.top - 6) / zoom) });
  }

  hideTip() { if (this.tip()) this.tip.set(null); }

  // --- Column widths (drag the line at the right of a header) ---
  w(key: string) { return this.colWidths()[key] ?? null; }

  startResize(event: MouseEvent, key: string) {
    event.preventDefault();
    event.stopPropagation();
    const header = (event.currentTarget as HTMLElement).parentElement;
    if (!header) return;
    this.resizing = { key, startX: event.clientX, startWidth: header.getBoundingClientRect().width, zoom: this.cssZoom(header) };
    document.addEventListener('mousemove', this.onResizeMove);
    document.addEventListener('mouseup', this.onResizeEnd);
  }

  resetWidth(event: MouseEvent, key: string) {
    event.stopPropagation();
    this.colWidths.update((current) => { const next = { ...current }; delete next[key]; return next; });
  }

  private readonly onResizeMove = (event: MouseEvent) => {
    const drag = this.resizing;
    if (!drag) return;
    const width = Math.max(48, Math.round((drag.startWidth + event.clientX - drag.startX) / drag.zoom));
    this.colWidths.update((current) => ({ ...current, [drag.key]: width }));
  };

  private readonly onResizeEnd = () => {
    this.stopResize();
    this.justResized = true;
    setTimeout(() => { this.justResized = false; });
  };

  private stopResize() {
    this.resizing = null;
    document.removeEventListener('mousemove', this.onResizeMove);
    document.removeEventListener('mouseup', this.onResizeEnd);
  }

  /** Presentation mode zooms the page; screen positions must be divided by that zoom before they are used as CSS px. */
  private cssZoom(target: EventTarget | null) {
    const zoom = (target as (Element & { currentCSSZoom?: number }) | null)?.currentCSSZoom;
    return typeof zoom === 'number' && zoom > 0 ? zoom : 1;
  }

  /** Rounds a chart maximum up to a tidy number (1, 2, 4, 5, 8 or 10 times a power of ten) so the axis reads cleanly. */
  private niceCeiling(value: number) {
    if (!(value > 0)) return 1;
    const power = 10 ** Math.floor(Math.log10(value));
    const n = value / power;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 8 ? 8 : 10) * power;
  }

  /** "2026-11-03" -> "03 Nov". */
  private dayLabel(date: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) return date;
    return `${match[3]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(match[2]) - 1] ?? ''}`.trim();
  }

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

  async exportCampaign() {
    if (!this.selectedPeriod()) { this.setStatus('Upload a campaign report first.', 'error'); return; }
    const query = new URLSearchParams({ periodKey: this.selectedPeriod() });
    if (this.ui.focusedBrand()) query.set('brand', this.ui.focusedBrand());
    if (this.sheetType() !== 'ALL') query.set('sheetType', this.sheetType());
    try {
      await this.api.download(`/api/export-campaign?${query}`, 'Campaign_Analysis.xlsx');
    } catch (error) { this.setStatus(this.message(error), 'error'); }
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
      this.daily.set(data.daily || []);
      this.selectedKeys.set(new Set());
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
