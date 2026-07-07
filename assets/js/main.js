// Life OS — Main module page: live day-progress ring + today's tasks (Supabase-backed).
import { supabase } from './supabase.js';
import {
  budapestToday, budapestOffset, budapestHHMM, dayProgress, loadDayWindow,
  fmtDuration, ringSVG, setRing, escapeHtml, emptyStateHTML, addDays, TZ,
} from './ui.js';

const $ = (sel) => document.querySelector(sel);

// TZ: Europe/Budapest — the whole page operates on Budapest "today".
const today = budapestToday();

let dayWindow = null;
let tasks = [];

init();

async function init() {
  $('#ring-slot').innerHTML = ringSVG(220, 12);
  $('#today-label').textContent = 'TODAY — ' + new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric',
  }).format(new Date()).toUpperCase();

  dayWindow = await loadDayWindow(supabase);
  renderRing();
  setInterval(renderRing, 30_000); // live: refresh the ring every 30s

  $('#btn-add').addEventListener('click', () => toggleForm(true));
  $('#btn-cancel').addEventListener('click', () => toggleForm(false));
  $('#add-form').addEventListener('submit', onAdd);

  await loadTasks();
}

/* ---------- day ring ---------- */

// Phase of the day by Budapest wall-clock hour (matches the awake window vibe,
// not the window itself: early wake still counts as morning).
function phaseOf(hour) {
  if (hour >= 5 && hour < 12) return { label: 'MORNING', title: 'Morning — build', emoji: '🌅' };
  if (hour >= 12 && hour < 18) return { label: 'AFTERNOON', title: 'Afternoon — execute', emoji: '⚡' };
  return { label: 'EVENING', title: 'Evening — wrap up', emoji: '⌛' };
}

function renderRing() {
  const d = dayProgress(dayWindow); // TZ: Europe/Budapest inside dayProgress
  setRing($('#ring-slot'), d.progress);

  const ph = phaseOf(Number(d.now.slice(0, 2)));
  $('#ring-pct').textContent = `${Math.round(d.progress * 100)}%`;
  $('#ring-phase').textContent = ph.label;
  $('#ring-time').textContent = d.now;
  $('#phase-emoji').textContent = ph.emoji;
  $('#phase-title').textContent = ph.title;
  $('#meta-remaining').textContent = `${fmtDuration(d.remainingMin)} awake time left`;
  $('#meta-window').textContent = `${dayWindow.wake} – ${dayWindow.sleep}`;
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
  const done = tasks.filter((t) => t.done).length;

  // ticker — the next thing still to do, over the ring
  const next = tasks.find((t) => !t.done);
  $('#ticker-text').textContent =
    next ? next.title : (tasks.length ? 'Minden kész mára 🎉' : 'Nincs mai feladat');
  $('#ticker-count').textContent = `${done}/${tasks.length}`;

  // counters + one progress segment per task
  $('#count-done').textContent = done;
  $('#count-total').textContent = tasks.length;
  $('#seg-bar').innerHTML = tasks
    .map((t) => `<span class="seg${t.done ? ' is-done' : ''}"></span>`).join('');

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
    const id = row.dataset.id;
    row.querySelector('.task-check').addEventListener('click', () => onToggle(id));
    row.querySelector('.btn-push').addEventListener('click', () => onPushTomorrow(id));
    row.querySelector('.btn-del').addEventListener('click', () => onDelete(id));
    row.querySelector('.task-title').addEventListener('click', () => startEdit(id, row));
  });
}

function taskRow(t) {
  const time = t.scheduled_at ? budapestHHMM(t.scheduled_at) : ''; // TZ: Europe/Budapest in helper
  return `<li class="task${t.done ? ' is-done' : ''}" data-id="${t.id}">
    <button class="task-check" type="button" role="checkbox" aria-checked="${!!t.done}" aria-label="Kész"></button>
    <span class="task-title" title="Kattints a szerkesztéshez">${escapeHtml(t.title)}</span>
    ${t.category ? `<span class="tag">${escapeHtml(t.category)}</span>` : ''}
    ${time ? `<span class="task-time">${time}</span>` : ''}
    <span class="task-actions">
      <button class="task-btn btn-push" type="button" title="Áttesz holnapra">→</button>
      <button class="task-btn btn-del" type="button" title="Törlés">×</button>
    </span>
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

async function onDelete(id) {
  const idx = tasks.findIndex((x) => String(x.id) === String(id));
  if (idx < 0) return;
  const [t] = tasks.splice(idx, 1); // optimistic
  renderTasks();

  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) {
    tasks.splice(idx, 0, t); // revert on failure
    renderTasks();
    showError(`Törlési hiba: ${error.message}`);
  }
}

async function onPushTomorrow(id) {
  const idx = tasks.findIndex((x) => String(x.id) === String(id));
  if (idx < 0) return;
  const t = tasks[idx];

  const tomorrow = addDays(today, 1);
  const patch = { for_date: tomorrow };
  if (t.scheduled_at) {
    // TZ: Europe/Budapest — keep the same wall-clock time on tomorrow's date
    // (offset computed for tomorrow, so a DST switch doesn't shift the hour)
    const hm = budapestHHMM(t.scheduled_at);
    patch.scheduled_at = `${tomorrow}T${hm}:00${budapestOffset(new Date(Date.now() + 86_400_000))}`;
  }

  tasks.splice(idx, 1); // optimistic — it's not today's task anymore
  renderTasks();

  const { error } = await supabase.from('tasks').update(patch).eq('id', id);
  if (error) {
    tasks.splice(idx, 0, t); // revert on failure
    renderTasks();
    showError(`Mentési hiba: ${error.message}`);
  }
}

// Inline title editing: click the title, Enter/blur saves, Esc cancels.
function startEdit(id, row) {
  const t = tasks.find((x) => String(x.id) === String(id));
  if (!t) return;
  const titleEl = row.querySelector('.task-title');
  const input = document.createElement('input');
  input.className = 'task-edit';
  input.maxLength = 200;
  input.value = t.title;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  async function finish(save) {
    if (finished) return;
    finished = true;
    const title = input.value.trim();
    if (!save || !title || title === t.title) return renderTasks();

    const prev = t.title;
    t.title = title;
    renderTasks(); // optimistic
    const { error } = await supabase.from('tasks').update({ title }).eq('id', t.id);
    if (error) {
      t.title = prev;
      renderTasks();
      showError(`Mentési hiba: ${error.message}`);
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
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
