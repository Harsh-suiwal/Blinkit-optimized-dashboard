import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { StrategyAction, StrategyInputs, StrategyPill, StrategyQuota, StrategyReportInfo, StrategyScorecard, StrategySource, StrategyStatus } from '../core/models';
import { UiStateService } from '../core/ui-state.service';

const WORD: Record<StrategyStatus, string> = { g: 'OK', a: 'Watch', r: 'Fix', na: 'No data', n: '' };
// Which base-plan pillar a health pill belongs to (clicking a pill opens that pillar).
const PILL_PILLAR: Record<string, string> = { stock: 'p3', listing: 'p2', hero: 'p4', ads: 'p5', organic: 'p5', margin: 'p8', trend: 'p9' };

/**
 * Strategy for the brand picked in the sidebar. Top to bottom: where you stand (health pills, computed by
 * parser/strategyScorecard.js), do this first, the 6-month plan with gates, the base checklist, optional add-ons,
 * talking points, and a collapsed optional AI box. The base plan is hand-written in strategy/basePlan.js and the
 * ticks are saved per brand. The AI only adds brand-specific words and never changes colours, numbers or the plan.
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
        <span class="muted strat-last">Hero: <b>{{ d.hero || '—' }}</b></span>
        <span class="strat-grow"></span>
        @if (d.missing.length) { <button type="button" class="strat-chip" (click)="inputsOpen.set(true)">{{ d.missing.length }} {{ d.missing.length === 1 ? 'input' : 'inputs' }} needed</button> }
        @else { <button type="button" class="secondary-btn" (click)="inputsOpen.set(true)">Inputs</button> }
        @if (auth.can('download')) { <button type="button" class="secondary-btn" (click)="download()">Download report</button> }
      </section>

      <h2 class="strat-h">Where you stand</h2>
      <section class="strat-strip" aria-label="Health strip">
        @for (p of d.pills; track p.key) {
          <button type="button" class="strat-pill" [class]="'strat-pill strat-' + p.status" [attr.title]="p.note" (click)="openFor(p.key)">
            <i aria-hidden="true"></i><b>{{ p.name }}</b><span>{{ pillText(p) }}</span>
          </button>
        }
      </section>

      <h2 class="strat-h">Do this first</h2>
      <section class="strat-actions">
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
      </section>

      <h2 class="strat-h">6-month plan <span class="muted">· {{ planLine() }}</span></h2>
      <section class="strat-months">
        @for (m of d.plan.months; track m.id; let i = $index) {
          <article class="strat-month" [class.current]="i === currentMonth()" [class.done]="ticks()['g.' + m.id]" [class.later]="i > currentMonth()">
            <h3>{{ m.id }} · {{ m.title }}</h3>
            <p class="muted">{{ m.focus }}</p>
            <ul>@for (a of m.actions; track a) { <li>{{ a }}</li> }</ul>
            <label class="strat-check strat-gate"><input type="checkbox" [checked]="!!ticks()['g.' + m.id]" (change)="toggleTick('g.' + m.id)"><span><b>Gate:</b> {{ m.gate }}</span></label>
          </article>
        }
      </section>
      <p class="muted strat-note">Do not start the next month until the gate is ticked.</p>

      <h2 class="strat-h">Base checklist <span class="muted">· {{ doneCount() }} of {{ totalCount() }} done</span></h2>
      <section class="strat-acc">
        @for (p of d.plan.pillars; track p.id) {
          <div class="strat-row" [id]="'strat-' + p.id">
            <button type="button" class="strat-row-btn" [attr.aria-expanded]="openId() === p.id" (click)="toggleRow(p.id)">
              <span class="strat-dot" [class]="'strat-dot strat-' + (p.status || 'n')"></span>
              <span class="strat-row-title">{{ p.title }}</span>
              <span class="strat-row-sum">{{ pillarDone(p.id, p.musts.length) }} of {{ p.musts.length }} done · {{ p.why }}</span>
              <span class="muted">{{ openId() === p.id ? 'Close' : 'Open' }}</span>
            </button>
            @if (openId() === p.id) {
              <div class="strat-row-body">
                @if (p.facts.length) { <ul class="strat-facts">@for (f of p.facts; track f) { <li>{{ f }}</li> }</ul> }
                @for (pl of pillsOf(p.id); track pl.key) {
                  @if (pl.rule) { <p class="muted"><b>Rule:</b> {{ pl.rule }}</p> }
                  @if (pl.fix && pl.status !== 'g') { <p><b>Fix:</b> {{ pl.fix }}</p> }
                }
                @for (m of p.musts; track $index) {
                  <label class="strat-check"><input type="checkbox" [checked]="!!ticks()[p.id + '.' + ($index + 1)]" (change)="toggleTick(p.id + '.' + ($index + 1))"><span>{{ m }}</span></label>
                }
                @if (p.stop) { <p class="strat-stop"><b>Stop:</b> {{ p.stop }}</p> }
              </div>
            }
          </div>
        }
      </section>

      <h2 class="strat-h">Optional add-ons</h2>
      <p class="muted strat-note">Switch these on only when the base is ready. The app checks what it can; the rest is your call.</p>
      <section class="strat-mods">
        @for (m of d.plan.modules; track m.id) {
          <article class="strat-card">
            <h3>{{ m.id }} · {{ m.name }} <span class="strat-badge" [class.ok]="m.ready === true" [class.no]="m.ready === false">{{ m.ready === true ? 'Ready' : m.ready === false ? 'Not yet' : 'Check yourself' }}</span></h3>
            <p><b>Use when:</b> {{ m.use }}</p>
            <ul class="strat-needs">@for (n of m.needs; track n.text) { <li>{{ n.ok === true ? '✓' : n.ok === false ? '✗' : '?' }} {{ n.text }}</li> }</ul>
          </article>
        }
      </section>

      <section class="strat-card strat-talk">
        <div class="strat-talk-head"><h2>Talking points</h2><button type="button" class="secondary-btn" [disabled]="!d.talkingPoints.length" (click)="copyPoints()">Copy</button></div>
        <p class="muted">{{ d.talkingBuiltin ? 'Built from your numbers and the base plan.' : 'Written by the AI from your last report.' }}</p>
        @if (d.talkingPoints.length) { <ol>@for (t of d.talkingPoints; track $index) { <li>{{ t }}</li> }</ol> }
      </section>

      <details class="strat-assume strat-ai">
        <summary>AI assistant (optional)</summary>
        <p class="muted">Adds brand-specific wording only. The plan, colours and numbers above never change. Free models can be wrong, so read it before you use it.</p>
        <div class="strat-bar">
          <div class="sheet-tabs" role="tablist" aria-label="Data source">
            @for (s of sources; track s.id) {
              <button type="button" role="tab" class="sheet-tab" [class.active]="source() === s.id" [attr.aria-selected]="source() === s.id" (click)="source.set(s.id)">{{ s.label }}</button>
            }
          </div>
          <button type="button" class="upload-btn" [disabled]="generating()" (click)="generate()">{{ generating() ? 'Writing…' : 'Generate' }}</button>
          @if (generating()) { <button type="button" class="secondary-btn" (click)="cancelGenerate()">Cancel</button> }
          @if (quota(); as q) { @if (q.available) { <span class="muted strat-last">Requests left today: <b>{{ q.remaining }}/{{ q.limit }}</b></span> } }
        </div>
        <div class="strat-bar">
          @for (m of moduleList(); track m.id) {
            <label class="feeder-option"><input type="checkbox" [checked]="modulesOn().includes(m.id)" (change)="toggleModule(m.id)"><span>{{ m.id }}</span></label>
          }
        </div>
        @if (d.reports.length || d.hasDraft) {
          <div class="strat-bar">
            <select class="strat-select" aria-label="Saved report" [value]="d.selectedId" (change)="pickReport($any($event.target).value)">
              @if (d.hasDraft) { <option value="draft">Built-in draft (not saved)</option> }
              @for (r of d.reports; track r.id) { <option [value]="r.id">{{ reportLabel(r) }}</option> }
            </select>
            @if (!generating() && d.selectedId) {
              <button type="button" class="secondary-btn" (click)="deleteReport()">{{ d.selectedId === 'draft' ? 'Discard draft' : 'Delete this report' }}</button>
            }
            <span class="muted strat-last">{{ d.last ? (d.last.builtin ? 'Built-in draft, not written by the AI' : 'Written: ' + lastLabel()) : '' }}</span>
          </div>
        }
        @for (n of aiNotes(); track n.id) {
          <h3 class="strat-h">{{ n.title }}</h3>
          <p class="muted">{{ n.summary }}</p>
          <ul>@for (pt of n.points; track pt) { <li>{{ pt }}</li> }</ul>
        }
        @if (d.assumptions.length) {
          <h3 class="strat-h">Assumptions ({{ d.assumptions.length }})</h3>
          <ul>@for (a of d.assumptions; track a) { <li>{{ a }}</li> }</ul>
        }
        @if (d.failedCount) {
          <h3 class="strat-h">Failed attempts ({{ d.failedCount }})</h3>
          <ul>@for (f of d.failed; track f.at) { <li>{{ when(f.at) }} · {{ f.model || 'no model' }} · {{ f.reason }}@if (f.sample) { <br><span class="muted">{{ f.sample }}</span> }</li> }</ul>
        }
      </details>

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
  `,
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
  readonly ticks = signal<Record<string, boolean>>({});
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
  /** AI-written notes for the AI box: only rows and add-ons that have points. */
  readonly aiNotes = computed(() => {
    const d = this.data();
    if (!d) return [];
    const rows = d.rows.filter((r) => r.points.length).map((r) => ({ id: r.id, title: r.title, summary: r.summary, points: r.points }));
    const mods = d.moduleRows.filter((m) => m.points.length).map((m) => ({ id: m.id, title: m.id + ' · ' + (d.modules[m.id] ?? m.title), summary: m.summary, points: m.points }));
    return [...rows, ...mods];
  });
  readonly totalCount = computed(() => (this.data()?.plan.pillars ?? []).reduce((n, p) => n + p.musts.length, 0));
  readonly doneCount = computed(() => {
    const t = this.ticks();
    return (this.data()?.plan.pillars ?? []).reduce((n, p) => n + p.musts.filter((_, i) => t[p.id + '.' + (i + 1)]).length, 0);
  });
  /** First month whose gate is not ticked yet; 6 when all gates are done. */
  readonly currentMonth = computed(() => {
    const months = this.data()?.plan.months ?? [];
    const t = this.ticks();
    const i = months.findIndex((m) => !t['g.' + m.id]);
    return i < 0 ? months.length : i;
  });
  readonly planLine = computed(() => {
    const months = this.data()?.plan.months ?? [];
    const cur = this.currentMonth();
    return cur >= months.length ? 'all 6 gates passed' : 'now in ' + months[cur].id + ' ' + months[cur].title + ', ' + cur + ' of ' + months.length + ' gates passed';
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
      this.ticks.set({ ...d.ticks });
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
    const before = this.quota()?.remaining; // the count before this run, to see when it changes
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
      if (!res.saved) this.say(res.note || 'The AI did not answer.', 'error');
      else this.say(res.note ? 'Saved as a new report. ' + res.note : 'Saved as a new report.', 'success');
    } catch (err) {
      if (id !== this.runId) return;
      this.say(err instanceof Error ? err.message : 'Could not write the strategy.', 'error');
    } finally {
      clearTimeout(guard);
      void this.refreshQuotaAfterGenerate(brand, before);
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
    /** After a Generate the count can lag on OpenRouter's side: ask every 5 seconds (up to 1 minute) until it changes. */
  private async refreshQuotaAfterGenerate(brand: string, before?: number) {
    for (let i = 0; i < 12; i++) {
      await this.refreshQuota(brand);
      const now = this.quota()?.remaining;
      if (before === undefined || now === undefined || now !== before) return;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
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
    const id = PILL_PILLAR[pillKey];
    if (!id) return;
    this.openId.set(id);
    setTimeout(() => document.getElementById('strat-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  pillsOf(pillarId: string): StrategyPill[] { return (this.data()?.pills ?? []).filter((p) => PILL_PILLAR[p.key] === pillarId); }
  pillarDone(pillarId: string, total: number): number {
    const t = this.ticks();
    let n = 0;
    for (let i = 1; i <= total; i++) if (t[pillarId + '.' + i]) n++;
    return n;
  }

  /** Ticks save per brand. The screen changes at once; a failed save puts it back and says so. */
  async toggleTick(id: string) {
    const brand = this.brand();
    if (!brand) return;
    const before = this.ticks();
    const next = { ...before };
    if (next[id]) delete next[id]; else next[id] = true;
    this.ticks.set(next);
    try { await this.api.saveStrategyTicks(brand, next); }
    catch (err) { this.ticks.set(before); this.say(err instanceof Error ? err.message : 'Could not save the tick.', 'error'); }
  }

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
    const t = this.ticks();
    const box = (on: boolean) => (on ? '[x] ' : '[ ] ');
    const md = [
      '# Strategy: ' + d.brand, '',
      '## Where you stand', ...d.pills.map((p) => '- ' + p.name + ' (' + WORD[p.status] + (p.value ? ', ' + p.value : '') + '): ' + p.note), '',
      '## Do this first', ...d.actions.map((a) => '- **' + a.title + '**. Why: ' + a.why + ' Result: ' + a.result), '',
      '## 6-month plan (' + this.planLine() + ')',
      ...d.plan.months.flatMap((m) => ['### ' + m.id + ' ' + m.title + ' (' + m.focus + ')', ...m.actions.map((a) => '- ' + a), box(!!t['g.' + m.id]) + 'Gate: ' + m.gate, '']),
      '## Base checklist (' + this.doneCount() + ' of ' + this.totalCount() + ' done)',
      ...d.plan.pillars.flatMap((p) => ['### ' + p.title, p.why, ...p.facts.map((f) => '- ' + f), ...p.musts.map((m, i) => box(!!t[p.id + '.' + (i + 1)]) + m), ...(p.stop ? ['Stop: ' + p.stop] : []), '']),
      '## Optional add-ons', ...d.plan.modules.map((m) => '- ' + m.id + ' ' + m.name + ': ' + (m.ready === true ? 'ready' : m.ready === false ? 'not yet' : 'check yourself')), '',
      ...(d.talkingPoints.length ? ['## Talking points', ...d.talkingPoints.map((x, i) => (i + 1) + '. ' + x), ''] : []),
      ...this.aiNotes().flatMap((n) => ['## AI note: ' + n.title, n.summary, ...n.points.map((x) => '- ' + x), '']),
      ...(d.assumptions.length ? ['## Assumptions', ...d.assumptions.map((a) => '- ' + a)] : []),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url; a.download = d.brand.replace(/\W+/g, '-') + '-strategy.md'; a.click();
    URL.revokeObjectURL(url);
  }
}
