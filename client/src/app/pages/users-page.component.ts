// NEW FILE: client/src/app/pages/users-page.component.ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AdminUser, RoleOption } from '../core/models';

/** Admin-only Users page (route /users). Server enforces manageUsers on every call. */
@Component({
  selector: 'app-users-page',
  imports: [FormsModule],
  template: `
    <header class="topbar">
      <div class="topbar-left"><div><h1>Users</h1><span class="muted">Admins only. A change applies on the user's next click.</span></div></div>
    </header>
    <section class="profile">
      @if (message()) { <p class="muted">{{ message() }}</p> }
      @if (error()) { <p class="muted users-error">{{ error() }}</p> }

      <div class="overview-list profile-card">
        <h3>Brands</h3>
        <p class="muted">Add a brand here before any data is uploaded, then tick it for a user.</p>
        <div class="profile-row">
          <input type="text" [(ngModel)]="newBrand" placeholder="Brand name" />
          <button type="button" class="secondary-btn" (click)="addBrand()" [disabled]="busy()">Add brand</button>
        </div>
        <div class="users-brands">
          @for (b of brands(); track b) {
            <span>{{ b }} <button type="button" class="delete-btn" title="Remove (only if it has no data and no user has it)" (click)="removeBrand(b)">×</button></span>
          }
        </div>
      </div>

      <div class="overview-list profile-card">
        <h3>Add user</h3>
        <div class="profile-row"><span class="profile-label">Email</span><input type="email" [(ngModel)]="newUser.email" /></div>
        <div class="profile-row"><span class="profile-label">Name</span><input type="text" [(ngModel)]="newUser.name" /></div>
        <div class="profile-row"><span class="profile-label">Password</span><input type="password" [(ngModel)]="newUser.password" placeholder="At least 8 characters" /></div>
        <div class="profile-row">
          <span class="profile-label">Role</span>
          <select [(ngModel)]="newUser.role">
            @for (r of roles(); track r.value) { <option [value]="r.value">{{ r.label }}</option> }
          </select>
        </div>
        <div class="profile-row">
          <span class="profile-label">Brands</span>
          <div class="users-brands">
            @if (brands().length) {
              <label class="brand-chip select-all">
                <input type="checkbox" [checked]="allSelected(newUser.brands)" (change)="toggleAll(newUser.brands, $any($event.target).checked)" /> Select all
              </label>
            }
            @for (b of brands(); track b) {
              <label class="brand-chip"><input type="checkbox" [checked]="newUser.brands.includes(b)" (change)="toggle(newUser.brands, b, $any($event.target).checked)" /> {{ b }}</label>
            }
            @if (!brands().length) { <span class="muted">No brands uploaded yet.</span> }
          </div>
        </div>
        <div class="profile-row"><span class="profile-label">Active</span><input type="checkbox" [(ngModel)]="newUser.active" /></div>
        <button type="button" class="secondary-btn" (click)="create()" [disabled]="busy()">Add user</button>
      </div>

      <div class="overview-list profile-card">
        <h3>Users</h3>
        @for (u of users(); track u.id) {
          <div class="users-row">
            @if (editingId() === u.id) {
              <div class="profile-row"><span class="profile-label">Name</span><input type="text" [(ngModel)]="editDraft.name" /></div>
              <div class="profile-row">
                <span class="profile-label">Role</span>
                <select [(ngModel)]="editDraft.role">
                  @for (r of roles(); track r.value) { <option [value]="r.value">{{ r.label }}</option> }
                </select>
              </div>
              <div class="profile-row">
                <span class="profile-label">Brands</span>
                <div class="users-brands">
                  @if (brands().length) {
                    <label class="brand-chip select-all">
                      <input type="checkbox" [checked]="allSelected(editDraft.brands)" (change)="toggleAll(editDraft.brands, $any($event.target).checked)" /> Select all
                    </label>
                  }
                  @for (b of brands(); track b) {
                    <label class="brand-chip"><input type="checkbox" [checked]="editDraft.brands.includes(b)" (change)="toggle(editDraft.brands, b, $any($event.target).checked)" /> {{ b }}</label>
                  }
                </div>
              </div>
              <div class="profile-row"><span class="profile-label">Active</span><input type="checkbox" [(ngModel)]="editDraft.active" /></div>
              <div class="profile-row"><span class="profile-label">New password</span><input type="password" [(ngModel)]="passwordDraft" placeholder="Leave empty to keep" /></div>
              <button type="button" class="secondary-btn" (click)="saveEdit(u)" [disabled]="busy()">Save</button>
              <button type="button" class="secondary-btn" (click)="cancelEdit()">Cancel</button>
            } @else {
              <strong>{{ u.name || u.email }}</strong>
              <span class="muted">{{ u.email }} · {{ roleLabel(u.role) }} · {{ u.active ? 'Active' : 'Deactivated' }}</span>
              <span class="muted">Brands: {{ u.brands.length ? u.brands.join(', ') : 'none' }}</span>
              <button type="button" class="secondary-btn" (click)="startEdit(u)">Edit</button>
            }
          </div>
        }
      </div>
    </section>
  `,
  styles: `
    .users-brands { display: flex; flex-wrap: wrap; gap: 8px; }
    .brand-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 10px; border: 1px solid #d0d5dd; border-radius: 6px;
      cursor: pointer; user-select: none; font-size: 13px;
    }
    .brand-chip:hover { background: rgba(127, 127, 127, 0.12); }
    .brand-chip input { cursor: pointer; accent-color: #4f46e5; }
    .brand-chip.select-all { font-weight: 600; border-style: dashed; }
  `,
})
export class UsersPageComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly users = signal<AdminUser[]>([]);
  readonly roles = signal<RoleOption[]>([]);
  readonly brands = signal<string[]>([]);
  readonly message = signal('');
  readonly error = signal('');
  readonly busy = signal(false);
  readonly editingId = signal<string | null>(null);

  newUser = { email: '', name: '', password: '', role: 'ecom_executive', brands: [] as string[], active: true };
  editDraft = { name: '', role: '', brands: [] as string[], active: true };
  passwordDraft = '';
  newBrand = '';

  async ngOnInit() {
    await this.load();
  }

  async load() {
    try {
      const data = await this.api.users();
      this.users.set(data.users);
      this.roles.set(data.roles);
      this.brands.set(data.brands);
    } catch (err) {
      this.error.set((err as Error).message);
    }
  }

  async addBrand() {
    await this.run(async () => {
      const result = await this.api.addBrand(this.newBrand);
      this.brands.set(result.brands);
      this.newBrand = '';
      this.message.set('Brand added. You can tick it for a user now.');
    });
  }

  async removeBrand(name: string) {
    await this.run(async () => {
      const result = await this.api.removeBrand(name);
      this.brands.set(result.brands);
      this.message.set(`Removed ${name}.`);
    });
  }

  toggle(list: string[], brand: string, on: boolean) {
    const at = list.indexOf(brand);
    if (on && at === -1) list.push(brand);
    if (!on && at !== -1) list.splice(at, 1);
  }

  allSelected(list: string[]) {
    const all = this.brands();
    return all.length > 0 && all.every((b) => list.includes(b));
  }

  toggleAll(list: string[], on: boolean) {
    list.length = 0;
    if (on) list.push(...this.brands());
  }

  roleLabel(value: string) {
    return this.roles().find((r) => r.value === value)?.label || value;
  }

  async create() {
    await this.run(async () => {
      await this.api.createUser({ ...this.newUser });
      this.newUser = { email: '', name: '', password: '', role: 'ecom_executive', brands: [], active: true };
      await this.load();
      this.message.set('User added.');
    });
  }

  startEdit(u: AdminUser) {
    this.editingId.set(u.id);
    this.editDraft = { name: u.name, role: u.role, brands: [...u.brands], active: u.active };
    this.passwordDraft = '';
  }

  cancelEdit() {
    this.editingId.set(null);
    this.passwordDraft = '';
  }

  async saveEdit(u: AdminUser) {
    await this.run(async () => {
      await this.api.updateUser(u.id, { ...this.editDraft });
      if (this.passwordDraft) await this.api.setUserPassword(u.id, this.passwordDraft);
      this.cancelEdit();
      await this.load();
      this.message.set('Saved. Sessions were ended if the user was deactivated or the password changed.');
    });
  }

  private async run(action: () => Promise<void>) {
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await action();
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}