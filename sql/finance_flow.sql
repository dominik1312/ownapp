-- Dominik's Dashboard — Money · Flow (monthly budget). Run ONCE in the Supabase SQL Editor.
-- One row = one budget line for one month. Groups: income / expense / bills.
-- Each line carries a Planned (Tervezett) and an Actual (Tényleges) amount.
-- Categories are seeded from Költségvetés 2026.xlsx by the app, then fully
-- editable in the UI. Amounts are HUF. Sits alongside finance_items
-- (sql/finance.sql), which keeps accounts / subscriptions / savings goals.

create table if not exists public.finance_flow (
  id uuid primary key default gen_random_uuid(),
  month text not null,                                    -- 'YYYY-MM', e.g. '2026-07'
  grp text not null check (grp in ('income', 'expense', 'bills')),
  name text not null,                                     -- category name (editable)
  planned numeric not null default 0,                     -- Tervezett
  actual numeric not null default 0,                      -- Tényleges
  sort integer not null default 0,                        -- order within a group/month
  created_at timestamptz not null default now()
);

create index if not exists finance_flow_month_idx on public.finance_flow (month);
create index if not exists finance_flow_month_grp_idx on public.finance_flow (month, grp);

-- The browser talks to Supabase with the ANON key; give it read/write access,
-- matching the convention of finance_items.
alter table public.finance_flow enable row level security;
create policy "anon full access finance_flow"
  on public.finance_flow for all
  to anon using (true) with check (true);

-- No seed data needed here: the app creates July 2026 with your predefined
-- categories on first use (the "Create July 2026" button in the Flow tab).
