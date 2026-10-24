import { Component, HostListener, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { UiStateService } from '../core/ui-state.service';

@Component({
  selector: 'app-shell',
  imports: [FormsModule, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <nav class="sidebar" [class.collapsed]="ui.collapsed()">
      <div class="sidebar-focus sidebar-workspace">
        <label class="sidebar-focus-label" for="brandFocusSelect">Brand</label>
        <div class="brand-switcher">
          <span class="brand-avatar" aria-hidden="true">{{ brandInitial() }}</span>
          <select id="brandFocusSelect" class="sidebar-focus-select" [ngModel]="ui.focusedBrand()" (ngModelChange)="ui.setBrand($event)">
            <option value="">All brands</option>
            @for (brand of brands(); track brand) { <option [value]="brand">{{ brand }}</option> }
          </select>
        </div>
      </div>
      <ul class="sidebar-nav">
        <li><a routerLink="/overview" routerLinkActive="active"><span class="sidebar-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1"/><path d="M5 16h4a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1"/><path d="M15 12h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1"/><path d="M15 4h4a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1"/></svg></span><span class="sidebar-label">Overview</span></a></li>
        <li><a routerLink="/sales-performance" routerLinkActive="active"><span class="sidebar-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M4 20h14"/></svg></span><span class="sidebar-label">Sales</span></a></li>
        <li><a routerLink="/inventory" routerLinkActive="active"><span class="sidebar-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5"/><path d="M12 12l8 -4.5"/><path d="M12 12l0 9"/><path d="M12 12l-8 -4.5"/><path d="M16 5.25l-8 4.5"/></svg></span><span class="sidebar-label">Stock</span></a></li>
        <li><a routerLink="/campaign-analysis" routerLinkActive="active"><span class="sidebar-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a3 3 0 0 1 0 6"/><path d="M10 8v11a1 1 0 0 1 -1 1h-1a1 1 0 0 1 -1 -1v-5"/><path d="M12 8h0l4.524 -3.77a.9 .9 0 0 1 1.476 .692v12.156a.9 .9 0 0 1 -1.476 .692l-4.524 -3.77h-8a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h8"/></svg></span><span class="sidebar-label">Advertising</span></a></li>
        <li><a routerLink="/monthly-comparison" routerLinkActive="active"><span class="sidebar-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.795 21h-6.795a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v4"/><path d="M18 14v4h4"/><path d="M18 18m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M15 3v4"/><path d="M7 3v4"/><path d="M3 11h16"/></svg></span><span class="sidebar-label">Trends</span></a></li>
        <li><a routerLink="/reports" routerLinkActive="active"><span class="sidebar-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/><path d="M9 9l1 0"/><path d="M9 13l6 0"/><path d="M9 17l6 0"/></svg></span><span class="sidebar-label">Reports</span></a></li>
        @if (auth.user()?.role === 'admin') {
          <li class="sidebar-section-label" aria-hidden="true">Admin</li>
          <li><a routerLink="/uploads" routerLinkActive="active"><span class="sidebar-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 9l5 -5l5 5"/><path d="M12 4l0 12"/></svg></span><span class="sidebar-label">Uploads</span></a></li>
        }
      </ul>

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
        <strong>Go to:</strong> <kbd>O</kbd> Overview <kbd>S</kbd> Sales <kbd>I</kbd> Stock <kbd>C</kbd> Advertising <kbd>M</kbd> Trends
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

  /** First letter of the selected brand for the switcher badge ("A" for All brands). */
  brandInitial() {
    return (this.ui.focusedBrand().trim().charAt(0) || 'A').toUpperCase();
  }
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
