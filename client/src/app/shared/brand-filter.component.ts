import { Component, computed, input, output } from '@angular/core';
import { money, number } from '../core/formatters';

export interface BrandChip {
  brandName: string;
  /** Drives the chip's fill and label (ad spend, stock units, ...). */
  value: number;
}

/**
 * Chips for every brand the app knows about (uploaded in any tab), so the bar looks the
 * same on every tab. Brands with no data in this tab get a zero-value chip.
 */
export function mergeKnownBrands(chips: BrandChip[], known: string[]): BrandChip[] {
  const have = new Set(chips.map((chip) => chip.brandName.toLowerCase()));
  const missing = known.filter((name) => !have.has(name.toLowerCase())).map((brandName) => ({ brandName, value: 0 }));
  return [...chips, ...missing];
}

/** Horizontal brand chip bar; each chip's fill is its share of the total spend. */
@Component({
  selector: 'app-brand-filter',
  template: `
    <div class="brand-chips" role="group" aria-label="Brand filter">
      <button type="button" class="brand-chip" [class.active]="!selected()" (click)="select.emit('')">
        <span class="brand-chip-name">All brands</span><span class="brand-chip-spend">{{ display(totalValue()) }}</span>
      </button>
      @for (brand of brands(); track brand.brandName) {
        <button type="button" class="brand-chip" [class.active]="isSelected(brand.brandName)" [class.unknown]="brand.brandName === 'Unknown'" (click)="select.emit(brand.brandName)">
          <span class="brand-chip-fill" [style.width.%]="share(brand)"></span>
          <span class="brand-chip-name">{{ brand.brandName }}</span><span class="brand-chip-spend">{{ display(brand.value) }}</span>
        </button>
      }
    </div>
  `,
})
export class BrandFilterComponent {
  readonly brands = input.required<BrandChip[]>();
  readonly selected = input('');
  readonly unit = input<'money' | 'units'>('money');
  readonly select = output<string>();
  readonly totalValue = computed(() => this.brands().reduce((sum, brand) => sum + brand.value, 0));

  isSelected(name: string) { return this.selected().toLowerCase() === name.toLowerCase(); }
  display(value: number) { return this.unit() === 'money' ? money(value, 0) : `${number(value)} units`; }
  share(brand: BrandChip) { const total = this.totalValue(); return total > 0 ? Math.max(4, (brand.value / total) * 100) : 0; }
}
