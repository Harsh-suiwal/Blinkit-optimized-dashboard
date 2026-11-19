import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { UploadKind, UploadsOverview, UploadsUndoItem } from '../core/models';
import { UiStateService } from '../core/ui-state.service';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DUPLICATE = 'This file was already uploaded today — no changes were made.';

interface UploadCard { kind: UploadKind; title: string; help: string; }
interface CardMessage { text: string; type: 'success' | 'error' | ''; }

/**
 * Admin Uploads panel: every report in one place, what is uploaded for each brand, and an undo for the
 * latest upload of each report. The upload itself uses the same endpoints as the Stock, Sales,
 * Advertising and Trends pages.
 */
@Component({
  selector: 'app-uploads-page',
  imports: [RouterLink],
  template: `
    <header class="topbar">
      <div class="topbar-left"><div><h1>Data Uploads</h1><span class="muted">Centralised Report Management</span></div></div>
    </header>
    <div class="upload-status" [class.success]="statusType() === 'success'" [class.error]="statusType() === 'error'">{{ status() }}</div>

    @if (!isAdmin()) {
      <section class="overview-empty"><h2>Admin Access Required</h2><p class="muted">Report uploads are restricted to administrators.</p></section>
    } @else {
      <section class="upload-grid" aria-label="Upload Reports">
        @for (card of cards; track card.kind) {
          <div class="upload-card">
            <h3>{{ card.title }}</h3>
            <p class="muted">{{ card.help }}</p>
            @if (card.kind === 'costs') {
              <label class="filter-label" for="costBrand">Brand</label>
              <input id="costBrand" class="styled-select" list="uploadBrandOptions" placeholder="Select or enter a brand" [value]="costBrand()" (input)="costBrand.set(valueOf($event))">
              <datalist id="uploadBrandOptions">@for (name of brandNames(); track name) { <option [value]="name"></option> }</datalist>
            }
            <label class="upload-btn" [class.disabled]="busy() !== ''">{{ busy() === card.kind ? 'Uploading...' : 'Select File' }}<input type="file" accept=".xlsx,.xls" hidden [disabled]="busy() !== ''" (change)="upload(card.kind, $event)"></label>
            @if (message(card.kind); as m) { <p class="upload-note" [class.success]="m.type === 'success'" [class.error]="m.type === 'error'">{{ m.text }}</p> }
            @if (card.kind === 'campaign') { <p class="muted upload-hint">Campaigns without an assigned brand must be uploaded via the <a routerLink="/campaign-analysis">Advertising page</a> for naming.</p> }
          </div>
        }
      </section>

      @if (overview(); as o) {
        @if (o.undo.length) {
          <section class="table-wrap compare-table">
            <h3>Revert Last Upload</h3>
            <p class="muted">Restores the report to its pre-upload state, including any data removed since. Only the most recent upload per report type can be reverted.</p>
            <table id="uploadUndoTable">
              <thead><tr><th>Report</th><th>File</th><th>Uploaded</th><th>Brands</th><th></th></tr></thead>
              <tbody>
                @for (u of o.undo; track u.kind) {
                  <tr>
                    <td>{{ u.label }}</td><td>{{ u.fileName || '-' }}</td><td>{{ timeText(u.at) }}</td><td>{{ u.brands.join(', ') || '-' }}</td>
                    <td><button type="button" class="secondary-btn danger-btn" [class.confirming]="pendingUndo() === u.kind" (click)="undo(u)">{{ pendingUndo() === u.kind ? 'Confirm Reversion?' : 'Revert' }}</button></td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        }

        <section class="table-wrap compare-table">
          <h3>Upload Status by Brand</h3>
          @if (!o.brands.length) {
            <p class="muted">No uploads on record.</p>
          } @else {
            <table id="uploadedTable">
              <thead><tr><th>Brand</th><th>Stock</th><th>Sales</th><th>Monthly sales</th><th>Advertising</th><th>Cost sheet</th><th></th></tr></thead>
              <tbody>
                @for (b of o.brands; track b.brand) {
                  <tr>
                    <td><strong>{{ b.brand }}</strong></td>
                    <td>@if (b.stock; as s) { {{ dateText(s.date) }}<br><span class="muted">{{ s.fileName }}</span> } @else { <span class="muted">No data</span> }</td>
                    <td>@if (b.sales; as s) { {{ dateText(s.date) }}<br><span class="muted">{{ rangeText(s.from, s.to) || s.fileName }}</span> } @else { <span class="muted">No data</span> }</td>
                    <td>@if (b.monthly; as m) { {{ m.months }} {{ m.months === 1 ? 'month' : 'months' }}: {{ m.first }}{{ m.months > 1 ? ' to ' + m.last : '' }}<br><span class="muted">Latest file {{ m.fileName }}</span> } @else { <span class="muted">No data</span> }</td>
                    <td>@if (b.advertising; as a) { {{ a.periods.join(', ') }}<br><span class="muted">{{ a.fileName }}</span> } @else { <span class="muted">No data</span> }</td>
                    <td>@if (b.costs; as c) { {{ c.productCount }} products<br><span class="muted">{{ dateText(c.date) }}</span> } @else { <span class="muted">No data</span> }@if (b.typed) { <br><span class="muted">Manual data saved (COGS)</span> }</td>
                    <td><button type="button" class="secondary-btn danger-btn" (click)="openWipe(b.brand)">Remove Brand</button></td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>
      } @else if (loading()) {
        <p class="muted overview-loading">Loading…</p>
      }

      @if (wipeBrand(); as brand) {
        <div class="dialog-backdrop" (click)="closeWipe()">
          <div class="dialog wipe-dialog" role="dialog" aria-modal="true" aria-labelledby="wipeTitle" (click)="$event.stopPropagation()">
            <h2 id="wipeTitle">Remove Brand: {{ brand }}</h2>
            <p>This will permanently remove <strong>{{ brand }}</strong> and all associated data from the dashboard:</p>
            <ul class="wipe-list">
              <li>Stock inventory and 45/60-day history</li>
              <li>Sales data and trend history</li>
              <li>Monthly sales (Trends and Month-by-Month)</li>
              <li>Advertising data</li>
              <li>Uploaded cost sheet</li>
            </ul>
            <label class="dialog-check"><input type="checkbox" [checked]="wipeTyped()" (change)="wipeTyped.set(checked($event))"> <span>Also remove manually entered data (COGS)</span></label>
            <p class="muted wipe-hint">{{ wipeTyped() ? 'COGS, GST %, commission %, profit settings, and monthly other costs entered on the Profit tab will also be deleted.' : 'If left unchecked, Profit tab entries (COGS, GST %, commission %, settings, and monthly other costs) will be retained for future uploads.' }}</p>
            <p class="dialog-consequence">This action is irreversible. Other brands will not be affected. Reversion copies for all reports will be cleared, as reverting would restore this brand's data.</p>
            <label class="filter-label" for="wipeConfirm">Enter the brand name to confirm</label>
            <input id="wipeConfirm" class="styled-select" autocomplete="off" [placeholder]="brand" [value]="wipeText()" (input)="wipeText.set(valueOf($event))" (keydown.enter)="confirmWipe()">
            <div class="dialog-actions">
              <button type="button" class="secondary-btn" (click)="closeWipe()">Cancel</button>
              <button type="button" class="secondary-btn danger-btn" [disabled]="!wipeReady() || wiping()" (click)="confirmWipe()">{{ wiping() ? 'Removing...' : 'Remove ' + brand }}</button>
            </div>
          </div>
        </div>
      }
    }
  `,
})
export class UploadsPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly ui = inject(UiStateService);
  readonly cards: UploadCard[] = [
    { kind: 'inventory', title: 'Stock Report', help: 'Upload your Blinkit stock export (.xlsx). This will update inventory data for all brands in the file.' },
    { kind: 'sales', title: 'Sales Report', help: 'Upload your Blinkit sales export (.xlsx). Data will populate the Sales page and monthly history.' },
    { kind: 'salesMonthly', title: 'Monthly Sales Report', help: 'Upload one sales export per month for the Trends page. This does not affect the Sales page.' },
    { kind: 'campaign', title: 'Advertising Report', help: 'Upload your Blinkit campaign export (.xls or .xlsx).' },
    { kind: 'costs', title: 'Cost Sheet', help: 'Upload product costs and Blinkit fees for a single brand (.xlsx), used by the Profit module.' },
  ];
  readonly overview = signal<UploadsOverview | null>(null);
  readonly loading = signal(false);
  readonly busy = signal<UploadKind | ''>('');
  readonly costBrand = signal('');
  readonly pendingUndo = signal<UploadKind | ''>('');
  readonly status = signal('');
  readonly statusType = signal<'success' | 'error' | ''>('');
  private readonly messages = signal<Partial<Record<UploadKind, CardMessage>>>({});
  readonly brandNames = computed(() => (this.overview()?.brands ?? []).map((b) => b.brand));
  private pendingTimer?: ReturnType<typeof setTimeout>;
  /** The brand whose "Remove Brand" confirmation is open ('' = closed). */
  readonly wipeBrand = signal('');
  readonly wipeTyped = signal(false);
  readonly wipeText = signal('');
  readonly wiping = signal(false);
  /** The Delete button works only once the brand name has been typed (capitals and spaces at the ends don't matter). */
  readonly wipeReady = computed(() => this.wipeBrand() !== '' && this.wipeText().trim().toLowerCase() === this.wipeBrand().trim().toLowerCase());
  // The cross beside the brand in the sidebar arrives here as /uploads?wipe=<brand>.
  private readonly wipeParam = this.route.queryParamMap.subscribe((params) => {
    const brand = (params.get('wipe') ?? '').trim();
    if (!brand) return;
    this.openWipe(brand); // the dialog itself is only drawn for admins, and the server checks again
    void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true }); // so a reload does not reopen it
  });

  async ngOnInit() { await this.loadOverview(); }
  ngOnDestroy() { this.wipeParam.unsubscribe(); clearTimeout(this.pendingTimer); }

  isAdmin() { return this.auth.can('upload'); }
  message(kind: UploadKind): CardMessage | null { return this.messages()[kind] ?? null; }
  valueOf(event: Event) { return (event.target as HTMLInputElement).value; }
  checked(event: Event) { return (event.target as HTMLInputElement).checked; }

  // --- Delete a whole brand ---
  openWipe(brand: string) {
    this.wipeBrand.set(brand);
    this.wipeTyped.set(false);
    this.wipeText.set('');
  }

  @HostListener('document:keydown.escape')
  closeWipe() { if (!this.wiping()) this.wipeBrand.set(''); }

  async confirmWipe() {
    const brand = this.wipeBrand();
    if (!this.wipeReady() || this.wiping()) return;
    this.wiping.set(true);
    try {
      const result = await this.api.wipeBrand(brand, this.wipeTyped());
      const r = result.removed;
      const parts = [
        r.stockRows ? `${r.stockRows} stock rows` : '',
        r.salesRows ? `${r.salesRows} sales rows` : '',
        r.months ? `${r.months} ${r.months === 1 ? 'month' : 'months'} of monthly sales` : '',
        r.campaignRows ? `${r.campaignRows} advertising rows` : '',
        r.costSheet ? 'the cost sheet' : '',
        r.typed ? 'the typed data (COGS)' : '',
      ].filter(Boolean);
      this.setStatus(parts.length ? `Removed ${brand}: ${parts.join(', ')}.` : `No data was found for ${brand}.`, 'success');
      if (this.ui.focusedBrand().toLowerCase() === brand.toLowerCase()) this.ui.setBrand('');
      this.wipeBrand.set('');
      this.ui.refreshLookups();
      await this.loadOverview();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Removal failed.', 'error');
      this.wipeBrand.set('');
    } finally {
      this.wiping.set(false);
    }
  }

  dateText(date: string) {
    const [year, month, day] = date.slice(0, 10).split('-').map(Number);
    return year && month && day ? `${day} ${SHORT_MONTHS[month - 1]} ${year}` : date || '-';
  }

  rangeText(from: string | null, to: string | null) {
    return from && to ? `orders ${this.dateText(from)} to ${this.dateText(to)}` : '';
  }

  timeText(iso: string) {
    const when = new Date(iso);
    return Number.isNaN(when.getTime()) ? iso : when.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  async upload(kind: UploadKind, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (kind === 'costs' && !this.costBrand().trim()) {
      this.setMessage(kind, 'Please select a brand for the cost sheet first.', 'error');
      input.value = '';
      return;
    }
    this.busy.set(kind);
    this.setMessage(kind, 'Uploading...', '');
    try {
      this.setMessage(kind, await this.send(kind, file), 'success');
      this.ui.refreshLookups();
      await this.loadOverview();
    } catch (error) {
      this.setMessage(kind, error instanceof Error ? error.message : 'Upload failed.', 'error');
    } finally {
      this.busy.set('');
      input.value = '';
    }
  }

  /** Two clicks: the first asks "Confirm undo?", the second does it. */
  async undo(item: UploadsUndoItem) {
    if (this.pendingUndo() !== item.kind) {
      this.pendingUndo.set(item.kind);
      clearTimeout(this.pendingTimer);
      this.pendingTimer = setTimeout(() => this.pendingUndo.set(''), 4000);
      return;
    }
    clearTimeout(this.pendingTimer);
    this.pendingUndo.set('');
    try {
      const result = await this.api.undoUpload(item.kind);
      this.setStatus(`Reverted the ${result.label.toLowerCase()} upload${result.fileName ? ` (${result.fileName})` : ''}.`, 'success');
      this.ui.refreshLookups();
      await this.loadOverview();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Reversion failed.', 'error');
    }
  }

  private async send(kind: UploadKind, file: File): Promise<string> {
    switch (kind) {
      case 'inventory': {
        const result: { duplicate?: boolean; rowCount?: number; brands?: string[] } = await this.api.uploadInventory(file);
        return result.duplicate ? DUPLICATE : `Stock data uploaded: ${result.rowCount ?? 0} rows for ${(result.brands ?? []).join(', ') || 'your brands'}.`;
      }
      case 'sales': {
        const result: { duplicate?: boolean; orderRowCount?: number; brands?: string[] } = await this.api.uploadSales(file);
        return result.duplicate ? DUPLICATE : `Sales data uploaded: ${result.orderRowCount ?? 0} order rows for ${(result.brands ?? []).join(', ') || 'your brands'}.`;
      }
      case 'salesMonthly': {
        const result = await this.api.uploadSalesMonth(file);
        if (result.duplicate) return DUPLICATE;
        const months = Array.from(new Set((result.months ?? []).map((m) => m.label)));
        return `Saved ${months.length} ${months.length === 1 ? 'month' : 'months'}${months.length ? `: ${months.join(', ')}` : ''}.`;
      }
      case 'campaign': {
        const preview = await this.api.previewCampaignUpload(file);
        if (preview.unresolved.length) {
          throw new Error(`${preview.unresolved.length} campaign(s) have no recognised brand. Please upload this file via the Advertising page to assign brands.`);
        }
        const result = await this.api.uploadCampaign(file);
        return result.duplicate ? DUPLICATE : `Advertising data uploaded: ${result.rowCount} campaign rows for ${result.periodKeys.join(', ')}.`;
      }
      case 'costs': {
        const result = await this.api.uploadBrandCosts(this.costBrand().trim(), file);
        return `Cost data saved for ${result.productCount} products${result.skippedRows ? `; ${result.skippedRows} rows skipped` : ''}.`;
      }
    }
  }

  private async loadOverview() {
    this.loading.set(true);
    try {
      this.overview.set(await this.api.uploadsOverview());
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Request failed.', 'error');
    } finally {
      this.loading.set(false);
    }
  }

  private setMessage(kind: UploadKind, text: string, type: CardMessage['type']) {
    this.messages.update((current) => ({ ...current, [kind]: { text, type } }));
  }

  private setStatus(text: string, type: 'success' | 'error' | '') {
    this.status.set(text);
    this.statusType.set(type);
  }
}