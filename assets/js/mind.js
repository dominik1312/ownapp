// Dominik's Dashboard — Mind module: a daily mood / energy / focus check-in.
// Each dimension is rated 1–5; the three combine into an overall "state" score that
// drives a violet hero ring, a 7-day trend and a "today's read" verdict. Persisted in
// Supabase, one row per Budapest calendar day:
//   mind_logs — (for_date unique, mood, energy, focus)  — see sql/mind.sql
// Structure adopted from the Habits module (assets/js/habits.js).
import { supabase } from './supabase.js';
import { budapestToday, addDays, escapeHtml, ringSVG, setRing } from './ui.js';

const $ = (sel) => document.querySelector(sel);

const HISTORY_WINDOW = 120; // days of mind_logs to load for trend/streak math

// TZ: Europe/Budapest — the whole module operates on Budapest "today".
const today = budapestToday();
const offsetDate = (n) => addDays(today, -n); // n days before today, as YYYY-MM-DD

const DIMS = [
  { key: 'mood',   emoji: '😊', label: 'Mood' },
  { key: 'energy', emoji: '⚡', label: 'Energy' },
  { key: 'focus',  emoji: '🎯', label: 'Focus' },
];
const WORDS = ['—', 'very low', 'low', 'okay', 'good', 'great']; // index by value 0..5

const state = {
  loaded: false,
  days: new Map(), // for_date -> { mood, energy, focus } (any subset may be null)
};

/* ---------- date formatting (UTC-pinned: the input is already a calendar day) ---------- */

function formatDateDisplay(ds) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  }).format(new Date(`${ds}T00:00:00Z`));
}
function weekdayShort(ds) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' })
    .format(new Date(`${ds}T00:00:00Z`));
}

/* ---------- score helpers (read from the in-memory day map) ---------- */

const entry = (ds) => state.days.get(ds) || null;
const isSet = (v) => v != null;

// overall daily score = average of the dimensions that were rated that day (1..5), or null
function dayAvg(ds) {
  const d = entry(ds);
  if (!d) return null;
  const vals = [d.mood, d.energy, d.focus].filter(isSet);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
const checkedIn = (ds) => dayAvg(ds) != null;

// trailing 7-day average for one dimension
function weekAvg(dim) {
  let sum = 0, n = 0;
  for (let i = 0; i < 7; i++) {
    const d = entry(offsetDate(i));
    if (d && isSet(d[dim])) { sum += d[dim]; n++; }
  }
  return n ? sum / n : null;
}

function calcStreak() {
  let streak = 0;
  for (let i = checkedIn(offsetDate(0)) ? 0 : 1; i <= 366; i++) {
    if (!checkedIn(offsetDate(i))) break;
    streak++;
  }
  return streak;
}

const ZONES = [
  { max: 2,       label: 'running low', text: 'A low read is still data. Be kind to yourself and keep it light today.' },
  { max: 3,       label: 'getting by',  text: 'Running on a little less. Protect your energy and pick one thing that matters.' },
  { max: 4,       label: 'steady',      text: "Solid, balanced day. Good conditions to make steady progress." },
  { max: 4.5,     label: 'good day',    text: "You're firing on most cylinders — a great window to push on something meaningful." },
  { max: Infinity, label: 'dialed in',  text: 'Mood, energy and focus all high. This is a peak day — spend it on what counts.' },
];
function zoneFor(avg) {
  if (avg == null) return { label: 'not checked in', text: 'Rate your mood, energy and focus to see today’s read.' };
  return ZONES.find((z) => avg < z.max) || ZONES[ZONES.length - 1];
}

/* ---------- Supabase load + mutation (optimistic) ---------- */

async function load() {
  const { data, error } = await supabase
    .from('mind_logs').select('for_date,mood,energy,focus')
    .gte('for_date', offsetDate(HISTORY_WINDOW));
  state.loaded = true; // even on error: drop the "loading…" state and show the empty read
  if (error) { render(); return showError(error); }
  state.days = new Map((data ?? []).map((r) => [r.for_date, { mood: r.mood, energy: r.energy, focus: r.focus }]));
  render();
}

function setRating(dim, value) {
  const next = { mood: null, energy: null, focus: null, ...(entry(today) || {}) };
  next[dim] = next[dim] === value ? null : value; // click the active level again to clear it
  state.days.set(today, next);
  render();
  queueSave(); // persist the whole day-row, serialized (see below)
}

// All three dimensions live in one mind_logs row (keyed by for_date), so concurrent
// upserts would race and clobber each other. Serialize saves through a single chain:
// each runs after the previous settles and re-reads the *current* today-state, so the
// last write always reflects the latest taps. On failure we resync from the server.
let saveChain = Promise.resolve();
function queueSave() {
  saveChain = saveChain.then(saveToday, saveToday);
}
async function saveToday() {
  const cur = entry(today) || { mood: null, energy: null, focus: null };
  const { error } = await supabase.from('mind_logs').upsert(
    { for_date: today, mood: cur.mood ?? null, energy: cur.energy ?? null, focus: cur.focus ?? null, updated_at: new Date().toISOString() },
    { onConflict: 'for_date' },
  );
  if (error) { showError(error); await load(); } // resync UI to server truth
}

let statusTimer;
function showError(error) {
  const el = $('#mind-status');
  if (!el) return;
  const missing = error?.code === '42P01' || /does not exist|schema cache/i.test(error?.message ?? '');
  clearTimeout(statusTimer);
  if (missing) {
    el.textContent = 'Missing mind_logs table in Supabase — run sql/mind.sql once.';
  } else {
    el.textContent = `Error: ${error.message}`;
    statusTimer = setTimeout(() => { el.textContent = ''; }, 8000);
  }
}

/* ---------- render ---------- */

function render() {
  const avg = dayAvg(today);
  const zone = zoneFor(avg);

  // Hero ring — fill + center score + state label
  setRing($('#mindRingWrap'), avg == null ? 0 : avg / 5);
  $('#mindScore').textContent = avg == null ? '—' : avg.toFixed(1);
  const labelEl = $('#mindRingLabel');
  labelEl.textContent = state.loaded ? zone.label : 'loading…';

  $('#mindDate').textContent = formatDateDisplay(today);

  // Dimension check-in rows
  const td = entry(today) || {};
  $('#mindDims').innerHTML = DIMS.map((dim) => {
    const v = td[dim.key];
    const segs = [1, 2, 3, 4, 5].map((n) => `
      <button class="mind-seg ${isSet(v) && n <= v ? 'is-on' : ''}" data-dim="${dim.key}" data-val="${n}"
        type="button" aria-label="${dim.label} ${n} of 5" aria-pressed="${v === n}">${n}</button>`).join('');
    return `
      <div class="mind-dim">
        <div class="mind-dim-head">
          <span class="mind-dim-emoji">${dim.emoji}</span>
          <span class="mind-dim-label">${dim.label}</span>
          <span class="mind-dim-value">${isSet(v) ? escapeHtml(WORDS[v]) : '—'}</span>
        </div>
        <div class="mind-segs" role="group" aria-label="${dim.label} rating">${segs}</div>
      </div>`;
  }).join('');

  // Stats — 7-day per-dimension averages + check-in streak
  const fmt = (x) => (x == null ? '—' : x.toFixed(1));
  $('#statMood').textContent = fmt(weekAvg('mood'));
  $('#statEnergy').textContent = fmt(weekAvg('energy'));
  $('#statFocus').textContent = fmt(weekAvg('focus'));
  const streak = calcStreak();
  $('#statStreak').textContent = streak > 0 ? streak : '—';

  // 7-day history strip — one bar per day, height = overall score / 5
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const ds = offsetDate(i);
    const a = dayAvg(ds);
    days.push({ ds, a, isToday: i === 0, label: i === 0 ? 'Today' : weekdayShort(ds) });
  }
  const rated = days.filter((d) => d.a != null);
  $('#mindHistoryLegend').textContent = rated.length
    ? `${(rated.reduce((s, d) => s + d.a, 0) / rated.length).toFixed(1)} avg`
    : '';
  $('#mindHistoryStrip').innerHTML = days.map((d) => {
    const h = d.a == null ? 4 : Math.max(8, Math.round((d.a / 5) * 100));
    const cls = d.a == null ? 'empty' : d.a >= 4 ? 'high' : '';
    const title = d.a == null ? `${d.ds} · no check-in` : `${d.ds} · ${d.a.toFixed(1)} / 5`;
    return `
      <div class="mind-history-day ${d.isToday ? 'today' : ''}">
        <div class="mind-history-bar-wrap" title="${title}">
          <div class="mind-history-bar ${cls}" style="height:${h}%"></div>
        </div>
        <span class="mind-history-day-label">${d.label.slice(0, 3)}</span>
      </div>`;
  }).join('');

  // Today's read verdict
  $('#mindVerdictBadge').textContent = zone.label;
  let txt = zone.text;
  if (avg != null && streak > 1) txt += ` That's ${streak} days checked in a row.`;
  $('#mindVerdictText').textContent = txt;
}

/* ---------- events ---------- */

$('#mindDims').addEventListener('click', (e) => {
  const seg = e.target.closest('[data-dim]');
  if (seg) setRating(seg.dataset.dim, Number(seg.dataset.val));
});

/* ---------- init ---------- */

// Inject the violet hero ring behind the static center overlay, then paint + load.
$('#mindRingWrap').insertAdjacentHTML('afterbegin', ringSVG(220, 14));
render();
load();
