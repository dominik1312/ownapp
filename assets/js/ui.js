// Life OS — shared UI + timezone helpers. No Supabase import here (pages that
// only need layout must not depend on the CDN client).

export const TZ = 'Europe/Budapest';
export const DEFAULT_DAY_WINDOW = { wake: '07:00', sleep: '23:00' };

/* ---------- timezone helpers ---------- */

// TZ: Europe/Budapest — "today" (YYYY-MM-DD) by Budapest wall clock, regardless of device timezone.
export function budapestToday() {
  // en-CA locale formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

// Calendar-date arithmetic on a YYYY-MM-DD string (timezone-free by design:
// the input is already a Budapest calendar day).
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// TZ: Europe/Budapest — current wall-clock hour/minute/second in Budapest.
export function budapestNowParts() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const num = (type) => Number(parts.find((p) => p.type === type).value);
  return { hour: num('hour'), minute: num('minute'), second: num('second') };
}

// TZ: Europe/Budapest — current UTC offset ("+02:00"/"+01:00", DST-aware), used to
// build timestamps that mean "today at HH:MM Budapest wall-clock time".
export function budapestOffset(date = new Date()) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName').value; // e.g. "GMT+02:00" ("GMT" at zero offset)
  return name === 'GMT' ? '+00:00' : name.replace('GMT', '');
}

// TZ: Europe/Budapest — render a stored timestamp as Budapest wall-clock HH:MM.
export function budapestHHMM(value) {
  if (!value) return '';
  if (!String(value).includes('T')) return String(value).slice(0, 5); // plain "HH:MM[:SS]"
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
}

/* ---------- day progress ---------- */

function hmToMin(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  return h * 60 + (m || 0);
}

const pad2 = (n) => String(n).padStart(2, '0');

// TZ: Europe/Budapest — progress through the awake window, from Budapest wall-clock "now".
// Supports windows that cross midnight (e.g. 08:00 → 00:00): hours after midnight
// still belong to the previous day's window. Inside the sleep gap, the first half
// counts as "day over" (100%) and the second half as "not started yet" (0%).
// `now` is injectable for tests only; it defaults to the live Budapest clock.
export function dayProgress(dayWindow = DEFAULT_DAY_WINDOW, now = budapestNowParts()) {
  const { hour, minute, second = 0 } = now;
  const nowMin = hour * 60 + minute + second / 60;
  const wake = hmToMin(dayWindow.wake);
  let sleep = hmToMin(dayWindow.sleep);
  if (sleep <= wake) sleep += 1440; // window ends on the next calendar day
  const span = sleep - wake;

  // minutes since wake, wrapped to [0, 1440) so post-midnight times sort after evening
  const sinceWake = (((nowMin - wake) % 1440) + 1440) % 1440;
  let elapsed;
  if (sinceWake <= span) {
    elapsed = sinceWake;
  } else {
    const intoGap = sinceWake - span;
    elapsed = intoGap < (1440 - span) / 2 ? span : 0;
  }

  return {
    progress: elapsed / span,
    elapsedMin: elapsed,
    remainingMin: span - elapsed,
    now: `${pad2(hour)}:${pad2(minute)}`,
    clock: `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`,
  };
}

export function fmtDuration(mins) {
  const m = Math.max(0, Math.round(mins));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/* ---------- settings ---------- */

// Reads settings.day_window; falls back to 07:00–23:00 when missing or unreachable.
export async function loadDayWindow(supabase) {
  try {
    const { data, error } = await supabase
      .from('settings').select('value').eq('key', 'day_window').maybeSingle();
    if (error || !data?.value?.wake || !data?.value?.sleep) return DEFAULT_DAY_WINDOW;
    return data.value;
  } catch {
    return DEFAULT_DAY_WINDOW;
  }
}

/* ---------- dom helpers ---------- */

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// App-wide "Nincs naplózva" style empty-state card.
export function emptyStateHTML(message = 'Nincs naplózva', actionHTML = '') {
  return `<div class="empty-card"><span class="empty-emoji">◌</span><p>${escapeHtml(message)}</p>${actionHTML}</div>`;
}

/* ---------- day ring (SVG) ---------- */

// Gradient arc on a faint track, with a glowing dot riding the arc tip and
// (on large rings) a clock-face tick ring. Progress is set via stroke-dashoffset
// for the arc and a rotation for the dot arm — both CSS-transitioned, so the
// initial render sweeps in and per-second updates crawl smoothly.
export function ringSVG(size, stroke) {
  const r = (size - stroke) / 2;
  const c = (2 * Math.PI * r).toFixed(2);
  const mid = size / 2;
  const gid = `ring-grad-${size}`; // gradient ids are document-global: key by size

  let ticks = '';
  if (size >= 120) {
    const inner = r - stroke * 1.5;
    const outer = r - stroke * 0.95;
    const lines = [];
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * 2 * Math.PI;
      const [cos, sin] = [Math.cos(a), Math.sin(a)];
      lines.push(`<line x1="${(mid + inner * cos).toFixed(1)}" y1="${(mid + inner * sin).toFixed(1)}" x2="${(mid + outer * cos).toFixed(1)}" y2="${(mid + outer * sin).toFixed(1)}"/>`);
    }
    ticks = `<g class="ring-ticks">${lines.join('')}</g>`;
  }

  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#6D28D9"></stop>
        <stop offset=".55" stop-color="#8B5CF6"></stop>
        <stop offset="1" stop-color="#C4B5FD"></stop>
      </linearGradient>
    </defs>
    <circle class="ring-track" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"></circle>
    ${ticks}
    <circle class="ring-arc" stroke="url(#${gid})" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"
      stroke-dasharray="${c}" stroke-dashoffset="${c}"></circle>
    <g class="ring-arm">
      <circle class="ring-dot-glow" cx="${mid + r}" cy="${mid}" r="${(stroke * 1.15).toFixed(1)}"></circle>
      <circle class="ring-dot" cx="${mid + r}" cy="${mid}" r="${(stroke * 0.42).toFixed(1)}"></circle>
    </g>
  </svg>`;
}

export function setRing(root, progress) {
  const arc = root.querySelector('.ring-arc');
  if (!arc) return;
  const c = parseFloat(arc.getAttribute('stroke-dasharray'));
  arc.setAttribute('stroke-dashoffset', (c * (1 - progress)).toFixed(2));
  const arm = root.querySelector('.ring-arm');
  if (arm) arm.style.transform = `rotate(${(progress * 360).toFixed(2)}deg)`;
}
