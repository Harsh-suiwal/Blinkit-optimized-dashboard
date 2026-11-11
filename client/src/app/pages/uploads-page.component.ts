import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { UploadKind, UploadsOverview, UploadsUndoItem } from '../core/models';
import { UiStateService } from '../core/ui-state.service';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DUPLICATE = 'This exact file was already uploaded today, so nothing changed.';

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
      <div class="topbar-left"><div><h1>Uploads</h1><span class="muted">Every report in one place</span></div></div>
    </header>
    <div class="upload-status" [class.success]="statusType() === 'success'" [class.error]="statusType() === 'error'">{{ status() }}</div>

    @if (!isAdmin()) {
      <section class="overview-empty"><h2>Admins only</h2><p class="muted">Only admins can upload reports.</p></section>
    } @else {
      <section class="upload-grid" aria-label="Upload a report">
        @for (card of cards; track card.kind) {
          <div class="upload-card">
            <h3>{{ card.title }}</h3>
            <p class="muted">{{ card.help }}</p>
            @if (card.kind === 'costs') {
              <label class="filter-label" for="costBrand">Brand</label>
              <input id="costBrand" class="styled-select" list="uploadBrandOptions" placeholder="Pick or type a brand" [value]="costBrand()" (input)="costBrand.set(valueOf($event))">
              <datalist id="uploadBrandOptions">@for (name of brandNames(); track name) { <option [value]="name"></option> }</datalist>
            }
            <label class="upload-btn" [class.disabled]="busy() !== ''">{{ busy() === card.kind ? 'Uploading...' : 'Choose file' }}<input type="file" accept=".xlsx,.xls" hidden [disabled]="busy() !== ''" (change)="upload(card.kind, $event)"></label>
            @if (message(card.kind); as m) { <p class="upload-note" [class.success]="m.type === 'success'" [class.error]="m.type === 'error'">{{ m.text }}</p> }
            @if (card.kind === 'campaign') { <p class="muted upload-hint">A file with campaigns that have no brand yet must be uploaded on the <a routerLink="/campaign-analysis">Advertising page</a>, where you name them.</p> }
          </div>
        }
      </section>

      @if (overview(); as o) {
        @if (o.undo.length) {
          <section class="table-wrap compare-table">
            <h3>Undo the last upload</h3>
            <p class="muted">Puts that report back as it was before the upload, including anything removed since. Only the latest upload of each report can be undone.</p>
            <table id="uploadUndoTable">
              <thead><tr><th>Report</th><th>File</th><th>Uploaded</th><th>Brands</th><th></th></tr></thead>
              <tbody>
                @for (u of o.undo; track u.kind) {
                  <tr>
                    <td>{{ u.label }}</td><td>{{ u.fileName || '-' }}</td><td>{{ timeText(u.at) }}</td><td>{{ u.brands.join(', ') || '-' }}</td>
                    <td><button type="button" class="secondary-btn danger-btn" [class.confirming]="pendingUndo() === u.kind" (click)="undo(u)">{{ pendingUndo() === u.kind ? 'Confirm undo?' : 'Undo' }}</button></td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        }

        <section class="table-wrap compare-table">
          <h3>What is uploaded for each brand</h3>
          @if (!o.brands.length) {
            <p class="muted">Nothing has been uploaded yet.</p>
          } @else {
            <table id="uploadedTable">
              <thead><tr><th>Brand</th><th>Stock</th><th>Sales</th><th>Monthly sales</th><th>Advertising</th><th>Cost sheet</th></tr></thead>
              <tbody>
                @for (b of o.brands; track b.brand) {
                  <tr>
                    <td><strong>{{ b.brand }}</strong></td>
                    <td>@if (b.stock; as s) { {{ dateText(s.date) }}<br><span class="muted">{{ s.fileName }}</span> } @else { <span class="muted">Not uploaded</span> }</td>
                    <td>@if (b.sales; as s) { {{ dateText(s.date) }}<br><span class="muted">{{ rangeText(s.from, s.to) || s.fileName }}</span> } @else { <span class="muted">Not uploaded</span> }</td>
                    <td>@if (b.monthly; as m) { {{ m.months }} {{ m.months === 1 ? 'month' : 'months' }}: {{ m.first }}{{ m.months > 1 ? ' to ' + m.last : '' }}<br><span class="muted">latest file {{ m.fileName }}</span> } @else { <span class="muted">Not uploaded</span> }</td>
                    <td>@if (b.advertising; as a) { {{ a.periods.join(', ') }}<br><span class="muted">{{ a.fileName }}</span> } @else { <span class="muted">Not uploaded</span> }</td>
                    <td>@if (b.costs; as c) { {{ c.productCount }} products<br><span class="muted">{{ dateText(c.date) }}</span> } @else { <span class="muted">Not uploaded</span> }</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>
      } @else if (loading()) {
        <p class="muted overview-loading">Loading…</p>
      }
    }
  `,
})
export class UploadsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly ui = inject(UiStateService);
  readonly cards: UploadCard[] = [
    { kind: 'inventory', title: 'Stock report', help: 'The Blinkit stock export (.xlsx). Replaces the stock of every brand in the file.' },
    { kind: 'sales', title: 'Sales report', help: 'The Blinkit sales export (.xlsx). Shows on the Sales page and also fills the monthly history.' },
    { kind: 'salesMonthly', title: 'Monthly sales report', help: 'One sales export per month for the Trends page. Never changes the Sales page.' },
    { kind: 'campaign', title: 'Advertising report', help: 'The Blinkit campaign export (.xls or .xlsx).' },
    { kind: 'costs', title: 'Cost sheet', help: 'Product costs and Blinkit fees for one brand (.xlsx), used by the Profit tab.' },
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

  async ngOnInit() { await this.loadOverview(); }

  isAdmin() { return this.auth.user()?.role === 'admin'; }
  message(kind: UploadKind): CardMessage | null { return this.messages()[kind] ?? null; }
  valueOf(event: Event) { return (event.target as HTMLInputElement).value; }

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
      this.setMessage(kind, 'Pick a brand for the cost sheet first.', 'error');
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
      this.setMessage(kind, error instanceof Error ? error.message : 'The upload failed.', 'error');
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
      this.setStatus(`Undid the ${result.label.toLowerCase()} upload${result.fileName ? ` (${result.fileName})` : ''}.`, 'success');
      this.ui.refreshLookups();
      await this.loadOverview();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'The undo failed.', 'error');
    }
  }

  private async send(kind: UploadKind, file: File): Promise<string> {
    switch (kind) {
      case 'inventory': {
        const result: { duplicate?: boolean; rowCount?: number; brands?: string[] } = await this.api.uploadInventory(file);
        return result.duplicate ? DUPLICATE : `Uploaded ${result.rowCount ?? 0} stock rows for ${(result.brands ?? []).join(', ') || 'your brands'}.`;
      }
      case 'sales': {
        const result: { duplicate?: boolean; orderRowCount?: number; brands?: string[] } = await this.api.uploadSales(file);
        return result.duplicate ? DUPLICATE : `Uploaded ${result.orderRowCount ?? 0} order rows for ${(result.brands ?? []).join(', ') || 'your brands'}.`;
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
          throw new Error(`${preview.unresolved.length} campaign(s) have no recognisable brand yet. Upload this file on the Advertising page to name them.`);
        }
        const result = await this.api.uploadCampaign(file);
        return result.duplicate ? DUPLICATE : `Uploaded ${result.rowCount} campaign rows for ${result.periodKeys.join(', ')}.`;
      }
      case 'costs': {
        const result = await this.api.uploadBrandCosts(this.costBrand().trim(), file);
        return `Saved costs for ${result.productCount} products${result.skippedRows ? `, ${result.skippedRows} rows skipped` : ''}.`;
      }
    }
  }

  private async loadOverview() {
    this.loading.set(true);
    try {
      this.overview.set(await this.api.uploadsOverview());
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'The request failed.', 'error');
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
