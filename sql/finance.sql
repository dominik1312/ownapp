-- Life OS — Money module storage. Run ONCE in the Supabase SQL Editor.
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
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists finance_items_list_idx on public.finance_items (list);

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
--   ('income', 'Freelance', 80000),
--   ('categories', 'Housing', 180000),
--   ('categories', 'Groceries', 96000),
--   ('categories', 'Transport', 42000);
-- insert into public.finance_items (list, name, amount, day) values
--   ('subs', 'Netflix', 4490, 12),
--   ('subs', 'Spotify', 1990, 3);
-- insert into public.finance_items (list, name, target, saved) values
--   ('goals', 'Emergency fund', 3000000, 2100000);
