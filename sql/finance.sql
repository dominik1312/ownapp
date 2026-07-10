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
  type text,                                  -- accounts: subtitle (e.g. "Folyószámla · OTP")
  day integer check (day between 1 and 31),   -- subs: renewal day of month
  target numeric,                             -- goals
  saved numeric,                              -- goals
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists finance_items_list_idx on public.finance_items (list);

-- Optional starter data (same as the old in-memory demo) — uncomment to load:
-- insert into public.finance_items (list, name, amount, type) values
--   ('accounts', 'Készpénz', 640000, 'Folyószámla · OTP'),
--   ('accounts', 'Megtakarítás', 3200000, 'Lekötött betét'),
--   ('accounts', 'Befektetés', 4800000, 'ETF portfólió');
-- insert into public.finance_items (list, name, amount) values
--   ('income', 'Fizetés', 640000),
--   ('income', 'Freelance', 80000),
--   ('categories', 'Lakhatás', 180000),
--   ('categories', 'Élelmiszer', 96000),
--   ('categories', 'Közlekedés', 42000);
-- insert into public.finance_items (list, name, amount, day) values
--   ('subs', 'Netflix', 4490, 12),
--   ('subs', 'Spotify', 1990, 3);
-- insert into public.finance_items (list, name, target, saved) values
--   ('goals', 'Vészhelyzeti alap', 3000000, 2100000);
