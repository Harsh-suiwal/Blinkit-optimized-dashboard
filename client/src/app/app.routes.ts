import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { AppShellComponent } from './layout/app-shell.component';
import { InventoryPageComponent } from './pages/inventory-page.component';
import { SalesPageComponent } from './pages/sales-page.component';
import { CampaignPageComponent } from './pages/campaign-page.component';

export const routes: Routes = [
  {
    path: '',
    component: AppShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'inventory' },
      { path: 'inventory', component: InventoryPageComponent },
      { path: 'sales-performance', component: SalesPageComponent },
      { path: 'campaign-analysis', component: CampaignPageComponent },
    ],
  },
  { path: '**', redirectTo: '' },
];
