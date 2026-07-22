-- Dominik's Dashboard — Health module storage. Run once in the Supabase SQL Editor.
-- One row per Budapest calendar day, updated as the daily check-in changes.

create table if not exists public.health_logs (
  id uuid primary key default gen_random_uuid(),
  for_date date not null unique,
  sleep_hours numeric(4,1) check (sleep_hours between 0 and 24),
  water_glasses smallint check (water_glasses between 0 and 50),
  steps integer check (steps between 0 and 100000),
  weight_kg numeric(5,1) check (weight_kg between 20 and 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.health_logs enable row level security;
drop policy if exists "anon full access health_logs" on public.health_logs;
create policy "anon full access health_logs"
  on public.health_logs for all
  to anon using (true) with check (true);

-- Personal supplement schedule and one completion record per supplement/day.
create table if not exists public.health_supplements (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  dose text check (char_length(dose) <= 40),
  time_of_day text not null default 'morning'
    check (time_of_day in ('morning', 'afternoon', 'evening', 'anytime')),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.health_supplement_logs (
  id uuid primary key default gen_random_uuid(),
  supplement_id uuid not null references public.health_supplements(id) on delete cascade,
  for_date date not null,
  taken_at timestamptz not null default now(),
  unique (supplement_id, for_date)
);

alter table public.health_supplements enable row level security;
alter table public.health_supplement_logs enable row level security;

drop policy if exists "anon full access health_supplements" on public.health_supplements;
create policy "anon full access health_supplements"
  on public.health_supplements for all
  to anon using (true) with check (true);

drop policy if exists "anon full access health_supplement_logs" on public.health_supplement_logs;
create policy "anon full access health_supplement_logs"
  on public.health_supplement_logs for all
  to anon using (true) with check (true);

create index if not exists health_supplement_logs_date_idx
  on public.health_supplement_logs (for_date);
