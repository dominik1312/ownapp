// Life OS — Main module page: live day-progress ring + today's tasks (Supabase-backed).
import { supabase } from './supabase.js';
import {
  budapestToday, budapestOffset, budapestHHMM, dayProgress, loadDayWindow,
  fmtDuration, ringSVG, setRing, escapeHtml, emptyStateHTML,
} from './ui.js';

const $ = (sel) => document.querySelector(sel);

// TZ: Europe/Budapest — the whole page operates on Budapest "today".
const today = budapestToday();

let dayWindow = null;
let tasks = [];

init();

async function init() {
  $('#ring-slot').innerHTML = ringSVG(220, 12);
  dayWindow = await loadDayWindow(supabase);
  renderRing();
  setInterval(renderRing, 30_000); // live: refresh the ring every 30s

  $('#btn-add').addEventListener('click', () => toggleForm(true));
  $('#btn-cancel').addEventListener('click', () => toggleForm(false));
  $('#add-form').addEventListener('submit', onAdd);

  await loadTasks();
}

/* ---------- day ring ---------- */

function renderRing() {
  const d = dayProgress(dayWindow); // TZ: Europe/Budapest inside dayProgress
  setRing($('#ring-slot'), d.progress);
  $('#ring-time').textContent = d.now;
  $('#ring-pct').textContent = `${Math.round(d.progress * 100)}% of day`;
  $('#meta-window').textContent = `${dayWindow.wake}–${dayWindow.sleep}`;
  $('#meta-elapsed').textContent = fmtDuration(d.elapsedMin);
  $('#meta-remaining').textContent = fmtDuration(d.remainingMin);
}

function renderDoneMeta() {
  const done = tasks.filter((t) => t.done).length;
  $('#meta-done').textContent = `${done}/${tasks.length}`;
}

/* ---------- tasks ---------- */

async function loadTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('for_date', today) // TZ: Europe/Budapest — see budapestToday()
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .order('sort', { ascending: true });
  if (error) return showError(`Betöltési hiba: ${error.message}`);
  tasks = data ?? [];
  renderTasks();
}

function renderTasks() {
  renderDoneMeta();
  const list = $('#task-list');
  const empty = $('#empty-slot');

  if (!tasks.length) {
    list.innerHTML = '';
    empty.innerHTML = emptyStateHTML(
      'Nincs naplózva — nincs mai feladat.',
      '<button class="btn" id="btn-add-empty" type="button">+ Add task</button>',
    );
    $('#btn-add-empty').addEventListener('click', () => toggleForm(true));
    return;
  }

  empty.innerHTML = '';
  list.innerHTML = tasks.map(taskRow).join('');
  list.querySelectorAll('.task').forEach((row) => {
    row.querySelector('.task-check').addEventListener('click', () => onToggle(row.dataset.id));
  });
}

function taskRow(t) {
  const time = t.scheduled_at ? budapestHHMM(t.scheduled_at) : ''; // TZ: Europe/Budapest in helper
  return `<li class="task${t.done ? ' is-done' : ''}" data-id="${t.id}">
    <button class="task-check" type="button" role="checkbox" aria-checked="${!!t.done}" aria-label="Kész"></button>
    <span class="task-title">${escapeHtml(t.title)}</span>
    ${t.category ? `<span class="tag">${escapeHtml(t.category)}</span>` : ''}
    ${time ? `<span class="task-time">${time}</span>` : ''}
  </li>`;
}

async function onToggle(id) {
  const t = tasks.find((x) => String(x.id) === String(id));
  if (!t) return;
  const prev = { done: t.done, done_at: t.done_at };
  t.done = !t.done;
  t.done_at = t.done ? new Date().toISOString() : null; // instant in time, stored as UTC
  renderTasks(); // optimistic

  const { error } = await supabase
    .from('tasks')
    .update({ done: t.done, done_at: t.done_at })
    .eq('id', t.id);
  if (error) {
    Object.assign(t, prev); // revert on failure
    renderTasks();
    showError(`Mentési hiba: ${error.message}`);
  }
}

async function onAdd(e) {
  e.preventDefault();
  const title = $('#f-title').value.trim();
  if (!title) return;
  const category = $('#f-category').value.trim() || null;
  const time = $('#f-time').value; // "HH:MM" from <input type="time">
  // TZ: Europe/Budapest — store "today at HH:MM Budapest wall clock" with the correct UTC offset
  const scheduled_at = time ? `${today}T${time}:00${budapestOffset()}` : null;
  const sort = tasks.length ? Math.max(...tasks.map((t) => t.sort ?? 0)) + 1 : 0;

  const { data, error } = await supabase
    .from('tasks')
    .insert({ title, category, scheduled_at, for_date: today, done: false, sort })
    .select()
    .single();
  if (error) return showError(`Mentési hiba: ${error.message}`);

  tasks.push(data);
  sortTasks();
  renderTasks();
  e.target.reset();
  toggleForm(false);
}

// mirror of the query order: scheduled_at asc nulls last, then sort asc
function sortTasks() {
  tasks.sort((a, b) => {
    if (a.scheduled_at && b.scheduled_at) return a.scheduled_at < b.scheduled_at ? -1 : 1;
    if (a.scheduled_at) return -1;
    if (b.scheduled_at) return 1;
    return (a.sort ?? 0) - (b.sort ?? 0);
  });
}

/* ---------- misc ---------- */

function toggleForm(show) {
  const form = $('#add-form');
  form.hidden = !show;
  if (show) $('#f-title').focus();
}

let statusTimer;
function showError(msg) {
  $('#status').textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { $('#status').textContent = ''; }, 6000);
}
