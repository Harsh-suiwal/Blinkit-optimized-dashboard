import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

const THEME_KEY = 'blinkitTheme';
const SIDEBAR_WIDTH_KEY = 'blinkitSidebarWidth';
const SIDEBAR_COLLAPSED_KEY = 'blinkitSidebarCollapsed';
const PRODUCT_FOCUS_KEY = 'blinkitFocusProduct';
const BRAND_FILTER_KEY = 'blinkitBrandFilter';
const FEEDER_FILTER_KEY = 'blinkitFeederFilter';

@Injectable({ providedIn: 'root' })
export class UiStateService {
  private readonly document = inject(DOCUMENT);
  readonly theme = signal(this.read(THEME_KEY) || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  readonly sidebarWidth = signal(Number(this.read(SIDEBAR_WIDTH_KEY)) || 220);
  readonly collapsed = signal(this.read(SIDEBAR_COLLAPSED_KEY) === '1');
  readonly focusedProduct = signal(this.read(PRODUCT_FOCUS_KEY));
  readonly focusedBrand = signal(this.read(BRAND_FILTER_KEY));
  readonly focusedFeeder = signal(this.read(FEEDER_FILTER_KEY));

  constructor() {
    this.applyTheme(this.theme());
    this.applySidebarWidth(this.sidebarWidth());
  }

  toggleTheme() {
    const next = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    localStorage.setItem(THEME_KEY, next);
    this.applyTheme(next);
  }

  setSidebarWidth(width: number) {
    const next = Math.max(160, Math.min(400, width));
    this.sidebarWidth.set(next);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
    this.applySidebarWidth(next);
  }

  toggleSidebar() {
    const next = !this.collapsed();
    this.collapsed.set(next);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
  }

  setFocus(product: string) {
    this.focusedProduct.set(product);
    this.write(PRODUCT_FOCUS_KEY, product);
  }

  setBrand(brand: string) {
    this.focusedBrand.set(brand);
    this.write(BRAND_FILTER_KEY, brand);
  }

  setFeeder(feeder: string) {
    this.focusedFeeder.set(feeder);
    this.write(FEEDER_FILTER_KEY, feeder);
  }

  clearFocus() {
    this.setFocus('');
    this.setBrand('');
    this.setFeeder('');
  }

  private applyTheme(theme: string) {
    this.document.documentElement.setAttribute('data-theme', theme);
  }

  private applySidebarWidth(width: number) {
    this.document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
  }

  private read(key: string) {
    return localStorage.getItem(key) || '';
  }

  private write(key: string, value: string) {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  }
}
