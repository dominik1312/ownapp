// Life OS — Main module page: "Daily rhythm" phase ring + today's tasks, plus a
// "plan tomorrow" card underneath (Supabase-backed; one `tasks` table, keyed by for_date).
import { supabase } from './supabase.js';
import {
  budapestToday, budapestOffset, budapestHHMM, budapestNowParts,
  escapeHtml, emptyStateHTML, addDays,
} from './ui.js';

const $ = (sel) => document.querySelector(sel);

// TZ: Europe/Budapest — the whole page operates on Budapest "today".
const today = budapestToday();
const tomorrow = addDays(today, 1);

// Per-card wiring; every task handler is parametrized by date via this map.
const cards = {
  [today]: {
    list: '#task-list', empty: '#empty-slot', status: '#status',
    form: '#add-form', title: '#f-title', category: '#f-category', time: '#f-time',
    moveGlyph: '→', moveHint: 'Move to tomorrow',
    emptyText: 'Nothing logged — no tasks today.', addLabel: '+ Add task',
  },
  [tomorrow]: {
    list: '#task-list-tmrw', empty: '#empty-slot-tmrw', status: '#status-tmrw',
    form: '#add-form-tmrw', title: '#f2-title', category: '#f2-category', time: '#f2-time',
    moveGlyph: '←', moveHint: 'Move back to today',
    emptyText: "Tomorrow's plan is still empty.", addLabel: '+ Plan task',
  },
};

let byDate = { [today]: [], [tomorrow]: [] };

// "TUE, JUL 7" from a YYYY-MM-DD string (UTC-pinned so the label can't shift a day)
function dayLabel(ymd) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  }).format(new Date(`${ymd}T00:00:00Z`)).toUpperCase();
}

// TZ: Europe/Budapest — UTC offset valid on the given calendar day (noon avoids DST edges)
const offsetFor = (ymd) => budapestOffset(new Date(`${ymd}T12:00:00Z`));

async function init() {
  $('#today-label').textContent = `TODAY — ${dayLabel(today)}`;
  $('#tmrw-label').textContent = `TOMORROW — ${dayLabel(tomorrow)}`;

  renderRing();
  setInterval(renderRing, 1000); // live: ring + clock tick every second

  $('#btn-add').addEventListener('click', () => toggleForm(today, true));
  $('#btn-add-tmrw').addEventListener('click', () => toggleForm(tomorrow, true));
  $('#btn-cancel').addEventListener('click', () => toggleForm(today, false));
  $('#btn-cancel-tmrw').addEventListener('click', () => toggleForm(tomorrow, false));
  $('#add-form').addEventListener('submit', (e) => onAdd(e, today));
  $('#add-form-tmrw').addEventListener('submit', (e) => onAdd(e, tomorrow));

  await loadTasks();
}

/* ---------- "Daily rhythm" phase ring ---------- */
// The ring fills across the CURRENT PHASE of the day (not the whole day) and
// resets at each phase boundary — design imported from "Day Ring - standalone".

const PHASES = [
  { key: 'morning', label: 'Morning', title: 'Morning momentum', start: 6, end: 12,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M12 20v2"/><path d="M12 8a4 4 0 0 0-4 4"/></svg>' },
  { key: 'afternoon', label: 'Afternoon', title: 'Deep work', start: 12, end: 18,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>' },
  { key: 'evening', label: 'Evening', title: 'Wind-down', start: 18, end: 23,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/></svg>' },
  { key: 'night', label: 'Night', title: 'Rest', start: 23, end: 6,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>' },
];

const fmtHour = (h) => `${String(((Math.round(h) % 24) + 24) % 24).padStart(2, '0')}:00`;

let pctIntroDone = false;
let activePhaseKey = null;

function renderRing() {
  // TZ: Europe/Budapest — phase selection runs on Budapest wall-clock time
  const { hour, minute, second } = budapestNowParts();
  const hf = hour + minute / 60 + second / 3600;

  const ph = PHASES.find((p) =>
    p.start < p.end ? (hf >= p.start && hf < p.end) : (hf >= p.start || hf < p.end),
  ) ?? PHASES[0];
  const span = ph.start < ph.end ? ph.end - ph.start : 24 - ph.start + ph.end;
  const elapsed = hf >= ph.start ? hf - ph.start : 24 - ph.start + hf;
  const progress = Math.min(1, Math.max(0, elapsed / span));

  const arc = $('#pr-arc');
  const c = parseFloat(arc.getAttribute('stroke-dasharray'));
  arc.setAttribute('stroke-dashoffset', (c * (1 - progress)).toFixed(2));

  const pct = Math.round(progress * 100);
  if (pctIntroDone) {
    $('#ring-pct').textContent = `${pct}%`;
  } else {
    // first paint: count up 0 → pct alongside the arc sweep
    pctIntroDone = true;
    const el = $('#ring-pct');
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 1100);
      el.textContent = `${Math.round(pct * (1 - (1 - k) ** 3))}%`; // ease-out cubic
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  $('#ring-time').textContent = `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;

  const remaining = Math.max(0, span - elapsed);
  const remH = Math.floor(remaining);
  const remM = Math.round((remaining - remH) * 60);
  $('#meta-remaining').textContent = remaining <= 0
    ? 'Phase over'
    : `${remH > 0 ? `${remH} hr ` : ''}${remM} min remaining`;

  // phase-dependent bits only change at phase boundaries
  if (ph.key !== activePhaseKey) {
    activePhaseKey = ph.key;
    $('#ring-phase').textContent = ph.label;
    $('#phase-title').textContent = ph.title;
    $('#phase-icon').innerHTML = ph.icon;
    $('#meta-window').textContent = `${fmtHour(ph.start)}–${fmtHour(ph.end)}`;
    [...$('#phase-dots').children].forEach((dot, i) => {
      dot.classList.toggle('is-active', PHASES[i].key === ph.key);
    });
  }
}

/* ---------- tasks ---------- */

async function loadTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .in('for_date', [today, tomorrow]) // TZ: Europe/Budapest — see budapestToday()
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .order('sort', { ascending: true });
  if (error) return showError(today, `Load error: ${error.message}`);
  byDate = { [today]: [], [tomorrow]: [] };
  for (const t of data ?? []) byDate[t.for_date]?.push(t);
  renderAll();
}

function renderAll() {
  const todays = byDate[today];
  const done = todays.filter((t) => t.done).length;

  // ticker — the next thing still to do today, over the ring
  const next = todays.find((t) => !t.done);
  $('#ticker-text').textContent =
    next ? next.title : (todays.length ? 'All done for today 🎉' : 'No tasks today');
  $('#ticker-count').textContent = `${done}/${todays.length}`;

  // today card counters + one progress segment per task
  $('#count-done').textContent = done;
  $('#count-total').textContent = todays.length;
  $('#seg-bar').innerHTML = todays
    .map((t) => `<span class="seg${t.done ? ' is-done' : ''}"></span>`).join('');

  // tomorrow card counter
  $('#tmrw-total').textContent = byDate[tomorrow].length;

  renderList(today);
  renderList(tomorrow);
}

function renderList(date) {
  const c = cards[date];
  const tasks = byDate[date];
  const list = $(c.list);
  const empty = $(c.empty);

  if (!tasks.length) {
    list.innerHTML = '';
    empty.innerHTML = emptyStateHTML(
      c.emptyText,
      `<button class="btn btn-add-empty" type="button">${c.addLabel}</button>`,
    );
    empty.querySelector('.btn-add-empty').addEventListener('click', () => toggleForm(date, true));
    return;
  }

  empty.innerHTML = '';
  list.innerHTML = tasks.map((t) => taskRow(t, c)).join('');
  list.querySelectorAll('.task').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('.task-check').addEventListener('click', () => onToggle(date, id));
    row.querySelector('.btn-push').addEventListener('click', () => onMove(date, id));
    row.querySelector('.btn-del').addEventListener('click', () => onDelete(date, id));
    row.querySelector('.task-title').addEventListener('click', () => startEdit(date, id, row));
  });
}

function taskRow(t, c) {
  const time = t.scheduled_at ? budapestHHMM(t.scheduled_at) : ''; // TZ: Europe/Budapest in helper
  return `<li class="task${t.done ? ' is-done' : ''}" data-id="${t.id}">
    <button class="task-check" type="button" role="checkbox" aria-checked="${!!t.done}" aria-label="Done"></button>
    <span class="task-title" title="Click to edit">${escapeHtml(t.title)}</span>
    ${t.category ? `<span class="tag">${escapeHtml(t.category)}</span>` : ''}
    ${time ? `<span class="task-time">${time}</span>` : ''}
    <span class="task-actions">
      <button class="task-btn btn-push" type="button" title="${c.moveHint}">${c.moveGlyph}</button>
      <button class="task-btn btn-del" type="button" title="Delete">×</button>
    </span>
  </li>`;
}

function findIn(date, id) {
  const idx = byDate[date].findIndex((x) => String(x.id) === String(id));
  return { idx, t: byDate[date][idx] };
}

async function onToggle(date, id) {
  const { t } = findIn(date, id);
  if (!t) return;
  const prev = { done: t.done, done_at: t.done_at };
  t.done = !t.done;
  t.done_at = t.done ? new Date().toISOString() : null; // instant in time, stored as UTC
  renderAll(); // optimistic

  const { error } = await supabase
    .from('tasks')
    .update({ done: t.done, done_at: t.done_at })
    .eq('id', t.id);
  if (error) {
    Object.assign(t, prev); // revert on failure
    renderAll();
    showError(date, `Save error: ${error.message}`);
  }
}

async function onDelete(date, id) {
  const { idx, t } = findIn(date, id);
  if (!t) return;
  byDate[date].splice(idx, 1); // optimistic
  renderAll();

  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) {
    byDate[date].splice(idx, 0, t); // revert on failure
    renderAll();
    showError(date, `Delete error: ${error.message}`);
  }
}

// Move between the two cards (today ⇄ tomorrow).
async function onMove(from, id) {
  const to = from === today ? tomorrow : today;
  const { idx, t } = findIn(from, id);
  if (!t) return;

  const patch = { for_date: to };
  if (t.scheduled_at) {
    // TZ: Europe/Budapest — keep the same wall-clock time on the target date
    patch.scheduled_at = `${to}T${budapestHHMM(t.scheduled_at)}:00${offsetFor(to)}`;
  }

  byDate[from].splice(idx, 1); // optimistic — hop to the other card
  const moved = { ...t, ...patch };
  byDate[to].push(moved);
  sortTasks(byDate[to]);
  renderAll();

  const { error } = await supabase.from('tasks').update(patch).eq('id', id);
  if (error) {
    byDate[to].splice(byDate[to].indexOf(moved), 1); // revert on failure
    byDate[from].splice(idx, 0, t);
    renderAll();
    showError(from, `Save error: ${error.message}`);
  }
}

// Inline title editing: click the title, Enter/blur saves, Esc cancels.
function startEdit(date, id, row) {
  const { t } = findIn(date, id);
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
    if (!save || !title || title === t.title) return renderAll();

    const prev = t.title;
    t.title = title;
    renderAll(); // optimistic
    const { error } = await supabase.from('tasks').update({ title }).eq('id', t.id);
    if (error) {
      t.title = prev;
      renderAll();
      showError(date, `Save error: ${error.message}`);
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

async function onAdd(e, date) {
  e.preventDefault();
  const c = cards[date];
  const title = $(c.title).value.trim();
  if (!title) return;
  const category = $(c.category).value.trim() || null;
  const time = $(c.time).value; // "HH:MM" from <input type="time">
  // TZ: Europe/Budapest — store "date at HH:MM Budapest wall clock" with the correct UTC offset
  const scheduled_at = time ? `${date}T${time}:00${offsetFor(date)}` : null;
  const list = byDate[date];
  const sort = list.length ? Math.max(...list.map((t) => t.sort ?? 0)) + 1 : 0;

  const { data, error } = await supabase
    .from('tasks')
    .insert({ title, category, scheduled_at, for_date: date, done: false, sort })
    .select()
    .single();
  if (error) return showError(date, `Save error: ${error.message}`);

  list.push(data);
  sortTasks(list);
  renderAll();
  e.target.reset();
  toggleForm(date, false);
}

// mirror of the query order: scheduled_at asc nulls last, then sort asc
function sortTasks(arr) {
  arr.sort((a, b) => {
    if (a.scheduled_at && b.scheduled_at) return a.scheduled_at < b.scheduled_at ? -1 : 1;
    if (a.scheduled_at) return -1;
    if (b.scheduled_at) return 1;
    return (a.sort ?? 0) - (b.sort ?? 0);
  });
}

/* ---------- misc ---------- */

function toggleForm(date, show) {
  const c = cards[date];
  $(c.form).hidden = !show;
  if (show) $(c.title).focus();
}

const statusTimers = {};
function showError(date, msg) {
  const el = $(cards[date].status);
  el.textContent = msg;
  clearTimeout(statusTimers[date]);
  statusTimers[date] = setTimeout(() => { el.textContent = ''; }, 6000);
}

init();
