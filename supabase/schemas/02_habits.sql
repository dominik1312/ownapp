-- Current-state schema for the Habits module.

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon text not null default '🎯',
  target_per_week smallint check (target_per_week between 1 and 7),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete cascade,
  for_date date not null,
  logged_at timestamptz not null default now(),
  unique (habit_id, for_date)
);

create index if not exists habit_logs_date_idx
  on public.habit_logs (for_date);

alter table public.habits enable row level security;
alter table public.habit_logs enable row level security;

drop policy if exists "anon full access habits" on public.habits;
create policy "anon full access habits"
  on public.habits for all to anon using (true) with check (true);

drop policy if exists "anon full access habit_logs" on public.habit_logs;
create policy "anon full access habit_logs"
  on public.habit_logs for all to anon using (true) with check (true);
