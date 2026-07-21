// Dominik's Dashboard navigation for module pages.
// The fixed top bar provides a home action and page context. The bottom bar is
// config-driven from MODULE_REGISTRY and contains the major module shortcuts.
import { MODULE_REGISTRY } from './config.js';
import { budapestToday } from './ui.js';

// The "major" pages that get the bar, in tab order. Extend as modules mature.
const NAV_IDS = ['main', 'body', 'habits', 'money', 'schedule'];

function ensureSharedStylesheet(id, href) {
  if (document.getElementById(id) || document.querySelector(`link[href*="${href.split('?')[0]}"]`)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

// Keep shared mobile and navbar behavior reliable even when a module's HTML is
// restored from an older browser cache. The navbar owns these dependencies.
ensureSharedStylesheet('shared-mobile-forms', '../assets/css/mobile-forms.css?v=2');
ensureSharedStylesheet('shared-nav-calendar', '../assets/css/nav-calendar.css?v=4');

function fileOf(href) { return href.split('/').pop(); } // 'modules/main.html' -> 'main.html'

function currentFile() {
  return location.pathname.split('/').pop() || '';
}

function calendarMarkup() {
  const today = budapestToday();
  const [year, month] = today.split('-').map(Number);
  const monthLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const requestedDate = currentFile() === 'schedule.html'
    ? new URLSearchParams(location.search).get('date') || today
    : null;
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const cells = [];

  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push('<span class="nav-calendar-blank" aria-hidden="true"></span>');
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const classes = [
      'nav-calendar-day',
      date === today ? 'is-today' : '',
      date === requestedDate ? 'is-selected' : '',
    ].filter(Boolean).join(' ');
    const label = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    }).format(new Date(`${date}T00:00:00Z`));
    cells.push(`<a class="${classes}" href="schedule.html?date=${date}" aria-label="Open schedule for ${label}"${date === requestedDate ? ' aria-current="date"' : ''}>${day}</a>`);
  }

  return `
    <div class="nav-calendar-panel" id="nav-calendar-panel" hidden>
      <div class="nav-calendar-head">
        <div>
          <span class="nav-calendar-eyebrow">Jump to schedule</span>
          <strong>${monthLabel}</strong>
        </div>
        <a class="nav-calendar-today" href="schedule.html?date=${today}">Today</a>
      </div>
      <div class="nav-calendar-weekdays" aria-hidden="true">
        ${weekdays.map((day) => `<span>${day}</span>`).join('')}
      </div>
      <div class="nav-calendar-grid">${cells.join('')}</div>
    </div>`;
}

function mountTopNav() {
  if (document.querySelector('.top-nav')) return;

  const currentModule = MODULE_REGISTRY.find((module) => fileOf(module.href) === currentFile());
  const nav = document.createElement('nav');
  nav.className = 'top-nav';
  nav.setAttribute('aria-label', 'Dashboard');
  nav.style.setProperty('--nav-tint', currentModule?.tint || '51,214,195');
  nav.innerHTML = `
    <div class="top-nav-inner has-calendar">
      <span class="top-nav-spacer" aria-hidden="true"></span>
      <span class="top-nav-title">${currentModule?.name || 'Dashboard'}</span>
      <div class="top-nav-actions">
        <a class="top-nav-home" href="../index.html" aria-label="Go to dashboard home">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 10.75 12 3l9 7.75"></path>
            <path d="M5.5 9.5v10.25h13V9.5"></path>
            <path d="M9.25 19.75v-6.5h5.5v6.5"></path>
          </svg>
        </a>
        <button class="top-nav-calendar" type="button" aria-label="Open schedule calendar" aria-expanded="false" aria-controls="nav-calendar-panel">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6.5 3v3M17.5 3v3M4 8.5h16"></path>
            <rect x="4" y="5" width="16" height="15" rx="3"></rect>
            <path d="M8 12h2M14 12h2M8 16h2M14 16h2"></path>
          </svg>
        </button>
        ${calendarMarkup()}
      </div>
    </div>`;

  document.body.prepend(nav);
  document.body.classList.add('has-top-nav');

  const calendarButton = nav.querySelector('.top-nav-calendar');
  const calendarPanel = nav.querySelector('.nav-calendar-panel');
  const closeCalendar = () => {
    calendarPanel.hidden = true;
    calendarButton.setAttribute('aria-expanded', 'false');
  };
  calendarButton.addEventListener('click', () => {
    const opening = calendarPanel.hidden;
    calendarPanel.hidden = !opening;
    calendarButton.setAttribute('aria-expanded', String(opening));
  });
  document.addEventListener('click', (event) => {
    if (!calendarPanel.hidden && !nav.querySelector('.top-nav-actions').contains(event.target)) closeCalendar();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !calendarPanel.hidden) {
      closeCalendar();
      calendarButton.focus();
    }
  });
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
