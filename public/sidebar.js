(function () {
  let currentUser = null;

  async function checkAuth() {
    try {
      const res = await fetch('/api/me');
      if (!res.ok) { window.location.href = '/login'; return; }
      const data = await res.json();
      currentUser = data.user;
      window.currentUser = currentUser;

      if (document.getElementById('userInfo')) {
        document.getElementById('userInfo').textContent = currentUser.email;
      }
      
      if (currentUser.role !== 'admin') {
        const uploadBtn = document.querySelector('.upload-btn');
        if (uploadBtn) uploadBtn.style.display = 'none';
        
        const wipeAllBtn = document.getElementById('wipeAllBtn');
        if (wipeAllBtn) wipeAllBtn.style.display = 'none';
      }
    } catch (_) {
      window.location.href = '/login';
    }
  }

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  checkAuth();
  const DEFAULT_WIDTH = 220;
  const MIN_WIDTH = 160;
  const MAX_WIDTH = 400;
  const STORAGE_KEY = 'blinkitSidebarWidth';
  const COLLAPSE_KEY = 'blinkitSidebarCollapsed';
  const FOCUS_KEY = 'blinkitFocusProduct';
  const BRAND_KEY = 'blinkitBrandFilter';

  // Exposed so every page's own script can read "which product is the
  // user currently focused on?" without re-reading localStorage itself.
  window.getFocusProduct = function () {
    return localStorage.getItem(FOCUS_KEY) || '';
  };

  // Same pattern for brand filter — every tab can call this to know
  // which brand the user has selected in the sidebar dropdown.
  window.getBrandFilter = function () {
    return localStorage.getItem(BRAND_KEY) || '';
  };

  const pages = [
    { href: 'index.html', label: 'Inventory Dashboard', icon: '\u{1F4E6}' },
    { href: 'sales-performance.html', label: 'Sales Performance', icon: '\u{1F4CD}' },
    { href: 'campaign-analysis.html', label: 'Campaign Analysis', icon: '\u{1F4CA}' },
  ];

  // "g" then a letter jumps straight to a page, e.g. Gmail/GitHub-style chords.
  const SHORTCUTS = {
    i: { href: 'index.html', label: 'Inventory' },
    s: { href: 'sales-performance.html', label: 'Sales' },
    c: { href: 'campaign-analysis.html', label: 'Campaign' },
  };
  const CHORD_TIMEOUT = 1500;

  function currentPage() {
    const path = window.location.pathname.split('/').pop();
    return path === '' ? 'index.html' : path;
  }

  function escapeHtmlAttr(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function renderFocusBanner(product, brand) {
    const existing = document.getElementById('focusBanner');
    if (existing) existing.remove();
    if (!product && !brand) return;

    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    const banner = document.createElement('div');
    banner.id = 'focusBanner';
    banner.className = 'focus-banner';
    
    let message = '';
    if (product && brand) {
      message = `&#127919; Focused on brand <strong>${escapeHtmlAttr(brand)}</strong> and product <strong>${escapeHtmlAttr(product)}</strong>`;
    } else if (product) {
      message = `&#127919; Focused on product <strong>${escapeHtmlAttr(product)}</strong>`;
    } else if (brand) {
      message = `&#127919; Focused on brand <strong>${escapeHtmlAttr(brand)}</strong>`;
    }

    banner.innerHTML = `
      <span>${message} across Inventory, Sales &amp; Campaigns</span>
      <button type="button" id="focusBannerClear" class="focus-banner-clear">Exit focus &times;</button>
    `;
    mainContent.prepend(banner);

    document.getElementById('focusBannerClear').addEventListener('click', () => {
      localStorage.removeItem(FOCUS_KEY);
      localStorage.removeItem(BRAND_KEY);
      window.location.reload();
    });
  }

  function buildSidebar() {
    const root = document.getElementById('sidebar-root');
    if (!root) return;

    const savedWidth = parseInt(localStorage.getItem(STORAGE_KEY), 10) || DEFAULT_WIDTH;
    document.documentElement.style.setProperty('--sidebar-width', savedWidth + 'px');

    const active = currentPage();
    const currentFocus = window.getFocusProduct();
    const currentBrand = window.getBrandFilter();

    root.innerHTML = `
      <nav class="sidebar" id="appSidebar">
        <div class="sidebar-brand">Blinkit Dashboard</div>
        <ul class="sidebar-nav">
          ${pages
            .map(
              (p) => `
            <li>
              <a href="${p.href}" class="${p.href === active ? 'active' : ''}">
                <span class="sidebar-icon">${p.icon}</span>
                <span class="sidebar-label">${p.label}</span>
              </a>
            </li>`
            )
            .join('')}
        </ul>
        <div class="sidebar-focus">
          <label class="sidebar-focus-label" for="brandFocusSelect">Brand Filter</label>
          <select id="brandFocusSelect" class="sidebar-focus-select" style="margin-bottom: 12px;">
            <option value="">All brands</option>
          </select>
          <label class="sidebar-focus-label" for="productFocusSelect">Product Focus</label>
          <select id="productFocusSelect" class="sidebar-focus-select">
            <option value="">All products</option>
          </select>
        </div>
        <div class="sidebar-footer">
          <button type="button" class="theme-toggle" id="themeToggle" aria-label="Toggle dark mode (Alt+T)" title="Toggle theme (Alt+T)">
            <span class="theme-toggle-icon" id="themeToggleIcon">&#127769;</span>
          </button>
        </div>
        <div class="sidebar-resize-handle" id="sidebarResizeHandle" title="Drag to resize"></div>
      </nav>
      <button type="button" class="sidebar-collapse-toggle" id="sidebarCollapseToggle" aria-expanded="true">
        <span class="arrow">&#8594;</span>
      </button>
    `;

    // --- Theme toggle (also reachable via Alt+T, see setupShortcuts) ---

    const themeToggleIcon = document.getElementById('themeToggleIcon');

    function paintThemeIcon() {
      const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      // Icon shows the theme you'll SWITCH TO, matching the sun/moon
      // convention the rest of the app already used.
      themeToggleIcon.innerHTML = current === 'dark' ? '&#9728;&#65039;' : '&#127769;';
    }

    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('blinkitTheme', next);
      paintThemeIcon();
    }

    // Exposed globally so the Alt+T keyboard shortcut (in setupShortcuts,
    // which may fire before or after this DOMContentLoaded handler runs)
    // can reuse the exact same toggle logic instead of duplicating it.
    window.toggleTheme = toggleTheme;

    paintThemeIcon();
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);

    // --- Brand focus dropdown -----------------------------------------
    
    const knownBrands = new Set();
    if (currentBrand) knownBrands.add(currentBrand);

    function updateBrandOptions(brandsToAdd) {
      if (Array.isArray(brandsToAdd)) {
        brandsToAdd.forEach((b) => {
          if (b && typeof b === 'string' && b.trim()) knownBrands.add(b.trim());
        });
      }
      const select = document.getElementById('brandFocusSelect');
      if (!select) return;
      const sorted = Array.from(knownBrands).sort((a, b) => a.localeCompare(b));
      const activeValue = select.value || currentBrand;
      select.innerHTML =
        '<option value="">All brands</option>' +
        sorted.map((b) => `<option value="${escapeHtmlAttr(b)}">${escapeHtmlAttr(b)}</option>`).join('');
      select.value = sorted.includes(activeValue) ? activeValue : '';
    }

    // Exposed globally so any page script (app.js, sales.js, campaign.js) can
    // dynamically inject the grouped brands extracted from currently displayed data.
    window.populateBrandDropdown = function (brands) {
      updateBrandOptions(brands);
    };

    updateBrandOptions();

    const brandSelect = document.getElementById('brandFocusSelect');
    fetch('/api/brand-names')
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.brands)) {
          updateBrandOptions(data.brands);
        }
      })
      .catch(() => {});

    brandSelect.addEventListener('change', () => {
      if (brandSelect.value) {
        localStorage.setItem(BRAND_KEY, brandSelect.value);
      } else {
        localStorage.removeItem(BRAND_KEY);
      }
      window.location.reload();
    });

    // --- Product focus dropdown -----------------------------------------

    const focusSelect = document.getElementById('productFocusSelect');
    fetch('/api/product-names')
      .then((res) => res.json())
      .then((data) => {
        const names = data.names || [];
        const filteredNames = currentBrand
          ? names.filter((n) => n.toLowerCase().includes(currentBrand.toLowerCase()))
          : names;
        focusSelect.innerHTML =
          '<option value="">All products</option>' +
          filteredNames.map((n) => `<option value="${escapeHtmlAttr(n)}">${escapeHtmlAttr(n)}</option>`).join('');
        focusSelect.value = filteredNames.includes(currentFocus) ? currentFocus : '';
      })
      .catch(() => {
        // No data uploaded yet anywhere - leave it at "All products".
      });

    focusSelect.addEventListener('change', () => {
      if (focusSelect.value) {
        localStorage.setItem(FOCUS_KEY, focusSelect.value);
      } else {
        localStorage.removeItem(FOCUS_KEY);
      }
      // Simplest reliable way to get every page's own script (app.js /
      // sales.js / campaign.js) to re-fetch and re-render under the new
      // focus, without wiring up cross-file event listeners.
      window.location.reload();
    });

    renderFocusBanner(currentFocus, currentBrand);

    // --- Collapse / expand ---------------------------------------------

    const collapseToggle = document.getElementById('sidebarCollapseToggle');
    const mainContent = document.querySelector('.main-content');

    function positionCollapseToggle(collapsed) {
      if (collapsed) {
        collapseToggle.style.left = '0px';
        return;
      }
      const width = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'),
        10
      ) || DEFAULT_WIDTH;
      collapseToggle.style.left = (width - 14) + 'px';
    }

    function setCollapsed(collapsed) {
      root.querySelector('.sidebar').classList.toggle('collapsed', collapsed);
      collapseToggle.classList.toggle('collapsed', collapsed);
      collapseToggle.setAttribute('aria-expanded', String(!collapsed));
      collapseToggle.title = (collapsed ? 'Expand sidebar' : 'Collapse sidebar') + ' (Ctrl+Shift+E)';
      if (mainContent) mainContent.classList.toggle('sidebar-collapsed', collapsed);
      positionCollapseToggle(collapsed);
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    }

    function toggleCollapsed() {
      const isCollapsed = root.querySelector('.sidebar').classList.contains('collapsed');
      setCollapsed(!isCollapsed);
    }

    collapseToggle.addEventListener('click', toggleCollapsed);
    window.toggleSidebarCollapse = toggleCollapsed;

    const startedCollapsed = localStorage.getItem(COLLAPSE_KEY) === '1';
    setCollapsed(startedCollapsed);

    const handle = document.getElementById('sidebarResizeHandle');
    let isDragging = false;

    handle.addEventListener('mousedown', (e) => {
      isDragging = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, e.clientX));
      document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
      collapseToggle.style.left = (newWidth - 14) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const width = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'),
        10
      );
      localStorage.setItem(STORAGE_KEY, width);
    });
  }

  // --- Keyboard shortcuts: g then l/s/c -----------------------------------

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function getHintEl() {
    let hint = document.getElementById('shortcutHint');
    if (hint) return hint;

    hint = document.createElement('div');
    hint.id = 'shortcutHint';
    hint.style.cssText = [
      'position:fixed', 'bottom:20px', 'left:50%',
      'transform:translateX(-50%) translateY(8px)',
      'background:rgba(28,28,30,0.85)', 'backdrop-filter:blur(20px) saturate(180%)',
      '-webkit-backdrop-filter:blur(20px) saturate(180%)',
      'color:rgba(255,255,255,0.9)', 'padding:8px 16px', 'border-radius:980px',
      'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Segoe UI,Roboto,Arial,sans-serif',
      'font-size:13px', 'z-index:9999', 'opacity:0', 'pointer-events:none',
      'transition:opacity 0.15s ease, transform 0.15s ease',
      'border:1px solid rgba(255,255,255,0.12)', 'white-space:nowrap',
    ].join(';');
    document.body.appendChild(hint);
    return hint;
  }

  function showLeaderHint() {
    const hint = getHintEl();
    hint.innerHTML = Object.entries(SHORTCUTS)
      .map(([key, p]) => `<strong style="color:#0a84ff">${key}</strong> ${p.label}`)
      .join('&nbsp;&nbsp;&nbsp;');
    hint.style.opacity = '1';
    hint.style.transform = 'translateX(-50%) translateY(0)';
  }

  function hideLeaderHint() {
    const hint = document.getElementById('shortcutHint');
    if (!hint) return;
    hint.style.opacity = '0';
    hint.style.transform = 'translateX(-50%) translateY(8px)';
  }

  function setupShortcuts() {
    let leaderActive = false;
    let leaderTimer = null;

    function resetLeader() {
      leaderActive = false;
      clearTimeout(leaderTimer);
      hideLeaderHint();
    }

    document.addEventListener('keydown', (e) => {
      // Ctrl+Shift+E: snap the sidebar in/out. Works even inside inputs,
      // like a real app-level shortcut, and regardless of other modifiers.
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (typeof window.toggleSidebarCollapse === 'function') window.toggleSidebarCollapse();
        return;
      }

      // Alt+T: toggle light/dark theme, from anywhere (including inputs).
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        if (typeof window.toggleTheme === 'function') window.toggleTheme();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const key = e.key.toLowerCase();

      if (leaderActive) {
        resetLeader();
        const target = SHORTCUTS[key];
        if (target && target.href !== currentPage()) {
          e.preventDefault();
          window.location.href = target.href;
        }
        return;
      }

      if (key === 'g') {
        leaderActive = true;
        showLeaderHint();
        leaderTimer = setTimeout(resetLeader, CHORD_TIMEOUT);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', buildSidebar);
  document.addEventListener('DOMContentLoaded', setupShortcuts);
})();
