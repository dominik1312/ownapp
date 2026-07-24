-- Current-state schema for all Money module data.
-- This includes the columns formerly added by the two finance upgrade scripts.

create table if not exists public.finance_items (
  id uuid primary key default gen_random_uuid(),
  list text not null check (list in ('accounts', 'income', 'categories', 'subs', 'goals')),
  name text not null,
  amount numeric not null default 0,
  type text,
  day integer check (day between 1 and 31),
  target numeric,
  saved numeric,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  goal_date date,
  is_primary boolean not null default false,
  deposits jsonb not null default '[]'::jsonb
);

create index if not exists finance_items_list_idx
  on public.finance_items (list);

create unique index if not exists finance_items_one_primary_goal_idx
  on public.finance_items (is_primary)
  where list = 'goals' and is_primary = true;

create table if not exists public.finance_flow (
  id uuid primary key default gen_random_uuid(),
  month text not null,
  grp text not null check (grp in ('income', 'expense', 'bills')),
  name text not null,
  planned numeric not null default 0,
  actual numeric not null default 0,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  entries jsonb not null default '[]'::jsonb
);

create index if not exists finance_flow_month_idx
  on public.finance_flow (month);

create index if not exists finance_flow_month_grp_idx
  on public.finance_flow (month, grp);

alter table public.finance_items enable row level security;
alter table public.finance_flow enable row level security;

drop policy if exists "anon full access finance_items" on public.finance_items;
create policy "anon full access finance_items"
  on public.finance_items for all to anon using (true) with check (true);

drop policy if exists "anon full access finance_flow" on public.finance_flow;
create policy "anon full access finance_flow"
  on public.finance_flow for all to anon using (true) with check (true);
