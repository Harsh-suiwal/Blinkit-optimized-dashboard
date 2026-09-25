import { CanActivateFn } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  if (auth.user() || await auth.loadSession()) return true;
  window.location.assign('/login');
  return false;
};
