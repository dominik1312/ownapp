-- Dominik's Dashboard — Money module storage. Run ONCE in the Supabase SQL Editor.
-- One shared table: the five Money lists (accounts / income / categories /
-- subs / goals) are rows discriminated by `list`, mirroring the UI state in
-- assets/js/money.js. Amounts are HUF. Follows the conventions of the
-- existing tables (public schema, accessed with the anon key).

create table if not exists public.finance_items (
  id uuid primary key default gen_random_uuid(),
  list text not null check (list in ('accounts', 'income', 'categories', 'subs', 'goals')),
  name text not null,
  amount numeric not null default 0,          -- accounts / income / categories / subs
  type text,                                  -- accounts: subtitle (e.g. "Checking · OTP")
  day integer check (day between 1 and 31),   -- subs: renewal day of month
  target numeric,                             -- goals
  saved numeric,                              -- goals
  goal_date date,                             -- goals: optional target date
  is_primary boolean not null default false,  -- goals: featured goal in Savings
  deposits jsonb not null default '[]'::jsonb,-- goals: append-only contribution history
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists finance_items_list_idx on public.finance_items (list);
create unique index if not exists finance_items_one_primary_goal_idx
  on public.finance_items (is_primary) where list = 'goals' and is_primary = true;

-- The browser talks to Supabase with the ANON key; give it read/write access
-- (RLS is on by default when tables are created from the dashboard).
alter table public.finance_items enable row level security;
create policy "anon full access finance_items"
  on public.finance_items for all
  to anon using (true) with check (true);

-- Optional starter data (same as the old in-memory demo) — uncomment to load:
-- insert into public.finance_items (list, name, amount, type) values
--   ('accounts', 'Cash', 640000, 'Checking · OTP'),
--   ('accounts', 'Savings', 3200000, 'Fixed deposit'),
--   ('accounts', 'Investment', 4800000, 'ETF portfolio');
-- insert into public.finance_items (list, name, amount) values
--   ('income', 'Salary', 640000),
--   ('income', 'Freela