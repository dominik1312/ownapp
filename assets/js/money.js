// Dominik's Dashboard — Money module: net worth, flow (income/expense/bills),
// subscriptions, savings goals.
//
// Two tables in Supabase:
//   • finance_items  — accounts / subs / goals   (sql/finance.sql)
//   • finance_flow   — monthly budget lines       (sql/finance_flow.sql)  ← NEW
//
// The Flow tab tracks money per MONTH. Each line belongs to a group
// (income / expense / bills) and stores a Planned (Tervezett) and an
// Actual (Tényleges) amount. Categories are pre-seeded but fully editable
// (rename, add, delete, reorder). Starting a new month clones the previous
// month's categories with actuals reset to 0. Amounts are HUF.
import { supabase } from './supabase.js';
import { escapeHtml, emptyStateHTML } from './ui.js';

const $ = (sel) => document.querySelector(sel);

const CURRENCY_SUFFIX = 'Ft';
const PALETTE = ['#33D6C3', '#F5B95F', '#60A5FA', '#A78BFA', '#4ADE80', '#FF8A7A', '#F472B6', '#FBBF24'];

const TABLE = 'finance_items';
const LISTS = ['accounts', 'subs', 'goals']; // flow moved to its own table
const FLOW_TABLE = 'finance_flow';
const FIRST_MONTH = '2026-07'; // tracking starts July 2026

// Predefined categories, taken from Költségvetés 2026.xlsx (amounts intentionally 0).
const DEFAULT_FLOW = {
  income: ['Vinted sidehustle', 'Egyéb', 'Tartalékból', 'Fűnyírás', 'Anya'],
  expense: [
    'Szükséges étel & ital', 'Opcionális étel & ital', 'Ruházat & kiegészítő',
    'Szépségápolás', 'Szórakozás', 'Egyéb', 'Ajándékok', 'Vinted kiadások',
    'Taxi, helyjegy, tankolás', 'Utazás', 'Fodrász', 'Buli', 'Masszőr',
    'Tápkieg.', 'Sport, önfejlesztés',
  ],
  bills: ['Telekom', 'Laptop', 'Albérlet', 'Bérlet', 'Ipad'],
};

const FLOW_GROUPS = [
  { key: 'income', label: 'Income', color: '#4ADE80', btn: 'green' },
  { key: 'expense', label: 'Expenses', color: '#FF8A7A', btn: 'red' },
  { key: 'bills', label: 'Bills', color: '#F5B95F', btn: 'gold' },
];

const state = {
  tab: 'net',
  openForm: null,
  openEntries: null,  // flow row id whose itemized box is expanded, or null
  editing: null, // { list, id, field } while a value is being edited in place
  loaded: false,
  seeding: false,
  flowMissing: false, // finance_flow table not created yet
  flowHasEntries: true, // finance_flow.entries column present (see finance_flow_entries.sql)
  accounts: [], subs: [], goals: [],
  flow: [],           // all finance_flow rows (every month)
  month: FIRST_MONTH, // currently selected month
};

const fmt = (n) => `${Math.round(n).toLocaleString('hu-HU')} ${CURRENCY_SUFFIX}`;
const sum = (arr, key) => arr.reduce((a, b) => a + (Number(b[key]) || 0), 0);

// Short date for an itemized entry, e.g. "júl. 8". Falls back gracefully.
function entryDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
}

// Evaluate an amount entry, supporting + and − chains, e.g. "12000+3000-500".
// Amount fields pre-fill with the current value, so appending "+500" adds to it
// and "-500" subtracts. Returns NaN for anything that isn't a plain +/− sum.
function evalAmount(raw) {
  const s = String(raw).replace(/[\s ]/g, '').replace(/−/g, '-'); // strip spaces, normalize minus sign
  if (!/^[-+]?\d*\.?\d+([-+]\d*\.?\d+)*$/.test(s)) return NaN;
  const terms = s.match(/[+-]?\d*\.?\d+/g);
  return terms ? terms.reduce((a, t) => a + Number(t), 0) : NaN;
}

function setTab(tab) { state.tab = tab; state.openForm = null; state.editing = null; state.openEntries = null; render(); }
function toggleForm(key) { state.openForm = state.openForm === key ? null : key; state.editing = null; render(); }

/* ---------- month helpers ---------- */

function ymAdd(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function monthShort(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1))
    .toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}
function monthsWithData() { return [...new Set(state.flow.map((r) => r.month))].sort(); }
function flowRows(month, grp) {
  return state.flow
    .filter((r) => r.month === month && (!grp || r.grp === grp))
    .sort((a, b) => a.sort - b.sort || String(a.id).localeCompare(String(b.id)));
}

/* ---------- Supabase CRUD (optimistic where possible) ---------- */

// numeric columns arrive as strings from PostgREST — coerce once here
function normalize(row) {
  return { ...row, amount: Number(row.amount ?? 0), target: Number(row.target ?? 0), saved: Number(row.saved ?? 0) };
}
function normalizeFlow(row) {
  return {
    id: row.id, month: row.month, grp: row.grp, name: row.name,
    planned: Number(row.planned ?? 0), actual: Number(row.actual ?? 0), sort: Number(row.sort ?? 0),
    entries: Array.isArray(row.entries) ? row.entries : [], // itemized amounts added to actual
  };
}

async function load() {
  // finance_items (accounts / subs / goals)
  const items = await supabase.from(TABLE).select('*').order('sort').order('created_at');
  if (items.error) return showError(items.error);
  for (const l of LISTS) state[l] = [];
  for (const row of items.data ?? []) if (Array.isArray(state[row.list])) state[row.list].push(normalize(row));

  // finance_flow (monthly budget lines) — may not exist yet
  const flow = await supabase.from(FLOW_TABLE).select('*').order('sort').order('created_at');
  if (flow.error) {
    const missing = flow.error.code === '42P01' || /does not exist|schema cache/i.test(flow.error.message ?? '');
    if (missing) { state.flowMissing = true; state.flow = []; }
    else { showError(flow.error); }
    state.flowHasEntries = true;
  } else {
    state.flowMissing = false;
    state.flow = (flow.data ?? []).map(normalizeFlow);
    // Existing installations enable this column with finance_flow_entries.sql.
    const rows = flow.data ?? [];
    state.flowHasEntries = rows.length ? rows.some((r) => 'entries' in r) : true;
  }

  const months = monthsWithData();
  state.month = months.includes(state.month) ? state.month : (months[months.length - 1] || FIRST_MONTH);
  state.loaded = true;
  render();
}

async function pushItem(list, obj) {
  const { data, error } = await supabase.from(TABLE).insert({ list, ...obj }).select().single();
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
  if (error) { state[list] = prev; render(); showError(error); }
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
    render(); showError(error);
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
    render(); showError(error);
  }
}

/* ---------- finance_flow CRUD ---------- */

async function flowAdd(grp, obj) {
  const month = state.month;
  const peers = flowRows(month, grp);
  const sort = peers.length ? Math.max(...peers.map((r) => r.sort)) + 1 : 1;
  const insert = { month, grp, name: obj.name, planned: obj.planned || 0, actual: obj.actual || 0, sort };
  if (state.flowHasEntries) insert.entries = obj.actual ? [{ amt: obj.actual, at: new Date().toISOString() }] : [];
  const { data, error } = await supabase.from(FLOW_TABLE)
    .insert(insert)
    .select().single();
  if (error) return showError(error);
  state.flow = [...state.flow, normalizeFlow(data)];
  state.openForm = null;
  render();
}

async function flowDel(id) {
  const prev = state.flow;
  state.flow = prev.filter((x) => String(x.id) !== String(id)); // optimistic
  render();
  const { error } = await supabase.from(FLOW_TABLE).delete().eq('id', id);
  if (error) { state.flow = prev; render(); showError(error); }
}

async function flowPatch(id, changes) {
  const item = state.flow.find((x) => String(x.id) === String(id));
  if (!item) return;
  const prev = {};
  for (const k of Object.keys(changes)) prev[k] = item[k];
  state.flow = state.flow.map((x) => (x === item ? { ...x, ...changes } : x)); // optimistic
  render();
  const { error } = await supabase.from(FLOW_TABLE).update(changes).eq('id', id);
  if (error) {
    state.flow = state.flow.map((x) => (String(x.id) === String(id) ? { ...x, ...prev } : x));
    render(); showError(error);
  }
}

// Swap sort with the adjacent sibling in the same group/month.
async function flowMove(id, dir) {
  const item = state.flow.find((x) => String(x.id) === String(id));
  if (!item) return;
  const peers = flowRows(item.month, item.grp);
  const idx = peers.findIndex((r) => String(r.id) === String(id));
  const swap = peers[idx + dir];
  if (!swap) return;
  const a = item.sort, b = swap.sort;
  state.flow = state.flow.map((x) => {
    if (x === item) return { ...x, sort: b };
    if (x === swap) return { ...x, sort: a };
    return x;
  });
  render();
  const r1 = await supabase.from(FLOW_TABLE).update({ sort: b }).eq('id', item.id);
  const r2 = await supabase.from(FLOW_TABLE).update({ sort: a }).eq('id', swap.id);
  if (r1.error || r2.error) { showError(r1.error || r2.error); load(); }
}

// Seed a month. sourceRows given → clone their names + planned (actual reset);
// otherwise use the Excel defaults with all amounts at 0.
async function seedMonth(month, sourceRows) {
  const rows = [];
  if (sourceRows && sourceRows.length) {
    for (const r of sourceRows) rows.push({ month, grp: r.grp, name: r.name, planned: r.planned, actual: 0, sort: r.sort });
  } else {
    for (const g of FLOW_GROUPS) {
      let i = 0;
      for (const name of DEFAULT_FLOW[g.key]) rows.push({ month, grp: g.key, name, planned: 0, actual: 0, sort: ++i });
    }
  }
  state.seeding = true; render();
  const { data, error } = await supabase.from(FLOW_TABLE).insert(rows).select();
  state.seeding = false;
  if (error) return showError(error);
  state.flow = [...state.flow, ...(data ?? []).map(normalizeFlow)];
  state.month = month;
  render();
}

function startNewMonth() {
  const months = monthsWithData();
  if (!months.length) return seedMonth(FIRST_MONTH, null);
  const latest = months[months.length - 1];
  seedMonth(ymAdd(latest, 1), flowRows(latest));
}

let statusTimer;
function showError(error) {
  const el = $('#money-status');
  const missing = error?.code === '42P01' || /does not exist|schema cache/i.test(error?.message ?? '');
  clearTimeout(statusTimer);
  if (missing) {
    el.textContent = 'Missing table — run sql/finance.sql and sql/finance_flow.sql once in the Supabase SQL Editor.';
  } else {
    el.textContent = `Error: ${error.message}`;
    statusTimer = setTimeout(() => { el.textContent = ''; }, 8000);
  }
}

/* ---------- inline editing (click-to-edit) ---------- */

// A value cell: normally a click-to-edit button; while this exact cell is being
// edited it renders as an input. `type` = 'number' (default) or 'text'.
function editCell(list, item, field, display, opts = {}) {
  const { type = 'number', cls = '' } = opts;
  const e = state.editing;
  if (e && e.list === list && String(e.id) === String(item.id) && e.field === field) {
    if (type === 'text') {
      return `<input id="edit-input" class="money-edit-input money-edit-input--text" type="text" value="${escapeHtml(String(item[field] ?? ''))}" maxlength="40" />`;
    }
    return `<input id="edit-input" class="money-edit-input mono" type="text" inputmode="text" autocomplete="off" title="Type + or − to add/subtract, e.g. 12000+3000" value="${Number(item[field]) || 0}" />`;
  }
  return `<button type="button" class="money-amount-btn ${cls}" title="Click to edit" data-action="edit" data-list="${list}" data-id="${item.id}" data-field="${field}">${display}</button>`;
}
// back-compat alias used by the untouched tabs
const amountCell = (list, item, field, display, extraClass = '') => editCell(list, item, field, display, { cls: extraClass });

function commitEdit(raw) {
  const e = state.editing;
  if (!e) return;
  state.editing = null;
  const item = state[e.list].find((x) => String(x.id) === String(e.id));
  if (!item) return render();
  let value, changed;
  if (e.field === 'name') { value = String(raw).trim(); changed = !!value && value !== item.name; }
  else { value = evalAmount(raw); changed = Number.isFinite(value) && value !== Number(item[e.field]); }
  if (!changed) return render();
  if (e.list === 'flow') {
    const changes = { [e.field]: value };
    if (e.field === 'actual' && state.flowHasEntries) {
      const delta = value - Number(item.actual || 0);
      if (delta !== 0) {
        const prevEntries = Array.isArray(item.entries) ? item.entries : [];
        // Older individual inputs cannot be reconstructed, so preserve their
        // current aggregate as a clearly labelled opening balance.
        const baseline = !prevEntries.length && Number(item.actual)
          ? [{ amt: Number(item.actual), at: null, baseline: true }]
          : [];
        changes.entries = [...baseline, ...prevEntries, { amt: delta, at: new Date().toISOString() }];
      }
    }
    flowPatch(e.id, changes);
  } else patchItem(e.list, e.id, { [e.field]: value });
}

/* ---------- tabs ---------- */

const TAB_DEFS = [
  { key: 'net', label: 'Net worth' },
  { key: 'flow', label: 'Flow' },
  { key: 'subs', label: 'Subscriptions' },
  { key: 'save', label: 'Savings' },
];
function renderTabs() {
  return TAB_DEFS.map((t) => `<button type="button" class="money-tab${state.tab === t.key ? ' is-active' : ''}" data-action="set-tab" data-tab="${t.key}">${t.label}</button>`).join('');
}

/* ---------- net worth (unchanged) ---------- */

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
          <span class="money-row-type">${escapeHtml(a.type || 'Account')}</span>
        </div>
        <button type="button" class="money-del-btn" title="Delete" data-action="delete" data-list="accounts" data-id="${a.id}">×</button>
      </div>`;
    }).join('')
    : emptyStateHTML('No accounts added yet.');

  const shareSegs = state.accounts.map((a, i) => `<span class="money-share-seg" style="width:${(a.amount / total) * 100}%;background:${PALETTE[i % PALETTE.length]};"></span>`).join('');

  const form = state.openForm === 'account' ? `
    <form class="card money-inline-form" data-form="add-account">
      <input name="acc_name" placeholder="Name (e.g. Revolut)" required maxlength="40" class="money-f-grow2" />
      <input name="acc_type" placeholder="Type" maxlength="30" class="money-f-grow1" />
      <input name="acc_amount" type="number" placeholder="Balance" required class="money-f-grow1 mono" />
      <button type="submit" class="money-form-submit money-form-submit--gold">Save</button>
    </form>` : '';

  return `
    <section class="card money-hero">
      <p class="money-hero-eyebrow">Total net worth</p>
      <p class="money-hero-value">${fmt(sum(state.accounts, 'amount'))}</p>
      <p class="money-hero-sub">${state.accounts.length} accounts</p>
      <div class="money-share-bar">${shareSegs}</div>
    </section>
    <div class="section-label">
      <span class="rule rule-s"></span>ACCOUNTS<span class="rule"></span>
      <button type="button" class="money-add-btn money-add-btn--gold" data-action="toggle-form" data-key="account">+ Account</button>
    </div>
    ${form}
    ${rows}`;
}

/* ---------- flow (reworked: monthly, three groups, planned + actual, charts) ---------- */

function groupTotals(month, grp) {
  const rows = flowRows(month, grp);
  return { planned: sum(rows, 'planned'), actual: sum(rows, 'actual') };
}

// Donut of actual spend by category (expenses + bills), top 7 + "Other".
function expenseDonut(month) {
  const rows = [...flowRows(month, 'expense'), ...flowRows(month, 'bills')]
    .filter((r) => r.actual > 0)
    .sort((a, b) => b.actual - a.actual);
  const total = sum(rows, 'actual');
  if (!total) return `<div class="money-chart-empty">No spend logged for ${monthLabel(month)} yet.</div>`;

  let segs = rows.map((r, i) => ({ label: r.name, value: r.actual, color: PALETTE[i % PALETTE.length] }));
  if (segs.length > 7) {
    const rest = segs.slice(7);
    segs = segs.slice(0, 7);
    segs.push({ label: 'Other', value: rest.reduce((a, s) => a + s.value, 0), color: 'var(--faint)' });
  }

  const r = 58, cx = 72, cy = 72, sw = 20, C = 2 * Math.PI * r;
  let off = 0;
  const circles = segs.map((s) => {
    const dash = (s.value / total) * C;
    const c = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"></circle>`;
    off += dash;
    return c;
  }).join('');

  const legend = segs.map((s) => `<div class="money-legend-item">
      <span class="money-legend-dot" style="background:${s.color};"></span>
      <span class="money-legend-name">${escapeHtml(s.label)}</span>
      <span class="money-legend-val">${Math.round((s.value / total) * 100)}%</span>
    </div>`).join('');

  return `<div class="money-donut-wrap">
    <svg width="144" height="144" viewBox="0 0 144 144" aria-hidden="true">
      ${circles}
      <text x="72" y="68" text-anchor="middle" class="money-donut-c1">${fmt(total)}</text>
      <text x="72" y="86" text-anchor="middle" class="money-donut-c2">spent</text>
    </svg>
    <div class="money-legend">${legend}</div>
  </div>`;
}

// Grouped bars of actual income vs outflow across the last 8 logged months.
function trendChart() {
  const months = monthsWithData().slice(-8);
  if (!months.length) return `<div class="money-chart-empty">Log a month to see the trend.</div>`;
  const data = months.map((m) => ({
    m,
    income: groupTotals(m, 'income').actual,
    out: groupTotals(m, 'expense').actual + groupTotals(m, 'bills').actual,
  }));
  const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.out)));
  const H = 96, W = Math.max(220, months.length * 54), slot = W / data.length;
  const bw = Math.min(16, slot / 3);
  const bars = data.map((d, i) => {
    const x = i * slot + slot / 2;
    const ih = (d.income / max) * H, oh = (d.out / max) * H;
    return `<rect x="${(x - bw - 1).toFixed(1)}" y="${(H - ih).toFixed(1)}" width="${bw}" height="${ih.toFixed(1)}" rx="2" fill="#4ADE80"></rect>
      <rect x="${(x + 1).toFixed(1)}" y="${(H - oh).toFixed(1)}" width="${bw}" height="${oh.toFixed(1)}" rx="2" fill="#FF8A7A"></rect>
      <text x="${x.toFixed(1)}" y="${H + 14}" text-anchor="middle" class="money-axis-lbl">${monthShort(d.m)}</text>`;
  }).join('');
  return `<div class="money-trend-legend">
      <span><i style="background:#4ADE80"></i>Income</span><span><i style="background:#FF8A7A"></i>Out</span>
    </div>
    <svg width="100%" viewBox="0 0 ${W} ${H + 20}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${bars}</svg>`;
}

function flowGroupSection(month, g) {
  const rows = flowRows(month, g.key);
  const tot = groupTotals(month, g.key);
  const groupActual = tot.actual || 1;

  const list = rows.length ? rows.map((r, i) => {
    const pct = g.key === 'income' ? 0 : Math.round((r.actual / groupActual) * 100);
    const barPct = r.planned > 0 ? Math.min(100, (r.actual / r.planned) * 100) : (r.actual > 0 ? 100 : 0);
    const over = r.planned > 0 && r.actual > r.planned;
    const open = String(state.openEntries) === String(r.id);
    const logBtn = state.flowHasEntries ? `<button type="button" class="money-flow-log-btn${open ? ' is-open' : ''}" title="Show amounts added" aria-expanded="${open}" data-action="toggle-entries" data-id="${r.id}">Itemized ${open ? '▴' : '▾'}${r.entries.length ? ` ${r.entries.length}` : ''}</button>` : '';
    const itemized = open ? `<div class="money-flow-items">${
      r.entries.length
        ? r.entries.slice().reverse().map((en) => {
          const amount = Number(en.amt) || 0;
          return `<span class="money-flow-item">
            <span class="money-flow-item-amt${amount < 0 ? ' is-neg' : ''}">${amount >= 0 ? '+' : '−'}${fmt(Math.abs(amount))}</span>
            <span class="money-flow-item-date">${en.baseline ? 'Earlier total' : entryDate(en.at)}</span>
          </span>`;
        }).join('')
        : (r.actual
          ? `<span class="money-flow-item"><span class="money-flow-item-amt">${fmt(r.actual)}</span><span class="money-flow-item-date">Earlier total</span></span>`
          : `<span class="money-flow-item money-flow-item--empty">No itemized amounts yet. The next change to Actual will appear here.</span>`)
    }</div>` : '';
    return `<div class="money-flow-row">
      <span class="money-flow-name">
        ${g.key !== 'income' ? `<span class="money-flow-pct">${pct}%</span>` : ''}
        ${editCell('flow', r, 'name', escapeHtml(r.name), { type: 'text' })}
        ${logBtn}
      </span>
      <span class="money-flow-figs">
        <span class="money-flow-plan">${editCell('flow', r, 'planned', fmt(r.planned))}</span>
        <span class="money-flow-sep">→</span>
        ${editCell('flow', r, 'actual', fmt(r.actual), { cls: 'money-flow-act' })}
      </span>
      <span class="money-flow-ctrls">
        <button type="button" class="money-move-btn" title="Move up" data-action="move-up" data-id="${r.id}"${i === 0 ? ' disabled' : ''}>▲</button>
        <button type="button" class="money-move-btn" title="Move down" data-action="move-down" data-id="${r.id}"${i === rows.length - 1 ? ' disabled' : ''}>▼</button>
        <button type="button" class="money-del-btn money-del-btn--sm" title="Delete" data-action="delete" data-list="flow" data-id="${r.id}">×</button>
      </span>
      <span class="money-flow-bar"><span style="width:${barPct}%;background:${over ? '#FF8A7A' : g.color};"></span></span>
      ${itemized}
    </div>`;
  }).join('') : `<div class="money-chart-empty">No ${g.label.toLowerCase()} categories.</div>`;

  const form = state.openForm === `flow-${g.key}` ? `
    <form class="card money-inline-form" data-form="add-flow" data-grp="${g.key}">
      <input name="f_name" placeholder="Category" required maxlength="40" class="money-f-grow2" />
      <input name="f_planned" type="number" placeholder="Planned" class="money-f-grow1 mono" />
      <input name="f_actual" type="number" placeholder="Actual" class="money-f-grow1 mono" />
      <button type="submit" class="money-form-submit money-form-submit--${g.btn}">Add</button>
    </form>` : '';

  return `
    <div class="section-label">
      <span class="rule rule-s"></span>${g.label.toUpperCase()}
      <span class="money-group-tot">${fmt(tot.actual)} / ${fmt(tot.planned)}</span>
      <span class="rule"></span>
      <button type="button" class="money-add-btn money-add-btn--${g.btn}" data-action="toggle-form" data-key="flow-${g.key}">+ ${g.label}</button>
    </div>
    ${form}
    <section class="card money-flow-section">${list}</section>`;
}

function renderFlow() {
  if (state.flowMissing) {
    return emptyStateHTML('Flow needs its table — run sql/finance_flow.sql once in the Supabase SQL Editor, then reload.');
  }

  const months = monthsWithData();
  if (!months.length) {
    return `<section class="card money-flow-intro">
      <p class="money-flow-intro-title">Start tracking your budget</p>
      <p class="money-flow-intro-sub">Create ${monthLabel(FIRST_MONTH)} with your predefined categories from the Excel. You can rename, add or remove any of them afterwards.</p>
      <button type="button" class="money-form-submit money-form-submit--gold" data-action="seed-default"${state.seeding ? ' disabled' : ''}>${state.seeding ? 'Creating…' : `Create ${monthLabel(FIRST_MONTH)}`}</button>
    </section>`;
  }

  const month = state.month;
  const idx = months.indexOf(month);
  const inc = groupTotals(month, 'income');
  const exp = groupTotals(month, 'expense');
  const bill = groupTotals(month, 'bills');
  const outActual = exp.actual + bill.actual;
  const outPlanned = exp.planned + bill.planned;
  const net = inc.actual - outActual;
  const netColor = net >= 0 ? 'var(--ok)' : '#FF8A7A';
  const netFmt = `${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}`;
  const planNet = inc.planned - outPlanned;

  const options = months.map((m) => `<option value="${m}"${m === month ? ' selected' : ''}>${monthLabel(m)}</option>`).join('');

  return `
    <div class="money-month-bar">
      <button type="button" class="money-month-nav" data-action="month-prev"${idx <= 0 ? ' disabled' : ''}>◀</button>
      <select class="money-month-select" data-action="select-month">${options}</select>
      <button type="button" class="money-month-nav" data-action="month-next"${idx >= months.length - 1 ? ' disabled' : ''}>▶</button>
      <span class="money-month-spacer"></span>
      <button type="button" class="money-add-btn money-add-btn--gold" data-action="new-month"${state.seeding ? ' disabled' : ''}>${state.seeding ? 'Creating…' : '+ New month'}</button>
    </div>

    <div class="money-stat-grid">
      <div class="card money-stat-card"><p class="money-stat-label">Income</p><p class="money-stat-value" style="color:var(--ok);">${fmt(inc.actual)}</p><p class="money-stat-plan">plan ${fmt(inc.planned)}</p></div>
      <div class="card money-stat-card"><p class="money-stat-label">Out (exp + bills)</p><p class="money-stat-value" style="color:#FF8A7A;">${fmt(outActual)}</p><p class="money-stat-plan">plan ${fmt(outPlanned)}</p></div>
      <div class="card money-stat-card"><p class="money-stat-label">Balance</p><p class="money-stat-value" style="color:${netColor};">${netFmt}</p><p class="money-stat-plan">plan ${planNet >= 0 ? '+' : '−'}${fmt(Math.abs(planNet))}</p></div>
    </div>

    <div class="money-chart-grid">
      <div class="card money-chart-card"><p class="money-chart-title">Where the money goes · ${monthLabel(month)}</p>${expenseDonut(month)}</div>
      <div class="card money-chart-card"><p class="money-chart-title">Income vs out by month</p>${trendChart()}</div>
    </div>

    ${flowGroupSection(month, FLOW_GROUPS[0])}
    ${flowGroupSection(month, FLOW_GROUPS[1])}
    ${flowGroupSection(month, FLOW_GROUPS[2])}`;
}

/* ---------- subscriptions (unchanged) ---------- */

const SUB_LOGOS = {
  telekom: {
    bg: '#E20074',
    svg: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#fff" d="M4 4.5h16v6h-1.1c-.15-2.7-1.35-4.1-4.15-4.1h-.55v10.1c0 1.9.45 2.4 2.4 2.4v1.1H7.4v-1.1c1.95 0 2.4-.5 2.4-2.4V6.4h-.55c-2.8 0-4 1.4-4.15 4.1H4v-6z"/></svg>`,
  },
  spotify: {
    bg: '#191414',
    svg: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#1DB954" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`,
  },
};

function subLogo(name) {
  const n = name.trim().toLowerCase();
  for (const key of Object.keys(SUB_LOGOS)) {
    if (n.includes(key)) return SUB_LOGOS[key];
  }
  return null;
}

function renderSubs() {
  const monthly = sum(state.subs, 'amount');
  const subsHtml = state.subs.length
    ? state.subs.map((x) => {
      const logo = subLogo(x.name);
      const avatar = logo
        ? `<span class="money-sub-avatar money-sub-avatar--logo" style="background:${logo.bg};">${logo.svg}</span>`
        : `<span class="money-sub-avatar">${escapeHtml((x.name.trim()[0] || '?').toUpperCase())}</span>`;
      return `<div class="card money-sub-row">
        ${avatar}
        <div class="money-sub-main">
          <div class="money-sub-name">${escapeHtml(x.name)}</div>
          <div class="money-sub-renew">Renews monthly on day ${x.day}</div>
        </div>
        ${amountCell('subs', x, 'amount', fmt(x.amount), 'money-sub-amount mono')}
        <button type="button" class="money-del-btn" title="Cancel" data-action="delete" data-list="subs" data-id="${x.id}">×</button>
      </div>`;
    }).join('')
    : emptyStateHTML('No subscriptions added yet.');

  const form = state.openForm === 'sub' ? `
    <form class="card money-inline-form" data-form="add-sub">
      <input name="sub_name" placeholder="Service" required maxlength="40" class="money-f-grow2" />
      <input name="sub_amount" type="number" placeholder="Ft / mo" required class="money-f-grow1 mono" />
      <input name="sub_day" type="number" min="1" max="31" placeholder="Day (1–31)" required class="money-f-grow1 mono" />
      <button type="submit" class="money-form-submit money-form-submit--gold">Save</button>
    </form>` : '';

  return `
    <section class="money-summary-grid">
      <div class="card money-stat-card"><p class="money-stat-label">Monthly</p><p class="money-summary-value">${fmt(monthly)}</p></div>
      <div class="card money-stat-card"><p class="money-stat-label">Yearly</p><p class="money-summary-value" style="color:#F5B95F;">${fmt(monthly * 12)}</p></div>
    </section>
    <div class="section-label">
      <span class="rule rule-s"></span>ACTIVE SUBSCRIPTIONS<span class="rule"></span>
      <button type="button" class="money-add-btn money-add-btn--gold" data-action="toggle-form" data-key="sub">+ Subscription</button>
    </div>
    ${form}
    ${subsHtml}`;
}

/* ---------- savings (unchanged) ---------- */

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
          <span class="money-goal-nums">${amountCell('goals', g, 'saved', fmt(g.saved), 'money-goal-fig mono')}<span class="money-goal-fig">/</span>${amountCell('goals', g, 'target', fmt(g.target), 'money-goal-fig mono')}<button type="button" class="money-del-btn money-del-btn--sm" title="Delete" data-action="delete" data-list="goals" data-id="${g.id}">×</button></span>
        </div>
        <div class="money-goal-bar-row">
          <div class="money-bar-track"><span class="money-bar-fill money-bar-fill--gold" style="width:${pct}%;"></span></div>
          <span class="money-goal-pct">${pct}%</span>
        </div>
      </div>`;
    }).join('')
    : emptyStateHTML('No savings goals added yet.');

  const contribForm = state.openForm === 'contrib' ? `
    <form class="card money-inline-form" data-form="contribute">
      <select name="c_goal" class="money-f-grow2">${goalOptions}</select>
      <input name="c_amount" type="number" placeholder="Amount" required class="money-f-grow1 mono" />
      <button type="submit" class="money-form-submit money-form-submit--gold">Deposit</button>
    </form>` : '';

  const goalForm = state.openForm === 'goal' ? `
    <form class="card money-inline-form" data-form="add-goal">
      <input name="goal_name" placeholder="Goal name" required maxlength="40" class="money-f-grow2" />
      <input name="goal_target" type="number" placeholder="Target amount" required class="money-f-grow1 mono" />
      <input name="goal_saved" type="number" placeholder="Current" class="money-f-grow1 mono" />
      <button type="submit" class="money-form-submit money-form-submit--gold">Create</button>
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
          <span class="money-ring-label">done</span>
        </div>
      </div>
      <div class="money-save-info">
        <p class="money-save-eyebrow">Primary goal</p>
        <p class="money-save-goal-name">${primary ? escapeHtml(primary.name) : '—'}</p>
        <div class="money-save-amount-row">
          <span class="money-save-saved mono">${primary ? fmt(primary.saved) : fmt(0)}</span>
          <span class="money-save-target">/ ${primary ? fmt(primary.target) : fmt(0)}</span>
        </div>
        <p class="money-save-remain">${primary ? fmt(Math.max(0, primary.target - primary.saved)) : fmt(0)} left to goal</p>
      </div>
    </section>
    <div class="money-save-actions">
      <button type="button" class="money-save-action-btn money-save-action-btn--gold" data-action="toggle-form" data-key="contrib">+ Deposit</button>
      <button type="button" class="money-save-action-btn money-save-action-btn--ghost" data-action="toggle-form" data-key="goal">+ New goal</button>
    </div>
    ${contribForm}
    ${goalForm}
    ${goalsHtml}`;
}

/* ---------- render + events ---------- */

const PANELS = { net: renderNetWorth, flow: renderFlow, subs: renderSubs, save: renderSave };

function render() {
  $('#money-tabs').innerHTML = renderTabs();
  $('#money-panel').innerHTML = state.loaded ? PANELS[state.tab]() : emptyStateHTML('Loading…');
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
  const a = btn.dataset.action;
  if (a === 'toggle-form') toggleForm(btn.dataset.key);
  else if (a === 'delete') { btn.dataset.list === 'flow' ? flowDel(btn.dataset.id) : delItem(btn.dataset.list, btn.dataset.id); }
  else if (a === 'edit') { state.editing = { list: btn.dataset.list, id: btn.dataset.id, field: btn.dataset.field }; render(); }
  else if (a === 'toggle-entries') { const id = btn.dataset.id; state.openEntries = String(state.openEntries) === String(id) ? null : id; render(); }
  else if (a === 'move-up') flowMove(btn.dataset.id, -1);
  else if (a === 'move-down') flowMove(btn.dataset.id, 1);
  else if (a === 'seed-default') seedMonth(FIRST_MONTH, null);
  else if (a === 'new-month') startNewMonth();
  else if (a === 'month-prev' || a === 'month-next') {
    const months = monthsWithData();
    const i = months.indexOf(state.month) + (a === 'month-next' ? 1 : -1);
    if (months[i]) { state.month = months[i]; state.openForm = null; state.editing = null; state.openEntries = null; render(); }
  }
});

$('#money-panel').addEventListener('change', (e) => {
  if (e.target.matches('[data-action="select-month"]')) {
    state.month = e.target.value; state.openForm = null; state.editing = null; state.openEntries = null; render();
  }
});

// inline edit lifecycle — Enter/blur saves, Esc cancels (input re-created each render)
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
      pushItem('accounts', { name: str('acc_name'), type: str('acc_type') || 'Account', amount: num('acc_amount') });
      break;
    case 'add-flow':
      flowAdd(form.dataset.grp, { name: str('f_name'), planned: num('f_planned'), actual: num('f_actual') });
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
