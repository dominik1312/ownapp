import { supabase } from './supabase.js';
import { addDays, budapestToday, TZ } from './ui.js';

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = 'weekly_reviews_v1';

const elements = {
  previous: $('#review-prev'),
  next: $('#review-next'),
  weekLabel: $('#review-week-label'),
  weekState: $('#review-week-state'),
  generate: $('#review-generate'),
  save: $('#review-save'),
  state: $('#review-state'),
  summary: $('#coach-summary'),
  note: $('#coach-note'),
  proud: $('#review-proud'),
  drained: $('#review-drained'),
  avoided: $('#review-avoided'),
  experiment: $('#review-experiment'),
  commitments: [
    $('#review-commitment-1'),
    $('#review-commitment-2'),
    $('#review-commitment-3'),
  ],
  sendMain: $('#review-send-main'),
  sendSchedule: $('#review-send-schedule'),
  status: $('#review-status'),
};

const metricElements = {
  tasks: {
    value: $('#metric-tasks-value'),
    unit: $('#metric-tasks-unit'),
    delta: $('#metric-tasks-delta'),
    bar: $('#metric-tasks-bar'),
  },
  habits: {
    value: $('#metric-habits-value'),
    delta: $('#metric-habits-delta'),
    bar: $('#metric-habits-bar'),
  },
  health: {
    value: $('#metric-health-value'),
    delta: $('#metric-health-delta'),
    bar: $('#metric-health-bar'),
  },
  focus: {
    value: $('#metric-focus-value'),
    delta: $('#metric-focus-delta'),
    bar: $('#metric-focus-bar'),
  },
};

const mostRecentCompletedWeek = completedWeekStart(budapestToday());
const state = {
  weekStart: mostRecentCompletedWeek,
  data: null,
  metrics: null,
  coach: null,
  loading: false,
};

function completedWeekStart(today) {
  const date = new Date(`${today}T00:00:00Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return addDays(today, -daysSinceMonday - 7);
}

function weekDates(start) {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function formatWeek(start) {
  const end = addDays(start, 6);
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
  const year = endDate.getUTCFullYear();
  const startMonth = month.format(startDate);
  const endMonth = month.format(endDate);
  return startMonth === endMonth
    ? `${startMonth} ${startDate.getUTCDate()}–${endDate.getUTCDate()}, ${year}`
    : `${startMonth} ${startDate.getUTCDate()}–${endMonth} ${endDate.getUTCDate()}, ${year}`;
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function percent(part, whole) {
  return whole > 0 ? (part / whole) * 100 : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function rangeRows(rows, start, end) {
  return rows.filter((row) => row.for_date >= start && row.for_date <= end);
}

function healthScore(entry) {
  if (!entry) return null;
  return (
    Number(Number(entry.sleep_hours) >= 8)
    + Number(Number(entry.water_glasses) >= 8)
    + Number(Number(entry.steps) >= 8000)
  ) / 3 * 100;
}

function budapestHour(value) {
  if (!value) return null;
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
  return Number(hour);
}

function safeData(result) {
  return result?.error ? [] : (result?.data ?? []);
}

async function loadDashboardData() {
  const currentEnd = addDays(state.weekStart, 6);
  const previousStart = addDays(state.weekStart, -7);
  const [tasks, habits, habitLogs, health, mind] = await Promise.all([
    supabase.from('tasks')
      .select('id,title,for_date,done,done_at,scheduled_at,sort')
      .gte('for_date', previousStart).lte('for_date', currentEnd),
    supabase.from('habits')
      .select('id,name,active').eq('active', true),
    supabase.from('habit_logs')
      .select('habit_id,for_date').gte('for_date', previousStart).lte('for_date', currentEnd),
    supabase.from('health_logs')
      .select('for_date,sleep_hours,water_glasses,steps')
      .gte('for_date', previousStart).lte('for_date', currentEnd),
    supabase.from('mind_logs')
      .select('for_date,mood,energy,focus')
      .gte('for_date', previousStart).lte('for_date', currentEnd),
  ]);

  return {
    tasks: safeData(tasks),
    habits: safeData(habits),
    habitLogs: safeData(habitLogs),
    health: safeData(health),
    mind: safeData(mind),
  };
}

function calculateMetrics(data) {
  const start = state.weekStart;
  const end = addDays(start, 6);
  const previousStart = addDays(start, -7);
  const previousEnd = addDays(start, -1);
  const currentTasks = rangeRows(data.tasks, start, end);
  const previousTasks = rangeRows(data.tasks, previousStart, previousEnd);
  const currentHabitLogs = rangeRows(data.habitLogs, start, end);
  const previousHabitLogs = rangeRows(data.habitLogs, previousStart, previousEnd);
  const currentHealth = rangeRows(data.health, start, end);
  const previousHealth = rangeRows(data.health, previousStart, previousEnd);
  const currentMind = rangeRows(data.mind, start, end);
  const previousMind = rangeRows(data.mind, previousStart, previousEnd);
  const activeHabits = data.habits.length;
  const doneTasks = currentTasks.filter((task) => task.done);
  const previousDoneTasks = previousTasks.filter((task) => task.done);

  return {
    currentTasks,
    previousTasks,
    doneTasks,
    taskRate: percent(doneTasks.length, currentTasks.length),
    previousTaskRate: percent(previousDoneTasks.length, previousTasks.length),
    habitRate: percent(currentHabitLogs.length, activeHabits * 7),
    previousHabitRate: percent(previousHabitLogs.length, activeHabits * 7),
    healthScore: average(currentHealth.map(healthScore)),
    previousHealthScore: average(previousHealth.map(healthScore)),
    focus: average(currentMind.map((entry) => entry.focus)),
    previousFocus: average(previousMind.map((entry) => entry.focus)),
    averageSleep: average(currentHealth.map((entry) => entry.sleep_hours)),
    currentHealth,
    currentMind,
    currentHabitLogs,
    activeHabits,
    morningDone: doneTasks.filter((task) => {
      const hour = budapestHour(task.done_at);
      return Number.isFinite(hour) && hour < 12;
    }).length,
  };
}

function formatDelta(current, previous, suffix = '', digits = 0) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return { text: 'No baseline', direction: '' };
  }
  const delta = current - previous;
  const rounded = Math.abs(delta).toFixed(digits);
  return {
    text: `${delta >= 0 ? '+' : '−'}${rounded}${suffix}`,
    direction: delta > 0.05 ? 'is-up' : delta < -0.05 ? 'is-down' : '',
  };
}

function renderMetric(name, value, barValue, delta, display, unit) {
  const target = metricElements[name];
  target.value.textContent = display;
  if (target.unit && unit) target.unit.textContent = unit;
  target.bar.style.width = `${clamp(barValue)}%`;
  target.delta.textContent = delta.text;
  target.delta.className = `review-delta ${delta.direction}`.trim();
  target.bar.parentElement.setAttribute('aria-label', Number.isFinite(value)
    ? `${name} score ${Math.round(value)} percent`
    : `${name} data unavailable`);
}

function renderMetrics(metrics) {
  renderMetric(
    'tasks',
    metrics.taskRate,
    metrics.taskRate,
    formatDelta(metrics.taskRate, metrics.previousTaskRate, '%'),
    `${metrics.doneTasks.length}/${metrics.currentTasks.length}`,
    Number.isFinite(metrics.taskRate) ? `${Math.round(metrics.taskRate)}%` : 'no tasks',
  );
  renderMetric(
    'habits',
    metrics.habitRate,
    metrics.habitRate,
    formatDelta(metrics.habitRate, metrics.previousHabitRate, '%'),
    Number.isFinite(metrics.habitRate) ? `${Math.round(metrics.habitRate)}%` : '—',
  );
  renderMetric(
    'health',
    metrics.healthScore,
    metrics.healthScore,
    formatDelta(metrics.healthScore, metrics.previousHealthScore),
    Number.isFinite(metrics.healthScore) ? `${Math.round(metrics.healthScore)}` : '—',
  );
  renderMetric(
    'focus',
    Number.isFinite(metrics.focus) ? metrics.focus * 20 : null,
    Number.isFinite(metrics.focus) ? metrics.focus * 20 : null,
    formatDelta(metrics.focus, metrics.previousFocus, '', 1),
    Number.isFinite(metrics.focus) ? metrics.focus.toFixed(1) : '—',
  );
}

function renderBars(selector, values, pink = false) {
  const element = $(selector);
  const normalized = values.map((value) => clamp(value, 4, 100));
  const threshold = average(normalized) ?? 50;
  element.classList.toggle('review-signal-pink', pink);
  element.innerHTML = normalized
    .map((value) => `<i class="${value >= threshold ? 'is-hot' : ''}" style="height:${value}%"></i>`)
    .join('');
}

function renderSignals(metrics) {
  const dates = weekDates(state.weekStart);
  const healthByDate = new Map(metrics.currentHealth.map((entry) => [entry.for_date, entry]));
  const mindByDate = new Map(metrics.currentMind.map((entry) => [entry.for_date, entry]));
  const focusValues = dates.map((date) => Number(mindByDate.get(date)?.focus) || 0);
  const paired = dates
    .map((date) => ({
      sleep: Number(healthByDate.get(date)?.sleep_hours),
      focus: Number(mindByDate.get(date)?.focus),
    }))
    .filter((entry) => Number.isFinite(entry.sleep) && Number.isFinite(entry.focus));
  const lowSleepFocus = average(paired.filter((entry) => entry.sleep < 7.5).map((entry) => entry.focus));
  const restedFocus = average(paired.filter((entry) => entry.sleep >= 7.5).map((entry) => entry.focus));
  const focusDifference = Number.isFinite(lowSleepFocus) && Number.isFinite(restedFocus)
    ? Math.round(((lowSleepFocus - restedFocus) / restedFocus) * 100)
    : null;

  $('#signal-sleep-score').textContent = focusDifference == null ? '7-day read' : `${focusDifference > 0 ? '+' : '−'}${Math.abs(focusDifference)}%`;
  $('#signal-sleep-title').textContent = metrics.averageSleep == null
    ? 'More check-ins will reveal the pattern'
    : metrics.averageSleep < 7.5 ? 'Sleep is the clearest recovery lever' : 'Sleep supported steady focus';
  $('#signal-sleep-copy').textContent = focusDifference == null
    ? `Average sleep was ${metrics.averageSleep == null ? 'not logged' : `${metrics.averageSleep.toFixed(1)} hours`}; keep pairing it with daily focus.`
    : `After shorter sleep, next-day focus averaged ${lowSleepFocus.toFixed(1)} instead of ${restedFocus.toFixed(1)}.`;
  renderBars('#signal-sleep-bars', focusValues.map((value) => value * 20), true);

  const taskCounts = dates.map((date) => metrics.doneTasks.filter((task) => task.for_date === date).length);
  const maxTasks = Math.max(1, ...taskCounts);
  const morningShare = percent(metrics.morningDone, metrics.doneTasks.length);
  $('#signal-tasks-score').textContent = Number.isFinite(morningShare) ? `${Math.round(morningShare)}%` : 'No timing';
  $('#signal-tasks-title').textContent = Number.isFinite(morningShare) && morningShare >= 60
    ? 'Mornings did the heavy lifting'
    : 'Your strongest work window is still forming';
  $('#signal-tasks-copy').textContent = metrics.doneTasks.length
    ? `${metrics.morningDone} of ${metrics.doneTasks.length} completed tasks were finished before 12:00.`
    : 'Complete a few tasks this week to reveal your strongest working hours.';
  renderBars('#signal-tasks-bars', taskCounts.map((value) => value / maxTasks * 100));

  const dailyHabitRates = dates.map((date) => {
    const count = metrics.currentHabitLogs.filter((log) => log.for_date === date).length;
    return metrics.activeHabits ? count / metrics.activeHabits * 100 : 0;
  });
  const habitDays = dailyHabitRates.filter((value) => value > 0).length;
  $('#signal-habits-score').textContent = metrics.activeHabits ? `${habitDays}/7 days` : 'No habits';
  $('#signal-habits-title').textContent = Number.isFinite(metrics.habitRate) && metrics.habitRate >= 75
    ? 'Consistency became your floor'
    : 'Consistency is the next stabilizer';
  $('#signal-habits-copy').textContent = metrics.activeHabits
    ? `${metrics.currentHabitLogs.length} of ${metrics.activeHabits * 7} possible habit check-ins were completed.`
    : 'Add active habits to reveal how consistency supports the rest of your week.';
  renderBars('#signal-habits-bars', dailyHabitRates);
}

function readReflections() {
  return {
    proud: elements.proud.value.trim(),
    drained: elements.drained.value.trim(),
    avoided: elements.avoided.value.trim(),
  };
}

function buildCoach(metrics) {
  const taskRate = Number.isFinite(metrics.taskRate) ? Math.round(metrics.taskRate) : null;
  const habitRate = Number.isFinite(metrics.habitRate) ? Math.round(metrics.habitRate) : null;
  const morningShare = percent(metrics.morningDone, metrics.doneTasks.length);
  const reflections = readReflections();
  const strengths = [];
  if (taskRate != null) strengths.push(`${taskRate}% task completion`);
  if (habitRate != null) strengths.push(`${habitRate}% habit consistency`);
  if (Number.isFinite(metrics.focus)) strengths.push(`${metrics.focus.toFixed(1)}/5 average focus`);

  let summary = strengths.length
    ? `This week was built on ${strengths.slice(0, 2).join(' and ')}.`
    : 'This week needs a few more check-ins before a strong pattern can be identified.';
  if (Number.isFinite(morningShare) && morningShare >= 60) {
    summary += ` Your mornings carried the work: ${Math.round(morningShare)}% of completed tasks were finished before noon.`;
  }
  if (Number.isFinite(metrics.averageSleep) && metrics.averageSleep < 7.5) {
    summary += ` Average sleep was ${metrics.averageSleep.toFixed(1)} hours, making recovery the clearest constraint to address next.`;
  } else if (Number.isFinite(metrics.averageSleep)) {
    summary += ` Sleep averaged ${metrics.averageSleep.toFixed(1)} hours and gave the week a stable recovery base.`;
  }

  let note = Number.isFinite(morningShare) && morningShare >= 60
    ? 'Protect the hours where your focus already works instead of adding more tasks.'
    : 'Reduce next week to one repeatable experiment and three commitments you can actually keep.';
  if (reflections.drained) note += ` Your note about “${reflections.drained}” should shape the experiment.`;

  const experiment = Number.isFinite(morningShare) && morningShare >= 60
    ? 'Protect a 09:00–11:00 deep-work block on Monday, Wednesday, and Friday.'
    : Number.isFinite(metrics.averageSleep) && metrics.averageSleep < 7.5
      ? 'Start a 22:30 wind-down and be in bed before 23:00 on five nights.'
      : Number.isFinite(metrics.habitRate) && metrics.habitRate < 70
        ? 'Anchor the most important habit to breakfast and complete it before checking messages.'
        : 'Choose one priority before noon on Monday, Wednesday, and Friday.';

  const carry = metrics.currentTasks.find((task) => !task.done)?.title
    || reflections.avoided
    || 'Finish the most important open task';
  const healthCommitment = Number.isFinite(metrics.averageSleep) && metrics.averageSleep < 7.5
    ? 'Sleep before 23:00 on five nights'
    : 'Complete three health check-ins';
  const focusCommitment = Number.isFinite(morningShare) && morningShare >= 60
    ? 'Protect three morning focus blocks'
    : 'Complete three focused work sessions';

  return {
    summary,
    note,
    experiment,
    commitments: [carry, healthCommitment, focusCommitment],
  };
}

function renderCoach(coach, { replacePlan = true } = {}) {
  state.coach = coach;
  elements.summary.textContent = coach.summary;
  elements.note.textContent = coach.note;
  elements.state.textContent = 'Ready to review';
  if (replacePlan) {
    elements.experiment.value = coach.experiment;
    elements.commitments.forEach((input, index) => {
      input.value = coach.commitments[index] ?? '';
    });
  }
}

function reviewStore() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function storedReview() {
  return reviewStore()[state.weekStart] ?? null;
}

function loadSavedReview() {
  const saved = storedReview();
  elements.proud.value = saved?.reflections?.proud ?? '';
  elements.drained.value = saved?.reflections?.drained ?? '';
  elements.avoided.value = saved?.reflections?.avoided ?? '';
  if (saved?.coach) {
    renderCoach(saved.coach, { replacePlan: false });
    elements.experiment.value = saved.experiment ?? saved.coach.experiment ?? '';
    elements.commitments.forEach((input, index) => {
      input.value = saved.commitments?.[index] ?? saved.coach.commitments?.[index] ?? '';
    });
    elements.weekState.textContent = 'Saved on this device';
  } else {
    elements.weekState.textContent = 'Completed week';
  }
  return saved;
}

function saveReview() {
  const store = reviewStore();
  const coach = state.coach ?? buildCoach(state.metrics);
  store[state.weekStart] = {
    savedAt: new Date().toISOString(),
    reflections: readReflections(),
    coach,
    experiment: elements.experiment.value.trim(),
    commitments: elements.commitments.map((input) => input.value.trim()),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    elements.weekState.textContent = 'Saved on this device';
    setStatus('Review saved on this device.');
  } catch {
    setStatus('This browser could not save the review.', true);
  }
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle('is-error', isError);
}

function setBusy(busy) {
  state.loading = busy;
  elements.generate.disabled = busy;
  elements.save.disabled = busy;
  elements.previous.disabled = busy;
  elements.next.disabled = busy || state.weekStart >= mostRecentCompletedWeek;
  if (busy) {
    elements.state.textContent = 'Reading your data…';
    setStatus('Loading dashboard data…');
  }
}

async function loadWeek() {
  elements.weekLabel.textContent = formatWeek(state.weekStart);
  setBusy(true);
  loadSavedReview();
  try {
    state.data = await loadDashboardData();
    state.metrics = calculateMetrics(state.data);
    renderMetrics(state.metrics);
    renderSignals(state.metrics);
    const saved = storedReview();
    if (saved?.coach) {
      renderCoach(saved.coach, { replacePlan: false });
    } else {
      renderCoach(buildCoach(state.metrics));
    }
    setStatus(saved ? 'Saved review loaded.' : 'Dashboard data is ready.');
  } catch (error) {
    state.data = { tasks: [], habits: [], habitLogs: [], health: [], mind: [] };
    state.metrics = calculateMetrics(state.data);
    renderMetrics(state.metrics);
    renderSignals(state.metrics);
    renderCoach(buildCoach(state.metrics));
    setStatus(`Review data could not be loaded: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function sendToMain() {
  const commitments = elements.commitments.map((input) => input.value.trim()).filter(Boolean);
  if (!commitments.length) return setStatus('Add at least one commitment first.', true);
  elements.sendMain.disabled = true;
  setStatus('Sending commitments to Main…');
  const nextWeek = addDays(state.weekStart, 7);
  const rows = commitments.map((title, index) => ({
    title,
    category: 'Weekly review',
    for_date: nextWeek,
    done: false,
    sort: index,
  }));
  const { error } = await supabase.from('tasks').insert(rows);
  elements.sendMain.disabled = false;
  setStatus(error ? `Could not send to Main: ${error.message}` : `${rows.length} commitments added to Main.`, !!error);
}

async function sendToSchedule() {
  const experiment = elements.experiment.value.trim();
  if (!experiment) return setStatus('Add a weekly experiment first.', true);
  elements.sendSchedule.disabled = true;
  setStatus('Adding the experiment to Schedule…');
  const nextWeek = addDays(state.weekStart, 7);
  const lower = experiment.toLowerCase();
  const plan = lower.includes('sleep') || lower.includes('wind-down')
    ? { offsets: [0, 1, 2, 3, 4], title: 'Evening wind-down', start: '22:30:00', end: '23:00:00', category: 'rest' }
    : lower.includes('habit') || lower.includes('breakfast')
      ? { offsets: [0, 1, 2, 3, 4], title: 'Habit anchor', start: '07:30:00', end: '07:45:00', category: 'personal' }
      : { offsets: [0, 2, 4], title: 'Protected deep work', start: '09:00:00', end: '11:00:00', category: 'focus' };
  const rows = plan.offsets.map((offset) => ({
    for_date: addDays(nextWeek, offset),
    title: plan.title,
    start_time: plan.start,
    end_time: plan.end,
    category: plan.category,
    notes: experiment,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from('schedule_entries').insert(rows);
  elements.sendSchedule.disabled = false;
  setStatus(error ? `Could not update Schedule: ${error.message}` : `${rows.length} experiment blocks added to Schedule.`, !!error);
}

elements.previous.addEventListener('click', () => {
  state.weekStart = addDays(state.weekStart, -7);
  loadWeek();
});
elements.next.addEventListener('click', () => {
  if (state.weekStart >= mostRecentCompletedWeek) return;
  state.weekStart = addDays(state.weekStart, 7);
  loadWeek();
});
elements.generate.addEventListener('click', () => {
  if (!state.metrics) return;
  renderCoach(buildCoach(state.metrics));
  setStatus('Review regenerated from the latest data and reflection notes.');
});
elements.save.addEventListener('click', saveReview);
elements.sendMain.addEventListener('click', sendToMain);
elements.sendSchedule.addEventListener('click', sendToSchedule);

loadWeek();
