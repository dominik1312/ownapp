-- Current-state schema for shared dashboard data.
-- Reconstructed from the live table inventory and the app's data contracts.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text,
  scheduled_at timestamptz,
  done boolean not null default false,
  done_at timestamptz,
  for_date date not null,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists tasks_date_order_idx
  on public.tasks (for_date, scheduled_at, sort);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Legacy tables are retained because they exist in the live project, although
-- the current browser app no longer reads or writes them.
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  value numeric,
  meta jsonb not null default '{}'::jsonb,
  source text,
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  metric text not null,
  target numeric not null,
  period text,
  created_at timestamptz not null default now()
);

alter table public.tasks enable row level security;
alter table public.settings enable row level security;
alter table public.events enable row level security;
alter table public.goals enable row level security;

drop policy if exists "anon full access tasks" on public.tasks;
create policy "anon full access tasks"
  on public.tasks for all to anon using (true) with check (true);

drop policy if exists "anon full access settings" on public.settings;
create policy "anon full access settings"
  on public.settings for all to anon using (true) with check (true);

drop policy if exists "anon full access events" on public.events;
create policy "anon full access events"
  on public.events for all to anon using (true) with check (true);

drop policy if exists "anon full access goals" on public.goals;
create policy "anon full access goals"
  on public.goals for all to anon using (true) with check (true);
