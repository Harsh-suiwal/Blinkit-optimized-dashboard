import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

/**
 * Placeholder for features that are planned but not built yet (Reports, Uploads, Present,
 * other platforms). The route's data supplies the title and the description.
 */
@Component({
  selector: 'app-coming-soon-page',
  imports: [RouterLink],
  template: `
    <header class="topbar">
      <div class="topbar-left"><div><h1>{{ title }}</h1><span class="muted">Coming soon</span></div></div>
    </header>
    <section class="coming-soon">
      <span class="coming-soon-badge">Coming soon</span>
      <h2>{{ title }} is on its way</h2>
      <p>{{ description }}</p>
      <a class="secondary-btn" routerLink="/overview">Back to overview</a>
    </section>
  `,
})
export class ComingSoonPageComponent {
  private readonly route = inject(ActivatedRoute);
  readonly title: string = this.route.snapshot.data['title'] ?? 'This page';
  readonly description: string = this.route.snapshot.data['description'] ?? 'This part of the dashboard is being built.';
}
