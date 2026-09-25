import { Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { UiStateService } from '../core/ui-state.service';
import { BrandMarkComponent } from '../shared/brand-mark.component';
import { FEEDER_CITY_MAP } from '../core/feeder-map';

@Component({
  selector: 'app-shell',
  imports: [FormsModule, RouterLink, RouterLinkActive, RouterOutlet, BrandMarkComponent],
  template: `
    <nav class="sidebar" [class.collapsed]="ui.collapsed()">
      <div class="sidebar-brand"><app-brand-mark /><span>Blinkit Dashboard</span></div>
      <ul class="sidebar-nav">
        <li><a routerLink="/inventory" routerLinkActive="active"><span class="sidebar-icon">📦</span><span class="sidebar-label">Inventory Dashboard</span></a></li>
        <li><a routerLink="/sales-performance" routerLinkActive="active"><span class="sidebar-icon">📍</span><span class="sidebar-label">Sales Performance</span></a></li>
        <li><a routerLink="/campaign-analysis" routerLinkActive="active"><span class="sidebar-icon">📊</span><span class="sidebar-label">Campaign Analysis</span></a></li>
      </ul>

      <div class="sidebar-focus">
        <label class="sidebar-focus-label" for="brandFocusSelect">Brand Filter</label>
        <select id="brandFocusSelect" class="sidebar-focus-select" [ngModel]="ui.focusedBrand()" (ngModelChange)="selectBrand($event)">
          <option value="">All brands</option>
          @for (brand of brands(); track brand) { <option [value]="brand">{{ brand }}</option> }
        </select>
        <label class="sidebar-focus-label" for="productFocusSelect">Product Focus</label>
        <select id="productFocusSelect" class="sidebar-focus-select" [ngModel]="ui.focusedProduct()" (ngModelChange)="ui.setFocus($event)">
          <option value="">All products</option>
          @for (product of filteredProducts(); track product) { <option [value]="product">{{ product }}</option> }
        </select>
        <label class="sidebar-focus-label" for="feederFocusSelect">Feeder City</label>
        <select id="feederFocusSelect" class="sidebar-focus-select" [ngModel]="ui.focusedFeeder()" (ngModelChange)="ui.setFeeder($event)">
          <option value="">All feeder cities</option>
          @for (feeder of feederNames; track feeder) { <option [value]="feeder">{{ feeder }}</option> }
        </select>
      </div>

      <div class="sidebar-footer">
        <button type="button" class="theme-toggle" (click)="ui.toggleTheme()" aria-label="Toggle dark mode" title="Toggle theme (Alt+T)">
          <span class="theme-toggle-icon">{{ ui.theme() === 'dark' ? '☀️' : '🌙' }}</span>
        </button>
      </div>
      <div class="sidebar-resize-handle" title="Drag to resize" (mousedown)="startResize($event)"></div>
    </nav>

    <button type="button" class="sidebar-collapse-toggle" [class.collapsed]="ui.collapsed()" [style.left.px]="ui.collapsed() ? 0 : ui.sidebarWidth() - 14" [attr.aria-expanded]="!ui.collapsed()" (click)="ui.toggleSidebar()" title="Collapse sidebar (Ctrl+Shift+E)">
      <span class="arrow">→</span>
    </button>

    @if (leaderActive()) {
      <div class="shortcut-hint" role="status" aria-live="polite">
        <strong>Go to:</strong> <kbd>I</kbd> Inventory <kbd>S</kbd> Sales <kbd>C</kbd> Campaign
      </div>
    }

    <main class="main-content" [class.sidebar-collapsed]="ui.collapsed()">
      @if (ui.focusedProduct() || ui.focusedBrand() || ui.focusedFeeder()) {
        <div class="focus-banner">
          <span>🎯 Focus filters: @if (ui.focusedBrand()) { brand <strong>{{ ui.focusedBrand() }}</strong> } @if (ui.focusedProduct()) { product <strong>{{ ui.focusedProduct() }}</strong> } @if (ui.focusedFeeder()) { feeder hub <strong>{{ ui.focusedFeeder() }}</strong> }</span>
          <button type="button" class="focus-banner-clear" (click)="ui.clearFocus()">Exit focus ×</button>
        </div>
      }
      <router-outlet />
    </main>
  `,
})
export class AppShellComponent implements OnInit {
  private readonly router = inject(Router);
  readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly ui = inject(UiStateService);
  readonly brands = signal<string[]>([]);
  readonly products = signal<string[]>([]);
  readonly filteredProducts = signal<string[]>([]);
  readonly feederNames = Object.keys(FEEDER_CITY_MAP);
  readonly leaderActive = signal(false);
  private resizing = false;
  private leaderTimer?: ReturnType<typeof setTimeout>;

  async ngOnInit() {
    await this.auth.loadSession();
    try {
      const [brands, products] = await Promise.all([this.api.brandNames(), this.api.productNames()]);
      this.brands.set(brands.brands);
      this.products.set(products.names);
      this.refreshProductOptions();
    } catch {
      // Empty select controls are expected before the first upload.
    }
  }

  selectBrand(brand: string) {
    this.ui.setBrand(brand);
    this.refreshProductOptions();
  }

  startResize(event: MouseEvent) {
    this.resizing = true;
    event.preventDefault();
  }

  @HostListener('document:mousemove', ['$event'])
  resize(event: MouseEvent) {
    if (this.resizing) this.ui.setSidebarWidth(event.clientX);
  }

  @HostListener('document:mouseup')
  stopResize() {
    this.resizing = false;
  }

  @HostListener('document:keydown', ['$event'])
  shortcuts(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || Boolean(target?.isContentEditable);

    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'e') {
      event.preventDefault();
      this.ui.toggleSidebar();
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 't') {
      event.preventDefault();
      this.ui.toggleTheme();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || typing) return;

    const key = event.key.toLowerCase();
    if (this.leaderActive()) {
      this.leaderActive.set(false);
      clearTimeout(this.leaderTimer);
      const routes: Record<string, string> = {
        i: '/inventory',
        s: '/sales-performance',
        c: '/campaign-analysis',
      };
      if (routes[key]) {
        event.preventDefault();
        void this.router.navigateByUrl(routes[key]);
      }
      return;
    }
    if (key === 'g') {
      event.preventDefault();
      this.leaderActive.set(true);
      clearTimeout(this.leaderTimer);
      this.leaderTimer = setTimeout(() => this.leaderActive.set(false), 1500);
    }
  }

  private refreshProductOptions() {
    const brand = this.ui.focusedBrand().toLowerCase();
    this.filteredProducts.set(brand ? this.products().filter((item) => item.toLowerCase().includes(brand)) : this.products());
  }
}
