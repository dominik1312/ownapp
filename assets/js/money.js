// Life OS — Money module: net worth, flow (income/expense), subscriptions,
// savings goals. Persisted in Supabase: one `finance_items` table shared by
// the five UI lists via its `list` column — see sql/finance.sql (run once in
// the Supabase SQL Editor). Amounts are HUF.
import { supabase } from './supabase.js';
import { escapeHtml, emptyStateHTML } from './ui.js';

const $ = (sel) => document.querySelector(sel);

const CURRENCY_SUFFIX = 'Ft';
const PALETTE = ['#33D6C3', '#F5B95F', '#60A5FA', '#A78BFA', '#4ADE80', '#FF8A7A'];

const TABLE = 'finance_items';
const LISTS = ['accounts', 'income', 'categories', 'subs', 'goals'];

const state = {
  tab: 'net',
  openForm: null,
  editing: null, // { list, id, field } while an amount is being edited in place
  loaded: false,
  accounts: [], income: [], categories: [], subs: [], goals: [],
};

const fmt = (n) => `${Math.round(n).toLocaleString('hu-HU')} ${CURRENCY_SUFFIX}`;
const sum = (arr, key) => arr.reduce((a, b) => a + b[key], 0);

function setTab(tab) { state.tab = tab; state.openForm = null; state.editing = null; render(); }
function toggleForm(key) { state.openForm = state.openForm === key ? null : key; state.editing = null; render(); }

/* ---------- Supabase CRUD (optimistic where possible) ---------- */

// numeric columns arrive as strings from PostgREST — coerce once here
function normalize(row) {
  return {
    ...row,
    amount: Number(row.amount ?? 0),
    target: Number(row.target ?? 0),
    saved: Number(row.saved ?? 0),
  };
}

async function load() {
  const { data, error } = await supabase.from(TABLE).select('*')
    .order('sort').order('created_at');
  if (error) return showError(error);
  for (const l of LISTS) state[l] = [];
  for (const row of data ?? []) state[row.list]?.push(normalize(row));
  state.loaded = true;
  render();
}

async function pushItem(list, obj) {
  const { data, error } = await supabase.from(TABLE)
    .insert({ list, ...obj }).select().single();
  if (error) return showError(error);
  state[list] = [...state[list], normalize(data)];
  state.openForm = null;
  render();
}

async function delItem(list, id) {
  const prev = state[list];
  state[list] = prev.filter((x) => String(x.id) !== String(id)); // optimistic
  render();
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) {
    state[list] = prev; // revert on failure
    render();
    showError(error);
  }
}

async function patchItem(list, id, changes) {
  const item = state[list].find((x) => String(x.id) === String(id));
  if (!item) return;
  const prev = {};
  for (const k of Object.keys(changes)) prev[k] = item[k];
  state[list] = state[list].map((x) => (x === item ? { ...x, ...changes } : x)); // optimistic
  render();
  const { error } = await supabase.from(TABLE).update(changes).eq('id', id);
  if (error) {
    state[list] = state[list].map((x) => (String(x.id) === String(id) ? { ...x, ...prev } : x));
    render();
    showError(error);
  }
}

async function contribute(id, amount) {
  const goal = state.goals.find((g) => String(g.id) === String(id));
  if (!goal || !(amount > 0)) return;
  const prevSaved = goal.saved;
  const saved = prevSaved + amount;
  state.goals = state.goals.map((g) => (g === goal ? { ...g, saved } : g)); // optimistic
  state.openForm = null;
  render();
  const { error } = await supabase.from(TABLE).update({ saved }).eq('id', id);
  if (error) {
    state.goals = state.goals.map((g) => (String(g.id) === String(id) ? { ...g, saved: prevSaved } : g));
    render();
    showError(error);
  }
}

let statusTimer;
function showError(error) {
  const el = $('#money-status');
  // Missing table → the one-time setup step hasn't run yet; keep the hint on screen.
  const missing = error?.code === '42P01' || /does not exist|schema cache/i.test(error?.message ?? '');
  clearTimeout(statusTimer);
  if (missing) {
    el.textContent = 'Hiányzó tábla — futtasd le egyszer a sql/finance.sql tartalmát a Supabase SQL Editorban.';
  } else {
    el.textContent = `Hiba: ${error.message}`;
    statusTimer = setTimeout(() => { el.textContent = ''; }, 8000);
  }
}

/* ---------- inline amount editing ---------- */

// A displayed amount: normally a click-to-edit button, but while this exact
// cell is being edited it renders as a number input instead.
function amountCell(list, item, field, display, extraClass = '') {
  const e = state.editing;
  if (e && e.list === list && String(e.id) === String(item.id) && e.field === field) {
    return `<input id="edit-input" class="money-edit-input mono" type="number" step="any" value="${Number(item[field]) || 0}" />`;
  }
  return `<button type="button" class="money-amount-btn ${extraClass}" title="Kattints a szerkesztéshez" data-action="edit" data-list="${list}" data-id="${item.id}" data-field="${field}">${display}</button>`;
}

function commitEdit(raw) {
  const e = state.editing;
  if (!e) return;
  state.editing = null;
  const item = state[e.list].find((x) => String(x.id) === String(e.id));
  const value = Number(raw);
  if (!item || !Number.isFinite(value) || value === Number(item[e.field])) return render();
  patchItem(e.list, e.id, { [e.field]: value });
}

/* ---------- tabs ---------- */

const TAB_DEFS = [
  { key: 'net', label: 'Nettó vagyon' },
  { key: 'flow', label: 'Flow' },
  { key: 'subs', label: 'Előfizetések' },
  { key: 'save', label: 'Megtakarítás' },
];

function renderTabs() {
  return TAB_DEFS.map((t) => `<button type="button" class="money-tab${state.tab === t.key ? ' is-active' : ''}" data-action="set-tab" data-tab="${t.key}">${t.label}</button>`)
    .join('');
}

/* ---------- net worth ---------- */

function renderNetWorth() {
  const total = sum(state.accounts, 'amount') || 1;

  const rows = state.accounts.length
    ? state.accounts.map((a, i) => {
      const pct = Math.round((a.amount / total) * 100);
      const color = PALETTE[i % PALETTE.length];
      return `<div class="card money-row">
        <span class="money-dot" style="background:${color};box-shadow:0 0 10px ${color};"></span>
        <div class="money-row-main">
          <div class="money-row-head">
            <span class="money-row-name">${escapeHtml(a.name)}</span>
            ${amountCell('accounts', a, 'amount', fmt(a.amount), 'money-row-amount mono')}
          </div>
          <div class="money-row-bar-line">
            <div class="money-bar-track"><span class="money-bar-fill" style="background:${color};width:${pct}%;"></span></div>
            <span class="money-row-pct">${pct}%</span>
          </div>
          <span class="money-row-type">${escapeHtml(a.type || 'Számla')}</span>
        </div>
        <button type="button" class="money-del-btn" title="Törlés" data-action="delete" data-list="accounts" data-id="${a.id}">×</button>
      </div>`;
    }).join('')
    : emptyStateHTML('Nincs még számla felvéve.');

  const shareSegs = state.accounts.map((a, i) => `<span class="money-share-seg" style="width:${(a.amount / total) * 100}%;background:${PALETTE[i % PALETTE.length]};"></span>`).join('');

  const form = state.openForm === 'account' ? `
    <form class="card money-inline-form" data-form="add-account">
      <input name="acc_name" placeholder="Név (pl. Revolut)" required maxlength="40" class="money-f-grow2" />
      <input name="acc_type" placeholder="Típus" maxlength="30" class="money-f-grow1" />
      <input name="acc_amount" type="number" placeholder="Egyenleg" required class="money-f-grow1 mono" />
      <button type="submit" class="money-form-submit money-form-submit--gold">Mentés</button>
    </form>` : '';

  return `
    <section class="card money-hero">
      <p class="money-hero-eyebrow">Teljes nettó vagyon</p>
      <p class="money-hero-value">${fmt(sum(state.accounts, 'amount'))}</p>
      <p class="money-hero-sub">${state.accounts.length} számla</p>
      <div class="money-share-bar">${shareSegs}</div>
    </section>
    <div class="section-label">
      <span class="rule rule-s"></span>SZÁMLÁK<span class="rule"></span>
      <button type="button" class="money-add-btn money-add-btn--gold" data-action="toggle-form" data-key="account">+ Számla</button>
    </div>
    ${form}
    ${rows}`;
}

/* ---------- flow ---------- */

function renderFlow() {
  const incomeTotal = sum(state.income, 'amount');
  const expenseTotal = sum(state.categories, 'amount');
  const net = incomeTotal - expenseTotal;
  const netColor = net >= 0 ? 'var(--ok)' : '#FF8A7A';
  const netFmt = `${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}`;
  const catMax = Math.max(1, ...state.categories.map((c) => c.amount));

  const categoriesHtml = state.categories.length
    ? state.categories.map((c) => {
      const pctLabel = expenseTotal ? Math.round((c.amount / expenseTotal) * 100) : 0;
      const barWidth = (c.amount / catMax) * 100;
      return `<div>
        <div class="money-cat-head">
          <span class="money-cat-name"><span class="money-cat-pct">${pctLabel}%</span>${escapeHtml(c.name)}</span>
          <span class="money-cat-amount-wrap">${amountCell('categories', c, 'amount', fmt(c.amount), 'mono')}<button type="button" class="money-del-btn money-del-btn--sm" title="Törlés" data-action="delete" data-list="categories" data-id="${c.id}">×</button></span>
        </div>
        <div class="money-bar-track money-bar-track--tall"><span class="money-bar-fill money-bar-fill--gold" style="width:${barWidth}%;"></span></div>
      </div>`;
    }).join('')
    : emptyStateHTML('Nincs még kiadás kategória felvéve.');

  const incomeHtml = state.income.length
    ? state.income.map((inc) => `<div class="card money-income-row">
        <span class="money-income-left"><span class="money-dot money-dot--sm" style="background:var(--ok);box-shadow:0 0 8px var(--ok);"></span><span>${escapeHtml(inc.name)}</span></span>
        <span class="money-income-left">${amountCell('income', inc, 'amount', `+${fmt(inc.amount)}`, 'money-income-amount mono')}<button type="button" class="money-del-btn" title="Törlés" data-action="delete" data-list="income" data-id="${inc.id}">×</button></span>
      </div>`).join('')
    : emptyStateHTML('Nincs még bevétel forrás felvéve.');

  const expenseForm = state.openForm === 'expense' ? `
    <form class="card money-inline-form" data-form="add-expense">
      <input name="cat_name" placeholder="Kategória" required maxlength="40" class="money-f-grow2" />
      <input name="cat_amount" type="number" placeholder="Összeg" required class="money-f-grow1 mono" />
      <button type="submit" class="money-form-submit money-form-submit--red">Mentés</button>
    </form>` : '';

  const incomeForm = state.openForm === 'income' ? `
    <form class="card money-inline-form" data-form="add-income">
      <input name="in_name" placeholder="Forrás (pl. Fizetés)" required maxlength="40" class="money-f-grow2" />
      <input name="in_amount" type="number" placeholder="Összeg" required class="money-f-grow1 mono" />
      <button type="submit" class="money-form-submit money-form-submit--green">Mentés</button>
    </form>` : '';

  return `
    <div class="money-stat-grid">
      <div class="card money-stat-card"><p class="money-stat-label">Bevétel</p><p class="money-stat-value" style="color:var(--ok);">${fmt(incomeTotal)}</p></div>
      <div class="card money-stat-card"><p class="money-stat-label">Kiadás</p><p class="money-stat-value" style="color:#FF8A7A;">${fmt(expenseTotal)}</p></div>
      <div class="card money-stat-card"><p class="money-stat-label">Nettó / hó</p><p class="money-stat-value" style="color:${netColor};">${netFmt}</p></div>
    </div>
    <div class="section-label">
      <span class="rule rule-s"></span>KIADÁS KATEGÓRIÁNKÉNT<span class="rule"></span>
      <button type="button" class="money-add-btn money-add-btn--red" data-action="toggle-form" data-key="expense">+ Kiadás</button>
    </div>
    ${expenseForm}
    <section class="card money-cat-section">${categoriesHtml}</section>
    <div class="section-label">
      <span class="rule rule-s"></span>BEVÉTEL FORRÁSOK<span class="rule"></span>
      <button type="button" class="money-add-btn money-add-btn--green" data-action="toggle-form" data-key="income">+ Bevétel</button>
    </div>
    ${incomeForm}
    ${incomeHtml}`;
}

/* ---------- subscriptions ---------- */

function renderSubs() {
  const monthly = sum(state.subs, 'amount');

  const subsHtml = state.subs.length
    ? state.subs.map((x) => {
      const initial = (x.name.trim()[0] || '?').toUpperCase();
      return `<div class="card money-sub-row">
        <span class="money-sub-avatar">${escapeHtml(initial)}</span>
        <div class="money-sub-main">
          <div class="money-sub-name">${escapeHtml(x.name)}</div>
          <div class="money-sub-renew">Megújul: minden hó ${x.day}-én</div>
        </div>
        ${amountCell('subs', x, 'amount', fmt(x.amount), 'money-sub-amount mono')}
        <button type="button" class="money-del-btn" title="Lemondás" data-action="delete" data-list="subs" data-id="${x.id}">×</button>
      </div>`;
    }).join('')
    : emptyStateHTML('Nincs még előfizetés felvéve.');

  const form = state.openForm === 'sub' ? `
    <form class="card money-inline-form" data-form="add-sub">
      <input name="sub_name" placeholder="Szolgáltatás" required maxlength="40" class="money-f-grow2" />
      <input name="sub_amount" type="number" placeholder="Ft / hó" required class="money-f-grow1 mono" />
      <input name="sub_day" type="number" min="1" max="31" placeholder="Nap (1–31)" required class="money-f-grow1 mono" />
      <button type="submit" class="money-form-submit money-form-submit--gold">Mentés</button>
    </form>` : '';

  return `
    <section class="money-summary-grid">
      <div class="card money-stat-card"><p class="money-stat-label">Havonta</p><p class="money-summary-value">${fmt(monthly)}</p></div>
      <div class="card money-stat-card"><p class="money-stat-label">Évente</p><p class="money-summary-value" style="color:#F5B95F;">${fmt(monthly * 12)}</p></div>
    </section>
    <div class="section-label">
      <span class="rule rule-s"></span>AKTÍV ELŐFIZETÉSEK<span class="rule"></span>
      <button type="button" class="money-add-btn money-add-btn--gold" data-action="toggle-form" data-key="sub">+ Előfizetés</button>
    </div>
    ${form}
    ${subsHtml}`;
}

/* ---------- savings ---------- */

function renderSave() {
  const goals = state.goals;
  const primary = goals[0];
  const primaryPct = primary && primary.target ? Math.min(100, (primary.saved / primary.target) * 100) : 0;
  const circumference = 2 * Math.PI * 80;
  const ringOffset = circumference * (1 - primaryPct / 100);

  const goalOptions = goals.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');

  const goalsHtml = goals.length
    ? goals.map((g) => {
      const pct = g.target ? Math.min(100, Math.round((g.saved / g.target) * 100)) : 0;
      return `<div class="card money-goal-card">
        <div class="money-goal-head">
          <span class="money-goal-name">${escapeHtml(g.name)}</span>
          <span class="money-goal-nums">${amountCell('goals', g, 'saved', fmt(g.saved), 'money-goal-fig mono')}<span class="money-goal-fig">/</span>${amountCell('goals', g, 'target', fmt(g.target), 'money-goal-fig mono')}<button type="button" class="money-del-btn money-del-btn--sm" title="Törlés" data-action="delete" data-list="goals" data-id="${g.id}">×</button></span>
        </div>
        <div class="money-goal-bar-row">
          <div class="money-bar-track"><span class="money-bar-fill money-bar-fill--gold" style="width:${pct}%;"></span></div>
          <span class="money-goal-pct">${pct}%</span>
        </div>
      </div>`;
    }).join('')
    : emptyStateHTML('Nincs még megtakarítási cél felvéve.');

  const contribForm = state.openForm === 'contrib' ? `
    <form class="card money-inline-form" data-form="contribute">
      <select name="c_goal" class="money-f-grow2">${goalOptions}</select>
      <input name="c_amount" type="number" placeholder="Összeg" required class="money-f-grow1 mono" />
      <button type="submit" class="money-form-submit money-form-submit--gold">Befizet</button>
    </form>` : '';

  const goalForm = state.openForm === 'goal' ? `
    <form class="card money-inline-form" data-form="add-goal">
      <input name="goal_name" placeholder="Cél neve" required maxlength="40" class="money-f-grow2" />
      <input name="goal_target" type="number" placeholder="Cél összeg" required class="money-f-grow1 mono" />
      <input name="goal_saved" type="number" placeholder="Meglévő" class="money-f-grow1 mono" />
      <button type="submit" class="money-form-submit money-form-submit--gold">Létrehoz</button>
    </form>` : '';

  return `
    <section class="card money-save-hero">
      <div class="money-ring-wrap">
        <svg viewBox="0 0 200 200" width="180" height="180" class="money-ring-svg" aria-hidden="true">
          <circle cx="100" cy="100" r="80" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="16"></circle>
          <circle cx="100" cy="100" r="80" fill="none" stroke="#F5B95F" stroke-width="16" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${ringOffset}" class="money-ring-progress"></circle>
        </svg>
        <div class="money-ring-center">
          <span class="money-ring-pct">${Math.round(primaryPct)}%</span>
          <span class="money-ring-label">kész</span>
        </div>
      </div>
      <div class="money-save-info">
        <p class="money-save-eyebrow">Elsődleges cél</p>
        <p class="money-save-goal-name">${primary ? escapeHtml(primary.name) : '—'}</p>
        <div class="money-save-amount-row">
          <span class="money-save-saved mono">${primary ? fmt(primary.saved) : fmt(0)}</span>
          <span class="money-save-target">/ ${primary ? fmt(primary.target) : fmt(0)}</span>
        </div>
        <p class="money-save-remain">Még ${primary ? fmt(Math.max(0, primary.target - primary.saved)) : fmt(0)} a célig</p>
      </div>
    </section>
    <div class="money-save-actions">
      <button type="button" class="money-save-action-btn money-save-action-btn--gold" data-action="toggle-form" data-key="contrib">+ Befizetés</button>
      <button type="button" class="money-save-action-btn money-save-action-btn--ghost" data-action="toggle-form" data-key="goal">+ Új cél</button>
    </div>
    ${contribForm}
    ${goalForm}
    ${goalsHtml}`;
}

/* ---------- render + events ---------- */

const PANELS = { net: renderNetWorth, flow: renderFlow, subs: renderSubs, save: renderSave };

function render() {
  $('#money-tabs').innerHTML = renderTabs();
  $('#money-panel').innerHTML = state.loaded
    ? PANELS[state.tab]()
    : emptyStateHTML('Betöltés…');
  const input = $('#edit-input');
  if (input) { input.focus(); input.select(); }
}

$('#money-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="set-tab"]');
  if (btn) setTab(btn.dataset.tab);
});

$('#money-panel').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'toggle-form') toggleForm(btn.dataset.key);
  else if (btn.dataset.action === 'delete') delItem(btn.dataset.list, btn.dataset.id);
  else if (btn.dataset.action === 'edit') {
    state.editing = { list: btn.dataset.list, id: btn.dataset.id, field: btn.dataset.field };
    render();
  }
});

// inline edit lifecycle — Enter/blur saves, Esc cancels (delegated: the input
// is re-created on every render)
$('#money-panel').addEventListener('keydown', (e) => {
  if (e.target.id !== 'edit-input') return;
  if (e.key === 'Enter') { e.preventDefault(); commitEdit(e.target.value); }
  if (e.key === 'Escape') { state.editing = null; render(); }
});

$('#money-panel').addEventListener('focusout', (e) => {
  if (e.target.id === 'edit-input') commitEdit(e.target.value);
});

$('#money-panel').addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const fd = new FormData(form);
  const str = (name) => (fd.get(name) || '').toString().trim();
  const num = (name) => Number(fd.get(name)) || 0;

  switch (form.dataset.form) {
    case 'add-account':
      pushItem('accounts', { name: str('acc_name'), type: str('acc_type') || 'Számla', amount: num('acc_amount') });
      break;
    case 'add-expense':
      pushItem('categories', { name: str('cat_name'), amount: num('cat_amount') });
      break;
    case 'add-income':
      pushItem('income', { name: str('in_name'), amount: num('in_amount') });
      break;
    case 'add-sub':
      pushItem('subs', { name: str('sub_name'), amount: num('sub_amount'), day: Math.min(31, Math.max(1, num('sub_day') || 1)) });
      break;
    case 'add-goal':
      pushItem('goals', { name: str('goal_name'), target: num('goal_target'), saved: num('goal_saved') });
      break;
    case 'contribute':
      contribute(fd.get('c_goal'), num('c_amount'));
      break;
    default:
      break;
  }
});

render();
load();
