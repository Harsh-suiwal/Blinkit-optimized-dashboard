(function () {
  const DEFAULT_WIDTH = 220;
  const MIN_WIDTH = 160;
  const MAX_WIDTH = 400;
  const STORAGE_KEY = 'blinkitSidebarWidth';
  const COLLAPSE_KEY = 'blinkitSidebarCollapsed';

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

  function buildSidebar() {
    const root = document.getElementById('sidebar-root');
    if (!root) return;

    const savedWidth = parseInt(localStorage.getItem(STORAGE_KEY), 10) || DEFAULT_WIDTH;
    document.documentElement.style.setProperty('--sidebar-width', savedWidth + 'px');

    const active = currentPage();

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
        <div class="sidebar-footer">
          <button type="button" class="theme-toggle" id="themeToggle" aria-label="Toggle dark mode">
            <span class="theme-toggle-icon">&#9728;&#65039;</span>
            <span class="theme-toggle-track"><span class="theme-toggle-thumb"></span></span>
            <span class="theme-toggle-icon">&#127769;</span>
          </button>
        </div>
        <div class="sidebar-resize-handle" id="sidebarResizeHandle" title="Drag to resize"></div>
      </nav>
      <button type="button" class="sidebar-collapse-toggle" id="sidebarCollapseToggle" aria-expanded="true">
        <span class="arrow">&#8594;</span>
      </button>
    `;

    const themeToggle = document.getElementById('themeToggle');
    themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('blinkitTheme', next);
    });

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
