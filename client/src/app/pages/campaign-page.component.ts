import { Component, HostListener, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { brandFor, compareValues, money, number } from '../core/formatters';
import { CampaignPeriod, CampaignRow, CampaignSummary } from '../core/models';
import { UiStateService } from '../core/ui-state.service';

@Component({
  selector: 'app-campaign-page',
  imports: [FormsModule],
  template: `
    <header class="topbar">
      <div class="topbar-left"><div><h1>Campaign Analysis</h1><span class="muted">{{ lastUpdated() }}</span></div></div>
      <div class="topbar-right"><span class="user-info muted">{{ auth.user()?.email }}</span>
        @if (isAdmin()) { <label class="upload-btn">Upload Campaign Sheet<input type="file" accept=".xlsx" hidden (change)="upload($event)"></label> }
        <button class="secondary-btn" (click)="exportCampaign()">Export Sheet</button>
      </div>
    </header>
    <div class="upload-status" [class.success]="statusType() === 'success'" [class.error]="statusType() === 'error'">{{ status() }}</div>
    <section class="controls campaign-controls">
      <label class="filter-label" for="periodSelect">Period</label><select id="periodSelect" [ngModel]="selectedPeriod()" (ngModelChange)="changePeriod($event)">@for (period of periods(); track period.periodKey) { <option [value]="period.periodKey">{{ period.periodLabel }}</option> }</select>
      <input type="text" [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Search campaign..."><span class="muted undo-hint">Tip: Ctrl+Z undoes the last delete</span>
    </section>
    <section class="cards campaign-kpis">
      <div class="card"><div class="card-label">Total Ad Spend</div><div class="card-value">{{ money(summary().totalAdSpend) }}</div></div><div class="card"><div class="card-label">Total Sales</div><div class="card-value">{{ money(summary().totalSales) }}</div></div><div class="card"><div class="card-label">Overall ROAS</div><div class="card-value">{{ roas(summary().overallRoas) }}</div></div><div class="card"><div class="card-label">Overall ROI</div><div class="card-value">{{ percent(summary().roiPct) }}</div></div><div class="card"><div class="card-label">Qty Sold</div><div class="card-value">{{ number(summary().totalUnits, 2) }}</div></div><div class="card"><div class="card-label">Active Campaigns</div><div class="card-value">{{ summary().activeCampaigns }}/{{ summary().totalCampaigns }}</div></div>
    </section>
    <section class="campaign-highlights"><div class="highlight-card highlight-best"><div class="highlight-label">Best Campaign</div><div class="highlight-name">{{ summary().bestCampaign?.name || '-' }}</div><div class="highlight-metric">{{ summary().bestCampaign ? 'ROAS ' + roas(summary().bestCampaign?.roas) : '-' }}</div></div><div class="highlight-card highlight-worst"><div class="highlight-label">Needs Attention</div><div class="highlight-name">{{ summary().worstCampaign?.name || '-' }}</div><div class="highlight-metric">{{ summary().worstCampaign ? 'ROAS ' + roas(summary().worstCampaign?.roas) : '-' }}</div></div><div class="funnel-card"><div class="highlight-label">Campaign Funnel</div><div class="funnel-row"><div><strong>{{ number(summary().totalImpressions) }}</strong><span>Impressions</span></div><div class="funnel-arrow">→</div><div><strong>{{ number(summary().totalAtc) }}</strong><span>ATC</span></div><div class="funnel-arrow">→</div><div><strong>{{ number(summary().totalUnits, 2) }}</strong><span>Qty Sold</span></div></div></div></section>
    <section class="legend"><span class="legend-item"><span class="dot dot-top"></span> Top performer (top 25% by ROAS)</span><span class="legend-item"><span class="dot dot-low"></span> Needs attention (bottom 25% by ROAS)</span></section>
    <section class="table-wrap"><table id="campaignTable"><thead><tr><th>Rank</th><th (click)="sortBy('campaignName')">Campaign {{ sortIndicator('campaignName') }}</th><th (click)="sortBy('campaignDetail')">Type {{ sortIndicator('campaignDetail') }}</th><th (click)="sortBy('status')">Status {{ sortIndicator('status') }}</th><th (click)="sortBy('adSpend')">Ad Spend {{ sortIndicator('adSpend') }}</th><th (click)="sortBy('sales')">Sales {{ sortIndicator('sales') }}</th><th (click)="sortBy('roas')">ROAS {{ sortIndicator('roas') }}</th><th (click)="sortBy('roiPct')">ROI {{ sortIndicator('roiPct') }}</th><th (click)="sortBy('rosPerUnit')">ROS / Unit {{ sortIndicator('rosPerUnit') }}</th><th (click)="sortBy('impressions')">Impressions {{ sortIndicator('impressions') }}</th><th (click)="sortBy('atc')">ATC {{ sortIndicator('atc') }}</th><th (click)="sortBy('qtySold')">Qty Sold {{ sortIndicator('qtySold') }}</th><th></th></tr></thead><tbody>
      @if (focusNote()) { <tr><td colspan="13" class="muted" style="white-space:normal;">{{ focusNote() }}</td></tr> }
      @for (row of displayedRows(); track row.storeIndex; let index = $index) { <tr [class.row-top]="row.tier === 'top'" [class.row-low]="row.tier === 'low'"><td>{{ index + 1 }}</td><td [title]="row.campaignName">{{ row.campaignName }}</td><td>{{ row.campaignDetail }}</td><td><span class="status-pill" [class.status-ok]="row.status.toLowerCase() === 'active'" [class.status-low]="row.status.toLowerCase() !== 'active'">{{ row.status }}</span></td><td>{{ money(row.adSpend) }}</td><td>{{ money(row.sales) }}</td><td>{{ roas(row.roas) }}</td><td>{{ percent(row.roiPct) }}</td><td>{{ money(row.rosPerUnit) }}</td><td>{{ number(row.impressions) }}</td><td>{{ number(row.atc) }}</td><td>{{ number(row.qtySold, 2) }}</td><td>@if (isAdmin()) { <button class="delete-btn" [class.confirming]="pendingDelete() === row.storeIndex" (click)="deleteCampaign(row)">{{ pendingDelete() === row.storeIndex ? 'Confirm?' : '🗑️' }}</button> }</td></tr> }
    </tbody></table>@if (!displayedRows().length) { <p class="muted">No campaign data yet. Upload the Oicia Campaign Sheet to get started.</p> }</section>
  `,
})
export class CampaignPageComponent implements OnInit {
  readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly ui = inject(UiStateService);
  readonly rows = signal<CampaignRow[]>([]);
  readonly periods = signal<CampaignPeriod[]>([]);
  readonly selectedPeriod = signal('');
  readonly query = signal('');
  readonly summary = signal<CampaignSummary>(this.emptySummary());
  readonly lastUpdated = signal('No campaign report uploaded yet');
  readonly status = signal('');
  readonly statusType = signal<'success' | 'error' | ''>('');
  readonly pendingDelete = signal<number | null>(null);
  readonly focusNote = computed(() => this.focusMessage());
  readonly displayedRows = computed(() => this.filterRows());
  readonly money = money;
  readonly number = number;
  readonly sortKey = signal<keyof CampaignRow>('roas');
  readonly sortAsc = signal(false);
  private initialized = false;
  private timer?: ReturnType<typeof setTimeout>;
  private undoStack: { periodKey: string; storeIndex: number; campaign: CampaignRow }[] = [];

  constructor() {
    effect(() => {
      this.ui.focusedProduct();
      this.ui.focusedBrand();
      if (this.initialized) void this.load(this.selectedPeriod() || undefined);
    });
  }

  async ngOnInit() { this.initialized = true; await this.load(); }
  isAdmin() { return this.auth.user()?.role === 'admin'; }
  roas(value: number | null | undefined) { return value === null || value === undefined ? 'n/a' : `${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}x`; }
  percent(value: number | null | undefined) { return value === null || value === undefined ? 'n/a' : `${value.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`; }
  sortBy(key: keyof CampaignRow) { this.sortAsc.set(this.sortKey() === key ? !this.sortAsc() : true); this.sortKey.set(key); }
  sortIndicator(key: keyof CampaignRow) { return this.sortKey() === key ? (this.sortAsc() ? '↑' : '↓') : ''; }

  async changePeriod(periodKey: string) { await this.load(periodKey); }
  exportCampaign() {
    if (!this.selectedPeriod()) { this.setStatus('Upload a campaign report first.', 'error'); return; }
    window.location.assign(`/api/export-campaign?periodKey=${encodeURIComponent(this.selectedPeriod())}`);
  }

  async upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.setStatus('Uploading...', '');
    try {
      const result = await this.api.uploadCampaign(file);
      this.setStatus(`Uploaded successfully - ${result.periodCount} periods, ${result.campaignCount} campaigns in latest period.`, 'success');
      await this.load(result.latestPeriodKey);
    } catch (error) { this.setStatus(this.message(error), 'error'); }
    finally { input.value = ''; }
  }

  async deleteCampaign(row: CampaignRow) {
    if (this.pendingDelete() !== row.storeIndex) {
      this.pendingDelete.set(row.storeIndex);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.pendingDelete.set(null), 3000);
      return;
    }
    clearTimeout(this.timer);
    this.pendingDelete.set(null);
    try {
      const result = await this.api.deleteCampaign(this.selectedPeriod(), row.storeIndex);
      this.rows.update((items) => items.filter((item) => item.storeIndex !== row.storeIndex));
      this.undoStack.push({ periodKey: this.selectedPeriod(), storeIndex: row.storeIndex, campaign: result.removed || row });
      if (this.undoStack.length > 15) this.undoStack.shift();
      this.updateSummary();
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
      await this.api.restoreCampaign(record.periodKey, record.storeIndex, record.campaign);
      await this.load(record.periodKey);
      this.setStatus('Restored.', 'success');
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  private async load(periodKey?: string) {
    try {
      const data = await this.api.campaignData(periodKey);
      this.periods.set(data.periods || []);
      this.selectedPeriod.set(data.periodKey || data.latestPeriodKey || '');
      this.rows.set(data.rows || []);
      this.lastUpdated.set(data.date ? `Last updated: ${data.date}` : 'No campaign report uploaded yet');
      await this.updateSummary();
    } catch (error) { this.setStatus(this.message(error), 'error'); }
  }

  private async updateSummary() {
    const focused = this.ui.focusedProduct() || this.ui.focusedBrand();
    if (!this.selectedPeriod()) { this.summary.set(this.emptySummary()); return; }
    if (!focused) { this.summary.set(await this.api.campaignSummary(this.selectedPeriod())); return; }
    const values = this.filteredForFocus().rows;
    const spend = values.reduce((sum, row) => sum + row.adSpend, 0);
    const sales = values.reduce((sum, row) => sum + row.sales, 0);
    const ranked = values.filter((row) => row.adSpend > 0 && row.roas !== null);
    const best = ranked.reduce<CampaignRow | null>((bestRow, row) => !bestRow || (row.roas ?? 0) > (bestRow.roas ?? 0) ? row : bestRow, null);
    const worst = ranked.reduce<CampaignRow | null>((worstRow, row) => !worstRow || (row.roas ?? 0) < (worstRow.roas ?? 0) ? row : worstRow, null);
    this.summary.set({ totalAdSpend: spend, totalSales: sales, overallRoas: spend ? Math.round((sales / spend) * 100) / 100 : null, roiPct: spend ? Math.round(((sales - spend) / spend) * 1000) / 10 : null, totalUnits: values.reduce((sum, row) => sum + row.qtySold, 0), activeCampaigns: values.filter((row) => row.status.toLowerCase() === 'active').length, totalCampaigns: values.length, bestCampaign: best ? { name: best.campaignName, roas: best.roas || 0 } : null, worstCampaign: worst ? { name: worst.campaignName, roas: worst.roas || 0 } : null, totalImpressions: values.reduce((sum, row) => sum + row.impressions, 0), totalAtc: values.reduce((sum, row) => sum + row.atc, 0) });
  }

  private filterRows() {
    const query = this.query().trim().toLowerCase();
    let values = this.rows().filter((row) => row.campaignName.toLowerCase().includes(query) || row.campaignDetail.toLowerCase().includes(query) || row.status.toLowerCase().includes(query));
    const focused = this.filteredForFocus(values);
    values = focused.rows;
    return [...values].sort((a, b) => (this.sortAsc() ? 1 : -1) * compareValues(a, b, this.sortKey()));
  }

  private filteredForFocus(source = this.rows()) {
    let values = source;
    let matchedAny = false;
    const filters = [this.ui.focusedBrand(), this.ui.focusedProduct()].filter(Boolean);
    for (const term of filters) {
      const needle = term.toLowerCase();
      const matching = values.filter((row) => brandFor(row).toLowerCase() === needle || row.campaignName.toLowerCase().includes(needle) || row.campaignDetail.toLowerCase().includes(needle));
      if (matching.length) { values = matching; matchedAny = true; }
    }
    const wanted = filters.length > 0;
    const found = matchedAny || !wanted;
    const terms = filters.map((term) => `"${term}"`).join(' and ');
    return { rows: values, note: wanted ? (found ? `Showing campaigns matching ${terms}.` : `No campaign explicitly mentions ${terms} - showing all campaigns for this period instead.`) : '' };
  }

  private focusMessage() {
    return this.filteredForFocus().note;
  }

  private emptySummary(): CampaignSummary { return { totalAdSpend: 0, totalSales: 0, overallRoas: null, roiPct: null, totalUnits: 0, activeCampaigns: 0, totalCampaigns: 0, bestCampaign: null, worstCampaign: null, totalImpressions: 0, totalAtc: 0 }; }
  private setStatus(value: string, type: 'success' | 'error' | '') { this.status.set(value); this.statusType.set(type); }
  private message(error: unknown) { return error instanceof Error ? error.message : 'The request failed.'; }
  private isTyping(target: EventTarget | null) { const tag = (target as HTMLElement | null)?.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'; }
}
