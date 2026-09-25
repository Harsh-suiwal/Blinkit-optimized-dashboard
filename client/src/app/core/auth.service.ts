import { Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { User } from './models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<User | null>(null);

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
