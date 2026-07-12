// Dominik's Dashboard — Habits module: daily check-off ring, perfect-day streaks,
// per-habit streaks, 7-day history and a "today's call" verdict. Persisted in
// Supabase across two tables (both pre-existing):
//   habits      — one row per tracked habit (name, icon, active, sort)
//   habit_logs  — one row per (habit, day) it was completed (habit_id, for_date)
// Design adopted from the "Habits — Daily Tracker" standalone export.
import { supabase } from './supabase.js';
import { budapestToday, addDays, escapeHtml } from './ui.js';

const $ = (sel) => document.querySelector(sel);

const CIRCUM = 603.19; // 2π·96, matches the ring radius in the markup
const HISTORY_WINDOW = 400; // days of habit_logs to load for streak/history math

// TZ: Europe/Budapest — the whole module operates on Budapest "today".
const today = budapestToday();
const offsetDate = (n) => addDays(today, -n); // n days before today, as YYYY-MM-DD

const state = {
  loaded: false,
  editMode: false,
  habits: [],          // active habits, ordered by sort then created_at
  logs: new Set(),     // "<habit_id>|<for_date>" for every completion
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

/* ---------- completion helpers (read from the in-memory log set) ---------- */

const doneOn = (id, ds) => state.logs.has(`${id}|${ds}`);
const allDone = (ds) => state.habits.length > 0 && state.habits.every((h) => doneOn(h.id, ds));

function calcPerfectStreak() {
  if (!state.habits.length) return { streak: 0, best: 0 };
  let streak = 0;
  for (let i = allDone(offsetDate(0)) ? 0 : 1; i <= 366; i++) {
    if (!allDone(offsetDate(i))) break;
    streak++;
  }
  let best = 0, cur = 0;
  for (let j = 366; j >= 0; j--) {
    if (allDone(offsetDate(j))) { cur++; if (cur > best) best = cur; } else cur = 0;
  }
  return { streak, best };
}

function calcHabitStreak(id) {
  let streak = 0;
  for (let i = doneOn(id, offsetDate(0)) ? 0 : 1; i <= 366; i++) {
    if (!doneOn(id, offsetDate(i))) break;
    streak++;
  }
  return streak;
}

function calcWeekAvg() {
  if (!state.habits.length) return 0;
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const dc = state.habits.filter((h) => doneOn(h.id, offsetDate(i))).length;
    total += dc / state.habits.length;
  }
  return Math.round((total / 7) * 100);
}

/* ---------- Supabase load + mutations (optimistic) ---------- */

async function load() {
  const [habitsRes, logsRes] = await Promise.all([
    supabase.from('habits').select('*').eq('active', true).order('sort').order('created_at'),
    supabase.from('habit_logs').select('habit_id,for_date').gte('for_date', offsetDate(HISTORY_WINDOW)),
  ]);
  if (habitsRes.error) return showError(habitsRes.error);
  if (logsRes.error) return showError(logsRes.error);
  state.habits = habitsRes.data ?? [];
  state.logs = new Set((logsRes.data ?? []).map((r) => `${r.habit_id}|${r.for_date}`));
  state.loaded = true;
  render();
}

async function toggleDone(id) {
  const key = `${id}|${today}`;
  const wasDone = state.logs.has(key);
  if (wasDone) state.logs.delete(key); else state.logs.add(key); // optimistic
  render();

  const { error } = wasDone
    ? await supabase.from('habit_logs').delete().eq('habit_id', id).eq('for_date', today)
    : await supabase.from('habit_logs').insert({ habit_id: id, for_date: today });
  if (error) {
    if (wasDone) state.logs.add(key); else state.logs.delete(key); // revert
    render();
    showError(error);
  }
}

async function addHabit(name, emoji) {
  const v = (name || '').trim();
  if (!v) return;
  const sort = state.habits.length ? Math.max(...state.habits.map((h) => h.sort ?? 0)) + 1 : 0;
  const { data, error } = await supabase.from('habits')
    .insert({ name: v, icon: (emoji || '').trim() || '🎯', active: true, sort })
    .select().single();
  if (error) return showError(error);
  state.habits = [...state.habits, data];
  render();
}

async function deleteHabit(id) {
  const prevHabits = state.habits;
  const prevLogs = state.logs;
  state.habits = state.habits.filter((h) => h.id !== id); // optimistic
  state.logs = new Set([...state.logs].filter((k) => !k.startsWith(`${id}|`)));
  render();

  // logs first so a foreign-key constraint can't block the habit delete
  await supabase.from('habit_logs').delete().eq('habit_id', id);
  const { error } = await supabase.from('habits').delete().eq('id', id);
  if (error) {
    state.habits = prevHabits; // revert
    state.logs = prevLogs;
    render();
    showError(error);
  }
}

async function renameHabit(id, name) {
  const v = (name || '').trim();
  const habit = state.habits.find((h) => h.id === id);
  if (!habit || !v || v === habit.name) return render();
  const prev = habit.name;
  habit.name = v; // optimistic
  render();
  const { error } = await supabase.from('habits').update({ name: v }).eq('id', id);
  if (error) { habit.name = prev; render(); showError(error); }
}

let statusTimer;
function showError(error) {
  const el = $('#habits-status');
  if (!el) return;
  const missing = error?.code === '42P01' || /does not exist|schema cache/i.test(error?.message ?? '');
  clearTimeout(statusTimer);
  if (missing) {
    el.textContent = 'Missing habits table in Supabase.';
  } else {
    el.textContent = `Error: ${error.message}`;
    statusTimer = setTimeout(() => { el.textContent = ''; }, 8000);
  }
}

/* ---------- render ---------- */

const VERDICT_ZONES = [
  { min: 0,    max: 0,    badge: 'not started',   color: '#FF6B6B', left: 'rgba(255,107,107,0.4)',  bg: 'rgba(255,107,107,0.10)', border: 'rgba(255,107,107,0.30)', text: 'Start small — a single rep counts. Do one habit to break the seal.' },
  { min: 0.01, max: 0.33, badge: 'getting going', color: '#F2C063', left: 'rgba(242,192,99,0.4)',   bg: 'rgba(242,192,99,0.10)',  border: 'rgba(242,192,99,0.30)',  text: 'Momentum is building. Each check-off makes the next one easier.' },
  { min: 0.34, max: 0.66, badge: 'halfway',       color: '#F2C063', left: 'rgba(242,192,99,0.4)',   bg: 'rgba(242,192,99,0.12)',  border: 'rgba(242,192,99,0.35)',  text: "Past the halfway point — keep going, you're on the right side of the day." },
  { min: 0.67, max: 0.99, badge: 'almost done',   color: '#6BE3A4', left: 'rgba(107,227,164,0.4)',  bg: 'rgba(107,227,164,0.10)', border: 'rgba(107,227,164,0.30)', text: 'Nearly a perfect day. One last push to lock it in.' },
  { min: 1,    max: 1,    badge: 'perfect day',   color: '#FFFFFF', left: 'rgba(255,255,255,0.5)',  bg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.25)', text: 'Every habit done. This is what the streak is made of.' },
];

function render() {
  const done = state.habits.filter((h) => doneOn(h.id, today));
  const doneCount = done.length;
  const total = state.habits.length;
  const pct = total === 0 ? 0 : doneCount / total;

  // Hero ring — fill + color + label
  const ringFill = $('#habitRingFill');
  ringFill.style.strokeDashoffset = CIRCUM * (1 - pct);
  let ringColor, labelText, labelColor;
  if (!state.loaded)     { ringColor = 'rgba(255,255,255,0.08)'; labelText = 'loading…'; labelColor = 'var(--text-quaternary)'; }
  else if (total === 0)  { ringColor = 'rgba(255,255,255,0.08)'; labelText = 'add your first habit below'; labelColor = 'var(--text-quaternary)'; }
  else if (pct === 0)    { ringColor = '#4D4B47'; labelText = 'get started'; labelColor = 'var(--text-tertiary)'; }
  else if (pct < 0.34)   { ringColor = '#FF6B6B'; labelText = 'getting going'; labelColor = '#FF6B6B'; }
  else if (pct < 0.67)   { ringColor = '#F2C063'; labelText = 'halfway there'; labelColor = '#F2C063'; }
  else if (pct < 1)      { ringColor = '#6BE3A4'; labelText = 'almost there'; labelColor = '#6BE3A4'; }
  else                   { ringColor = '#FFFFFF'; labelText = 'perfect day ✓'; labelColor = '#FFFFFF'; }
  ringFill.style.stroke = ringColor;
  $('#habitDoneCount').textContent = doneCount;
  $('#habitTotalCount').textContent = ` / ${total}`;
  const labelEl = $('#habitRingLabel');
  labelEl.textContent = labelText; labelEl.style.color = labelColor;

  $('#habitDate').textContent = formatDateDisplay(today);

  // Stats
  const { streak, best } = calcPerfectStreak();
  $('#statStreak').textContent = streak > 0 ? streak : '—';
  $('#statBest').textContent = best > 0 ? best : '—';
  $('#statWeek').textContent = total > 0 ? `${calcWeekAvg()}%` : '—';
  $('#statTotal').textContent = total;

  // Habit list
  const listEl = $('#habitList');
  if (!state.loaded) {
    listEl.innerHTML = '<div class="habit-list-empty">Loading…</div>';
  } else if (!total) {
    listEl.innerHTML = '<div class="habit-list-empty">No habits yet — add one below to start tracking.</div>';
  } else {
    listEl.innerHTML = state.habits.map((h) => {
      const isDone = doneOn(h.id, today);
      const hs = calcHabitStreak(h.id);
      const streakHtml = hs > 0
        ? `<span class="habit-streak ${hs >= 3 ? 'hot' : ''}">${hs >= 3 ? '🔥' : '🔗'} ${hs}</span>`
        : '';
      const delBtn = state.editMode
        ? `<button class="habit-del-btn" data-del="${escapeHtml(h.id)}" type="button">×</button>`
        : '';
      return `
        <div class="habit-item ${isDone ? 'done' : ''}">
          <button class="habit-check ${isDone ? 'checked' : ''}" data-toggle="${escapeHtml(h.id)}" type="button">${isDone ? '✓' : ''}</button>
          <span class="habit-item-emoji">${escapeHtml(h.icon || '🎯')}</span>
          <div class="habit-item-body">
            <div class="habit-item-name" data-rename="${escapeHtml(h.id)}">${escapeHtml(h.name)}</div>
          </div>
          ${streakHtml}
          ${delBtn}
        </div>`;
    }).join('');
  }

  // 7-day history strip
  const strip = $('#habitHistoryStrip');
  const legendEl = $('#habitHistoryLegend');
  if (!total) { strip.innerHTML = ''; legendEl.textContent = ''; } else {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const ds = offsetDate(i);
      const dc = state.habits.filter((h) => doneOn(h.id, ds)).length;
      days.push({ ds, dc, pct: dc / total, isToday: i === 0, label: i === 0 ? 'Today' : weekdayShort(ds) });
    }
    const avgPct = Math.round((days.reduce((s, d) => s + d.pct, 0) / 7) * 100);
    legendEl.textContent = `${avgPct}% avg`;
    strip.innerHTML = days.map((d) => {
      const h = Math.max(4, Math.round(d.pct * 100));
      const cls = d.pct === 1 ? 'full' : d.pct >= 0.5 ? 'good' : '';
      return `
        <div class="habit-history-day ${d.isToday ? 'today' : ''}">
          <div class="habit-history-bar-wrap" title="${d.dc}/${total} · ${d.ds}">
            <div class="habit-history-bar ${cls}" style="height:${h}%"></div>
          </div>
          <span class="habit-history-day-label">${d.label.slice(0, 3)}</span>
        </div>`;
    }).join('');
  }

  // Today's call verdict
  const verdictEl = $('#habitVerdict');
  if (!total) { verdictEl.style.display = 'none'; } else {
    verdictEl.style.display = '';
    const z = VERDICT_ZONES.find((zone) => pct >= zone.min && pct <= zone.max) || VERDICT_ZONES[0];
    const badge = $('#habitVerdictBadge');
    badge.textContent = z.badge;
    badge.style.background = z.bg; badge.style.borderColor = z.border; badge.style.color = z.color;
    let txt = z.text;
    if (pct === 1 && streak > 1) txt += ` That's ${streak} perfect days in a row.`;
    $('#habitVerdictText').textContent = txt;
    verdictEl.style.borderLeftColor = z.left;
  }
}

/* ---------- events ---------- */

$('#habitList').addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) return toggleDone(toggle.dataset.toggle);
  const del = e.target.closest('[data-del]');
  if (del) return deleteHabit(del.dataset.del);
  const rename = e.target.closest('[data-rename]');
  if (rename && !e.target.closest('button')) startRename(rename);
});

function startRename(el) {
  if (el.getAttribute('contenteditable') === 'true') return;
  el.setAttribute('contenteditable', 'true');
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el); range.collapse(false);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  const id = el.dataset.rename;
  const finish = () => {
    el.removeAttribute('contenteditable');
    renameHabit(id, el.textContent);
  };
  el.addEventListener('blur', finish, { once: true });
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
    if (ev.key === 'Escape') { el.textContent = state.habits.find((h) => h.id === id)?.name ?? ''; el.blur(); }
  });
}

$('#habitEditBtn').addEventListener('click', () => {
  state.editMode = !state.editMode;
  $('#habitEditBtn').textContent = state.editMode ? 'Done' : 'Edit';
  render();
});

const nameInput = $('#habitName');
const emojiInput = $('#habitEmoji');
const addBtn = $('#habitAddBtn');
addBtn.addEventListener('click', () => {
  addHabit(nameInput.value, emojiInput.value);
  nameInput.value = ''; emojiInput.value = '';
  nameInput.focus();
});
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); });

render();
load();
