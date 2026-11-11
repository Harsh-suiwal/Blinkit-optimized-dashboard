import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { AppShellComponent } from './layout/app-shell.component';
import { InventoryPageComponent } from './pages/inventory-page.component';
import { SalesPageComponent } from './pages/sales-page.component';
import { CampaignPageComponent } from './pages/campaign-page.component';
import { BrandOverviewPageComponent } from './pages/brand-overview-page.component';
import { MonthlyPageComponent } from './pages/monthly-page.component';
import { ComingSoonPageComponent } from './pages/coming-soon-page.component';
import { ProfilePageComponent } from './pages/profile-page.component';
import { ProfitPageComponent } from './pages/profit-page.component';
import { UploadsPageComponent } from './pages/uploads-page.component';
import { notWhilePresentingGuard, presentGuard } from './core/present.guard';

export const routes: Routes = [
  {
    path: '',
    component: AppShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      { path: 'overview', component: BrandOverviewPageComponent },
      { path: 'inventory', component: InventoryPageComponent },
      { path: 'sales-performance', component: SalesPageComponent },
      { path: 'monthly-comparison', component: MonthlyPageComponent },
      { path: 'profile', component: ProfilePageComponent, canActivate: [notWhilePresentingGuard] },
      { path: 'profit', component: ProfitPageComponent, canActivate: [notWhilePresentingGuard] },
      // Planned features: each shows a "Coming soon" page until it is built.
      { path: 'reports', component: ComingSoonPageComponent, canActivate: [notWhilePresentingGuard], data: { title: 'Reports', description: 'Create a client-ready report for one brand: pick the months and sections, then download it as a PDF.' } },
      { path: 'uploads', component: UploadsPageComponent, canActivate: [notWhilePresentingGuard], data: { title: 'Uploads', description: 'One place to upload every report, see what was uploaded for each brand, and undo an upload. Until then, upload from the Sales, Stock, Advertising and Trends pages.' } },
      { path: 'present', canActivate: [presentGuard], children: [] },
      { path: 'platforms/all', component: ComingSoonPageComponent, canActivate: [notWhilePresentingGuard], data: { title: 'All platforms', description: 'One combined view of a brand across Blinkit, Zepto and Flipkart Minutes.' } },
      { path: 'platforms/zepto', component: ComingSoonPageComponent, canActivate: [notWhilePresentingGuard], data: { title: 'Zepto', description: "A brand's Zepto sales, stock and advertising, as soon as Zepto reports can be uploaded." } },
      { path: 'platforms/flipkart-minutes', component: ComingSoonPageComponent, canActivate: [notWhilePresentingGuard], data: { title: 'Flipkart Minutes', description: "A brand's Flipkart Minutes sales, stock and advertising, as soon as its reports can be uploaded." } },
      { path: 'campaign-analysis', component: CampaignPageComponent },
    ],
  },
  { path: '**', redirectTo: '' },
];
