// Health module — quick daily signals stored in Supabase by Budapest calendar day.
import { supabase } from './supabase.js';
import { addDays, budapestToday, escapeHtml } from './ui.js';

const $ = (selector) => document.querySelector(selector);
const today = budapestToday();
const TARGETS = { sleep: 8, water: 8, steps: 8000 };
const emptyLog = { sleep_hours: null, water_glasses: 0, steps: null, weight_kg: null };
const LOCAL_KEYS = {
  health: 'dashboard.health.logs.v1',
  supplements: 'dashboard.health.supplements.v1',
  taken: 'dashboard.health.supplement-taken.v1',
};
let log = { ...emptyLog };
let history = [];
let supplements = [];
let takenSupplementIds = new Set();
let saveTimer;

function readLocal(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be disabled */ }
}

function saveHealthLocally(entry) {
  const byDate = new Map(history.map((item) => [item.for_date, item]));
  byDate.set(entry.for_date, entry);
  history = [...byDate.values()].sort((a, b) => a.for_date.localeCompare(b.for_date));
  writeLocal(LOCAL_KEYS.health, history);
}

function saveSupplementsLocally() {
  writeLocal(LOCAL_KEYS.supplements, supplements);
}

function saveTakenLocally() {
  const allTaken = readLocal(LOCAL_KEYS.taken, {});
  allTaken[today] = [...takenSupplementIds];
  writeLocal(LOCAL_KEYS.taken, allTaken);
}

function numeric(value, min, max) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function formatSleep(hours) {
  if (hours == null || hours === '') return 'Not logged';
  const value = Number(hours);
  if (!Number.isFinite(value)) return 'Not logged';
  return `${Number.isInteger(value) ? value : value.toFixed(1)} h`;
}

function scoreFor(entry) {
  if (!entry) return null;
  const hasSignal = entry.sleep_hours != null || entry.water_glasses > 0 || entry.steps != null;
  if (!hasSignal) return null;
  const sleep = Math.min(Number(entry.sleep_hours || 0) / TARGETS.sleep, 1);
  const water = Math.min(Number(entry.water_glasses || 0) / TARGETS.water, 1);
  const steps = Math.min(Number(entry.steps || 0) / TARGETS.steps, 1);
  return Math.round((sleep * 0.35 + water * 0.3 + steps * 0.35) * 100);
}

function goalsFor(entry) {
  return Number(entry.sleep_hours >= TARGETS.sleep)
    + Number(entry.water_glasses >= TARGETS.water)
    + Number(entry.steps >= TARGETS.steps);
}

function formatDay(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' })
    .format(new Date(`${date}T00:00:00Z`));
}

function insightFor(entry, score) {
  if (score == null) return 'Log today’s basics to see your daily read.';
  if (score >= 95) return 'All the foundations are covered. Keep the rest of the day easy and consistent.';
  const ratios = [
    { value: Number(entry.sleep_hours || 0) / TARGETS.sleep, text: 'Sleep is the biggest gap today. A calmer evening can protect tomorrow’s energy.' },
    { value: Number(entry.water_glasses || 0) / TARGETS.water, text: 'Hydration has the most room to improve. One glass now is an easy next step.' },
    { value: Number(entry.steps || 0) / TARGETS.steps, text: 'Movement is the clearest opportunity. A short walk will move this score quickly.' },
  ];
  ratios.sort((a, b) => a.value - b.value);
  return ratios[0].text;
}

function render() {
  const score = scoreFor(log);
  const goals = goalsFor(log);
  $('#healthScore').textContent = score == null ? '—' : score;
  $('#healthRing').style.setProperty('--score', score ?? 0);
  $('#healthGoals').textContent = `${goals} of 3`;
  $('#healthInsight').textContent = insightFor(log, score);

  const sleepHours = log.sleep_hours == null ? null : Number(log.sleep_hours);
  const sleepScaleValue = sleepHours == null ? TARGETS.sleep : Math.min(Math.max(sleepHours, 0), 12);
  $('#sleepInput').value = sleepScaleValue;
  $('#sleepInput').style.setProperty('--sleep-percent', `${(sleepScaleValue / 12) * 100}%`);
  $('#sleepInput').setAttribute('aria-valuetext', sleepHours == null ? 'Not logged' : `${sleepHours} hours`);
  $('#sleepValue').textContent = formatSleep(sleepHours);
  $('#sleepClear').hidden = sleepHours == null;
  $('#waterValue').textContent = log.water_glasses || 0;
  $('#stepsInput').value = log.steps ?? '';
  $('#weightInput').value = log.weight_kg ?? '';

  $('#sleepProgress').style.width = `${Math.min(Number(log.sleep_hours || 0) / TARGETS.sleep, 1) * 100}%`;
  $('#waterProgress').style.width = `${Math.min(Number(log.water_glasses || 0) / TARGETS.water, 1) * 100}%`;
  $('#stepsProgress').style.width = `${Math.min(Number(log.steps || 0) / TARGETS.steps, 1) * 100}%`;
  $('#weightProgress').style.width = log.weight_kg == null ? '0%' : '100%';

  renderHistory();
  renderSupplements();
}

function renderSupplements() {
  const taken = supplements.filter((item) => takenSupplementIds.has(item.id));
  const pending = supplements.filter((item) => !takenSupplementIds.has(item.id));
  $('#supplementCount').textContent = `${taken.length} / ${supplements.length} taken`;

  if (!supplements.length) {
    $('#supplementGroups').innerHTML = '<p class="supplement-empty">Add the supplements you already use to start today’s checklist.</p>';
    return;
  }

  const itemHTML = (item, isTaken) => `<div class="supplement-item${isTaken ? ' is-taken' : ''}">
    <button class="supplement-check" type="button" data-action="toggle" data-id="${item.id}"
      aria-label="Mark ${escapeHtml(item.name)} ${isTaken ? 'as not taken' : 'as taken'}">${isTaken ? '✓' : ''}</button>
    <span class="supplement-copy">
      <strong>${escapeHtml(item.name)}</strong>
      <small>${escapeHtml([item.dose, item.time_of_day].filter(Boolean).join(' · '))}</small>
    </span>
    <button class="supplement-archive" type="button" data-action="archive" data-id="${item.id}" aria-label="Remove ${escapeHtml(item.name)} from daily supplements">×</button>
  </div>`;

  const groupHTML = (label, items, isTaken) => items.length ? `<div class="supplement-group">
    <span class="supplement-group-label">${label} <b>${items.length}</b></span>
    <div class="supplement-list">${items.map((item) => itemHTML(item, isTaken)).join('')}</div>
  </div>` : '';

  $('#supplementGroups').innerHTML = groupHTML('Still to take', pending, false)
    + groupHTML('Taken today', taken, true);
}

function renderHistory() {
  const byDate = new Map(history.map((entry) => [entry.for_date, entry]));
  byDate.set(today, { ...log, for_date: today });
  const days = Array.from({ length: 7 }, (_, index) => addDays(today, index - 6));
  const scored = days.map((date) => scoreFor(byDate.get(date))).filter((value) => value != null);
  $('#healthHistoryLabel').textContent = scored.length
    ? `${Math.round(scored.reduce((sum, value) => sum + value, 0) / scored.length)} avg score`
    : 'No entries yet';
  $('#healthHistoryBars').innerHTML = days.map((date) => {
    const value = scoreFor(byDate.get(date));
    const height = value == null ? 8 : Math.max(value, 12);
    const label = value == null ? 'Not logged' : `${value} health score`;
    return `<div class="health-history-day${date === today ? ' is-today' : ''}" title="${escapeHtml(label)}">
      <span class="health-history-value">${value ?? '·'}</span>
      <span class="health-history-track"><i class="${value == null ? 'is-empty' : ''}" style="height:${height}%"></i></span>
      <span>${formatDay(date)}</span>
    </div>`;
  }).join('');
}

function queueSave() {
  clearTimeout(saveTimer);
  $('#healthSaveState').textContent = 'Saving…';
  saveTimer = setTimeout(save, 450);
}

async function save() {
  const payload = {
    for_date: today,
    sleep_hours: log.sleep_hours,
    water_glasses: log.water_glasses,
    steps: log.steps,
    weight_kg: log.weight_kg,
    updated_at: new Date().toISOString(),
  };
  saveHealthLocally(payload);
  const { error } = await supabase.from('health_logs').upsert(payload, { onConflict: 'for_date' });
  if (error) {
    $('#healthSaveState').textContent = 'Saved on this device';
    showDatabaseError(error);
    return;
  }
  $('#healthSaveState').textContent = 'Saved';
  setTimeout(() => { if ($('#healthSaveState').textContent === 'Saved') $('#healthSaveState').textContent = ''; }, 1400);
}

function showDatabaseError(error) {
  const status = $('#health-status');
  status.textContent = /health_|schema cache|relation/i.test(error?.message || '')
    ? 'Using device storage for now. Run sql/health.sql in Supabase to sync across devices.'
    : 'Health data is temporarily unavailable.';
}

async function load() {
  $('#healthDate').textContent = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric',
  }).format(new Date(`${today}T00:00:00Z`));

  history = readLocal(LOCAL_KEYS.health, []);
  supplements = readLocal(LOCAL_KEYS.supplements, []);
  const localTaken = readLocal(LOCAL_KEYS.taken, {});
  takenSupplementIds = new Set(localTaken[today] || []);
  const localTodayLog = history.find((entry) => entry.for_date === today);
  if (localTodayLog) log = { ...emptyLog, ...localTodayLog };
  render();

  const from = addDays(today, -6);
  const [healthResult, supplementResult, takenResult] = await Promise.all([
    supabase.from('health_logs')
      .select('for_date,sleep_hours,water_glasses,steps,weight_kg')
      .gte('for_date', from).lte('for_date', today).order('for_date'),
    supabase.from('health_supplements')
      .select('id,name,dose,time_of_day,sort').eq('active', true).order('sort').order('created_at'),
    supabase.from('health_supplement_logs')
      .select('supplement_id').eq('for_date', today),
  ]);

  const firstError = healthResult.error || supplementResult.error || takenResult.error;
  if (firstError) showDatabaseError(firstError);

  if (!healthResult.error && healthResult.data?.length && !history.length) {
    history = healthResult.data;
    writeLocal(LOCAL_KEYS.health, history);
  }
  if (!supplementResult.error && supplementResult.data?.length) {
    const merged = new Map(supplementResult.data.map((item) => [item.id, item]));
    supplements.filter((item) => String(item.id).startsWith('local-')).forEach((item) => merged.set(item.id, item));
    supplements = [...merged.values()];
    saveSupplementsLocally();
  }
  if (!takenResult.error) {
    (takenResult.data || []).forEach((entry) => takenSupplementIds.add(entry.supplement_id));
    saveTakenLocally();
  }
  const todayLog = history.find((entry) => entry.for_date === today);
  if (todayLog) log = { ...emptyLog, ...todayLog };
  render();
}

async function toggleSupplement(id) {
  const isTaken = takenSupplementIds.has(id);
  if (isTaken) takenSupplementIds.delete(id);
  else takenSupplementIds.add(id);
  saveTakenLocally();
  renderSupplements();

  if (String(id).startsWith('local-')) return;
  const request = isTaken
    ? supabase.from('health_supplement_logs').delete().eq('supplement_id', id).eq('for_date', today)
    : supabase.from('health_supplement_logs').insert({ supplement_id: id, for_date: today });
  const { error } = await request;
  if (error) showDatabaseError(error);
}

async function archiveSupplement(id) {
  supplements = supplements.filter((item) => item.id !== id);
  takenSupplementIds.delete(id);
  saveSupplementsLocally();
  saveTakenLocally();
  renderSupplements();

  if (String(id).startsWith('local-')) return;
  const { error } = await supabase.from('health_supplements').update({ active: false }).eq('id', id);
  if (error) showDatabaseError(error);
}

$('#sleepInput').addEventListener('input', (event) => {
  log.sleep_hours = numeric(event.target.value, 0, 12);
  render();
  queueSave();
});

$('#sleepClear').addEventListener('click', () => {
  log.sleep_hours = null;
  render();
  queueSave();
});

$('#stepsInput').addEventListener('input', (event) => {
  log.steps = numeric(event.target.value, 0, 100000);
  render();
  queueSave();
});

$('#weightInput').addEventListener('input', (event) => {
  const value = numeric(event.target.value, 20, 400);
  if (value == null && event.target.value !== '') return;
  log.weight_kg = value;
  $('#weightProgress').style.width = value == null ? '0%' : '100%';
  queueSave();
});

$('#waterMinus').addEventListener('click', () => {
  log.water_glasses = Math.max(0, Number(log.water_glasses || 0) - 1);
  render();
  queueSave();
});

$('#waterPlus').addEventListener('click', () => {
  log.water_glasses = Math.min(50, Number(log.water_glasses || 0) + 1);
  render();
  queueSave();
});

$('#supplementGroups').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'toggle') toggleSupplement(button.dataset.id);
  if (button.dataset.action === 'archive') archiveSupplement(button.dataset.id);
});

$('#supplementForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('#supplementName').value.trim();
  if (!name) return;
  const payload = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    dose: $('#supplementDose').value.trim() || null,
    time_of_day: $('#supplementTime').value,
    sort: supplements.length ? Math.max(...supplements.map((item) => item.sort || 0)) + 1 : 0,
  };
  supplements.push(payload);
  saveSupplementsLocally();
  event.target.reset();
  renderSupplements();

  const remotePayload = { ...payload };
  delete remotePayload.id;
  const { data, error } = await supabase.from('health_supplements')
    .insert(remotePayload).select('id,name,dose,time_of_day,sort').single();
  if (error) {
    showDatabaseError(error);
    return;
  }
  const localIndex = supplements.findIndex((item) => item.id === payload.id);
  if (localIndex >= 0) supplements[localIndex] = data;
  if (takenSupplementIds.delete(payload.id)) {
    takenSupplementIds.add(data.id);
    saveTakenLocally();
  }
  saveSupplementsLocally();
  renderSupplements();
});

render();
load();
