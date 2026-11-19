// NEW FILE: client/src/app/core/perm.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { PermKey } from './models';

/** Lets a route through only when the signed-in role has the permission; otherwise goes to Overview. */
export const permGuard = (key: PermKey): CanActivateFn => () => {
  const auth = inject(AuthService);
  if (auth.user()?.perms?.[key]) return true;
  return inject(Router).createUrlTree(['/overview']);
};
