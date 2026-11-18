import { NgTemplateOutlet } from '@angular/common';
import { Component, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { StrategyAction, StrategyInputs, StrategyPill, StrategyQuota, StrategyReportInfo, StrategyRow, StrategyScorecard, StrategySource, StrategyStatus } from '../core/models';
import { UiStateService } from '../core/ui-state.service';

const WORD: Record<StrategyStatus, string> = { g: 'OK', a: 'Watch', r: 'Fix', na: 'No data', n: '' };
// Which accordion row a health pill opens.
// Row ids now equal pill keys, so a pill opens its own row.

/**
 * Strategy for the brand picked in the sidebar. The colours and numbers come from the server's scorecard
 * (parser/strategyScorecard.js); the AI only writes the words (Generate). Layout: top bar, health strip,
 * top 3 actions, accordion of the base strategy, optional modules, inputs panel. Talking points is a second view.
 */
@Component({
  selector: 'app-strategy-page',
  template: `
    <header class="topbar">
      <div class="topbar-left"><div><h1>Strategy</h1><span class="muted">{{ brand() || 'Pick a brand' }}</span></div></div>
    </header>
    <div class="upload-status" [class.success]="statusType() === 'success'" [class.error]="statusType() === 'error'">{{ status() }}</div>

    @if (!brand()) {
      <section class="overview-empty"><h2>Choose a brand</h2><p class="muted">Strategy is written for one brand at a time. Pick a brand in the sidebar.</p></section>
    } @else if (data(); as d) {
      <section class="strat-bar">
        <select class="strat-select" aria-label="Product" [value]="product()" (change)="product.set($any($event.target).value)">
          <option value="">All products (hero)</option>
          @for (p of d.products; track p) { <option [value]="p">{{ p }}</option> }
        </select>
        <div class="sheet-tabs" role="tablist" aria-label="Data source">
          @for (s of sources; track s.id) {
            <button type="button" role="tab" class="sheet-tab" [class.active]="source() === s.id" [attr.aria-selected]="source() === s.id" (click)="source.set(s.id)">{{ s.label }}</button>
          }
        </div>
        <div class="sheet-tabs" role="tablist" aria-label="View">
          <button type="button" role="tab" class="sheet-tab" [class.active]="view() === 'report'" [attr.aria-selected]="view() === 'report'" (click)="view.set('report')">Report</button>
          <button type="button" role="tab" class="sheet-tab" [class.active]="view() === 'talking'" [attr.aria-selected]="view() === 'talking'" (click)="view.set('talking')">Talking points</button>
        </div>
        <button type="button" class="upload-btn" [disabled]="generating()" (click)="generate()">{{ generating() ? 'Writing…' : 'Generate' }}</button>
        @if (generating()) {
          <button type="button" class="secondary-btn" (click)="cancelGenerate()">Cancel</button>
        }
        @if (d.reports.length || d.hasDraft) {
          <select class="strat-select" aria-label="Saved report" [value]="d.selectedId" (change)="pickReport($any($event.target).value)">
            @if (d.hasDraft) { <option value="draft">Built-in draft (not saved)</option> }
            @for (r of d.reports; track r.id) { <option [value]="r.id">{{ reportLabel(r) }}</option> }
          </select>
          @if (!generating() && d.selectedId) {
            <button type="button" class="secondary-btn" (click)="deleteReport()">{{ d.selectedId === 'draft' ? 'Discard draft' : 'Delete this report' }}</button>
          }
        }
        <span class="muted strat-last">{{ d.last ? (d.last.builtin ? 'Built-in draft, not written by the AI' : 'Written: ' + lastLabel()) : 'No report yet' }}</span>
        @if (quota(); as q) {
          @if (q.available) { <span class="muted strat-last">Requests left today: <b>{{ q.remaining }}/{{ q.limit }}</b></span> }
        }
        <span class="muted strat-last">Hero: <b>{{ d.hero || '—' }}</b></span>
      </section>

      @if (view() === 'report') {
        <section class="strat-strip" aria-label="Health strip">
          @for (p of d.pills; track p.key) {
            <button type="button" class="strat-pill" [class]="'strat-pill strat-' + p.status" [attr.title]="p.note" (click)="openFor(p.key)">
              <i aria-hidden="true"></i><b>{{ p.name }}</b><span>{{ pillText(p) }}</span>
            </button>
          }
        </section>

        <section>
          <h2 class="strat-h">Do this first</h2>
          <div class="strat-actions">
            @for (a of d.actions; track a.area) {
              @if (showAction(a)) {
                <article class="strat-card" [style.cursor]="actionPage(a) ? 'pointer' : null" [attr.role]="actionPage(a) ? 'link' : null" [attr.tabindex]="actionPage(a) ? 0 : null" (click)="goAction(a)" (keydown.enter)="goAction(a)">
                  <h3>{{ a.title }}</h3>
                  <p><b>Why:</b> {{ a.why }}</p>
                  <p><b>Result:</b> {{ a.result }}</p>
                  @if (actionPage(a)) { <span class="muted">Open the problem →</span> }
                </article>
              }
            } @empty { <article class="strat-card"><h3>No urgent fixes</h3><p>Nothing is red or amber right now.</p></article> }
          </div>
        </section>

        <section class="strat-acc">
          @for (r of d.rows; track r.id) { <ng-container [ngTemplateOutlet]="rowTpl" [ngTemplateOutletContext]="{ r: r }" /> }
          @for (m of moduleRows(); track m.id) { <ng-container [ngTemplateOutlet]="rowTpl" [ngTemplateOutletContext]="{ r: m }" /> }
        </section>

        <section class="strat-foot">
          <div class="strat-pop-host">
            <button type="button" class="secondary-btn" [attr.aria-expanded]="menu() === 'modules'" (click)="toggleMenu('modules')">+ Add module</button>
            @if (menu() === 'modules') {
              <div class="feeder-menu" role="group" aria-label="Advanced modules">
                @for (m of moduleList(); track m.id) {
                  <label class="feeder-option"><input type="checkbox" [checked]="modulesOn().includes(m.id)" (change)="toggleModule(m.id)"><span>{{ m.name }}</span></label>
                }
              </div>
            }
          </div>
          <span class="strat-grow"></span>
          @if (d.missing.length) { <button type="button" class="strat-chip" (click)="inputsOpen.set(true)">{{ d.missing.length }} {{ d.missing.length === 1 ? 'input' : 'inputs' }} needed</button> }
          @else { <button type="button" class="secondary-btn" (click)="inputsOpen.set(true)">Inputs</button> }
          @if (auth.can('download')) { <button type="button" class="secondary-btn" (click)="download()">Download report</button> }
        </section>
        @if (d.assumptions.length) {
          <details class="strat-assume"><summary>Assumptions ({{ d.assumptions.length }})</summary><ul>@for (a of d.assumptions; track a) { <li>{{ a }}</li> }</ul></details>
        }
        @if (d.failedCount) {
          <details class="strat-assume">
            <summary>Failed attempts ({{ d.failedCount }})</summary>
            <ul>@for (f of d.failed; track f.at) { <li>{{ when(f.at) }} · {{ f.model || 'no model' }} · {{ f.reason }}@if (f.sample) { <br><span class="muted">{{ f.sample }}</span> }</li> }</ul>
          </details>
        }
      } @else {
        <section class="strat-card strat-talk">
          <div class="strat-talk-head"><h2>Talking points</h2><button type="button" class="secondary-btn" [disabled]="!d.talkingPoints.length" (click)="copyPoints()">Copy</button></div>
          @if (d.talkingPoints.length) { <ol>@for (t of d.talkingPoints; track $index) { <li>{{ t }}</li> }</ol> }
          @else { <p class="muted">Press Generate to write 8 to 12 points for the client meeting.</p> }
        </section>
      }

      @if (inputsOpen()) {
        <aside class="strat-side strat-pop-host" role="dialog" aria-label="Inputs needed">
          <div class="strat-side-head"><b>Inputs</b><button type="button" class="secondary-btn" aria-label="Close" (click)="inputsOpen.set(false)">×</button></div>
          <p class="muted">The reports do not contain these.</p>
          <label class="feeder-option"><input type="checkbox" [checked]="showCompliance()" (change)="showCompliance.set(!showCompliance())"><span>Show compliance (optional)</span></label>
          @if (showCompliance()) {
            <label>Compliance (optional)
              <select [value]="form().compliance || ''" (change)="setField('compliance', $any($event.target).value)">
                <option value="">Not checked</option><option value="confirmed">Confirmed by the brand</option><option value="doubt">Doubt or violation</option>
              </select>
            </label>
          }
          @for (f of fields; track f.key) {
            <label>{{ f.label }}
              <input [type]="f.type" [value]="form()[f.key] ?? ''" [placeholder]="autoText(f.key) || f.hint" (input)="setField(f.key, $any($event.target).value)">
            </label>
            @if (form()[f.key] !== undefined && auto()[f.key] !== undefined) { <button type="button" class="secondary-btn" (click)="setField(f.key, '')">Use upload value</button> }
          }
          <label>First image has text
            <select [value]="form().firstImageHasText === undefined ? '' : String(form().firstImageHasText)" (change)="setField('firstImageHasText', $any($event.target).value)">
              <option value="">Unknown</option><option value="false">No</option><option value="true">Yes</option>
            </select>
          </label>
          <button type="button" class="upload-btn" (click)="saveInputs()">Save</button>
        </aside>
      }
    } @else if (loading()) {
      <p class="muted">Loading…</p>
    }

    <ng-template #rowTpl let-r="r">
      <div class="strat-row" [id]="'strat-' + r.id">
        <button type="button" class="strat-row-btn" [attr.aria-expanded]="openId() === r.id" (click)="toggleRow(r.id)">
          <span class="strat-dot" [class]="'strat-dot strat-' + (r.status || 'n')"></span>
          <span class="strat-row-title">{{ r.title }}@if (r.value) { <b> · {{ r.value }}</b> }</span>
          <span class="strat-row-sum">{{ r.summary }}</span>
          <span class="muted">{{ openId() === r.id ? 'Close' : 'Open' }}</span>
        </button>
        @if (openId() === r.id) {
          <div class="strat-row-body">
            @if (r.rule) { <p class="muted"><b>Rule:</b> {{ r.rule }}</p> }
            @if (r.fix && r.status !== 'g') { <p><b>Fix:</b> {{ r.fix }}</p> }
            @if (r.points?.length) { <ul>@for (p of r.points; track p) { <li>{{ p }}</li> }</ul> }
            @else { <p class="muted">Press Generate to add the written advice.</p> }
            @if (r.link) { <span class="muted">{{ r.link }}</span> }
          </div>
        }
      </div>
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
})
export class StrategyPageComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly ui = inject(UiStateService);
  readonly auth = inject(AuthService);
  protected readonly String = String;

  readonly brand = computed(() => this.ui.focusedBrand());
  readonly data = signal<StrategyScorecard | null>(null);
  readonly loading = signal(false);
  readonly generating = signal(false);
  readonly status = signal('');
  readonly statusType = signal<'success' | 'error' | ''>('');
  readonly view = signal<'report' | 'talking'>('report');
  readonly source = signal<StrategySource>('dashboard');
  readonly product = signal('');
  readonly openId = signal<string | null>(null);
  readonly menu = signal<'modules' | null>(null);
  readonly modulesOn = signal<string[]>([]);
  readonly inputsOpen = signal(false);
  readonly showCompliance = signal(false);
  readonly form = signal<StrategyInputs>({});
  readonly auto = signal<StrategyInputs>({});
  readonly reportId = signal('');
  readonly quota = signal<StrategyQuota | null>(null);
  private lastBrand = '';
  private runId = 0; // bumps on Cancel/Clear/timeout so a late answer from an old run is ignored

  readonly sources: { id: StrategySource; label: string }[] = [
    { id: 'raw', label: 'Raw sheets' }, { id: 'dashboard', label: 'Dashboard' }, { id: 'both', label: 'Both' },
  ];
  readonly fields: { key: keyof StrategyInputs; label: string; type: string; hint: string }[] = [
    { key: 'title', label: 'Current title', type: 'text', hint: 'Paste the listing title' },
    { key: 'description', label: 'Description', type: 'text', hint: 'First line is enough' },
    { key: 'imageCount', label: 'Number of images', type: 'number', hint: '' },
    { key: 'mrp', label: 'MRP', type: 'number', hint: '' },
    { key: 'price', label: 'Selling price', type: 'number', hint: '' },
    { key: 'rating', label: 'Rating', type: 'number', hint: 'e.g. 4.2' },
    { key: 'reviewCount', label: 'Review count', type: 'number', hint: '' },
    { key: 'cities', label: 'Target cities', type: 'text', hint: 'Comma separated' },
    { key: 'adBudget', label: 'Monthly ad budget', type: 'number', hint: '' },
  ];

  readonly moduleList = computed(() => Object.entries(this.data()?.modules ?? {}).map(([id, name]) => ({ id, name })));
  readonly moduleRows = computed(() => {
    const d = this.data();
    if (!d) return [];
    const made = new Map(d.moduleRows.map((m) => [m.id, m]));
    return this.modulesOn().slice().sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((id) => {
      const m = made.get(id);
      return { id, title: d.modules[id] ?? id, status: 'n' as StrategyStatus, value: '', rule: '', fix: '', summary: m?.summary || 'Generate to fill this module', points: m?.points ?? [], link: '' };
    });
  });

  constructor() {
    effect(() => {
      const brand = this.brand();
      const product = this.product();
      untracked(() => {
        if (brand !== this.lastBrand) { this.lastBrand = brand; this.reportId.set(''); }
        void this.load(brand, product);
        void this.refreshQuota(brand);
      });
    });
  }

  word(s: StrategyStatus) { return WORD[s]; }
  pillText(p: StrategyPill) { return p.value ? p.value : this.word(p.status); }
  when(iso: string) { return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  reportLabel(r: StrategyReportInfo) { return this.when(r.at) + (r.product ? ' · ' + r.product : ' · all products'); }
  lastLabel() {
    const at = this.data()?.last?.at;
    return at ? new Date(at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  }

  private say(text: string, type: 'success' | 'error' | '' = '') { this.status.set(text); this.statusType.set(type); }

  async load(brand: string, product: string) {
    if (!brand) { this.data.set(null); return; }
    this.loading.set(true);
    try {
      const d = await this.api.strategyScorecard(brand, product, this.reportId());
      this.data.set(d);
      this.form.set({ ...d.inputs });
      this.auto.set(d.auto ?? {});
      this.reportId.set(d.selectedId);
      if (!this.modulesOn().length && d.last?.modules.length) this.modulesOn.set(d.last.modules);
      this.say('');
    } catch (err) {
      this.data.set(null);
      this.say(err instanceof Error ? err.message : 'Could not load the strategy.', 'error');
    } finally { this.loading.set(false); }
  }

  async generate() {
    const brand = this.brand();
    if (!brand || this.generating()) return;
    const id = ++this.runId;
    this.generating.set(true);
    this.say('Writing the strategy. This takes up to two minutes.');
    // Safety net: if nothing comes back, free the page so it never stays frozen.
    const guard = setTimeout(() => {
      if (id !== this.runId) return;
      this.runId++;
      this.generating.set(false);
      this.say('The AI took too long. Press Clear AI report, then Generate.', 'error');
    }, 150000);
    try {
      const res = await this.api.generateStrategy(brand, { product: this.product(), source: this.source(), modules: this.modulesOn() });
      if (id !== this.runId) return;
      this.reportId.set(res.saved && res.reportId ? res.reportId : 'draft');
      await this.load(brand, this.product());
      void this.refreshQuota(brand);
      if (!res.saved) this.say(res.note || 'The AI did not answer.', 'error');
      else this.say(res.note ? 'Saved as a new report. ' + res.note : 'Saved as a new report.', 'success');
    } catch (err) {
      if (id !== this.runId) return;
      this.say(err instanceof Error ? err.message : 'Could not write the strategy.', 'error');
    } finally {
      clearTimeout(guard);
      if (id === this.runId) this.generating.set(false);
    }
  }

  /** Stops waiting for a running Generate and tells the server to drop it. No confirmation, nothing is deleted but the run. */
  async cancelGenerate() {
    const brand = this.brand();
    this.runId++;
    this.generating.set(false);
    this.say('Cancelled.');
    if (!brand) return;
    try { await this.api.clearStrategy(brand); await this.load(brand, this.product()); } catch { /* the page is already free */ }
  }

  /** Deletes only the report being shown. Older saved reports and the failed log stay. */
  async deleteReport() {
    const brand = this.brand();
    const id = this.data()?.selectedId;
    if (!brand || !id || this.generating()) return;
    const text = id === 'draft' ? 'Discard the built-in draft?' : 'Delete this saved report for ' + brand + '? Your other reports and typed inputs stay. This cannot be undone.';
    if (!window.confirm(text)) return;
    try {
      await this.api.clearStrategy(brand, id);
      this.reportId.set('');
      await this.load(brand, this.product());
      this.say('Deleted.', 'success');
    } catch (err) {
      this.say(err instanceof Error ? err.message : 'Could not delete.', 'error');
    }
  }

  async pickReport(id: string) {
    this.reportId.set(id);
    await this.load(this.brand(), this.product());
  }

  /** Free requests left today. Hidden when the server cannot read it. */
  async refreshQuota(brand: string) {
    if (!brand) return;
    try { this.quota.set(await this.api.strategyQuota(brand)); } catch { this.quota.set(null); }
  }

  /** The upload's value for a field, shown as the placeholder. Empty when there is none. */
  autoText(key: string): string {
    const v = (this.auto() as Record<string, unknown>)[key];
    return v === undefined || v === null || v === '' ? '' : 'Upload: ' + v;
  }

  setField(key: keyof StrategyInputs | 'compliance' | 'firstImageHasText', value: string) {
    const next: Record<string, unknown> = { ...this.form() };
    if (value === '') delete next[key];
    else if (key === 'firstImageHasText') next[key] = value === 'true';
    else if (['imageCount', 'mrp', 'price', 'rating', 'reviewCount', 'adBudget'].includes(key)) next[key] = Number(value);
    else next[key] = value;
    this.form.set(next as StrategyInputs);
  }

  async saveInputs() {
    const brand = this.brand();
    if (!brand) return;
    try {
      await this.api.saveStrategyInputs(brand, this.form());
      this.inputsOpen.set(false);
      await this.load(brand, this.product());
      this.say('Inputs saved.', 'success');
    } catch (err) { this.say(err instanceof Error ? err.message : 'Could not save.', 'error'); }
  }

  toggleRow(id: string) { this.openId.set(this.openId() === id ? null : id); }

  /** Where each "Do this first" card leads. Listing opens the Inputs panel (its fields are the problem). */
  private readonly ACTION_PAGE: Record<string, string> = {
    stock: '/inventory', ads: '/campaign-analysis', margin: '/profit', listing: 'inputs',
  };

  actionPage(a: StrategyAction): string {
    return this.ACTION_PAGE[a.area] ?? '';
  }

  /** Profit is hidden while presenting (its page is blocked then) and for accounts without the profit permission. */
  showAction(a: StrategyAction): boolean {
    const page = this.actionPage(a);
    if (page === '/profit') return this.auth.can('profit') && !this.ui.presenting();
    return true;
  }

  goAction(a: StrategyAction) {
    const target = this.actionPage(a);
    if (!target) return;
    if (target === 'inputs') { this.inputsOpen.set(true); return; }
    const hero = this.data()?.hero;
    if (hero) this.ui.setFocus(hero); // Stock and Advertising open on the hero product
    void this.router.navigateByUrl(target);
  }

  openFor(pillKey: string) {
    const id = pillKey;
    this.openId.set(id);
    setTimeout(() => document.getElementById('strat-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }
  toggleMenu(m: 'modules') { this.menu.set(this.menu() === m ? null : m); }
  toggleModule(id: string) {
    const on = this.modulesOn();
    this.modulesOn.set(on.includes(id) ? on.filter((x) => x !== id) : [...on, id]);
  }

  copyPoints() {
    const list = (this.data()?.talkingPoints ?? []).map((t, i) => (i + 1) + '. ' + t).join('\n');
    void navigator.clipboard.writeText(list).then(() => this.say('Copied.', 'success'));
  }

  download() {
    const d = this.data();
    if (!d) return;
    const rows: StrategyRow[] = [...d.rows, ...this.moduleRows() as StrategyRow[]];
    const md = [
      '# Strategy: ' + d.brand, '',
      '## Health', ...d.pills.map((p) => '- ' + p.name + ' (' + WORD[p.status] + (p.value ? ', ' + p.value : '') + '): ' + p.note), '',
      '## Do this first', ...d.actions.map((a) => '- **' + a.title + '**. Why: ' + a.why + ' Result: ' + a.result), '',
      ...rows.flatMap((r) => ['## ' + r.title + (r.value ? ' (' + r.value + ')' : ''), r.summary, ...(r.rule ? ['Rule: ' + r.rule] : []), ...(r.fix && r.status !== 'g' ? ['Fix: ' + r.fix] : []), ...r.points.map((p) => '- ' + p), '']),
      ...(d.talkingPoints.length ? ['## Talking points', ...d.talkingPoints.map((t, i) => (i + 1) + '. ' + t), ''] : []),
      ...(d.assumptions.length ? ['## Assumptions', ...d.assumptions.map((a) => '- ' + a)] : []),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url; a.download = d.brand.replace(/\W+/g, '-') + '-strategy.md'; a.click();
    URL.revokeObjectURL(url);
  }

  // Menus never stick: one click outside, Esc, a scroll or a resize closes them (house rule, see AGENTS.md).
  @HostListener('document:click', ['$event'])
  onDocClick(e: Event) {
    if (this.menu() && !(e.target as HTMLElement).closest('.strat-pop-host')) this.menu.set(null);
  }
  @HostListener('document:keydown.escape')
  @HostListener('window:resize')
  @HostListener('window:scroll')
  closeMenus() { this.menu.set(null); }
}
