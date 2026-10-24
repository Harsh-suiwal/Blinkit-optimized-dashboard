import { Component, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { UiStateService } from '../core/ui-state.service';

/** The signed-in user's page: appearance settings (style and light / dark) and who is signed in. */
@Component({
  selector: 'app-profile-page',
  template: `
    <header class="topbar">
      <div class="topbar-left"><div><h1>Profile</h1><span class="muted">{{ auth.user()?.email }}</span></div></div>
    </header>
    <section class="profile">
      <div class="overview-list profile-card">
        <h3>Appearance</h3>
        <p class="muted">Saved on this computer only.</p>
        <div class="profile-row">
          <span class="profile-label" id="styleLabel">Style</span>
          <div class="sheet-tabs" role="radiogroup" aria-labelledby="styleLabel">
            <button type="button" role="radio" class="sheet-tab" [class.active]="ui.look() === 'pro'" [attr.aria-checked]="ui.look() === 'pro'" (click)="ui.setLook('pro')">Pro</button>
            <button type="button" role="radio" class="sheet-tab" [class.active]="ui.look() === 'glass'" [attr.aria-checked]="ui.look() === 'glass'" (click)="ui.setLook('glass')">Glass</button>
          </div>
        </div>
        <p class="muted profile-hint">{{ ui.look() === 'pro' ? 'Flat and quiet, made for client meetings.' : 'Translucent glass with colour accents.' }}</p>
        <div class="profile-row">
          <span class="profile-label" id="modeLabel">Mode</span>
          <div class="sheet-tabs" role="radiogroup" aria-labelledby="modeLabel">
            <button type="button" role="radio" class="sheet-tab" [class.active]="ui.theme() !== 'dark'" [attr.aria-checked]="ui.theme() !== 'dark'" (click)="ui.setTheme('light')">Light</button>
            <button type="button" role="radio" class="sheet-tab" [class.active]="ui.theme() === 'dark'" [attr.aria-checked]="ui.theme() === 'dark'" (click)="ui.setTheme('dark')">Dark</button>
          </div>
        </div>
      </div>
      <div class="overview-list profile-card">
        <h3>Account</h3>
        <dl class="profile-facts">
          <div><dt>Email</dt><dd>{{ auth.user()?.email }}</dd></div>
          <div><dt>Role</dt><dd>{{ auth.user()?.role === 'admin' ? 'Admin' : 'Viewer' }}</dd></div>
        </dl>
      </div>
    </section>
  `,
})
export class ProfilePageComponent {
  readonly auth = inject(AuthService);
  readonly ui = inject(UiStateService);
}
