import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UiStateService } from './ui-state.service';

/** /present: starts presenting the brand picked in the sidebar, then opens the Overview. */
export const presentGuard: CanActivateFn = () => {
  inject(UiStateService).startPresenting();
  return inject(Router).createUrlTree(['/overview']);
};

/** Pages that are not for clients (Profit, Profile, Reports, Uploads, platforms): while presenting they send you back to the Overview. */
export const notWhilePresentingGuard: CanActivateFn = () =>
  inject(UiStateService).presenting() ? inject(Router).createUrlTree(['/overview']) : true;
