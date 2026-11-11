import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { User } from './models';
import { UiStateService } from './ui-state.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly ui = inject(UiStateService);
  readonly user = signal<User | null>(null);
  /** True for an admin outside presentation mode. Every admin-only control checks this one rule. */
  readonly isAdmin = computed(() => this.user()?.role === 'admin' && !this.ui.presenting());

  constructor(private readonly api: ApiService) {}

  async loadSession(): Promise<boolean> {
    try {
      this.user.set((await this.api.me()).user);
      return true;
    } catch {
      this.user.set(null);
      return false;
    }
  }

  async logout(): Promise<void> {
    await this.api.logout();
    this.user.set(null);
    window.location.assign('/login');
  }
}
