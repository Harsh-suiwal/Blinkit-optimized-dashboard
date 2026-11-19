// client/src/app/pages/users-page.component.ts
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AdminUser, RoleOption } from '../core/models';

type PermKey = 'allBrands' | 'profit' | 'upload' | 'deleteData' | 'download' | 'manageUsers';
type RolePermsMap = Record<string, Record<PermKey, boolean>>;

interface PermMetaItem {
  key: PermKey;
  label: string;
  description: string;
}

const DEFAULT_PERM_META: PermMetaItem[] = [
  { key: 'allBrands',   label: 'All brands',       description: 'See every brand; when off, restricted to ticked brands only.' },
  { key: 'profit',      label: 'View profit',      description: 'See profit figures, margins, and cost tabs.' },
  { key: 'upload',      label: 'Upload reports',   description: 'Upload stock, sales, campaign, and cost files (requires All brands).' },
  { key: 'deleteData',  label: 'Delete data',      description: 'Delete stored stock, sales, monthly, or campaign data.' },
  { key: 'download',    label: 'Download exports', description: 'Export Excel workbooks.' },
  { key: 'manageUsers', label: 'Manage users',     description: 'Access Users page, manage accounts, and edit role permissions.' },
];

/** Admin-only Users & Permissions page (route /users). Server enforces manageUsers on every call. */
@Component({
  selector: 'app-users-page',
  imports: [FormsModule],
  template: `
    <header class="topbar">
      <div class="topbar-left">
        <div>
          <h1>Users &amp; Permissions</h1>
          <span class="muted">Admins only. Changes apply on each user's next click.</span>
        </div>
      </div>
    </header>
    <section class="profile">
      @if (message()) { <p class="muted">{{ message() }}</p> }
      @if (error()) { <p class="muted users-error">{{ error() }}</p> }

      <div class="overview-list profile-card">
        <div class="perm-header">
          <div>
            <h3>Role permissions</h3>
            <p class="muted">Toggle what each role can access. Upload requires All brands; Admin always keeps Manage users.</p>
          </div>
          <div class="perm-actions">
            @if (hasPermChanges()) {
              <span class="perm-dirty-badge">Unsaved changes</span>
            }
            <button type="button" class="secondary-btn" (click)="discardPerms()" [disabled]="busy() || !hasPermChanges()">Discard</button>
            <button type="button" class="secondary-btn" (click)="resetPerms()" [disabled]="busy()">Reset defaults</button>
            <button type="button" class="secondary-btn perm-save-btn" (click)="savePerms()" [disabled]="busy() || !hasPermChanges()">Save permissions</button>
          </div>
        </div>

        @if (roleKeys().length) {
          <div class="perm-table-wrap">
            <table class="perm-table">
              <thead>
                <tr>
                  <th>Permission</th>
                  @for (roleKey of roleKeys(); track roleKey) {
                    <th class="perm-role-col">{{ roleLabel(roleKey) }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (perm of permMeta(); track perm.key) {
                  <tr>
                    <td>
                      <div class="perm-name">{{ perm.label }}</div>
                      <div class="muted perm-desc">{{ perm.description }}</div>
                    </td>
                    @for (roleKey of roleKeys(); track roleKey) {
                      <td class="perm-cell">
                        <label
                          class="perm-switch"
                          [class.is-disabled]="isPermLocked(roleKey, perm.key)"
                          [title]="permLockReason(roleKey, perm.key)"
                        >
                          <input
                            type="checkbox"
                            [checked]="permValue(roleKey, perm.key)"
                            [disabled]="busy() || isPermLocked(roleKey, perm.key)"
                            (change)="togglePerm(roleKey, perm.key, $any($event.target).checked)"
                          />
                          <span class="perm-slider"></span>
                        </label>
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="muted">Loading role permissions…</p>
        }
      </div>

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

    .perm-header {
      display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between;
      gap: 12px; margin-bottom: 12px;
    }
    .perm-header h3 { margin: 0 0 4px; }
    .perm-header p { margin: 0; font-size: 13px; }
    .perm-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .perm-dirty-badge {
      font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 999px;
      background: rgba(79, 70, 229, 0.14); color: #4f46e5;
    }
    .perm-save-btn {
      background: #4f46e5; color: #fff; border-color: #4f46e5;
    }
    .perm-save-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .perm-table-wrap { overflow-x: auto; }
    .perm-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .perm-table th, .perm-table td {
      padding: 10px 8px; border-bottom: 1px solid rgba(127, 127, 127, 0.18); text-align: left;
    }
    .perm-table th.perm-role-col, .perm-cell { text-align: center; min-width: 110px; }
    .perm-name { font-weight: 600; }
    .perm-desc { font-size: 12px; margin-top: 2px; }

    .perm-switch {
      position: relative; display: inline-block; width: 38px; height: 22px; cursor: pointer;
    }
    .perm-switch.is-disabled { opacity: 0.45; cursor: not-allowed; }
    .perm-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
    .perm-slider {
      position: absolute; inset: 0; border-radius: 999px;
      background: rgba(127, 127, 127, 0.35); transition: background 0.16s ease;
    }
    .perm-slider::before {
      content: ''; position: absolute; left: 3px; top: 3px; width: 16px; height: 16px;
      border-radius: 50%; background: #fff; transition: transform 0.16s ease;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    }
    .perm-switch input:checked + .perm-slider { background: #4f46e5; }
    .perm-switch input:checked + .perm-slider::before { transform: translateX(16px); }
    .perm-switch input:focus-visible + .perm-slider { outline: 2px solid #4f46e5; outline-offset: 2px; }
  `,
})
export class UsersPageComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly users = signal<AdminUser[]>([]);
  readonly roles = signal<RoleOption[]>([]);
  readonly brands = signal<string[]>([]);
  readonly permMeta = signal<PermMetaItem[]>(DEFAULT_PERM_META);
  readonly savedPerms = signal<RolePermsMap>({});
  readonly draftPerms = signal<RolePermsMap>({});
  readonly message = signal('');
  readonly error = signal('');
  readonly busy = signal(false);
  readonly editingId = signal<string | null>(null);

  readonly roleKeys = computed(() => {
    const fromRoles = this.roles().map((r) => r.value);
    return fromRoles.length ? fromRoles : Object.keys(this.draftPerms());
  });

  readonly hasPermChanges = computed(
    () => JSON.stringify(this.draftPerms()) !== JSON.stringify(this.savedPerms()),
  );

  newUser = { email: '', name: '', password: '', role: 'ecom_executive', brands: [] as string[], active: true };
  editDraft = { name: '', role: '', brands: [] as string[], active: true };
  passwordDraft = '';
  newBrand = '';

  async ngOnInit() {
    await this.load();
  }

  async load() {
    try {
      const [data, permRes] = await Promise.all([
        this.api.users(),
        this.fetchJson<{ roles: RolePermsMap; permMeta?: PermMetaItem[] }>('/api/users/permissions'),
      ]);
      this.users.set(data.users);
      this.roles.set(data.roles);
      this.brands.set(data.brands);
      if (permRes.permMeta?.length) this.permMeta.set(permRes.permMeta);
      this.setPermsState(permRes.roles || {});
    } catch (err) {
      this.error.set((err as Error).message);
    }
  }

  private setPermsState(roles: RolePermsMap) {
    this.savedPerms.set(this.clonePerms(roles));
    this.draftPerms.set(this.clonePerms(roles));
  }

  private clonePerms(roles: RolePermsMap): RolePermsMap {
    const out: RolePermsMap = {};
    for (const [role, perms] of Object.entries(roles || {})) {
      out[role] = { ...perms };
    }
    return out;
  }

  permValue(roleKey: string, key: PermKey): boolean {
    return Boolean(this.draftPerms()[roleKey]?.[key]);
  }

  isPermLocked(roleKey: string, key: PermKey): boolean {
    if (roleKey === 'admin' && key === 'manageUsers') return true;
    if (key === 'upload' && !this.permValue(roleKey, 'allBrands')) return true;
    return false;
  }

  permLockReason(roleKey: string, key: PermKey): string {
    if (roleKey === 'admin' && key === 'manageUsers') return 'Admin must always keep Manage users permission.';
    if (key === 'upload' && !this.permValue(roleKey, 'allBrands')) return 'Requires All brands to be enabled.';
    return '';
  }

  togglePerm(roleKey: string, key: PermKey, on: boolean) {
    if (this.isPermLocked(roleKey, key)) return;
    const next = this.clonePerms(this.draftPerms());
    if (!next[roleKey]) return;
    next[roleKey][key] = on;
    if (key === 'allBrands' && !on) next[roleKey].upload = false;
    this.draftPerms.set(next);
  }

  discardPerms() {
    this.draftPerms.set(this.clonePerms(this.savedPerms()));
    this.error.set('');
    this.message.set('');
  }

  async savePerms() {
    await this.run(async () => {
      const res = await this.fetchJson<{ ok: boolean; roles: RolePermsMap }>('/api/users/permissions', {
        method: 'PUT',
        body: JSON.stringify({ roles: this.draftPerms() }),
      });
      this.setPermsState(res.roles);
      this.message.set('Role permissions saved. Changes apply on each user\'s next click.');
    });
  }

  async resetPerms() {
    await this.run(async () => {
      const res = await this.fetchJson<{ ok: boolean; roles: RolePermsMap }>('/api/users/permissions/reset', {
        method: 'POST',
      });
      this.setPermsState(res.roles);
      this.message.set('Role permissions reset to defaults.');
    });
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      ...init,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status}).`);
    return body as T;
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