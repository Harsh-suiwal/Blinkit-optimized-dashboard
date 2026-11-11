import { BrandReport, ReportAdsMonth, ReportKeyword } from './models';

/** Optional facts the app cannot know. Every one can be left empty: its slide or tile then simply does not appear. */
export interface ReportInputs {
  priceRange: string;
  stores: number | null;
  availability: { name: string; current: number | null; target: number | null }[];
  decisions: string[];
}

export interface ReportSettings {
  sections: Record<string, boolean>;
  includeProfit: boolean;
  inputs: ReportInputs;
}

export const REPORT_SECTIONS: { key: string; label: string }[] = [
  { key: 'summary', label: 'Executive summary' },
  { key: 'scope', label: 'Business overview and data scope' },
  { key: 'trajectory', label: 'Sales trajectory' },
  { key: 'products', label: 'Product-wise sales' },
  { key: 'concentration', label: 'Portfolio concentration' },
  { key: 'stock', label: 'Stock position' },
  { key: 'availability', label: 'Availability vs target (from your inputs)' },
  { key: 'ads', label: 'Advertising, month by month' },
  { key: 'campaigns', label: 'Campaign analysis' },
  { key: 'efficiency', label: 'Advertising efficiency, month vs month' },
  { key: 'weekday', label: 'Weekday performance' },
  { key: 'funnel', label: 'Conversion funnel' },
  { key: 'keywords', label: 'Keyword decisions' },
  { key: 'economics', label: 'Break-even ROAS' },
  { key: 'profit', label: 'Profit and ROI (needs "Include profit and cost figures")' },
  { key: 'decisions', label: 'Management decisions' },
  { key: 'appendix', label: 'Definitions and data notes' },
];

export function emptyInputs(): ReportInputs {
  return { priceRange: '', stores: null, availability: [], decisions: ['', '', ''] };
}

/** True when at least one availability line has both a current and a target figure. */
export function hasAvailability(inputs: ReportInputs): boolean {
  return inputs.availability.some((x) => x.name.trim() !== '' && x.current !== null && x.target !== null);
}

/** Which sections the data (and the optional inputs) can fill. The profit one only when profit is wanted and available. */
export function availableSections(data: BrandReport, includeProfit: boolean, inputs: ReportInputs): Record<string, boolean> {
  const a = data.available;
  return {
    summary: a.sales || a.ads, scope: a.sales || a.ads, trajectory: a.trajectory, products: a.sales, concentration: a.concentration,
    stock: a.stock, availability: hasAvailability(inputs), ads: a.ads, campaigns: a.ads, efficiency: a.efficiency, weekday: a.weekday, funnel: a.funnel,
    keywords: a.keywords, economics: a.ads, profit: includeProfit && a.profit, decisions: a.sales || a.ads, appendix: a.sales || a.ads,
  };
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------
const NAVY = '#17375E'; const BLUE = '#1F4E79'; const TEAL = '#0F6B78'; const AMBER = '#B87820'; const RED = '#B14040';
const GREEN = '#2E7D5B'; const SLATE = '#6B7688'; const GRID = '#E3E7EE';

const esc = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const inr = (n: number | null | undefined, digits = 0): string =>
  n === null || n === undefined ? 'n/a' : `${n < 0 ? '-' : ''}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const num = (n: number | null | undefined, digits = 0): string =>
  n === null || n === undefined ? 'n/a' : n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const roasText = (n: number | null | undefined): string => (n === null || n === undefined ? 'n/a' : `${n.toFixed(2)}x`);
const signed = (n: number | null | undefined, digits = 1): string => (n === null || n === undefined ? 'n/a' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}%`);
const short = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const monthWord = (label: string): string => label.split(' ')[0];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayText = (iso: string): string => `${Number(iso.slice(8, 10))} ${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const longDate = (iso: string): string => `${Number(iso.slice(8, 10))} ${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const rangeText = (from: string, to: string): string => (from.slice(0, 7) === to.slice(0, 7)
  ? `${Number(from.slice(8, 10))}–${dayText(to)}` : `${dayText(from)} – ${dayText(to)}`);

/** Axis for values up to `value`: round tick steps (1, 2, 2.5, 5 times a power of ten), at most 6 steps, a little headroom. */
function scaleFor(value: number, maxSteps = 5): { max: number; n: number } {
  const target = value > 0 ? value * 1.06 : 1;
  const exp = 10 ** Math.floor(Math.log10(target));
  const steps = [1, 2, 2.5, 5, 10].flatMap((m) => [(m * exp) / 10, m * exp]).sort((a, b) => a - b);
  const step = steps.find((s) => Math.ceil(target / s) <= maxSteps) ?? exp * 10;
  const n = Math.ceil(target / step);
  return { max: n * step, n };
}

// ---------------------------------------------------------------------------------------------
// Chart pieces (inline SVG, no library)
// ---------------------------------------------------------------------------------------------
interface Bar { label: string; value: number; color: string; text?: string; hatched?: boolean; }

function vBars(items: Bar[], width: number, height: number, fmt: (n: number) => string, yMax?: number, steps = 5): string {
  const padL = 62; const padR = 12; const padT = 28; const padB = 38;
  const sc = yMax !== undefined ? { max: yMax, n: steps } : scaleFor(Math.max(...items.map((i) => i.value), 0));
  const max = sc.max;
  const plotW = width - padL - padR; const plotH = height - padT - padB;
  const slot = plotW / Math.max(items.length, 1);
  const barW = Math.min(slot * 0.62, 150);
  let svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">`;
  svg += `<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="${AMBER}"/><rect width="4" height="8" fill="#D9A04A"/></pattern></defs>`;
  for (let i = 0; i <= sc.n; i += 1) {
    const v = (max / sc.n) * i; const y = padT + plotH - (v / max) * plotH;
    svg += `<line x1="${padL}" x2="${width - padR}" y1="${y}" y2="${y}" stroke="${GRID}"/>`;
    svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="13" fill="${SLATE}">${esc(fmt(v))}</text>`;
  }
  items.forEach((item, i) => {
    const h = Math.max((item.value / max) * plotH, item.value > 0 ? 2 : 0);
    const x = padL + slot * i + (slot - barW) / 2; const y = padT + plotH - h;
    svg += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${item.hatched ? 'url(#hatch)' : item.color}"/>`;
    svg += `<text x="${x + barW / 2}" y="${y - 8}" text-anchor="middle" font-size="16" fill="#111">${esc(item.text ?? fmt(item.value))}</text>`;
    svg += `<text x="${x + barW / 2}" y="${height - 12}" text-anchor="middle" font-size="14" fill="#222">${esc(item.label)}</text>`;
  });
  svg += `<line x1="${padL}" x2="${width - padR}" y1="${padT + plotH}" y2="${padT + plotH}" stroke="#9AA3B2"/></svg>`;
  return svg;
}

interface Group { label: string; values: { value: number; color: string; text?: string }[]; }

/** Vertical clustered bars (for example spend and attributed sales per campaign). */
function vGroups(groups: Group[], width: number, height: number, fmt: (n: number) => string, legend: { label: string; color: string }[]): string {
  const padL = 62; const padR = 12; const padT = 28; const padB = 56;
  const sc = scaleFor(Math.max(...groups.flatMap((g) => g.values.map((v) => v.value)), 0)); const max = sc.max;
  const plotW = width - padL - padR; const plotH = height - padT - padB;
  const slot = plotW / Math.max(groups.length, 1);
  const k = Math.max(...groups.map((g) => g.values.length), 1);
  const barW = Math.min((slot * 0.78) / k, 60);
  let svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">`;
  for (let i = 0; i <= sc.n; i += 1) {
    const v = (max / sc.n) * i; const y = padT + plotH - (v / max) * plotH;
    svg += `<line x1="${padL}" x2="${width - padR}" y1="${y}" y2="${y}" stroke="${GRID}"/>`;
    svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="13" fill="${SLATE}">${esc(fmt(v))}</text>`;
  }
  groups.forEach((g, gi) => {
    const start = padL + slot * gi + (slot - barW * g.values.length) / 2;
    g.values.forEach((v, vi) => {
      const h = Math.max((v.value / max) * plotH, v.value > 0 ? 2 : 0); const x = start + barW * vi; const y = padT + plotH - h;
      svg += `<rect x="${x}" y="${y}" width="${barW - 2}" height="${h}" fill="${v.color}"/>`;
      svg += `<text x="${x + (barW - 2) / 2}" y="${y - 6}" text-anchor="middle" font-size="12" fill="#111">${esc(v.text ?? fmt(v.value))}</text>`;
    });
    svg += `<text x="${padL + slot * gi + slot / 2}" y="${padT + plotH + 20}" text-anchor="middle" font-size="13" fill="#222">${esc(g.label)}</text>`;
  });
  svg += `<line x1="${padL}" x2="${width - padR}" y1="${padT + plotH}" y2="${padT + plotH}" stroke="#9AA3B2"/>`;
  legend.forEach((l, i) => {
    const x = width / 2 - (legend.length * 150) / 2 + i * 150;
    svg += `<rect x="${x}" y="${height - 16}" width="12" height="12" fill="${l.color}"/><text x="${x + 18}" y="${height - 5}" font-size="14" fill="#222">${esc(l.label)}</text>`;
  });
  return `${svg}</svg>`;
}

/** Horizontal clustered bars with the group label on the left. */
function hGroups(groups: Group[], width: number, height: number, fmt: (n: number) => string, legend: { label: string; color: string }[], labelW = 130): string {
  const padR = 48; const padT = 8; const padB = 62;
  const sc = scaleFor(Math.max(...groups.flatMap((g) => g.values.map((v) => v.value)), 0)); const max = sc.max;
  const plotW = width - labelW - padR; const plotH = height - padT - padB;
  const slot = plotH / Math.max(groups.length, 1);
  const k = Math.max(...groups.map((g) => g.values.length), 1);
  const barH = Math.min((slot * 0.8) / k, 34);
  let svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">`;
  for (let i = 0; i <= sc.n; i += 1) {
    const v = (max / sc.n) * i; const x = labelW + (v / max) * plotW;
    svg += `<line x1="${x}" x2="${x}" y1="${padT}" y2="${padT + plotH}" stroke="${GRID}"/>`;
    svg += `<text x="${x}" y="${padT + plotH + 18}" text-anchor="middle" font-size="13" fill="${SLATE}">${esc(fmt(v))}</text>`;
  }
  groups.forEach((g, gi) => {
    const y0 = padT + slot * gi + (slot - barH * g.values.length) / 2;
    svg += `<text x="${labelW - 10}" y="${padT + slot * gi + slot / 2 + 5}" text-anchor="end" font-size="14" fill="#222">${esc(g.label)}</text>`;
    g.values.forEach((v, vi) => {
      const w = Math.max((v.value / max) * plotW, v.value > 0 ? 2 : 0);
      svg += `<rect x="${labelW}" y="${y0 + barH * vi}" width="${w}" height="${barH - 2}" fill="${v.color}"/>`;
      svg += `<text x="${labelW + w + 6}" y="${y0 + barH * vi + barH / 2 + 3}" font-size="13" fill="#222">${esc(v.text ?? fmt(v.value))}</text>`;
    });
  });
  svg += `<line x1="${labelW}" x2="${labelW}" y1="${padT}" y2="${padT + plotH}" stroke="#9AA3B2"/>`;
  legend.forEach((l, i) => {
    const x = labelW + plotW / 2 - (legend.length * 200) / 2 + i * 200;
    svg += `<rect x="${x}" y="${height - 16}" width="12" height="12" fill="${l.color}"/><text x="${x + 18}" y="${height - 5}" font-size="14" fill="#222">${esc(l.label)}</text>`;
  });
  return `${svg}</svg>`;
}

/** Two or more columns, each split into percentage segments that add up to 100. */
function stacked(columns: { label: string; segments: { value: number; color: string; name: string }[] }[], width: number, height: number): string {
  const padL = 56; const padT = 14; const padB = 40; const plotW = width - padL - 10; const plotH = height - padT - padB;
  const slot = plotW / columns.length; const barW = Math.min(slot * 0.6, 180);
  let svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">`;
  [0, 25, 50, 75, 100].forEach((v) => {
    const y = padT + plotH - (v / 100) * plotH;
    svg += `<line x1="${padL}" x2="${width - 10}" y1="${y}" y2="${y}" stroke="${GRID}"/><text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="13" fill="${SLATE}">${v}%</text>`;
  });
  columns.forEach((c, ci) => {
    const x = padL + slot * ci + (slot - barW) / 2; let y = padT + plotH;
    c.segments.forEach((s) => {
      const h = (s.value / 100) * plotH; y -= h;
      svg += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${s.color}"/>`;
      if (h > 22) svg += `<text x="${x + barW / 2}" y="${y + h / 2 + 5}" text-anchor="middle" font-size="15" fill="#fff">${s.value.toFixed(1)}%</text>`;
    });
    svg += `<text x="${x + barW / 2}" y="${height - 12}" text-anchor="middle" font-size="14" fill="#222">${esc(c.label)}</text>`;
  });
  return `${svg}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// Layout pieces (HTML)
// ---------------------------------------------------------------------------------------------
type Tone = '' | 'good' | 'bad' | 'amber' | 'teal';
const kpi = (value: string, label: string, sub = '', tone: Tone = '', cls = ''): string =>
  `<div class="rk ${cls}"><div class="rk-v ${tone}">${esc(value)}</div><div class="rk-l">${esc(label)}</div>${sub ? `<div class="rk-s">${esc(sub)}</div>` : ''}</div>`;
const takeaway = (text: string): string => `<div class="rt"><b>TAKEAWAY</b> ${esc(text)}</div>`;
const panel = (title: string, inner: string, tone: '' | 'warm' | 'pink' | 'soft' = 'soft'): string =>
  `<div class="rp ${tone}">${title ? `<div class="rp-t">${esc(title)}</div>` : ''}${inner}</div>`;
const pill = (text: string, tone: 'amber' | 'teal' | 'red' = 'amber'): string => `<div class="rpill ${tone}">${esc(text)}</div>`;

function table(headers: string[], rows: string[][], opts: { numFrom?: number; totalRow?: boolean; widths?: string; rowClass?: (i: number) => string } = {}): string {
  const numFrom = opts.numFrom ?? 1;
  const head = headers.map((h, i) => `<th class="${i >= numFrom ? 'n' : ''}">${esc(h)}</th>`).join('');
  const body = rows.map((r, ri) => `<tr class="${opts.totalRow && ri === rows.length - 1 ? 'tot' : ''} ${opts.rowClass ? opts.rowClass(ri) : ''}">${r.map((c, i) => `<td class="${i >= numFrom ? 'n' : ''}">${c}</td>`).join('')}</tr>`).join('');
  return `<table class="rtb">${opts.widths ? `<colgroup>${opts.widths.split(',').map((w) => `<col style="width:${w}">`).join('')}</colgroup>` : ''}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const change = (v: number | null, goodWhenUp = true, digits = 1): string => {
  if (v === null) return '<span class="mu">n/a</span>';
  const good = goodWhenUp ? v > 0 : v < 0;
  const bad = goodWhenUp ? v < 0 : v > 0;
  return `<span class="${good ? 'gd' : bad ? 'bd' : ''}">${signed(v, digits)}</span>`;
};

// ---------------------------------------------------------------------------------------------
// The slides
// ---------------------------------------------------------------------------------------------
interface Ctx { d: BrandReport; s: ReportSettings; brand: string; }
type SlideFn = (n: number) => string;

function frame(c: Ctx, n: number, label: string, title: string, body: string, source = ''): string {
  return `<section class="rs"><div class="rs-label">${esc(label)}</div><h2 class="rs-title">${esc(title)}</h2>${body}`
    + `${source ? `<div class="rs-src">${esc(source)}</div>` : ''}`
    + `<div class="rs-foot"><span>${esc(c.brand)} × Blinkit | Sales, advertising &amp; growth review</span><span>${n}</span></div></section>`;
}

function coverSlide(c: Ctx): SlideFn {
  return () => {
    const d = c.d;
    const sales = d.coverage.sales ? `Product sales: ${longDate(d.coverage.sales.from)} – ${longDate(d.coverage.sales.to)}` : '';
    const ads = d.coverage.ads.length ? `Advertising: ${longDate(d.coverage.ads[0].from)} – ${longDate(d.coverage.ads[d.coverage.ads.length - 1].to)}${sales && d.coverage.sales && d.coverage.ads[d.coverage.ads.length - 1].to !== d.coverage.sales.to ? ' (reporting windows differ)' : ''}` : '';
    return `<section class="rs cover"><div class="c1"></div><div class="c2"></div><div class="cv-label">PERFORMANCE REVIEW</div>`
      + `<div class="cv-title">${esc(c.brand)} × Blinkit</div>`
      + `<div class="cv-sub">${d.ads ? 'Sales Performance, Advertising Efficiency &amp; Growth Strategy' : 'Sales Performance &amp; Growth Review'}</div>`
      + `<div class="cv-meta">${[sales, ads, `Prepared ${longDate(d.generatedOn)}`].filter(Boolean).map(esc).join('<br>')}</div></section>`;
  };
}

function groupRoas(d: BrandReport, names: string[]): number | null {
  if (!d.weekday) return null;
  const rows = d.weekday.days.filter((x) => names.includes(x.short));
  const spend = rows.reduce((s, x) => s + x.spend, 0); const rev = rows.reduce((s, x) => s + x.revenue, 0);
  return spend > 0 ? Math.round((rev / spend) * 100) / 100 : null;
}

function summarySlide(c: Ctx): SlideFn {
  return (n) => {
    const { d } = c; const s = d.sales; const a = d.ads; const tiles: string[] = [];
    if (s) {
      const l = s.latest; const p = s.previous;
      tiles.push(`<div class="rk"><div class="rk-h">SALES TRAJECTORY</div><div class="rk-v">${num(l.unitsPerDay, 2)} units/day</div><div class="rk-l">${esc(l.label)}${l.partial ? ` (${rangeText(l.from, l.to)})` : ''} daily run-rate</div>`
        + `<div class="rk-s">${p && s.rateChangePct !== null ? `${signed(s.rateChangePct)} vs ${esc(monthWord(p.label))}'s ${num(p.unitsPerDay, 2)}/day. ` : ''}Units: ${s.months.map((m) => `${monthWord(m.label).slice(0, 3)} ${m.units}`).join(' → ')}</div></div>`);
      const cc = s.concentration;
      if (cc) {
        const now = cc.latest.topShare ?? 0; const before = cc.previous.topShare ?? 0;
        tiles.push(`<div class="rk"><div class="rk-h">CONCENTRATION</div><div class="rk-v">${now.toFixed(1)}%</div><div class="rk-l">${esc(monthWord(l.label))} units from ${esc(short(cc.top[0], 14))} + ${esc(short(cc.top[1], 14))}</div><div class="rk-s">${now >= before ? 'Up' : 'Down'} from ${before.toFixed(1)}% in ${esc(monthWord(cc.previous.label))}. The other products went from ${num(cc.previous.restUnits)} to ${num(cc.latest.restUnits)} units.</div></div>`);
      }
    }
    if (a && a.latest) {
      const l = a.latest; const p = a.previous;
      tiles.push(`<div class="rk"><div class="rk-h">AD EFFICIENCY</div><div class="rk-v">${p ? `${roasText(p.roas)} → ` : ''}${roasText(l.roas)}</div><div class="rk-l">ROAS${p ? `, ${esc(monthWord(p.label).slice(0, 3))} → ${esc(monthWord(l.label).slice(0, 3))}` : ` in ${esc(l.label)}`}</div><div class="rk-s">${(l.roas ?? 0) < 1 ? 'Below 1.0x' : 'Above 1.0x'}${p ? ' in the latest month' : ''}. Spend per attributed unit ${p ? `${(l.spendPerUnit ?? 0) >= (p.spendPerUnit ?? 0) ? 'rose' : 'fell'} from ${inr(p.spendPerUnit)} to ${inr(l.spendPerUnit)}` : `is ${inr(l.spendPerUnit)}`}.</div></div>`);
    }
    const w = d.weekday;
    if (w && w.winners.length && w.priorities.length) {
      tiles.push(`<div class="rk"><div class="rk-h">WEEKDAY PATTERN</div><div class="rk-v">${roasText(groupRoas(d, w.winners))} vs ${roasText(groupRoas(d, w.priorities))}</div><div class="rk-l">${esc(w.winners.join('+'))} vs ${esc(w.priorities.join('+'))} ROAS</div><div class="rk-s">${esc(w.priorities.join(', '))} take ${w.priorityShare.spend}% of spend but deliver ${w.priorityShare.units}% of units.</div></div>`);
    }
    const av = c.s.inputs.availability.filter((x) => x.current !== null && x.target !== null);
    if (av.length) {
      const gap = Math.round(((av[0].target ?? 0) - (av[0].current ?? 0)) * 10) / 10;
      tiles.push(`<div class="rk"><div class="rk-h">AVAILABILITY GAP</div><div class="rk-v">${num(av[0].current, 0)}% vs ${num(av[0].target, 0)}%</div><div class="rk-l">${esc(av.map((x) => short(x.name, 12)).join(', '))} vs target</div><div class="rk-s">A ${gap}-point gap.${c.s.inputs.stores ? ` About ${Math.round((c.s.inputs.stores * gap) / 100)} stores per product (estimate).` : ''}</div></div>`);
    } else if (d.stock) {
      tiles.push(`<div class="rk"><div class="rk-h">STOCK STATUS</div><div class="rk-v">${d.stock.totals.lowOrOut} of ${d.stock.totals.listings}</div><div class="rk-l">Stock listings low or out of stock</div><div class="rk-s">${num(d.stock.totals.stock)} units in stock, ${num(d.stock.totals.sold30)} sold in the last 30 days.</div></div>`);
    } else if (s) {
      tiles.push(`<div class="rk"><div class="rk-h">REVENUE</div><div class="rk-v">${inr(s.latest.revenue)}</div><div class="rk-l">${esc(s.latest.label)} product sales</div><div class="rk-s">${num(s.latest.orders)} orders, average order ${inr(s.latest.aov)}.</div></div>`);
    }
    if (d.coverage.sales || d.coverage.ads.length) {
      tiles.push(`<div class="rk"><div class="rk-h">DATA COVERAGE</div><div class="rk-v">${d.coverage.adDays ? `${d.coverage.adDays} ad days` : `${d.selectedMonths.length} months`}</div><div class="rk-l">${d.coverage.adDays ? 'Advertising days with data' : 'Months in this report'}</div><div class="rk-s">${d.coverage.sales ? `Sales cover ${rangeText(d.coverage.sales.from, d.coverage.sales.to)}. ` : ''}${d.coverage.ads.length ? `Advertising covers ${rangeText(d.coverage.ads[0].from, d.coverage.ads[d.coverage.ads.length - 1].to)}.` : ''}</div></div>`);
    }
    const typed = c.s.inputs.decisions.map((x) => x.trim()).filter(Boolean);
    const decisions = typed.length ? typed : d.insights.decisions;
    const title = s && s.rateChangePct !== null
      ? `Sales are ${s.rateChangePct >= 0 ? 'rising' : 'slowing'} on a daily basis${a && a.latest ? `, and reported ad returns are ${(a.latest.roas ?? 0) < 1 ? 'below 1.0x' : 'above 1.0x'}` : ''}`
      : (s ? `${num(s.latest.units)} units sold in ${s.latest.label}${a && a.latest ? `, with ad returns of ${roasText(a.latest.roas)}` : ''}` : `Advertising returned ${roasText(a?.latest?.roas)} in ${a?.latest?.label ?? 'the period'}`);
    const dec = decisions.length ? `<div class="rs-sub">THREE DECISIONS</div><div class="rdec">${decisions.slice(0, 3).map((t, i) => `<div class="rdec-i"><span class="rdec-n">${i + 1}</span><span>${esc(t)}</span></div>`).join('')}</div>` : '';
    return frame(c, n, 'EXECUTIVE SUMMARY', title, `<div class="rs-body"><div class="rgrid g3 tight big">${tiles.join('')}</div>${dec}</div>`);
  };
}

function timeline(d: BrandReport): string {
  const rows: { label: string; blocks: { from: string; to: string; text: string; color: string }[]; dashed?: boolean }[] = [];
  if (d.sales) rows.push({ label: 'Product sales (units)', blocks: d.sales.months.map((m) => ({ from: m.from, to: m.to, text: m.partial ? rangeText(m.from, m.to) : monthWord(m.label).slice(0, 3), color: BLUE })) });
  if (d.ads) rows.push({ label: 'Advertising (daily rows)', blocks: d.ads.months.map((m) => ({ from: m.from, to: m.to, text: m.days < 28 ? rangeText(m.from, m.to) : monthWord(m.label).slice(0, 3), color: TEAL })) });
  const all = rows.flatMap((r) => r.blocks);
  if (!all.length) return '';
  const min = Math.min(...all.map((b) => Date.UTC(+b.from.slice(0, 4), +b.from.slice(5, 7) - 1, +b.from.slice(8, 10))));
  const max = Math.max(...all.map((b) => Date.UTC(+b.to.slice(0, 4), +b.to.slice(5, 7) - 1, +b.to.slice(8, 10))));
  const W = 700; const labelW = 200; const plotW = W - labelW - 20; const rowH = 62;
  const x = (iso: string) => labelW + ((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - min) / Math.max(max - min, 1)) * plotW;
  let svg = `<svg viewBox="0 0 ${W} ${rows.length * rowH + 70}" width="${W}" height="${rows.length * rowH + 70}" role="img">`;
  rows.forEach((r, ri) => {
    const y = 36 + ri * rowH;
    svg += `<text x="0" y="${y + 28}" font-size="16" fill="#222">${esc(r.label)}</text>`;
    r.blocks.forEach((b) => {
      const x1 = x(b.from); const x2 = Math.max(x(b.to), x1 + 40);
      svg += `<rect x="${x1}" y="${y}" width="${x2 - x1 - 2}" height="38" fill="${b.color}"/><text x="${(x1 + x2) / 2 - 1}" y="${y + 24}" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">${esc(b.text)}</text>`;
    });
  });
  const salesEnd = d.coverage.sales ? x(d.coverage.sales.to) : null;
  if (salesEnd !== null) {
    svg += `<line x1="${salesEnd}" x2="${salesEnd}" y1="14" y2="${rows.length * rowH + 40}" stroke="${RED}" stroke-dasharray="5 4"/>`;
    svg += `<text x="${salesEnd}" y="${rows.length * rowH + 62}" text-anchor="end" font-size="14" font-weight="700" fill="${RED}">Sales cut-off: ${esc(dayText(d.coverage.sales!.to))}</text>`;
  }
  svg += `<text x="${labelW}" y="12" font-size="13" fill="${SLATE}">${esc(dayText(new Date(min).toISOString().slice(0, 10)))}</text><text x="${W - 20}" y="12" text-anchor="end" font-size="13" fill="${SLATE}">${esc(dayText(new Date(max).toISOString().slice(0, 10)))}</text>`;
  return `${svg}</svg>`;
}

function scopeSlide(c: Ctx): SlideFn {
  return (n) => {
    const { d } = c; const s = d.sales; const tiles: string[] = [];
    if (s) tiles.push(kpi(`${s.productCount} product${s.productCount === 1 ? '' : 's'}`, short(s.rows.slice(0, 5).map((r) => short(r.name, 16)).join(' · '), 56), ''));
    if (s) tiles.push(kpi(`${s.latest.cityCount} cities`, s.latest.cities.length ? `Top: ${s.latest.cities[0].city} (${Math.round((s.latest.cities[0].revenue / Math.max(s.latest.revenue, 1)) * 100)}% of revenue)` : 'Cities with orders', ''));
    tiles.push(kpi(c.s.inputs.priceRange.trim() || (s ? inr(s.latest.aov) : '—'), c.s.inputs.priceRange.trim() ? 'Stated selling-price range' : 'Average order value', ''));
    const target = c.s.inputs.availability.find((x) => x.target !== null);
    tiles.push(kpi(target ? `${num(target.target, 0)}%` : `${d.selectedMonths.length} months`, target ? 'Availability target per product' : 'In this report', ''));
    if (s && s.rows.length >= 2) tiles.push(kpi(short(s.rows.slice(0, 2).map((r) => short(r.name, 10)).join(' + '), 22), 'Top sellers of the latest month', ''));
    if (d.ads && d.ads.latest) tiles.push(kpi(`Ads: ${d.ads.latest.campaignCount} campaign${d.ads.latest.campaignCount === 1 ? '' : 's'}`, `${d.ads.months.length} month${d.ads.months.length === 1 ? '' : 's'} of advertising data`, ''));
    const same = d.coverage.sales && d.coverage.ads.length && d.coverage.ads[d.coverage.ads.length - 1].to === d.coverage.sales.to;
    const tk = d.coverage.sales && d.coverage.ads.length
      ? (same ? 'Sales and advertising end on the same day, so they can be read side by side.' : `Sales end ${longDate(d.coverage.sales.to)} and advertising ends ${longDate(d.coverage.ads[d.coverage.ads.length - 1].to)}, so each dataset is kept separate.`)
      : 'Only one dataset is available, so there is nothing to compare it with yet.';
    return frame(c, n, 'BUSINESS OVERVIEW AND DATA SCOPE', `${s ? `${s.productCount} product${s.productCount === 1 ? '' : 's'}, ${s.latest.cityCount} cities` : 'Advertising data'} and the periods each dataset covers`,
      `<div class="rs-body two"><div><div class="rs-sub">Business at a glance</div><div class="rgrid g2">${tiles.join('')}</div></div>`
      + `<div><div class="rs-sub">Reporting windows (${d.coverage.sales ? `${longDate(d.coverage.sales.from)} – ${longDate(d.coverage.sales.to)}` : 'advertising'})</div>${timeline(d)}<div class="spacer"></div>${takeaway(tk)}</div></div>`,
      'Source: monthly product sales and daily campaign rows uploaded to the dashboard.');
  };
}

function trajectorySlide(c: Ctx): SlideFn {
  return (n) => {
    const s = c.d.sales!; const bars: Bar[] = s.months.map((m) => ({ label: m.partial ? `${monthWord(m.label)} ${rangeText(m.from, m.to).split('–')[0]}–${m.to.slice(8, 10)}` : monthWord(m.label), value: m.units, color: BLUE }));
    if (s.projection) bars.push({ label: `${monthWord(s.latest.label)} projected*`, value: s.projection.units, color: AMBER, text: `${s.projection.units}` });
    const p = s.previous; const l = s.latest; const tiles: string[] = [];
    if (s.multiple !== null && s.multiple >= 2 && s.months.length >= 3) tiles.push(kpi(`${s.multiple}x`, `${monthWord(p!.label)} vs ${monthWord(s.months[s.months.length - 3].label)}`, `${s.months[s.months.length - 3].units} → ${p!.units} units${s.months[s.months.length - 3].units < 20 ? '; very low base' : ''}`));
    else if (p) tiles.push(kpi(num(p.units), `Units in ${monthWord(p.label)}`, `${num(p.revenue)} revenue`.replace(/^(\d)/, '₹$1')));
    if (p) tiles.push(kpi(num(p.unitsPerDay, 2), `Units/day, ${monthWord(p.label)}`, `${p.units} ÷ ${p.days} days`));
    tiles.push(kpi(num(l.unitsPerDay, 2), `Units/day, ${l.partial ? rangeText(l.from, l.to) : monthWord(l.label)}`, `${l.units} ÷ ${l.days} days`));
    if (p && s.rateChangePct !== null) tiles.push(kpi(signed(s.rateChangePct), `${monthWord(l.label)} vs ${monthWord(p.label)} daily rate`, `${num(l.unitsPerDay, 2)} vs ${num(p.unitsPerDay, 2)} units/day`, s.rateChangePct >= 0 ? 'good' : 'bad'));
    const proj = s.projection ? panel('STRAIGHT-LINE PROJECTION (ILLUSTRATIVE)', `<div class="rk-v big">≈${s.projection.units} units</div><div class="rp-p">If the ${rangeText(l.from, l.to)} pace of ${num(s.projection.perDay, 2)} units/day holds to ${s.projection.days} ${monthWord(l.label)}. Not a forecast; promotions, stock and seasonality are not modelled.</div>`, 'warm') : '';
    return frame(c, n, 'OVERALL SALES TRAJECTORY',
      p && s.rateChangePct !== null ? `${monthWord(l.label)}'s daily pace is ${Math.abs(s.rateChangePct)}% ${s.rateChangePct >= 0 ? 'above' : 'below'} ${monthWord(p.label)}${s.multiple !== null && s.multiple >= 5 ? ', after a jump off a tiny base' : ''}` : `${num(l.units)} units sold in ${l.label}`,
      `<div class="rs-body two wide"><div><div class="rs-sub">Units sold per month, all products</div>${vBars(bars, 740, 430, (v) => num(v))}`
      + `${s.projection ? `<div class="rs-note">*Straight-line projection (${l.units} ÷ ${l.days} × ${l.fullDays} ≈ ${s.projection.units}); illustrative, not a forecast.</div>` : ''}${takeaway(c.d.insights.trajectory ?? '')}</div>`
      + `<div><div class="rgrid g2">${tiles.join('')}</div>${proj}</div></div>`,
      `Source: monthly product sales. ${s.months.map((m) => `${monthWord(m.label)} = ${m.days} days`).join('; ')}.`);
  };
}

function productsSlide(c: Ctx): SlideFn {
  return (n) => {
    const s = c.d.sales!; const l = s.latest; const p = s.previous; const idx = s.months.map((_, i) => i).slice(-3);
    const rows = s.rows.slice(0, 8);
    const sum = (i: number) => s.months[i].units;
    const heads = ['Product', ...idx.map((i) => monthWord(s.months[i].label).slice(0, 3)), ...(p ? [`${monthWord(p.label).slice(0, 3)} / day`, `${monthWord(l.label).slice(0, 3)} / day`, 'Daily-rate change'] : [`${monthWord(l.label).slice(0, 3)} / day`]), 'Mix', `${l.fullDays}-day run-rate`];
    const body = rows.map((r) => [`<b>${esc(short(r.name, 30))}</b>`, ...idx.map((i) => num(r.perMonth[i])), ...(p ? [num(r.prevPerDay, 2), num(r.latestPerDay, 2), change(r.rateChangePct)] : [num(r.latestPerDay, 2)]), `${r.mixPct.toFixed(1)}%`, num(r.runRate, 1)]);
    body.push(['<b>Total</b>', ...idx.map((i) => `<b>${num(sum(i))}</b>`), ...(p ? [`<b>${num(p.unitsPerDay, 2)}</b>`, `<b>${num(l.unitsPerDay, 2)}</b>`, `<b>${change(s.rateChangePct)}</b>`] : [`<b>${num(l.unitsPerDay, 2)}</b>`]), '<b>100.0%</b>', `<b>${num(Math.round((l.units / l.days) * l.fullDays * 10) / 10, 1)}</b>`]);
    const groups: Group[] = rows.slice(0, 6).map((r) => ({ label: short(r.name, 16), values: [{ value: r.latestPerDay, color: BLUE, text: num(r.latestPerDay, 2) }, ...(p ? [{ value: r.prevPerDay ?? 0, color: '#6E7B8F', text: num(r.prevPerDay ?? 0, 2) }] : [])] }));
    const why = l.partial && p ? panel('Why compare daily rates, not totals?', `<ul class="rul"><li>${esc(monthWord(l.label))} has ${l.days} days of data against ${esc(monthWord(p.label))}'s ${p.days}. Totals show a ${Math.abs(Math.round(((l.units - p.units) / Math.max(p.units, 1)) * 100))}% ${l.units < p.units ? 'fall' : 'rise'} (${p.units} → ${l.units}); daily rates show ${s.rateChangePct !== null ? `a ${Math.abs(s.rateChangePct)}% ${s.rateChangePct >= 0 ? 'rise' : 'fall'}` : 'a different picture'} (${num(p.unitsPerDay, 2)} → ${num(l.unitsPerDay, 2)}).</li><li>Run-rate columns are straight-line (units ÷ ${l.days} × ${l.fullDays}), not forecasts.</li></ul>`) : '';
    const up = s.rows.filter((r) => (r.rateChangePct ?? 0) > 0).length; const down = s.rows.filter((r) => (r.rateChangePct ?? 0) < 0).length;
    return frame(c, n, 'PRODUCT-WISE SALES PERFORMANCE',
      p ? `${up} product${up === 1 ? ' is' : 's are'} accelerating on a daily basis${down ? ` while ${down} ${down === 1 ? 'is' : 'are'} slowing` : ''}` : `${s.productCount} products and their share of units`,
      `<div class="rs-body two prod"><div>${table(heads, body, { totalRow: true, widths: p ? '25%,7%,7%,7%,9%,9%,13%,8%,15%' : '40%,10%,10%,10%,15%,15%' })}${why}</div>`
      + `<div><div class="rs-sub">Units per day by product</div>${hGroups(groups, 400, 400, (v) => num(v, 1), [{ label: `${monthWord(l.label)}${l.partial ? ` ${rangeText(l.from, l.to)}` : ''}`, color: BLUE }, ...(p ? [{ label: monthWord(p.label), color: '#6E7B8F' }] : [])], 120)}${takeaway(c.d.insights.products ?? '')}</div></div>`,
      'Source: monthly product sales. Rate change = latest units per day ÷ previous units per day − 1.');
  };
}

function concentrationSlide(c: Ctx): SlideFn {
  return (n) => {
    const cc = c.d.sales!.concentration!; const { top } = cc;
    const col = (x: typeof cc.latest) => ({ label: `${x.label} (${num(x.units)} units)`, segments: [{ value: x.top1 ?? 0, color: BLUE, name: top[0] }, { value: x.top2 ?? 0, color: TEAL, name: top[1] }, { value: x.rest ?? 0, color: SLATE, name: 'All other products' }] });
    const dTop = cc.topChange; const dRest = cc.restChange; const net = cc.netChange; const now = cc.latest.topShare ?? 0;
    return frame(c, n, 'PORTFOLIO CONCENTRATION',
      dRest < 0 && dTop > 0 ? `Gains on ${short(top[0], 14)} and ${short(top[1], 14)} are partly offset by declines elsewhere, so net growth is only ${net >= 0 ? '+' : '−'}${Math.abs(net).toFixed(2)} units a day` : `${short(top[0], 14)} and ${short(top[1], 14)} make up ${(Math.round(now * 10) / 10).toFixed(1)}% of units`,
      `<div class="rs-body two"><div><div class="rs-sub">Share of units, ${esc(cc.previous.label)} vs ${esc(cc.latest.label)}</div>${stacked([col(cc.previous), col(cc.latest)], 600, 420)}`
      + `<div class="rleg">${[[BLUE, top[0]], [TEAL, top[1]], [SLATE, 'All other products']].map(([k, t]) => `<span><i style="background:${k}"></i>${esc(short(t, 26))}</span>`).join('')}</div>${takeaway(c.d.insights.concentration ?? '')}</div>`
      + `<div><div class="rgrid g3">${kpi(`${dTop >= 0 ? '+' : '−'}${Math.abs(dTop).toFixed(2)}/day`, `${short(top[0], 12)} + ${short(top[1], 12)}`, `${cc.topPerDay.previous.toFixed(2)} → ${cc.topPerDay.latest.toFixed(2)} units/day`, dTop >= 0 ? 'good' : 'bad')}${kpi(`${dRest >= 0 ? '+' : '−'}${Math.abs(dRest).toFixed(2)}/day`, 'All other products', `${cc.restPerDay.previous.toFixed(2)} → ${cc.restPerDay.latest.toFixed(2)} units/day`, dRest >= 0 ? 'good' : 'bad')}${kpi(`${net >= 0 ? '+' : '−'}${Math.abs(net).toFixed(2)}/day`, 'Total brand (net)', `${cc.totalPerDay.previous.toFixed(2)} → ${cc.totalPerDay.latest.toFixed(2)} units/day`)}</div>`
      + `<div class="rgrid g2">${panel('Concentrating on two products', `<p class="rp-p"><b>Upside:</b> spend follows proven velocity.</p><p class="rp-p"><b>Risk:</b> a stock-out on either now hits ${(Math.round(now))}% of units.</p><p class="rp-p"><b>Risk:</b> ${esc(short(top[0], 20))} alone is ${(cc.latest.top1 ?? 0).toFixed(0)}% of units.</p>`)}${panel('Test cannibalization, don’t assume it', `<p class="rp-p"><b>Test:</b> run ads in matched test and hold-out stores or cities.</p><p class="rp-p"><b>Judge:</b> on total brand units, not product-attributed sales.</p><p class="rp-p"><b>Control:</b> compare periods with matched availability.</p>`)}</div></div></div>`,
      'Source: monthly product sales. An offset between products is not proof of cannibalization.');
  };
}

function stockSlide(c: Ctx): SlideFn {
  return (n) => {
    const st = c.d.stock!; const rows = st.products.slice(0, 7);
    const groups: Group[] = rows.map((r) => ({ label: short(r.name, 16), values: [{ value: r.stock, color: TEAL, text: num(r.stock) }, { value: r.sold30, color: BLUE, text: num(r.sold30) }] }));
    const share = Math.round((st.totals.lowOrOut / Math.max(st.totals.listings, 1)) * 100);
    return frame(c, n, 'STOCK POSITION', `${st.totals.lowOrOut} of ${st.totals.listings} stock listings are low or out of stock`,
      `<div class="rs-body two"><div><div class="rs-sub">Units in stock vs units sold in the last 30 days</div>${hGroups(groups, 640, 420, (v) => num(v), [{ label: 'In stock', color: TEAL }, { label: 'Sold, last 30 days', color: BLUE }], 130)}${takeaway(`${share}% of stock listings (a product in a warehouse) are low or out of stock. Low stock clouds the demand read.`)}</div>`
      + `<div><div class="rgrid g2">${kpi(num(st.totals.stock), 'Units in stock', `${st.totals.products} products`)}${kpi(num(st.totals.sold30), 'Units sold, last 30 days', 'From the stock report')}${kpi(`${st.totals.lowOrOut}`, 'Low or out-of-stock listings', `of ${st.totals.listings} listings`, st.totals.lowOrOut > 0 ? 'bad' : 'good')}${kpi(`${st.totals.lowOrOut > 0 ? 'Replenish first' : 'Healthy'}`, 'Reading', 'Stock status comes from the latest stock upload')}</div>`
      + `${panel('Why weak sales are not always weak demand', `<ul class="rul"><li>A product that is out of stock in many warehouses cannot sell there.</li><li>Compare periods with matched stock before judging a product.</li><li>Ask for a daily stock-out report to confirm.</li></ul>`)}</div></div>`,
      'Source: latest stock upload. Low = at or below the stock threshold; out = zero.');
  };
}

function availabilitySlide(c: Ctx): SlideFn {
  return (n) => {
    const rows = c.s.inputs.availability.filter((x) => x.name.trim() && x.current !== null && x.target !== null);
    const groups: Group[] = rows.map((r) => ({ label: short(r.name, 16), values: [{ value: r.current ?? 0, color: RED, text: `${num(r.current, 0)}%` }, { value: r.target ?? 0, color: TEAL, text: `${num(r.target, 0)}%` }] }));
    const gap = Math.round(Math.max(...rows.map((r) => (r.target ?? 0) - (r.current ?? 0))));
    const stores = c.s.inputs.stores; const r0 = rows[0];
    const math = stores && r0 ? table(['Indicative store math (per product)', 'Stores'], [
      ['Dark-store base (assumed)', num(stores)], [`Available at ${num(r0.current, 0)}%`, `≈${Math.round((stores * (r0.current ?? 0)) / 100)}`],
      [`Needed at ${num(r0.target, 0)}% target`, `≈${Math.round((stores * (r0.target ?? 0)) / 100)}`], ['<b>Additional stores per product</b>', `<b>≈${Math.round((stores * ((r0.target ?? 0) - (r0.current ?? 0))) / 100)}</b>`],
    ], { totalRow: true }) : '';
    return frame(c, n, 'AVAILABILITY AND LOST-GROWTH OPPORTUNITIES', `${rows.length === 1 ? short(rows[0].name, 24) : 'These products'} sit below the availability target, so their sales are not a fair test of demand`,
      `<div class="rs-body two"><div><div class="rs-sub">Availability vs target</div>${vGroups(groups, 640, 330, (v) => `${num(v, 0)}%`, [{ label: 'Current availability', color: RED }, { label: 'Target availability', color: TEAL }])}${takeaway(`A ${gap}-point gap on the biggest shortfall; where stock is thin, sales are not a fair test of demand.`)}</div>`
      + `<div>${stores ? pill('ESTIMATES: DENOMINATOR TO BE CONFIRMED') : ''}${math}${panel('Why weak sales ≠ weak demand', `<ul class="rul"><li>Availability that month may have been lower than the target.</li><li>Recent sales may be stock-constrained.</li><li>Compare periods with matched availability before judging demand.</li></ul>`)}</div></div>`,
      `Source: availability figures entered by the report author${stores ? `; store counts = availability % × ${num(stores)} assumed eligible stores` : ''}.`);
  };
}

function adsMonthSlide(c: Ctx, m: ReportAdsMonth): SlideFn {
  return (n) => {
    const types = m.byType.map((t) => `${t.label} ${inr(t.spend)}`).join(' · ');
    const bars: Bar[] = [{ label: 'Ad spend', value: m.spend, color: BLUE }, { label: 'Attributed revenue', value: m.sales, color: TEAL }];
    return frame(c, n, `${monthWord(m.label).toUpperCase()} ADVERTISING PERFORMANCE`,
      `${monthWord(m.label)}: ${inr(m.spend)} of advertising returned ${inr(m.sales)} of reported attributed revenue, a ROAS of ${roasText(m.roas)}`,
      `<div class="rs-body"><div class="rgrid g4">${kpi(inr(m.spend), 'Ad spend', types)}${kpi(num(m.impressions), 'Impressions', `${rangeText(m.from, m.to)}, ${m.activeDays} days with data`)}${kpi(num(m.units), 'Attributed units', 'Reported by the ad platform')}${kpi(inr(m.sales), 'Attributed revenue', `${inr(m.salesPerUnit, 2)} per attributed unit`)}</div>`
      + `<div class="two bottom"><div><div class="rs-sub">Spend vs reported attributed revenue</div>${vBars(bars, 600, 330, (v) => inr(v))}</div>`
      + `<div><div class="rs-sub">Calculated efficiency</div><div class="rgrid g3">${kpi(roasText(m.roas), 'ROAS', 'Revenue ÷ spend', (m.roas ?? 0) < 1 ? 'bad' : 'good')}${kpi(inr(m.spendPerUnit), 'Spend per attributed unit', `${inr(m.spend)} ÷ ${num(m.units)}`)}${kpi(inr(m.spendPerRupee, 2), 'Spend per ₹1 of revenue', `${inr(m.spend)} ÷ ${inr(m.sales)}`)}</div>${takeaway(c.d.insights.ads?.[m.periodKey] ?? '')}</div></div></div>`,
      'Source: daily campaign rows. Attributed = credited to ads by the platform; it does not prove incremental sales.');
  };
}

function campaignsSlide(c: Ctx): SlideFn {
  return (n) => {
    const m = c.d.ads!.latest!; const cs = m.campaigns.slice(0, 5);
    const ranked = cs.filter((x) => x.roas !== null && x.spend > 0).sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0));
    const best = ranked[0]; const worst = ranked[ranked.length - 1]; const total = cs.reduce((s, x) => s + x.spend, 0);
    const groups: Group[] = cs.slice(0, 4).map((x) => ({ label: short(x.name, 18), values: [{ value: x.spend, color: BLUE }, { value: x.sales, color: TEAL }] }));
    const rows = cs.map((x, i) => [`${i + 1}`, `<b>${esc(short(x.name, 34))}</b><div class="sub">${esc(x.type)} · ${esc(x.status)}</div>`, inr(x.spend), num(x.units), inr(x.sales), `<span class="${(x.roas ?? 0) >= 0.3 ? 'gd' : (x.roas ?? 0) < 0.1 ? 'bd' : ''}">${roasText(x.roas)}</span>`, inr(x.spendPerUnit)]);
    rows.push(['', '<b>Total (shown)</b>', `<b>${inr(total)}</b>`, `<b>${num(cs.reduce((s, x) => s + x.units, 0))}</b>`, `<b>${inr(cs.reduce((s, x) => s + x.sales, 0))}</b>`, `<b>${roasText(total > 0 ? Math.round((cs.reduce((s, x) => s + x.sales, 0) / total) * 100) / 100 : null)}</b>`, '']);
    const notes = best ? `<p class="rp-p"><b>Relative ≠ profitable:</b> at ${roasText(best.roas)}, ₹100 of ads is credited with ₹${Math.round((best.roas ?? 0) * 100)} of revenue, before any product cost.</p>${worst && worst !== best ? `<p class="rp-p"><b>${esc(short(worst.name, 30))}:</b> ${roasText(worst.roas)} and ${inr(worst.spendPerUnit)} per unit. Diagnose before any relaunch.</p>` : ''}` : '';
    return frame(c, n, `CAMPAIGN-LEVEL ANALYSIS (${monthWord(m.label).toUpperCase()})`,
      best ? `${short(best.name, 30)} is the strongest campaign at ${roasText(best.roas)} ROAS${(best.roas ?? 0) < 1 ? ', yet no campaign recovers its spend in reported revenue' : ''}` : 'Campaign-level results',
      `<div class="rs-body two camp"><div><div class="rs-sub">Spend vs attributed sales by campaign</div>${vGroups(groups, 560, 380, (v) => inr(v), [{ label: 'Spend', color: BLUE }, { label: 'Attributed sales', color: TEAL }])}${takeaway(best ? `Spend is concentrated in ${cs[0].name} (${total > 0 ? Math.round((cs[0].spend / total) * 100) : 0}% of the spend shown).${worst && worst.units > 0 ? ` The weakest campaign spent ${inr(worst.spend)} for ${worst.units} reported unit${worst.units === 1 ? '' : 's'}.` : ''}` : '')}</div>`
      + `<div>${table(['Rank', 'Campaign', 'Spend', 'Units', 'Sales', 'ROAS', 'Spend / unit'], rows, { numFrom: 2, totalRow: true, widths: '8%,32%,13%,9%,13%,10%,15%' })}${notes ? panel('', notes) : ''}</div></div>`,
      'Source: daily campaign rows, top campaigns by spend. Attributed sales are credited by the ad platform.');
  };
}

function efficiencySlide(c: Ctx): SlideFn {
  return (n) => {
    const a = c.d.ads!; const p = a.previous!; const l = a.latest!; const ch = a.change!; const w = (x: string) => monthWord(x).slice(0, 3);
    const rows = [
      ['Ad spend', inr(p.spend), inr(l.spend), `<span class="mu">${signed(ch.spend, 0)}${l.days !== p.days ? ` (${l.days} vs ${p.days} days)` : ''}</span>`],
      ['Impressions', num(p.impressions), num(l.impressions), `<span class="mu">${signed(ch.impressions, 0)}</span>`],
      ['Attributed units', num(p.units), num(l.units), `<span class="mu">${signed(ch.units, 0)}</span>`],
      ['Attributed sales', inr(p.sales), inr(l.sales), `<span class="mu">${signed(ch.sales, 0)}</span>`],
      ['ROAS (revenue ÷ spend)', roasText(p.roas), roasText(l.roas), change(ch.roas, true)],
      ['Spend per attributed unit', inr(p.spendPerUnit), inr(l.spendPerUnit), change(ch.spendPerUnit, false)],
      ['Spend per ₹1 of revenue', inr(p.spendPerRupee, 2), inr(l.spendPerRupee, 2), change(ch.spendPerRupee, false)],
      ['Spend per 1,000 impressions', inr(p.spendPer1000), inr(l.spendPer1000), change(ch.spendPer1000, false, 0)],
      ['Revenue per 1,000 impressions', inr(p.revenuePer1000), inr(l.revenuePer1000), change(ch.revenuePer1000, true, 0)],
    ];
    const bars: Bar[] = [{ label: monthWord(p.label), value: p.roas ?? 0, color: BLUE, text: roasText(p.roas) }, { label: `${monthWord(l.label)}${l.days < 28 ? ` ${rangeText(l.from, l.to)}` : ''}`, value: l.roas ?? 0, color: (l.roas ?? 0) < (p.roas ?? 0) ? RED : GREEN, text: roasText(l.roas) }];
    const s = c.d.sales; const extra = s && s.previous && s.rateChangePct !== null ? panel('', `<p class="rp-p"><b>Not the same as brand sales:</b> units/day ${s.rateChangePct >= 0 ? 'rose' : 'fell'} ${Math.abs(s.rateChangePct)}% while attributed units ${(ch.units ?? 0) >= 0 ? 'rose' : 'fell'}. Incrementality is unproven either way.</p>`) : '';
    return frame(c, n, `ADVERTISING EFFICIENCY: ${w(p.label).toUpperCase()} VS ${w(l.label).toUpperCase()}`,
      ch.roas !== null ? `Reported ad efficiency ${ch.roas < 0 ? 'worsened' : 'improved'}: ROAS ${ch.roas < 0 ? 'fell' : 'rose'} ${Math.abs(ch.roas)}%${ch.spendPer1000 !== null ? ` as each impression became ${Math.abs(ch.spendPer1000) >= 50 ? (ch.spendPer1000 > 0 ? `about ${(1 + ch.spendPer1000 / 100).toFixed(1)}x more expensive` : 'cheaper') : 'similarly priced'}` : ''}` : 'Advertising efficiency, month against month',
      `<div class="rs-body two wide"><div>${table(['Metric', monthWord(p.label), `${monthWord(l.label)}${l.days < 28 ? ` ${rangeText(l.from, l.to)}` : ''}`, 'Change'], rows, { widths: '37%,19%,22%,22%' })}<div class="rs-note">Grey = volume change${l.days !== p.days ? `, not like-for-like (${monthWord(l.label)} is ${l.days} days)` : ''}. Red/green = efficiency ratios.</div></div>`
      + `<div><div class="rs-sub">ROAS (axis starts at 0; 1.0x = revenue equals spend)</div>${vBars(bars, 520, 250, (v) => `${v.toFixed(2)}x`, 1, 4)}${takeaway(c.d.insights.efficiency ?? '')}${extra}</div></div>`,
      'Source: daily campaign rows. Spend per 1,000 impressions is derived (spend ÷ impressions × 1,000); the cause of any change is not identifiable from the data supplied.');
  };
}

const WD_COLORS = (d: string, winners: string[], priorities: string[]): string => (winners.includes(d) ? GREEN : priorities.includes(d) ? RED : BLUE);

function weekdaySlide(c: Ctx): SlideFn {
  return (n) => {
    const w = c.d.weekday!; const t = w.totals;
    const rows = w.days.map((x) => [`<b>${esc(x.weekday)}</b>`, num(x.daysWithData), num(x.impressions), num(x.atc), num(x.units), inr(x.revenue), inr(x.spend, 2)]);
    rows.push(['<b>Total</b>', `<b>${num(t.daysWithData)}</b>`, `<b>${num(t.impressions)}</b>`, `<b>${num(t.atc)}</b>`, `<b>${num(t.units)}</b>`, `<b>${inr(t.revenue)}</b>`, `<b>${inr(t.spend, 2)}</b>`]);
    const groups: Group[] = [...w.days].reverse().map((x) => ({ label: x.weekday, values: [{ value: x.revenue, color: TEAL, text: '' }, { value: x.spend, color: BLUE, text: '' }] }));
    const all = w.days.every((x) => (x.roas ?? 0) < 1);
    return frame(c, n, 'WEEKDAY ADVERTISING REPORT', `${t.daysWithData} days of advertising: ${inr(t.spend)} of spend returned ${inr(t.revenue)} in attributed revenue (${roasText(t.roas)})`,
      `<div class="rs-body two wide"><div>${table(['Day', 'Days with data', 'Impressions', 'Add-to-carts', 'Units', 'Revenue', 'Spend'], rows, { totalRow: true, widths: '17%,11%,15%,14%,9%,16%,18%' })}${panel('', `<p class="rp-p"><b>Each weekday merges ${Math.min(...w.days.map((x) => x.daysWithData))}–${Math.max(...w.days.map((x) => x.daysWithData))} days of data.</b> Daily campaign rows from every selected month are grouped by the day of the week. Revenue per unit is ${inr(t.units > 0 ? Math.round((t.revenue / t.units) * 100) / 100 : null, 2)}.</p>`, 'warm')}</div>`
      + `<div><div class="rs-sub">Spend vs attributed revenue by weekday</div>${hGroups(groups.map((g) => ({ ...g, values: g.values.map((v) => ({ ...v, text: inr(v.value) })) })), 420, 360, (v) => inr(v), [{ label: 'Attributed revenue', color: TEAL }, { label: 'Spend', color: BLUE }], 100)}${takeaway(all ? `Spend exceeds attributed revenue on every weekday; overall ROAS is ${roasText(t.roas)}.` : `Overall ROAS is ${roasText(t.roas)}; the best weekdays are covered on the next slide.`)}</div></div>`,
      'Source: daily campaign rows grouped by weekday. Revenue is attributed by the platform.');
  };
}

function weekdayDeepSlide(c: Ctx): SlideFn {
  return (n) => {
    const w = c.d.weekday!; const col = (d: string) => WD_COLORS(d, w.winners, w.priorities);
    const roas: Bar[] = w.days.map((x) => ({ label: x.short, value: x.roas ?? 0, color: col(x.short), text: (x.roas ?? 0).toFixed(2) }));
    const unit: Bar[] = w.days.map((x) => ({ label: x.short, value: x.spendPerUnit ?? 0, color: col(x.short), text: x.spendPerUnit === null ? 'none' : inr(x.spendPerUnit) }));
    const wr = groupRoas(c.d, w.winners); const pr = groupRoas(c.d, w.priorities);
    return frame(c, n, 'WEEKDAY PERFORMANCE DEEP DIVE', `${w.winners.join(' and ')} convert spend best; ${w.priorities.join(', ')} take ${w.priorityShare.spend}% of spend for ${w.priorityShare.units}% of units`,
      `<div class="rs-body"><div class="two bottom charts"><div><div class="rs-sub">ROAS by weekday</div>${vBars(roas, 640, 250, (v) => `${v.toFixed(2)}x`, 1, 4)}</div><div><div class="rs-sub">Spend per reported unit by weekday</div>${vBars(unit, 640, 250, (v) => inr(v))}</div></div>`
      + `<div class="rgrid g3">${panel(`Relative winners: ${w.winners.join(' & ')}`, `<p class="rp-p">ROAS ${roasText(wr)} with ${w.winnerShare.spend}% of spend yielding ${w.winnerShare.units}% of units. Review keywords, placements and stock before replicating.</p>`)}${panel(`Priorities: ${w.priorities.join(', ')}`, `<p class="rp-p">ROAS ${roasText(pr)}; ${w.priorityShare.spend}% of spend, ${w.priorityShare.units}% of units.</p>`, 'pink')}${panel('Caution', `<p class="rp-p">Each weekday merges ${Math.min(...w.days.map((x) => x.daysWithData))}–${Math.max(...w.days.map((x) => x.daysWithData))} days, so causation is unproven. Validate with date-level campaign data.</p>`, 'warm')}</div></div>`,
      'Source: daily campaign rows. Green = best weekdays, red = weakest weekdays, blue = the rest.');
  };
}

function funnelSlide(c: Ctx): SlideFn {
  return (n) => {
    const f = c.d.funnel!;
    const blocks = `<div class="rfun"><div class="fb f1"><b>${num(f.impressions)}</b><span>impressions</span></div><div class="fa">▼ <b>${f.atcRatePct === null ? 'n/a' : `${f.atcRatePct}%`}</b> of impressions add to cart</div><div class="fb f2"><b>${num(f.atc)}</b><span>add-to-carts</span></div><div class="fa">▼ <b>${f.unitsPerAtcPct === null ? 'n/a' : `${f.unitsPerAtcPct}%`}</b> units ÷ add-to-carts (directional only)</div><div class="fb f3"><b>${num(f.units)}</b><span>reported units</span></div></div>`;
    return frame(c, n, 'CONVERSION FUNNEL AND EFFICIENCY', `Only ${f.atcRatePct === null ? 'a small share' : `${f.atcRatePct}%`} of impressions become add-to-carts, and each add-to-cart costs about ${inr(f.spendPerAtc)} in ad spend`,
      `<div class="rs-body two"><div>${blocks}${takeaway(c.d.insights.funnel ?? '')}</div><div><div class="rgrid g2">${kpi(f.atcRatePct === null ? 'n/a' : `${f.atcRatePct}%`, 'Add-to-carts per impression', `${num(f.atc)} ÷ ${num(f.impressions)}`)}${kpi(f.unitsPerAtcPct === null ? 'n/a' : `${f.unitsPerAtcPct}%`, 'Units per add-to-cart', `${num(f.units)} ÷ ${num(f.atc)}; not a true conversion rate`, 'amber')}${kpi(inr(f.spendPerAtc, 2), 'Spend per add-to-cart', `${inr(f.spend, 2)} ÷ ${num(f.atc)}`)}${kpi(inr(f.spendPerUnit, 2), 'Spend per reported unit', `${inr(f.spend, 2)} ÷ ${num(f.units)}`, 'bad')}</div>${panel('Read with care', `<p class="rp-p">Event definitions and attribution windows may differ between add-to-carts and units. Needed next: clicks, CTR, CPC, orders and the attribution window.</p>`, 'warm')}</div></div>`,
      'Source: daily campaign rows. The funnel is a stylised view; bar widths are not to scale.');
  };
}

function keywordsSlide(c: Ctx): SlideFn {
  return (n) => {
    const k = c.d.keywords!; const list: ReportKeyword[] = k.list.slice(0, 7);
    const test = list.filter((x) => x.tone === 'amber').length; const restrict = list.filter((x) => x.tone === 'red').length;
    const rows = list.map((x, i) => [`${i + 1}`, `<b>${esc(short(x.keyword, 30))}</b>`, `<span class="dc ${x.tone}">${esc(x.decision)}</span>`, esc(x.signal), esc(x.evidence), esc(x.action)]);
    return frame(c, n, 'KEYWORD RANKING AND DECISIONS', `${test ? `${test} keyword${test === 1 ? '' : 's'} merit${test === 1 ? 's' : ''} a controlled test` : 'No keyword stands out yet'}${restrict ? `; ${restrict} should be restricted until clicks, spend and relevance are known` : '; clicks and relevance are still unknown'}`,
      `<div class="rs-body">${table(['#', 'Keyword', 'Decision', 'Reported signal', 'Evidence strength', 'Next action'], rows, { numFrom: 99, widths: '4%,20%,16%,20%,14%,26%' })}${panel('', `<p class="rp-p"><b>Guardrails:</b> one sale is a signal, not proof; zero sales without click and sample-size context does not prove a term unviable. Clicks and keyword-to-product mapping were not supplied. The decisions above are suggested by simple rules on spend and ROAS only.</p>`, 'pink')}</div>`,
      `Source: daily campaign rows with a keyword (${k.total} keyword${k.total === 1 ? '' : 's'} in total; the top ${list.length} by spend are shown).`);
  };
}

function economicsSlide(c: Ctx): SlideFn {
  return (n) => {
    const a = c.d.ads!; const months = a.months.slice(-2); const margins = [20, 30, 40, 50, 60];
    const actualProfit = c.s.includeProfit && c.d.profit && c.d.profit.breakEvenRoas !== null ? c.d.profit : null;
    const groups: Group[] = [
      ...margins.map((m) => ({ label: `Break-even @ ${m}% margin`, values: [{ value: 100 / m, color: SLATE, text: `${(100 / m).toFixed(2)}x` }] })),
      ...(actualProfit ? [{ label: 'Break-even from cost sheet', values: [{ value: actualProfit.breakEvenRoas!, color: AMBER, text: `${actualProfit.breakEvenRoas!.toFixed(2)}x` }] }] : []),
      ...months.map((m) => ({ label: `${monthWord(m.label).slice(0, 3)} actual`, values: [{ value: m.roas ?? 0, color: RED, text: roasText(m.roas) }] })),
    ];
    const rows = margins.map((m) => [`${m}%`, `<b>${(100 / m).toFixed(2)}x</b>`, ...months.map((x) => `<span class="bd">${x.roas ? (100 / m / x.roas).toFixed(1) : 'n/a'}x</span>`)]);
    const best = c.d.ads!.latest!;
    return frame(c, n, 'ADVERTISING UNIT ECONOMICS AND BREAK-EVEN ROAS', `ROAS below 1.0x cannot cover ad spend even before product costs; break-even needs ${(100 / 60).toFixed(1)}x–${(100 / 20).toFixed(1)}x at illustrative margins`,
      `<div class="rs-body two"><div><div class="rs-sub">Actual ROAS vs ${actualProfit ? 'break-even ROAS' : 'hypothetical break-even ROAS'}</div>${hGroups(groups, 640, 340, (v) => `${v.toFixed(0)}x`, [], 220)}${takeaway(`At a hypothetical 60% margin, ${monthWord(best.label)}'s ${roasText(best.roas)} is still about ${best.roas ? (100 / 60 / best.roas).toFixed(0) : 'n/a'}x short of break-even.`)}${panel('', `<p class="rp-p"><b>ROAS = attributed revenue ÷ ad spend.</b> Below 1.0x means attributed revenue is under spend. It is not net profit or loss.</p>`)}</div>`
      + `<div>${pill(actualProfit ? 'SCENARIOS ARE HYPOTHETICAL; THE COST-SHEET LINE IS ACTUAL' : 'HYPOTHETICAL: NOT THE BRAND’S ACTUAL MARGINS')}${table(['Contribution margin before ads', 'Break-even ROAS', ...months.map((m) => `x ${monthWord(m.label).slice(0, 3)} ROAS`)], rows, { widths: '34%,22%,22%,22%' })}<div class="rs-note">Break-even ROAS ≈ 1 ÷ contribution margin before ads. “x ROAS” shows how many times ROAS would need to multiply to break even.</div>`
      + `${actualProfit ? panel('From the cost sheet', `<p class="rp-p">Contribution margin before ads: <b>${actualProfit.contributionMarginPct}%</b>, so break-even ROAS is about <b>${actualProfit.breakEvenRoas!.toFixed(2)}x</b> (net sales basis).</p>`, 'warm') : panel('Needed to set the real target (by product)', `<ul class="rul two-col"><li>Net realisation per unit (after discounts, tax)</li><li>Product cost (COGS)</li><li>Blinkit commission and fees</li><li>Logistics, returns and other variable costs</li><li>Repeat-purchase and halo value</li><li>Incremental vs organic sales share</li></ul>`)}</div></div>`,
      'Source: ROAS from daily campaign rows. Margin scenarios are illustrative only.');
  };
}

function profitSlide(c: Ctx): SlideFn {
  return (n) => {
    const p = c.d.profit!;
    const rows = p.months.map((m) => [`<b>${esc(m.label)}${m.partial ? '*' : ''}</b>`, inr(m.netSales), inr(m.productCost), inr(m.fees), `${inr(m.adSpend)}${m.adDataMissing ? '†' : ''}`, inr(m.otherCosts), `<span class="${(m.profit ?? 0) > 0 ? 'gd' : (m.profit ?? 0) < 0 ? 'bd' : ''}">${inr(m.profit)}</span>`, m.marginPct === null ? 'n/a' : `${m.marginPct}%`, m.roiPct === null ? 'n/a' : `${m.roiPct}%`]);
    const bars: Bar[] = p.months.map((m) => ({ label: monthWord(m.label), value: Math.abs(m.profit ?? 0), color: (m.profit ?? 0) >= 0 ? GREEN : RED, text: inr(m.profit) }));
    const prod = p.products.slice(0, 6).map((x) => [esc(short(x.name, 32)), num(x.units), `<span class="${(x.profitPerUnit ?? 0) >= 0 ? 'gd' : 'bd'}">${inr(x.profitPerUnit, 2)}</span>`, x.marginPct === null ? 'n/a' : `${x.marginPct}%`]);
    return frame(c, n, 'PROFIT AND ROI', `${p.totals.profit >= 0 ? 'Profit' : 'Loss'} of ${inr(Math.abs(p.totals.profit))} on ${inr(p.totals.netSales)} of net sales across ${p.months.length} month${p.months.length === 1 ? '' : 's'}`,
      `<div class="rs-body"><div class="rgrid g4 compact">${kpi(inr(p.totals.profit), 'Profit / loss', 'After product cost, fees, ads and other costs', p.totals.profit >= 0 ? 'good' : 'bad')}${kpi(inr(p.totals.netSales), 'Net sales', 'Sales without tax')}${kpi(inr(p.totals.totalCosts), 'Total costs', `Ads ${inr(p.totals.adSpend)}`)}${kpi(p.totals.totalCosts > 0 ? `${(Math.round((p.totals.profit / p.totals.totalCosts) * 1000) / 10)}%` : 'n/a', 'Overall ROI', 'Profit ÷ total costs', p.totals.profit >= 0 ? 'good' : 'bad')}</div>`
      + `${table(['Month', 'Net sales', 'Product cost', 'Blinkit fees', 'Ad spend', 'Other costs', 'Profit / loss', 'Margin', 'ROI'], rows, { widths: '15%,12%,12%,12%,11%,11%,13%,7%,7%' })}<div class="rs-note">* Partial month. † No advertising upload for that month, so ad spend counts as ₹0.</div>`
      + `<div class="two bottom"><div><div class="rs-sub">Profit or loss by month (bar size; red = loss)</div>${vBars(bars, 600, 190, (v) => inr(v), undefined, 3)}</div><div>${prod.length ? `<div class="rs-sub">Profit per unit, before advertising</div>${table(['Product', 'Units', 'Profit / unit', 'Margin'], prod.slice(0, 4), { widths: '46%,14%,22%,18%' })}` : ''}</div></div></div>`,
      'Source: cost sheet and sales uploaded to the dashboard. Profit = net sales − product cost − Blinkit fees − ad spend − other costs.');
  };
}

function decisionsSlide(c: Ctx): SlideFn {
  return (n) => {
    const m = c.d.insights.management;
    const col = (title: string, color: string, glyph: string, items: string[]): string => `<div class="rdc"><div class="rdc-i" style="background:${color}">${glyph}</div><div class="rdc-t">${esc(title)}</div>${items.length ? `<ul>${items.slice(0, 3).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="mu2">Nothing flagged by the data.</p>'}</div>`;
    return `<section class="rs dark"><div class="rs-label light">FINAL RECOMMENDATIONS AND MANAGEMENT DECISIONS</div><h2 class="rs-title light">Management decisions: continue, optimize, restrict, fix and measure</h2>`
      + `<div class="rs-body"><div class="rdcs">${col('CONTINUE', GREEN, '✓', m.continue)}${col('OPTIMIZE', '#2F4B6E', '✎', m.optimize)}${col('RESTRICT OR PAUSE', RED, 'Ⅱ', m.restrict)}${col('FIX OPERATIONALLY', TEAL, '⌂', m.fix)}${col('MEASURE BEFORE SCALING', AMBER, '▥', m.measure)}</div></div>`
      + `<div class="rbanner">Reconcile the data, fix availability, improve advertising economics, prove incrementality, then scale.</div><div class="rs-foot light"><span>${esc(c.brand)} × Blinkit | Sales, advertising &amp; growth review</span><span>${n}</span></div></section>`;
  };
}

function appendixSlide(c: Ctx): SlideFn {
  return (n) => {
    const d = c.d; const rows: string[][] = [];
    if (d.sales) rows.push(['Product sales (monthly)', `${rangeText(d.sales.months[0].from, d.sales.latest.to)}`, d.sales.latest.partial ? `${monthWord(d.sales.latest.label)} is partial (${d.sales.latest.days} of ${d.sales.latest.fullDays} days)` : 'Full months']);
    d.coverage.ads.forEach((a) => rows.push([`Advertising, ${a.label}`, rangeText(a.from, a.to), 'Daily campaign rows']));
    if (d.weekday) rows.push(['Weekday and keyword views', `${d.coverage.adDays} days with data`, 'Built from the same daily rows; days of the same weekday are merged']);
    if (d.stock) rows.push(['Stock', 'Latest stock upload', `${d.stock.totals.listings} listings`]);
    return frame(c, n, 'APPENDIX: DATA COVERAGE, DEFINITIONS AND LIMITATIONS', 'Every figure comes from uploaded reports; here is what each covers and how the measures are defined',
      `<div class="rs-body two"><div>${table(['Dataset', 'Covers', 'Note'], rows, { numFrom: 99, widths: '34%,26%,40%' })}${panel('', `<p class="rp-p"><b>Not added together:</b> product sales, advertising and stock come from different reports with different windows; each is shown on its own basis.</p>`, 'warm')}</div>`
      + `<div>${panel('Definitions and limitations', `<ul class="rul"><li><b>ROAS:</b> attributed revenue ÷ ad spend; below 1.0x means attributed revenue is under spend, before costs.</li><li><b>Spend per attributed unit:</b> spend ÷ reported attributed units; not necessarily the true acquisition cost.</li><li><b>Run-rate:</b> units so far ÷ days so far × days in the month; a straight line, not a forecast.</li><li><b>Break-even ROAS:</b> ≈ 1 ÷ contribution margin before ads.</li><li><b>Spend per 1,000 impressions:</b> derived (spend ÷ impressions × 1,000).</li><li><b>Limits:</b> attribution is not incrementality. Clicks, CTR, CPC and keyword-to-product mapping are not in the uploaded data.</li></ul>`)}</div></div>`,
      'Figures are shown as supplied; nothing was adjusted to make datasets agree.');
  };
}

// ---------------------------------------------------------------------------------------------
// Assembly and styles
// ---------------------------------------------------------------------------------------------
export const REPORT_CSS = `
.rpt{font-family:'Lato','Segoe UI',Calibri,Arial,sans-serif;color:#1a2330;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.rpt *{box-sizing:border-box}
.rpt svg{max-width:100%;height:auto;display:block}
.rpt .rs{position:relative;width:1456px;height:818px;background:#fff;overflow:hidden;margin:0 auto 24px;box-shadow:0 2px 14px rgba(0,0,0,.18);page-break-after:always;break-after:page}
.rpt .rs-label{position:absolute;left:65px;top:34px;font-size:13px;letter-spacing:3.2px;font-weight:800;color:${TEAL};text-transform:uppercase}
.rpt .rs-label.light{color:#C9D6E4}
.rpt .rs-title{position:absolute;left:65px;right:65px;top:60px;margin:0;font-family:Georgia,'PT Serif','Times New Roman',serif;font-size:33px;line-height:1.2;color:${NAVY};font-weight:700}
.rpt .rs-title.light{color:#fff}
.rpt .rs-body{position:absolute;left:65px;right:65px;top:172px;bottom:84px}
.rpt .rs-src{position:absolute;left:65px;right:65px;bottom:50px;font-size:12px;color:${SLATE}}
.rpt .rs-foot{position:absolute;left:65px;right:65px;bottom:24px;display:flex;justify-content:space-between;font-size:13px;color:${SLATE}}
.rpt .rs-foot.light{color:#C9D6E4}
.rpt .rs-sub{font-size:17px;font-weight:800;color:${NAVY};margin:0 0 10px}
.rpt .rs-note{font-size:13px;color:${SLATE};margin:6px 0 10px}
.rpt .two{display:grid;grid-template-columns:1fr 1fr;gap:34px}
.rpt .two.wide{grid-template-columns:1.08fr .92fr}
.rpt .two.prod{grid-template-columns:1.32fr .68fr;gap:30px}
.rpt .two.camp{grid-template-columns:.9fr 1.1fr}
.rpt .two.bottom{margin-top:14px}
.rpt .spacer{height:14px}
.rpt .rgrid{display:grid;gap:14px;margin-bottom:14px}
.rpt .rgrid.g2{grid-template-columns:1fr 1fr}.rpt .rgrid.g3{grid-template-columns:1fr 1fr 1fr}.rpt .rgrid.g4{grid-template-columns:repeat(4,1fr)}
.rpt .rgrid.tight{gap:14px 16px}
.rpt .rk{background:#F2F4F8;border-radius:10px;padding:20px 22px;min-width:0}
.rpt .rgrid.compact .rk{padding:12px 18px}.rpt .rgrid.compact .rk-v{font-size:28px}.rpt .rgrid.compact{margin-bottom:10px}
.rpt .rgrid.big .rk{min-height:152px;padding:22px 26px}.rpt .rgrid.big .rk-v{font-size:38px}.rpt .rgrid.big .rk-l{font-size:16px}.rpt .rgrid.big .rk-s{font-size:14px}
.rpt .rk-h{font-size:12px;letter-spacing:3px;font-weight:800;color:${TEAL};margin-bottom:6px}
.rpt .rk-v{font-family:Georgia,'PT Serif',serif;font-size:34px;font-weight:700;color:${NAVY};line-height:1.15}
.rpt .rk-v.big{font-size:40px}.rpt .rk-v.good{color:${GREEN}}.rpt .rk-v.bad{color:${RED}}.rpt .rk-v.amber{color:${AMBER}}.rpt .rk-v.teal{color:${TEAL}}
.rpt .rk-l{font-size:15px;font-weight:700;color:#1a2330;margin-top:6px}
.rpt .rk-s{font-size:13px;color:${SLATE};margin-top:6px;line-height:1.35}
.rpt .rt{background:#E6EFF0;border-radius:8px;padding:14px 20px;font-size:16px;line-height:1.35;margin:12px 0 10px}
.rpt .rt b{color:${TEAL};letter-spacing:2px;font-size:12px;margin-right:8px}
.rpt .rp{background:#F2F4F8;border-radius:10px;padding:14px 20px;margin-bottom:12px}
.rpt .rp.warm{background:#F4EADC}.rpt .rp.pink{background:#F4E4E4}
.rpt .rp-t{font-size:17px;font-weight:800;color:${NAVY};margin-bottom:6px}
.rpt .rp-p{margin:5px 0;font-size:14.5px;line-height:1.4}
.rpt .rul{margin:4px 0 0;padding-left:20px;font-size:14.5px;line-height:1.4}.rpt .rul li{margin:6px 0}
.rpt .rul.two-col{columns:2;column-gap:28px}
.rpt .rpill{display:inline-block;color:#fff;font-size:12px;letter-spacing:2.4px;font-weight:800;padding:8px 20px;border-radius:20px;margin-bottom:12px}
.rpt .rpill.amber{background:${AMBER}}.rpt .rpill.teal{background:${TEAL}}.rpt .rpill.red{background:${RED}}
.rpt .rtb{width:100%;border-collapse:collapse;margin-bottom:10px;table-layout:fixed}
.rpt .rtb th{background:${NAVY};color:#fff;font-size:14px;font-weight:700;text-align:left;padding:10px 12px}
.rpt .rtb th.n,.rpt .rtb td.n{text-align:right}
.rpt .rtb td{font-size:14.5px;padding:8px 12px;border-bottom:1px solid #E3E7EE;vertical-align:middle;overflow-wrap:anywhere}
.rpt .rtb tr.tot td{background:#F2F4F8}
.rpt .rtb .sub{font-size:12px;color:${SLATE};font-weight:400}
.rpt .gd{color:${GREEN};font-weight:700}.rpt .bd{color:${RED};font-weight:700}.rpt .mu{color:${SLATE};font-weight:700}.rpt .mu2{color:#AFC0D4;font-size:15px}
.rpt .dc{display:inline-block;font-weight:700;font-size:13.5px;padding:7px 10px;text-align:center;width:100%}
.rpt .dc.red{background:${RED};color:#fff}.rpt .dc.amber{background:#F1E1C9;color:#222}.rpt .dc.grey{background:#E8EBF0;color:#222}
.rpt .rleg{display:flex;gap:22px;font-size:14px;margin:4px 0 0}.rpt .rleg i{display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:-1px}
.rpt .rdec{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:6px}.rpt .rs-sub{margin-top:8px}
.rpt .rdec-i{background:#F2F4F8;border-radius:10px;padding:22px 22px;display:flex;gap:14px;font-size:16px;line-height:1.35;font-weight:600;color:${NAVY}}
.rpt .rdec-n{flex:none;width:34px;height:34px;border-radius:50%;background:${TEAL};color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center}
.rpt .rfun{display:flex;flex-direction:column;align-items:center;gap:10px}
.rpt .rfun .fb{color:#fff;text-align:center;padding:16px 0;border-radius:6px}
.rpt .rfun .fb b{display:block;font-family:Georgia,serif;font-size:38px}.rpt .rfun .fb span{font-size:16px}
.rpt .rfun .f1{width:100%;background:${BLUE}}.rpt .rfun .f2{width:62%;background:${TEAL}}.rpt .rfun .f3{width:38%;background:${NAVY}}
.rpt .rfun .fa{font-size:15px;color:#333;align-self:flex-start}
.rpt .cover{background:${NAVY};color:#fff}
.rpt .cover .c1{position:absolute;right:-250px;top:-190px;width:760px;height:760px;border-radius:50%;background:#14516A}
.rpt .cover .c2{position:absolute;right:-190px;bottom:-320px;width:460px;height:460px;border-radius:50%;background:#1B4170}
.rpt .cv-label{position:absolute;left:98px;top:190px;font-size:16px;letter-spacing:5.5px;font-weight:800}
.rpt .cv-title{position:absolute;left:98px;top:238px;font-family:Georgia,'PT Serif',serif;font-size:76px;font-weight:700}
.rpt .cv-sub{position:absolute;left:98px;top:392px;width:820px;font-size:32px;line-height:1.3;color:#E6EDF6}
.rpt .cv-meta{position:absolute;left:98px;top:580px;font-size:19px;line-height:1.6;color:#E6EDF6}
.rpt .dark{background:${NAVY}}
.rpt .rdcs{display:grid;grid-template-columns:repeat(5,1fr);gap:18px;height:430px}
.rpt .rdc{background:#1F4E79;border-radius:10px;padding:22px 20px;color:#fff}
.rpt .rdc-i{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:18px}
.rpt .rdc-t{font-weight:800;letter-spacing:2px;font-size:16px;margin-bottom:14px}
.rpt .rdc ul{margin:0;padding-left:18px;font-size:16px;line-height:1.4}.rpt .rdc li{margin-bottom:10px}
.rpt .rbanner{position:absolute;left:65px;right:65px;bottom:62px;height:96px;background:${TEAL};border-radius:10px;color:#fff;font-family:Georgia,'PT Serif',serif;font-size:30px;font-weight:700;display:flex;align-items:center;padding:0 32px;line-height:1.25}
@page{size:1456px 818px;margin:0}
@media print{.rpt .rs{margin:0;box-shadow:none}}
`;

/** Builds the whole report as HTML (every figure and text is escaped), one 16:9 page per slide. */
export function renderReport(data: BrandReport, settings: ReportSettings): string {
  const c: Ctx = { d: data, s: settings, brand: data.brand };
  const can = availableSections(data, settings.includeProfit, settings.inputs);
  const on = (key: string): boolean => can[key] === true && settings.sections[key] !== false;
  const slides: SlideFn[] = [coverSlide(c)];
  if (on('summary')) slides.push(summarySlide(c));
  if (on('scope')) slides.push(scopeSlide(c));
  if (on('trajectory')) slides.push(trajectorySlide(c));
  if (on('products')) slides.push(productsSlide(c));
  if (on('concentration')) slides.push(concentrationSlide(c));
  if (on('stock')) slides.push(stockSlide(c));
  if (on('availability')) slides.push(availabilitySlide(c));
  if (on('ads') && data.ads) data.ads.months.slice(-3).forEach((m) => slides.push(adsMonthSlide(c, m)));
  if (on('campaigns')) slides.push(campaignsSlide(c));
  if (on('efficiency')) slides.push(efficiencySlide(c));
  if (on('weekday')) { slides.push(weekdaySlide(c)); if (data.weekday && data.weekday.winners.length) slides.push(weekdayDeepSlide(c)); }
  if (on('funnel')) slides.push(funnelSlide(c));
  if (on('keywords')) slides.push(keywordsSlide(c));
  if (on('economics')) slides.push(economicsSlide(c));
  if (on('profit')) slides.push(profitSlide(c));
  if (on('decisions')) slides.push(decisionsSlide(c));
  if (on('appendix')) slides.push(appendixSlide(c));
  return `<div class="rpt"><style>${REPORT_CSS}</style>${slides.map((fn, i) => fn(i + 1)).join('')}</div>`;
}
