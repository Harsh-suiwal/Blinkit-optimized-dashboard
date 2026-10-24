import { Component, HostListener, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { UiStateService } from '../core/ui-state.service';
import { BrandMarkComponent } from '../shared/brand-mark.component';

@Component({
  selector: 'app-shell',
  imports: [FormsModule, RouterLink, RouterLinkActive, RouterOutlet, BrandMarkComponent],
  template: `
    <nav class="sidebar" [class.collapsed]="ui.collapsed()">
      <div class="sidebar-brand"><app-brand-mark /><span>Blinkit Dashboard</span></div>
      <ul class="sidebar-nav">
        <li><a routerLink="/overview" routerLinkActive="active"><span class="sidebar-icon">🏷️</span><span class="sidebar-label">Brand Overview</span></a></li>
        <li><a routerLink="/inventory" routerLinkActive="active"><span class="sidebar-icon">📦</span><span class="sidebar-label">Inventory Dashboard</span></a></li>
        <li><a routerLink="/sales-performance" routerLinkActive="active"><span class="sidebar-icon">📍</span><span class="sidebar-label">Sales Performance</span></a></li>
        <li><a routerLink="/monthly-comparison" routerLinkActive="active"><span class="sidebar-icon">📅</span><span class="sidebar-label">Monthly Comparison</span></a></li>
        <li><a routerLink="/campaign-analysis" routerLinkActive="active"><span class="sidebar-icon">📊</span><span class="sidebar-label">Campaign Analysis</span></a></li>
      </ul>

      <div class="sidebar-focus">
        <label class="sidebar-focus-label" for="brandFocusSelect">Brand Filter</label>
        <select id="brandFocusSelect" class="sidebar-focus-select" [ngModel]="ui.focusedBrand()" (ngModelChange)="ui.setBrand($event)">
          <option value="">All brands</option>
          @for (brand of brands(); track brand) { <option [value]="brand">{{ brand }}</option> }
        </select>
      </div>

      <div class="sidebar-footer">
        <button type="button" class="theme-switch" role="switch" [attr.aria-checked]="ui.theme() === 'dark'" (click)="ui.toggleTheme()" aria-label="Dark mode" title="Toggle theme (Alt+T)">
          <span class="theme-switch-thumb"></span>
          <span class="theme-switch-icon">☀️</span><span class="theme-switch-icon">🌙</span>
        </button>
        <button type="button" class="sidebar-logout" (click)="auth.logout()" title="Log out" aria-label="Log out">Logout</button>
      </div>
      <div class="sidebar-resize-handle" title="Drag to resize" (mousedown)="startResize($event)"></div>
    </nav>

    <button type="button" class="sidebar-collapse-toggle" [class.collapsed]="ui.collapsed()" [style.left.px]="ui.collapsed() ? 0 : ui.sidebarWidth() - 14" [attr.aria-expanded]="!ui.collapsed()" (click)="ui.toggleSidebar()" title="Collapse sidebar (Ctrl+Shift+E)">
      <span class="arrow">→</span>
    </button>

    @if (leaderActive()) {
      <div class="shortcut-hint" role="status" aria-live="polite">
        <strong>Go to:</strong> <kbd>O</kbd> Overview <kbd>I</kbd> Inventory <kbd>S</kbd> Sales <kbd>M</kbd> Monthly <kbd>C</kbd> Campaign
      </div>
    }

    <main class="main-content" [class.sidebar-collapsed]="ui.collapsed()">
      <router-outlet />
    </main>
  `,
})
export class AppShellComponent implements OnInit {
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  readonly api = inject(ApiService);
  readonly ui = inject(UiStateService);
  readonly brands = signal<string[]>([]);
  readonly leaderActive = signal(false);
  private resizing = false;
  private leaderTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      // Re-read the brand list after an upload / clear, without a page reload.
      if (this.ui.lookupsVersion() > 0) void this.loadBrands();
    });
  }

  async ngOnInit() {
    await this.auth.loadSession();
    await this.loadBrands();
  }

  private async loadBrands() {
    try {
      this.brands.set((await this.api.brandNames()).brands);
    } catch {
      // An empty list is expected before the first upload.
    }
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
        o: '/overview',
        i: '/inventory',
        s: '/sales-performance',
        m: '/monthly-comparison',
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
}
