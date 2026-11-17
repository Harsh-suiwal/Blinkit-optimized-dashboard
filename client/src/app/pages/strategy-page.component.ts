import { NgTemplateOutlet } from '@angular/common';
import { Component, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { StrategyInputs, StrategyRow, StrategyScorecard, StrategySource, StrategyStatus } from '../core/models';
import { UiStateService } from '../core/ui-state.service';

const WORD: Record<StrategyStatus, string> = { g: 'OK', a: 'Watch', r: 'Fix', na: 'No data', n: '' };
// Which accordion row a health pill opens.
const PILL_ROW: Record<string, string> = { compliance: 'plan', stock: 'stock', listing: 'page', hero: 'hero', ads: 'kw', organic: 'kw', trend: 'hero', margin: 'profit' };

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
        <span class="muted strat-last">{{ d.last ? 'Last generated: ' + lastLabel() : 'Not generated yet' }}</span>
      </section>

      @if (view() === 'report') {
        <section class="strat-strip" aria-label="Health strip">
          @for (p of d.pills; track p.key) {
            <button type="button" class="strat-pill" [class]="'strat-pill strat-' + p.status" [attr.title]="p.note" (click)="openFor(p.key)">
              <i aria-hidden="true"></i><b>{{ p.name }}</b><span>{{ word(p.status) }}</span>
            </button>
          }
        </section>

        <section>
          <h2 class="strat-h">Do this first</h2>
          <div class="strat-actions">
            @for (a of d.actions; track a.area) {
              <article class="strat-card">
                <h3>{{ a.title }}</h3>
                <p><b>Why:</b> {{ a.why }}</p>
                <p><b>Result:</b> {{ a.result }}</p>
              </article>
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
          <label>Compliance
            <select [value]="form().compliance || ''" (change)="setField('compliance', $any($event.target).value)">
              <option value="">Not checked</option><option value="confirmed">Confirmed by the brand</option><option value="doubt">Doubt or violation</option>
            </select>
          </label>
          @for (f of fields; track f.key) {
            <label>{{ f.label }}<input [type]="f.type" [value]="form()[f.key] ?? ''" [placeholder]="f.hint" (input)="setField(f.key, $any($event.target).value)"></label>
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
          <span class="strat-row-title">{{ r.title }}</span>
          <span class="strat-row-sum">{{ r.summary }}</span>
          <span class="muted">{{ openId() === r.id ? 'Close' : 'Open' }}</span>
        </button>
        @if (openId() === r.id) {
          <div class="strat-row-body">
            @if (r.points?.length) { <ul>@for (p of r.points; track p) { <li>{{ p }}</li> }</ul> }
            @else { <p class="muted">Press Generate to fill this section.</p> }
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
  readonly form = signal<StrategyInputs>({});

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
    { key: 'specs', label: 'Product specs', type: 'text', hint: 'e.g. blade length and width' },
  ];

  readonly moduleList = computed(() => Object.entries(this.data()?.modules ?? {}).map(([id, name]) => ({ id, name })));
  readonly moduleRows = computed(() => {
    const d = this.data();
    if (!d) return [];
    const made = new Map(d.moduleRows.map((m) => [m.id, m]));
    return this.modulesOn().slice().sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((id) => {
      const m = made.get(id);
      return { id, title: d.modules[id] ?? id, status: 'n' as StrategyStatus, summary: m?.summary || 'Generate to fill this module', points: m?.points ?? [], link: '' };
    });
  });

  constructor() {
    effect(() => {
      const brand = this.brand();
      const product = this.product();
      untracked(() => void this.load(brand, product));
    });
  }

  word(s: StrategyStatus) { return WORD[s]; }
  lastLabel() {
    const at = this.data()?.last?.at;
    return at ? new Date(at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  }

  private say(text: string, type: 'success' | 'error' | '' = '') { this.status.set(text); this.statusType.set(type); }

  async load(brand: string, product: string) {
    if (!brand) { this.data.set(null); return; }
    this.loading.set(true);
    try {
      const d = await this.api.strategyScorecard(brand, product);
      this.data.set(d);
      this.form.set({ ...d.inputs });
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
    this.generating.set(true);
    this.say('Writing the strategy. This takes up to a minute.');
    try {
      const res = await this.api.generateStrategy(brand, { product: this.product(), source: this.source(), modules: this.modulesOn() });
      await this.load(brand, this.product());
      if (res.note) this.say(res.note, 'error'); else this.say('Strategy written.', 'success');
    } catch (err) {
      this.say(err instanceof Error ? err.message : 'Could not write the strategy.', 'error');
    } finally { this.generating.set(false); }
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
  openFor(pillKey: string) {
    const id = PILL_ROW[pillKey];
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
      '## Health', ...d.pills.map((p) => '- ' + p.name + ': ' + WORD[p.status] + '. ' + p.note), '',
      '## Do this first', ...d.actions.map((a) => '- **' + a.title + '**. Why: ' + a.why + ' Result: ' + a.result), '',
      ...rows.flatMap((r) => ['## ' + r.title, r.summary, ...r.points.map((p) => '- ' + p), '']),
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
