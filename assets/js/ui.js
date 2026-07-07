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

// TZ: Europe/Budapest — current wall-clock hour/minute in Budapest.
export function budapestNowParts() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const num = (type) => Number(parts.find((p) => p.type === type).value);
  return { hour: num('hour'), minute: num('minute') };
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

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// TZ: Europe/Budapest — progress through the awake window, from Budapest wall-clock "now".
// progress = (now − wake) / (sleep − wake), clamped 0–1.
export function dayProgress(dayWindow = DEFAULT_DAY_WINDOW) {
  const { hour, minute } = budapestNowParts();
  const nowMin = hour * 60 + minute;
  const wake = hmToMin(dayWindow.wake);
  const sleep = hmToMin(dayWindow.sleep);
  const span = Math.max(1, sleep - wake);
  const elapsed = clamp(nowMin - wake, 0, span);
  return {
    progress: elapsed / span,
    elapsedMin: elapsed,
    remainingMin: span - elapsed,
    now: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
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

// Single continuous accent arc on a faint track; progress is set via stroke-dashoffset.
export function ringSVG(size, stroke) {
  const r = (size - stroke) / 2;
  const c = (2 * Math.PI * r).toFixed(2);
  const mid = size / 2;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle class="ring-track" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"></circle>
    <circle class="ring-arc" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"
      stroke-dasharray="${c}" stroke-dashoffset="${c}"></circle>
  </svg>`;
}

export function setRing(root, progress) {
  const arc = root.querySelector('.ring-arc');
  if (!arc) return;
  const c = parseFloat(arc.getAttribute('stroke-dasharray'));
  arc.setAttribute('stroke-dashoffset', (c * (1 - progress)).toFixed(2));
}
