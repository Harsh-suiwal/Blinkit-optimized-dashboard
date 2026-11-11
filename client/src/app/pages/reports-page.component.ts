import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { BrandReport } from '../core/models';
import { REPORT_SECTIONS, ReportInputs, ReportSettings, availableSections, emptyInputs, renderReport } from '../core/report-render';
import { UiStateService } from '../core/ui-state.service';

type InputGroup = 'price' | 'availability' | 'decisions';

/**
 * Reports: a client-ready, slide-style report for the brand picked in the sidebar, drawn with real charts.
 * "Download PDF" opens the browser's print window (choose "Save as PDF"). The optional facts the app cannot
 * know are typed here; every group can be switched off, and the matching slide or tile then disappears.
 */
@Component({
  selector: 'app-reports-page',
  template: `
    <header class="topbar report-controls">
      <div class="topbar-left"><div><h1>Reports</h1><span class="muted">{{ brand() || 'Pick a brand' }}</span></div></div>
      @if (data()) {
        <div class="topbar-right"><button type="button" class="upload-btn" (click)="print()">Download PDF</button></div>
      }
    </header>

    @if (!brand()) {
      <section class="overview-empty report-controls"><h2>Choose a brand</h2><p class="muted">A report covers one brand at a time. Pick a brand in the sidebar.</p></section>
    } @else {
      <div class="report-layout">
        <aside class="report-panel report-controls" aria-label="Report settings">
          @if (data(); as d) {
            <div class="rp-block">
              <div class="rp-head">Months</div>
              <div class="month-chips" role="group" aria-label="Months in the report">
                @for (m of d.availableMonths; track m.monthKey) {
                  <button type="button" class="month-chip" [class.active]="d.selectedMonths.includes(m.monthKey)" [attr.aria-pressed]="d.selectedMonths.includes(m.monthKey)" (click)="toggleMonth(m.monthKey)" [title]="m.hasSales && m.hasAds ? 'Sales and advertising' : m.hasSales ? 'Sales only' : 'Advertising only'">{{ m.label }}</button>
                }
              </div>
            </div>

            @if (isAdmin()) {
              <div class="rp-block">
                <label class="rp-check"><input type="checkbox" [checked]="includeProfit()" (change)="includeProfit.set(checked($event))"> <b>Include profit and cost figures</b></label>
                <p class="muted rp-help">Adds a Profit and ROI slide and uses your cost sheet for break-even ROAS. Leave it off for a report that goes to the client.</p>
              </div>
            }

            <div class="rp-block">
              <div class="rp-head">Slides</div>
              @for (s of sectionList; track s.key) {
                <label class="rp-check" [class.disabled]="!can()[s.key]"><input type="checkbox" [disabled]="!can()[s.key]" [checked]="can()[s.key] && isOn(s.key)" (change)="setSection(s.key, checked($event))"> {{ s.label }}@if (!can()[s.key]) { <span class="muted"> (no data)</span> }</label>
              }
            </div>

            <div class="rp-block">
              <div class="rp-head">Optional details <span class="muted">(leave empty or switch off to skip)</span></div>

              <details class="rp-group">
                <summary>Price range</summary>
                <label class="rp-check"><input type="checkbox" [checked]="use().price" (change)="setUse('price', checked($event))"> Use it in the report</label>
                <input class="rp-input" type="text" placeholder="For example ₹137–₹140" aria-label="Stated selling-price range" [value]="inputs().priceRange" (input)="setPrice($event)">
              </details>

              <details class="rp-group">
                <summary>Availability and store count</summary>
                <label class="rp-check"><input type="checkbox" [checked]="use().availability" (change)="setUse('availability', checked($event))"> Use it in the report</label>
                <p class="muted rp-help">The app does not know availability. Enter it per product to add an Availability slide.</p>
                @for (row of inputs().availability; track $index; let i = $index) {
                  <div class="rp-row">
                    <input class="rp-input rp-name" type="text" list="reportProducts" placeholder="Product" aria-label="Product" [value]="row.name" (input)="setAvailability(i, 'name', $event)">
                    <input class="rp-input" type="number" min="0" max="100" placeholder="Now %" aria-label="Current availability %" [value]="row.current ?? ''" (input)="setAvailability(i, 'current', $event)">
                    <input class="rp-input" type="number" min="0" max="100" placeholder="Target %" aria-label="Target availability %" [value]="row.target ?? ''" (input)="setAvailability(i, 'target', $event)">
                    <button type="button" class="secondary-btn" (click)="removeAvailability(i)" aria-label="Remove this line">✕</button>
                  </div>
                }
                <datalist id="reportProducts">@for (name of productNames(); track name) { <option [value]="name"></option> }</datalist>
                <button type="button" class="secondary-btn" (click)="addAvailability()">Add a product</button>
                <input class="rp-input" type="number" min="0" placeholder="Dark stores in total (optional)" aria-label="Dark stores in total" [value]="inputs().stores ?? ''" (input)="setStores($event)">
              </details>

              <details class="rp-group">
                <summary>Your own “three decisions”</summary>
                <label class="rp-check"><input type="checkbox" [checked]="use().decisions" (change)="setUse('decisions', checked($event))"> Use them in the report</label>
                <p class="muted rp-help">Without these the summary shows suggestions worked out from the numbers.</p>
                @for (text of inputs().decisions; track $index; let i = $index) {
                  <textarea class="rp-input" rows="2" [attr.aria-label]="'Decision ' + (i + 1)" [placeholder]="'Decision ' + (i + 1)" [value]="text" (input)="setDecision(i, $event)"></textarea>
                }
              </details>
            </div>

            <div class="rp-block">
              <label class="rp-head" for="reportZoom">Preview size</label>
              <select id="reportZoom" class="styled-select" [value]="zoom()" (change)="setZoom($event)">
                <option value="0.45">Small</option><option value="0.6">Medium</option><option value="0.8">Large</option><option value="1">Full size</option>
              </select>
              <p class="muted rp-help">Download PDF opens the print window: choose “Save as PDF”. The pages are already landscape with no margins.</p>
            </div>
          } @else if (loading()) {
            <p class="muted">Loading…</p>
          }
        </aside>

        <section class="report-stage">
          @if (error()) { <p class="muted brand-note">{{ error() }}</p> }
          @if (data(); as d) {
            @if (!d.available.sales && !d.available.ads) {
              <section class="overview-empty"><h2>Nothing to report yet</h2><p class="muted">Upload this brand's monthly sales (Trends) or advertising report first.</p></section>
            } @else {
              <div class="report-preview" [style.zoom]="zoom()" [innerHTML]="html()"></div>
            }
          } @else if (loading()) {
            <p class="muted overview-loading">Building the report…</p>
          }
        </section>
      </div>
    }
  `,
})
export class ReportsPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly ui = inject(UiStateService);
  readonly brand = computed(() => this.ui.focusedBrand());
  readonly data = signal<BrandReport | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  /** Months asked for ([] = the latest months that have data). */
  readonly months = signal<string[]>([]);
  readonly includeProfit = signal(false);
  readonly sections = signal<Record<string, boolean>>({});
  readonly inputs = signal<ReportInputs>(emptyInputs());
  readonly use = signal<Record<InputGroup, boolean>>({ price: true, availability: true, decisions: true });
  readonly zoom = signal(0.6);
  readonly sectionList = REPORT_SECTIONS;
  readonly isAdmin = computed(() => this.auth.isAdmin());
  private requestId = 0;

  /** What is actually used: an input group that is switched off counts as empty. */
  readonly settings = computed<ReportSettings>(() => {
    const u = this.use(); const i = this.inputs();
    return {
      sections: this.sections(),
      includeProfit: this.includeProfit() && this.isAdmin(),
      inputs: {
        priceRange: u.price ? i.priceRange : '',
        stores: u.availability ? i.stores : null,
        availability: u.availability ? i.availability : [],
        decisions: u.decisions ? i.decisions : ['', '', ''],
      },
    };
  });
  readonly can = computed<Record<string, boolean>>(() => {
    const d = this.data(); const s = this.settings();
    return d ? availableSections(d, s.includeProfit, s.inputs) : {};
  });
  readonly productNames = computed(() => (this.data()?.sales?.rows ?? []).map((r) => r.name));
  /** The finished report. Every figure and text in it is escaped by renderReport, so it is safe to show as HTML. */
  readonly html = computed(() => {
    const d = this.data();
    return d ? this.sanitizer.bypassSecurityTrustHtml(renderReport(d, this.settings())) : '';
  });

  constructor() {
    effect(() => {
      this.brand();
      untracked(() => {
        this.months.set([]);
        this.sections.set({});
        this.inputs.set(emptyInputs());
        this.includeProfit.set(false);
        this.data.set(null);
      });
    });
    effect(() => {
      const brand = this.brand(); const months = this.months(); const profit = this.includeProfit() && this.isAdmin();
      untracked(() => void this.load(brand, months, profit));
    });
  }

  checked(event: Event) { return (event.target as HTMLInputElement).checked; }
  isOn(key: string) { return this.sections()[key] !== false; }
  setSection(key: string, on: boolean) { this.sections.update((s) => ({ ...s, [key]: on })); }
  setUse(group: InputGroup, on: boolean) { this.use.update((u) => ({ ...u, [group]: on })); }
  setZoom(event: Event) { this.zoom.set(Number((event.target as HTMLSelectElement).value)); }
  print() { window.print(); }

  toggleMonth(monthKey: string) {
    const current = this.data()?.selectedMonths ?? [];
    const next = current.includes(monthKey) ? current.filter((k) => k !== monthKey) : [...current, monthKey];
    if (next.length) this.months.set(next); // at least one month stays
  }

  setPrice(event: Event) { const priceRange = (event.target as HTMLInputElement).value; this.inputs.update((i) => ({ ...i, priceRange })); }
  setStores(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.inputs.update((i) => ({ ...i, stores: value === '' || Number(value) <= 0 ? null : Math.round(Number(value)) }));
  }
  addAvailability() { this.inputs.update((i) => ({ ...i, availability: [...i.availability, { name: '', current: null, target: null }] })); }
  removeAvailability(index: number) { this.inputs.update((i) => ({ ...i, availability: i.availability.filter((_, k) => k !== index) })); }
  setAvailability(index: number, field: 'name' | 'current' | 'target', event: Event) {
    const raw = (event.target as HTMLInputElement).value;
    this.inputs.update((i) => ({
      ...i,
      availability: i.availability.map((row, k) => {
        if (k !== index) return row;
        if (field === 'name') return { ...row, name: raw };
        const value = raw === '' ? null : Math.max(0, Math.min(100, Number(raw)));
        return { ...row, [field]: value };
      }),
    }));
  }
  setDecision(index: number, event: Event) {
    const text = (event.target as HTMLTextAreaElement).value;
    this.inputs.update((i) => ({ ...i, decisions: i.decisions.map((d, k) => (k === index ? text : d)) }));
  }

  private async load(brand: string, months: string[], includeProfit: boolean) {
    const id = ++this.requestId;
    this.error.set('');
    if (!brand) { this.loading.set(false); return; }
    this.loading.set(true);
    try {
      const result = await this.api.brandReport(brand, months, includeProfit);
      if (id === this.requestId) this.data.set(result);
    } catch (error) {
      if (id === this.requestId) this.error.set(error instanceof Error ? error.message : 'The request failed.');
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }
}
