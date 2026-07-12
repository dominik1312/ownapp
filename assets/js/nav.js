// Dominik's Dashboard — fixed bottom tab bar for the major module pages.
// Config-driven: the items come straight from MODULE_REGISTRY (single source of
// emoji / name / href / tint), filtered to NAV_IDS. To add a page to the bar,
// add its id here and drop <script type="module" src="../assets/js/nav.js"></script>
// before </body> on that page. Auto-mounts on import.
import { MODULE_REGISTRY } from './config.js';

// The "major" pages that get the bar, in tab order. Extend as modules mature.
const NAV_IDS = ['main', 'body', 'habits', 'money'];

function fileOf(href) { return href.split('/').pop(); } // 'modules/main.html' -> 'main.html'

function mountBottomNav() {
  const items = NAV_IDS
    .map((id) => MODULE_REGISTRY.find((m) => m.id === id))
    .filter(Boolean);
  if (!items.length) return;

  // Active tab = the page we're on (all major pages live in /modules/, so tab
  // links are just sibling filenames).
  const current = location.pathname.split('/').pop() || '';

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

mountBottomNav();
