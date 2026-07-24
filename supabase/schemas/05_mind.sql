-- Current-state schema for the Mind module.

create table if not exists public.mind_logs (
  id uuid primary key default gen_random_uuid(),
  for_date date not null unique,
  mood smallint check (mood between 1 and 5),
  energy smallint check (energy between 1 and 5),
  focus smallint check (focus between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mind_logs enable row level security;

drop policy if exists "anon full access mind_logs" on public.mind_logs;
create policy "anon full access mind_logs"
  on public.mind_logs for all to anon using (true) with check (true);
