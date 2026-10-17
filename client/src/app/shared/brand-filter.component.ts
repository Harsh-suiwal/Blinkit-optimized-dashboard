import { Component, computed, input, output } from '@angular/core';
import { money } from '../core/formatters';

export interface BrandChip {
  brandName: string;
  adSpend: number;
}

/** Horizontal brand chip bar; each chip's fill is its share of the total spend. */
@Component({
  selector: 'app-brand-filter',
  template: `
    <div class="brand-chips" role="group" aria-label="Brand filter">
      <button type="button" class="brand-chip" [class.active]="!selected()" (click)="select.emit('')">
        <span class="brand-chip-name">All brands</span><span class="brand-chip-spend">{{ money(totalSpend(), 0) }}</span>
      </button>
      @for (brand of brands(); track brand.brandName) {
        <button type="button" class="brand-chip" [class.active]="isSelected(brand.brandName)" [class.unknown]="brand.brandName === 'Unknown'" (click)="select.emit(brand.brandName)">
          <span class="brand-chip-fill" [style.width.%]="share(brand)"></span>
          <span class="brand-chip-name">{{ brand.brandName }}</span><span class="brand-chip-spend">{{ money(brand.adSpend, 0) }}</span>
        </button>
      }
    </div>
  `,
})
export class BrandFilterComponent {
  readonly brands = input.required<BrandChip[]>();
  readonly selected = input('');
  readonly select = output<string>();
  readonly money = money;
  readonly totalSpend = computed(() => this.brands().reduce((sum, brand) => sum + brand.adSpend, 0));

  isSelected(name: string) { return this.selected().toLowerCase() === name.toLowerCase(); }
  share(brand: BrandChip) { const total = this.totalSpend(); return total > 0 ? Math.max(4, (brand.adSpend / total) * 100) : 0; }
}
