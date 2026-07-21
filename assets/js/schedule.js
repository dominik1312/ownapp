// Schedule module — responsive daily time-block planner backed by Supabase.
import { supabase } from './supabase.js';
import { addDays, budapestNowParts, budapestToday, escapeHtml } from './ui.js';

const START_HOUR = 6;
const END_MINUTE = 24 * 60 - 1;
const SNAP_MINUTES = 15;

const DEFAULT_CATEGORIES = [
  { key: 'training', label: 'Training', color: '#6BE3A4' },
  { key: 'work', label: 'Work', color: '#F36F4F' },
  { key: 'focus', label: 'Focus', color: '#6AA8FF' },
  { key: 'meal', label: 'Meals', color: '#F2C063' },
  { key: 'rest', label: 'Rest', color: '#9B7BD4' },
  { key: 'personal', label: 'Personal', color: '#FF8FA3' },
];

const $ = (selector) => document.querySelector(selector);

const elements = {
  card: $('.schedule-card'),
  date: $('#schedule-date'),
  dateNote: $('#schedule-date-note'),
  stats: $('#schedule-stats'),
  legend: $('#schedule-legend'),
  scroll: $('#schedule-scroll'),
  grid: $('#schedule-grid'),
  blocks: $('#schedule-blocks'),
  now: $('#schedule-now'),
  status: $('#schedule-status'),
  overlay: $('#schedule-overlay'),
  modalTitle: $('#schedule-modal-title'),
  form: $('#schedule-form'),
  titleInput: $('#schedule-title-input'),
  startInput: $('#schedule-start-input'),
  endInput: $('#schedule-end-input'),
  notesInput: $('#schedule-notes-input'),
  categoryList: $('#schedule-category-list'),
  categoryManageButton: $('#schedule-category-manage'),
  categoryManager: $('#schedule-category-manager'),
  categoryManagerList: $('#schedule-category-manager-list'),
  categoryCount: $('#schedule-category-count'),
  categoryManagerStatus: $('#schedule-category-manager-status'),
  categoryNewName: $('#schedule-category-new-name'),
  categoryNewColor: $('#schedule-category-new-color'),
  categoryAddButton: $('#schedule-category-add'),
  formError: $('#schedule-form-error'),
  deleteButton: $('#schedule-delete'),
  saveButton: $('#schedule-save'),
};

const state = {
  activeDate: budapestToday(),
  entries: [],
  categories: DEFAULT_CATEGORIES.map((category, sort) => ({ ...category, sort })),
  categoryStorageReady: false,
  editingId: null,
  selectedCategory: 'focus',
  loadToken: 0,
  saving: false,
  suppressClickUntil: 0,
  previousBodyOverflow: '',
};

function pad2(value) {
  return String(value).padStart(2, '0');
}

function timeToMinutes(value) {
  const [hour = 0, minute = 0] = String(value || '').split(':').map(Number);
  return hour * 60 + minute;
}

function minutesToTime(value) {
  const minute = Math.max(0, Math.min(END_MINUTE, Math.round(value)));
  return `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;
}

function inputTime(value) {
  return String(value || '').slice(0, 5);
}

function snap(value) {
  return Math.round(value / SNAP_MINUTES) * SNAP_MINUTES;
}

function hourHeight() {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--schedule-hour')) || 64;
}

function minuteToY(minute) {
  return ((minute - START_HOUR * 60) / 60) * hourHeight();
}

function yToMinute(y) {
  return START_HOUR * 60 + (y / hourHeight()) * 60;
}

function categoryFor(key) {
  return state.categories.find((category) => category.key === key)
    || state.categories.find((category) => category.key === 'personal')
    || state.categories[0]
    || DEFAULT_CATEGORIES[0];
}

function dateObject(dateString) {
  return new Date(`${dateString}T00:00:00Z`);
}

function formatActiveDate(dateString) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(dateObject(dateString));
}

function formatHours(minutes) {
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${hours.toFixed(1)}h`;
}

function setStatus(message = '', info = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle('is-info', Boolean(message && info));
}

function isMissingTable(error) {
  return error?.code === '42P01' || /does not exist|schema cache/i.test(error?.message || '');
}

function showDataError(error) {
  if (isMissingTable(error)) {
    setStatus('Schedule storage is not ready — run sql/schedule.sql in Supabase.');
  } else {
    setStatus(`Could not sync schedule: ${error?.message || 'Unknown error'}`);
  }
}

function renderLegend() {
  elements.legend.innerHTML = state.categories.map((category) => `
    <span class="schedule-legend-item">
      <i class="schedule-legend-dot" style="--cat:${category.color}"></i>
      ${escapeHtml(category.label)}
    </span>`).join('');
}

function renderCategoryButtons() {
  elements.categoryList.innerHTML = state.categories.map((category) => `
    <button class="schedule-category-chip ${category.key === state.selectedCategory ? 'is-active' : ''}"
      type="button" data-category="${category.key}" style="--cat:${category.color}"
      aria-pressed="${category.key === state.selectedCategory}">
      ${escapeHtml(category.label)}
    </button>`).join('');
}

function renderCategoryManager() {
  elements.categoryCount.textContent = `${state.categories.length} ${state.categories.length === 1 ? 'category' : 'categories'}`;
  elements.categoryManagerList.innerHTML = state.categories.map((category) => `
    <div class="schedule-category-manager-row" data-category-row="${escapeHtml(category.key)}" style="--cat:${escapeHtml(category.color)}">
      <label class="schedule-category-color-picker" title="Change ${escapeHtml(category.label)} color">
        <input class="schedule-category-color" type="color" value="${escapeHtml(category.color)}" aria-label="${escapeHtml(category.label)} color" />
        <span class="schedule-category-color-preview"></span>
      </label>
      <div class="schedule-category-name-wrap">
        <input class="schedule-category-name" type="text" maxlength="32" value="${escapeHtml(category.label)}" aria-label="Category name" />
      </div>
      <button class="schedule-category-save-btn" type="button" data-category-action="save">
        <span aria-hidden="true">✓</span><span class="schedule-category-save-label">Update</span>
      </button>
      <button class="schedule-category-remove-btn" type="button" data-category-action="delete" aria-label="Delete ${escapeHtml(category.label)}" title="Delete ${escapeHtml(category.label)}"${state.categories.length === 1 ? ' disabled' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"/></svg>
      </button>
    </div>`).join('');
}

function renderCategories() {
  renderLegend();
  renderCategoryButtons();
  renderCategoryManager();
  renderEntries();
}

function setCategoryManagerStatus(message = '', error = false) {
  elements.categoryManagerStatus.textContent = message;
  elements.categoryManagerStatus.style.color = error ? '#FF8A7A' : '';
}

function categoryStorageError(error) {
  return isMissingTable(error)
    ? 'Category storage is not ready — run the latest sql/schedule.sql in Supabase.'
    : error?.message || 'Could not save the category.';
}

async function loadCategories() {
  const { data, error } = await supabase
    .from('schedule_categories')
    .select('key,label,color,sort')
    .order('sort')
    .order('created_at');

  if (error) {
    state.categoryStorageReady = false;
    state.categories = DEFAULT_CATEGORIES.map((category, sort) => ({ ...category, sort }));
  } else {
    state.categoryStorageReady = true;
    state.categories = data?.length
      ? data
      : DEFAULT_CATEGORIES.map((category, sort) => ({ ...category, sort }));
  }

  if (!state.categories.some((category) => category.key === state.selectedCategory)) {
    state.selectedCategory = state.categories[0]?.key || 'focus';
  }
  renderCategories();
}

function makeCategoryKey(label) {
  const base = label.toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 22) || 'category';
  let key = base;
  let suffix = 2;
  while (state.categories.some((category) => category.key === key)) {
    key = `${base}-${suffix}`;
    suffix += 1;
  }
  return key;
}

async function addCategory() {
  if (state.saving) return;
  const label = elements.categoryNewName.value.trim();
  const color = elements.categoryNewColor.value;
  if (!label) {
    setCategoryManagerStatus('Enter a category name.', true);
    elements.categoryNewName.focus();
    return;
  }
  if (!state.categoryStorageReady) {
    setCategoryManagerStatus(categoryStorageError({ code: '42P01' }), true);
    return;
  }

  const category = {
    key: makeCategoryKey(label),
    label,
    color,
    sort: Math.max(-1, ...state.categories.map((item) => Number(item.sort) || 0)) + 1,
    updated_at: new Date().toISOString(),
  };
  setCategoryManagerStatus('Adding…');
  const { error } = await supabase.from('schedule_categories').insert(category);
  if (error) {
    setCategoryManagerStatus(categoryStorageError(error), true);
    return;
  }
  state.selectedCategory = category.key;
  elements.categoryNewName.value = '';
  await loadCategories();
  setCategoryManagerStatus('Category added.');
}

async function saveCategory(row) {
  if (state.saving) return;
  const key = row.dataset.categoryRow;
  const label = row.querySelector('.schedule-category-name').value.trim();
  const color = row.querySelector('.schedule-category-color').value;
  if (!label) {
    setCategoryManagerStatus('Category names cannot be empty.', true);
    return;
  }
  if (!state.categoryStorageReady) {
    setCategoryManagerStatus(categoryStorageError({ code: '42P01' }), true);
    return;
  }

  setCategoryManagerStatus('Saving…');
  const { error } = await supabase
    .from('schedule_categories')
    .update({ label, color, updated_at: new Date().toISOString() })
    .eq('key', key);
  if (error) {
    setCategoryManagerStatus(categoryStorageError(error), true);
    return;
  }
  await loadCategories();
  setCategoryManagerStatus('Category updated.');
}

async function deleteCategory(row) {
  if (state.saving || state.categories.length <= 1) return;
  const key = row.dataset.categoryRow;
  const category = state.categories.find((item) => item.key === key);
  const replacement = state.categories.find((item) => item.key !== key);
  if (!category || !replacement) return;
  if (!window.confirm(`Delete “${category.label}”? Existing blocks will move to “${replacement.label}”.`)) return;
  if (!state.categoryStorageReady) {
    setCategoryManagerStatus(categoryStorageError({ code: '42P01' }), true);
    return;
  }

  setCategoryManagerStatus('Deleting…');
  const moved = await supabase
    .from('schedule_entries')
    .update({ category: replacement.key, updated_at: new Date().toISOString() })
    .eq('category', key);
  if (moved.error) {
    setCategoryManagerStatus(moved.error.message, true);
    return;
  }
  const removed = await supabase.from('schedule_categories').delete().eq('key', key);
  if (removed.error) {
    setCategoryManagerStatus(categoryStorageError(removed.error), true);
    return;
  }

  if (state.selectedCategory === key) state.selectedCategory = replacement.key;
  await loadCategories();
  setCategoryManagerStatus('Category deleted.');
  await loadDay();
}

function renderHeader() {
  const isToday = state.activeDate === budapestToday();
  elements.date.textContent = formatActiveDate(state.activeDate);
  elements.dateNote.textContent = isToday
    ? 'Today · Budapest time'
    : new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric' }).format(dateObject(state.activeDate));
  elements.dateNote.classList.toggle('is-today', isToday);
}

function buildGrid() {
  elements.grid.querySelectorAll('.schedule-hour-line, .schedule-hour-label').forEach((node) => node.remove());
  elements.grid.style.height = `${(24 - START_HOUR) * hourHeight()}px`;

  const fragment = document.createDocumentFragment();
  for (let hour = START_HOUR; hour <= 24; hour += 1) {
    const y = (hour - START_HOUR) * hourHeight();

    const line = document.createElement('span');
    line.className = 'schedule-hour-line';
    line.style.top = `${y}px`;
    fragment.appendChild(line);

    if (hour < 24) {
      const halfLine = document.createElement('span');
      halfLine.className = 'schedule-hour-line is-half';
      halfLine.style.top = `${y + hourHeight() / 2}px`;
      fragment.appendChild(halfLine);
    }

    const label = document.createElement('span');
    label.className = 'schedule-hour-label';
    label.style.top = `${y}px`;
    label.textContent = `${hour === 24 ? '0' : hour}:00`;
    fragment.appendChild(label);
  }

  elements.grid.insertBefore(fragment, elements.blocks);
}

function layoutEntries(entries) {
  const items = entries
    .map((entry) => ({
      entry,
      start: timeToMinutes(entry.start_time),
      end: timeToMinutes(entry.end_time),
    }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const output = [];
  let index = 0;
  while (index < items.length) {
    const cluster = [items[index]];
    let clusterEnd = items[index].end;
    let cursor = index + 1;

    while (cursor < items.length && items[cursor].start < clusterEnd) {
      cluster.push(items[cursor]);
      clusterEnd = Math.max(clusterEnd, items[cursor].end);
      cursor += 1;
    }

    const columnEnds = [];
    cluster.forEach((item) => {
      const openColumn = columnEnds.findIndex((end) => item.start >= end);
      item.column = openColumn >= 0 ? openColumn : columnEnds.length;
      columnEnds[item.column] = item.end;
    });

    cluster.forEach((item) => {
      item.columnCount = columnEnds.length;
      output.push(item);
    });
    index = cursor;
  }
  return output;
}

function entryMarkup(entry, duration, category) {
  const notes = entry.notes && duration >= 75
    ? `<span class="schedule-block-notes">${escapeHtml(entry.notes)}</span>`
    : '';
  return `
    <span class="schedule-block-time">${inputTime(entry.start_time)}–${inputTime(entry.end_time)}</span>
    <span class="schedule-block-title">
      <i class="schedule-block-dot"></i>
      <span>${escapeHtml(entry.title)}</span>
    </span>
    ${notes}
    <span class="schedule-resize-handle" aria-hidden="true"></span>`;
}

function renderEntries() {
  elements.blocks.replaceChildren();

  if (!state.entries.length) {
    const empty = document.createElement('div');
    empty.className = 'schedule-empty';
    empty.innerHTML = `
      <span class="schedule-empty-icon">◫</span>
      <p>No blocks yet. Tap the timeline or use “Add block” to shape this day.</p>`;
    elements.blocks.appendChild(empty);
  }

  layoutEntries(state.entries).forEach((item) => {
    const { entry } = item;
    const category = categoryFor(entry.category);
    const duration = item.end - item.start;
    const block = document.createElement('article');
    block.className = `schedule-block${duration < 40 ? ' is-short' : ''}`;
    block.dataset.id = entry.id;
    block.style.setProperty('--cat', category.color);
    block.style.top = `${minuteToY(item.start)}px`;
    block.style.height = `${Math.max(22, minuteToY(item.end) - minuteToY(item.start))}px`;
    block.style.left = `${(item.column / item.columnCount) * 100}%`;
    block.style.width = `calc(${100 / item.columnCount}% - 4px)`;
    block.tabIndex = 0;
    block.setAttribute('role', 'button');
    block.setAttribute('aria-label', `${entry.title}, ${inputTime(entry.start_time)} to ${inputTime(entry.end_time)}`);
    block.innerHTML = entryMarkup(entry, duration, category);
    block.addEventListener('click', () => {
      if (Date.now() < state.suppressClickUntil) return;
      openEditor(entry);
    });
    block.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openEditor(entry);
      }
    });
    attachMove(block, entry);
    attachResize(block, entry);
    elements.blocks.appendChild(block);
  });

  const totalMinutes = state.entries.reduce(
    (total, entry) => total + Math.max(0, timeToMinutes(entry.end_time) - timeToMinutes(entry.start_time)),
    0,
  );
  const blockWord = state.entries.length === 1 ? 'block' : 'blocks';
  elements.stats.textContent = `${state.entries.length} ${blockWord} · ${formatHours(totalMinutes)} planned`;
}

function renderNowLine() {
  const { hour, minute } = budapestNowParts();
  const nowMinute = hour * 60 + minute;
  const visible = state.activeDate === budapestToday()
    && nowMinute >= START_HOUR * 60
    && nowMinute <= END_MINUTE;
  elements.now.hidden = !visible;
  if (visible) elements.now.style.top = `${minuteToY(nowMinute)}px`;
}

function render() {
  renderHeader();
  renderEntries();
  renderNowLine();
}

async function loadDay({ scroll = false } = {}) {
  const token = ++state.loadToken;
  elements.card.setAttribute('aria-busy', 'true');
  setStatus('Syncing…', true);

  const { data, error } = await supabase
    .from('schedule_entries')
    .select('*')
    .eq('for_date', state.activeDate)
    .order('start_time')
    .order('created_at');

  if (token !== state.loadToken) return;
  elements.card.removeAttribute('aria-busy');
  if (error) {
    state.entries = [];
    render();
    showDataError(error);
    return;
  }

  state.entries = data || [];
  setStatus('');
  render();
  if (scroll) requestAnimationFrame(scrollToUsefulTime);
}

function nextStartTime() {
  if (state.activeDate !== budapestToday()) return 9 * 60;
  const { hour, minute } = budapestNowParts();
  const rounded = Math.ceil((hour * 60 + minute) / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.max(START_HOUR * 60, Math.min(END_MINUTE - 60, rounded));
}

function openEditor(entry = null, prefill = null) {
  state.editingId = entry?.id || null;
  state.selectedCategory = state.categories.some((category) => category.key === entry?.category)
    ? entry.category
    : state.categories.find((category) => category.key === 'focus')?.key || state.categories[0]?.key || 'focus';
  elements.modalTitle.textContent = entry ? 'Edit schedule block' : 'Add to schedule';
  elements.titleInput.value = entry?.title || '';
  elements.notesInput.value = entry?.notes || '';

  const suggestedStart = prefill?.start ?? nextStartTime();
  const suggestedEnd = prefill?.end ?? Math.min(END_MINUTE, suggestedStart + 60);
  elements.startInput.value = entry ? inputTime(entry.start_time) : minutesToTime(suggestedStart);
  elements.endInput.value = entry ? inputTime(entry.end_time) : minutesToTime(suggestedEnd);
  elements.deleteButton.hidden = !entry;
  elements.formError.textContent = '';
  elements.categoryManager.hidden = true;
  elements.categoryManageButton.setAttribute('aria-expanded', 'false');
  elements.categoryManageButton.textContent = 'Manage';
  setCategoryManagerStatus('');
  renderCategoryButtons();
  renderCategoryManager();

  elements.overlay.hidden = false;
  state.previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => elements.titleInput.focus());
}

function closeEditor() {
  if (state.saving) return;
  elements.overlay.hidden = true;
  document.body.style.overflow = state.previousBodyOverflow;
  state.editingId = null;
  elements.formError.textContent = '';
}

function setSaving(saving) {
  state.saving = saving;
  elements.saveButton.disabled = saving;
  elements.deleteButton.disabled = saving;
  elements.saveButton.textContent = saving ? 'Saving…' : 'Save block';
}

async function saveEntry(event) {
  event.preventDefault();
  if (state.saving) return;

  const title = elements.titleInput.value.trim();
  const notes = elements.notesInput.value.trim();
  const start = elements.startInput.value;
  const end = elements.endInput.value;
  const startMinute = timeToMinutes(start);
  const endMinute = timeToMinutes(end);

  if (!title) {
    elements.formError.textContent = 'Give this block a name.';
    elements.titleInput.focus();
    return;
  }
  if (startMinute < START_HOUR * 60 || endMinute > END_MINUTE) {
    elements.formError.textContent = 'Schedule blocks can run from 06:00 to 23:59.';
    return;
  }
  if (endMinute <= startMinute) {
    elements.formError.textContent = 'The end time must be after the start time.';
    return;
  }

  const row = {
    for_date: state.activeDate,
    title,
    start_time: `${start}:00`,
    end_time: `${end}:00`,
    category: state.selectedCategory,
    notes,
    updated_at: new Date().toISOString(),
  };

  setSaving(true);
  const result = state.editingId
    ? await supabase.from('schedule_entries').update(row).eq('id', state.editingId)
    : await supabase.from('schedule_entries').insert(row);
  setSaving(false);

  if (result.error) {
    elements.formError.textContent = isMissingTable(result.error)
      ? 'Run sql/schedule.sql in Supabase first.'
      : result.error.message;
    return;
  }

  closeEditor();
  await loadDay();
}

async function deleteEntry() {
  if (!state.editingId || state.saving) return;
  setSaving(true);
  const { error } = await supabase.from('schedule_entries').delete().eq('id', state.editingId);
  setSaving(false);
  if (error) {
    elements.formError.textContent = error.message;
    return;
  }
  closeEditor();
  await loadDay();
}

async function persistEntryTimes(entry) {
  setStatus('Saving position…', true);
  const { error } = await supabase
    .from('schedule_entries')
    .update({
      start_time: entry.start_time,
      end_time: entry.end_time,
      updated_at: new Date().toISOString(),
    })
    .eq('id', entry.id);

  if (error) {
    showDataError(error);
    await loadDay();
  } else {
    setStatus('');
  }
}

function attachMove(block, entry) {
  const handleDown = (downEvent) => {
    if (downEvent.target.closest('.schedule-resize-handle')) return;
    const pointerId = downEvent.pointerId;
    const startY = downEvent.clientY;
    const startX = downEvent.clientX;
    const originalStart = timeToMinutes(entry.start_time);
    const duration = timeToMinutes(entry.end_time) - originalStart;
    let armed = false;
    let moved = false;
    let nextStart = originalStart;
    let longPressTimer;

    const arm = () => {
      armed = true;
      block.classList.add('is-dragging');
      block.setPointerCapture?.(pointerId);
    };

    if (downEvent.pointerType === 'mouse') {
      downEvent.preventDefault();
      arm();
    } else {
      longPressTimer = window.setTimeout(arm, 360);
    }

    const onMove = (moveEvent) => {
      const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (!armed && distance > 8) {
        clearTimeout(longPressTimer);
        cleanup();
        return;
      }
      if (!armed) return;

      moveEvent.preventDefault();
      const deltaMinutes = snap(((moveEvent.clientY - startY) / hourHeight()) * 60);
      nextStart = Math.max(START_HOUR * 60, Math.min(END_MINUTE - duration, originalStart + deltaMinutes));
      moved = moved || nextStart !== originalStart;
      block.style.top = `${minuteToY(nextStart)}px`;
    };

    const finish = () => {
      clearTimeout(longPressTimer);
      if (armed) {
        block.classList.remove('is-dragging');
        block.releasePointerCapture?.(pointerId);
      }
      cleanup();
      if (!moved) return;

      state.suppressClickUntil = Date.now() + 350;
      entry.start_time = `${minutesToTime(nextStart)}:00`;
      entry.end_time = `${minutesToTime(nextStart + duration)}:00`;
      renderEntries();
      persistEntryTimes(entry);
    };

    const cleanup = () => {
      block.removeEventListener('pointermove', onMove);
      block.removeEventListener('pointerup', finish);
      block.removeEventListener('pointercancel', finish);
    };

    block.addEventListener('pointermove', onMove);
    block.addEventListener('pointerup', finish);
    block.addEventListener('pointercancel', finish);
  };

  block.addEventListener('pointerdown', handleDown);
}

function attachResize(block, entry) {
  const handle = block.querySelector('.schedule-resize-handle');
  handle.addEventListener('pointerdown', (downEvent) => {
    downEvent.stopPropagation();
    downEvent.preventDefault();
    const pointerId = downEvent.pointerId;
    const startY = downEvent.clientY;
    const startMinute = timeToMinutes(entry.start_time);
    const originalEnd = timeToMinutes(entry.end_time);
    let nextEnd = originalEnd;
    let changed = false;

    block.classList.add('is-dragging');
    handle.setPointerCapture?.(pointerId);

    const onMove = (moveEvent) => {
      moveEvent.preventDefault();
      const deltaMinutes = snap(((moveEvent.clientY - startY) / hourHeight()) * 60);
      nextEnd = Math.max(startMinute + SNAP_MINUTES, Math.min(END_MINUTE, originalEnd + deltaMinutes));
      changed = changed || nextEnd !== originalEnd;
      block.style.height = `${Math.max(22, minuteToY(nextEnd) - minuteToY(startMinute))}px`;
    };

    const finish = () => {
      block.classList.remove('is-dragging');
      handle.releasePointerCapture?.(pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      if (!changed) return;

      state.suppressClickUntil = Date.now() + 350;
      entry.end_time = `${minutesToTime(nextEnd)}:00`;
      renderEntries();
      persistEntryTimes(entry);
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  });
}

function changeDay(days) {
  state.activeDate = addDays(state.activeDate, days);
  renderHeader();
  loadDay({ scroll: true });
}

function scrollToUsefulTime() {
  const target = state.activeDate === budapestToday()
    ? (() => {
        const { hour, minute } = budapestNowParts();
        return Math.max(START_HOUR * 60, hour * 60 + minute - 90);
      })()
    : state.entries.length
      ? Math.max(START_HOUR * 60, timeToMinutes(state.entries[0].start_time) - 60)
      : 8 * 60;
  elements.scroll.scrollTop = Math.max(0, minuteToY(target));
}

function fitTimelineToPhone() {
  if (!window.matchMedia('(max-width: 680px)').matches) {
    elements.scroll.style.maxHeight = '';
    return;
  }
  const bottomNav = document.querySelector('.bottom-nav');
  const bottomHeight = bottomNav?.getBoundingClientRect().height || 0;
  const top = elements.scroll.getBoundingClientRect().top;
  const available = window.innerHeight - top - bottomHeight - 58;
  elements.scroll.style.maxHeight = `${Math.max(270, Math.round(available))}px`;
}

elements.categoryList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  state.selectedCategory = button.dataset.category;
  renderCategoryButtons();
});

elements.categoryManageButton.addEventListener('click', () => {
  const opening = elements.categoryManager.hidden;
  elements.categoryManager.hidden = !opening;
  elements.categoryManageButton.setAttribute('aria-expanded', String(opening));
  elements.categoryManageButton.textContent = opening ? 'Done' : 'Manage';
  setCategoryManagerStatus(state.categoryStorageReady ? '' : categoryStorageError({ code: '42P01' }), !state.categoryStorageReady);
  if (opening) renderCategoryManager();
});

elements.categoryAddButton.addEventListener('click', addCategory);
elements.categoryNewName.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  addCategory();
});
elements.categoryNewColor.addEventListener('input', () => {
  elements.categoryNewColor.nextElementSibling?.style.setProperty('--cat', elements.categoryNewColor.value);
  elements.categoryNewColor.closest('.schedule-category-color-picker')?.style.setProperty('--cat', elements.categoryNewColor.value);
});
elements.categoryManagerList.addEventListener('input', (event) => {
  if (!event.target.matches('.schedule-category-color')) return;
  event.target.closest('[data-category-row]')?.style.setProperty('--cat', event.target.value);
});
elements.categoryManagerList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-category-action]');
  const row = button?.closest('[data-category-row]');
  if (!button || !row) return;
  if (button.dataset.categoryAction === 'save') saveCategory(row);
  if (button.dataset.categoryAction === 'delete') deleteCategory(row);
});

elements.blocks.addEventListener('click', (event) => {
  if (event.target !== elements.blocks || Date.now() < state.suppressClickUntil) return;
  const rect = elements.blocks.getBoundingClientRect();
  let start = snap(yToMinute(event.clientY - rect.top));
  start = Math.max(START_HOUR * 60, Math.min(END_MINUTE - 60, start));
  openEditor(null, { start, end: Math.min(END_MINUTE, start + 60) });
});

$('#schedule-prev').addEventListener('click', () => changeDay(-1));
$('#schedule-next').addEventListener('click', () => changeDay(1));
$('#schedule-today').addEventListener('click', () => {
  state.activeDate = budapestToday();
  loadDay({ scroll: true });
});
$('#schedule-add').addEventListener('click', () => openEditor());
$('#schedule-close').addEventListener('click', closeEditor);
$('#schedule-cancel').addEventListener('click', closeEditor);
elements.deleteButton.addEventListener('click', deleteEntry);
elements.form.addEventListener('submit', saveEntry);
elements.overlay.addEventListener('click', (event) => {
  if (event.target === elements.overlay) closeEditor();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.overlay.hidden) closeEditor();
});

let resizeFrame;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    buildGrid();
    render();
    fitTimelineToPhone();
  });
});
window.addEventListener('orientationchange', fitTimelineToPhone);
window.addEventListener('load', fitTimelineToPhone);
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    state.activeDate = budapestToday();
    loadDay({ scroll: true });
  }
});

supabase
  .channel('schedule-live')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_entries' }, () => loadDay())
  .subscribe();

supabase
  .channel('schedule-category-live')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_categories' }, () => loadCategories())
  .subscribe();

async function initialize() {
  await loadCategories();
  buildGrid();
  render();
  await loadDay({ scroll: true });
  fitTimelineToPhone();
}

initialize();
setInterval(renderNowLine, 30_000);
