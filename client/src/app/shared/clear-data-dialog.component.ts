import { Component, HostListener, OnInit, computed, input, output, signal } from '@angular/core';

/** Asks which brand's data to delete (or all brands) before anything is removed. */
@Component({
  selector: 'app-clear-data-dialog',
  template: `
    <div class="dialog-backdrop" (click)="cancel.emit()">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="clearDialogTitle" (click)="$event.stopPropagation()">
        <h2 id="clearDialogTitle">Clear {{ scope() }} data</h2>
        <label class="filter-label" for="clearBrandSelect">Which brand?</label>
        <select id="clearBrandSelect" [value]="choice()" (change)="choice.set(selectValue($event))">
          <option value="" [selected]="choice() === ''">All brands</option>
          @for (brand of brands(); track brand) { <option [value]="brand" [selected]="brand === choice()">{{ brand }}</option> }
        </select>
        <p class="dialog-warning">{{ warning() }}</p>
        <div class="dialog-actions">
          <button type="button" class="secondary-btn" (click)="cancel.emit()">Cancel</button>
          <button type="button" class="secondary-btn danger-btn" (click)="confirm.emit(choice())">Delete {{ choice() || 'all brands' }}</button>
        </div>
      </div>
    </div>
  `,
})
export class ClearDataDialogComponent implements OnInit {
  readonly scope = input.required<string>();
  readonly brands = input.required<string[]>();
  /** Brand to preselect (usually the active brand filter). */
  readonly initialBrand = input('');
  /** Extra sentence for what is kept, e.g. upload history. */
  readonly note = input('');
  readonly confirm = output<string>();
  readonly cancel = output<void>();
  readonly choice = signal('');
  readonly warning = computed(() => {
    const target = this.choice() ? `for ${this.choice()} only. Other brands are kept.` : 'for ALL brands.';
    return `This permanently deletes ${this.scope()} data ${target} ${this.note()} This cannot be undone.`.replace('  ', ' ');
  });

  ngOnInit() {
    const wanted = this.initialBrand().toLowerCase();
    this.choice.set(this.brands().find((brand) => brand.toLowerCase() === wanted) ?? '');
  }

  selectValue(event: Event) { return (event.target as HTMLSelectElement).value; }

  @HostListener('document:keydown.escape')
  close() { this.cancel.emit(); }
}
