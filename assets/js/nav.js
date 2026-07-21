// Dominik's Dashboard navigation for module pages.
// The fixed top bar provides a home action and page context. The bottom bar is
// config-driven from MODULE_REGISTRY and contains the major module shortcuts.
import { MODULE_REGISTRY } from './config.js';

// The "major" pages that get the bar, in tab order. Extend as modules mature.
const NAV_IDS = ['main', 'body', 'habits', 'money', 'schedule'];

function fileOf(href) { return href.split('/').pop(); } // 'modules/main.html' -> 'main.html'

function currentFile() {
  return location.pathname.split('/').pop() || '';
}

function mountTopNav() {
  if (document.querySelector('.top-nav')) return;

  const currentModule = MODULE_REGISTRY.find((module) => fileOf(module.href) === currentFile());
  const nav = document.createElement('nav');
  nav.className = 'top-nav';
  nav.setAttribute('aria-label', 'Dashboard');
  nav.style.setProperty('--nav-tint', currentModule?.tint || '51,214,195');
  nav.innerHTML = `
    <div class="top-nav-inner">
      <span class="top-nav-spacer" aria-hidden="true"></span>
      <span class="top-nav-title">${currentModule?.name || 'Dashboard'}</span>
      <a class="top-nav-home" href="../index.html" aria-label="Go to dashboard home">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 10.75 12 3l9 7.75"></path>
          <path d="M5.5 9.5v10.25h13V9.5"></path>
          <path d="M9.25 19.75v-6.5h5.5v6.5"></path>
        </svg>
      </a>
    </div>`;

  document.body.prepend(nav);
  document.body.classList.add('has-top-nav');
}

function mountBottomNav() {
  if (document.querySelector('.bottom-nav')) return;

  const items = NAV_IDS
    .map((id) => MODULE_REGISTRY.find((m) => m.id === id))
    .filter(Boolean);
  if (!items.length) return;

  // Active tab = the page we're on (all major pages live in /modules/, so tab
  // links are just sibling filenames).
  const current = currentFile();

  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.setAttribute('aria-label', 'Primary');
  nav.innerHTML = items.map((m) => {
    const file = fileOf(m.href);
    const active = file === current;
    return `<a class="bottom-nav-item${active ? ' is-active' : ''}" href="${file}" style="--nav-tint:${m.tint}"${active ? ' aria-current="page"' : ''}>
      <span class="bottom-nav-emoji">${m.emoji}</span>
      <span class="bottom-nav-label">${m.name}</span>
    </a>`;
  }).join('');

  document.body.appendChild(nav);
  document.body.classList.add('has-bottom-nav');
}

mountTopNav();
mountBottomNav();
