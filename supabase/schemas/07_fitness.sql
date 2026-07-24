-- Current-state schema for Body and endurance cloud synchronization.

create table if not exists public.app_state (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "anon full access app_state" on public.app_state;
create policy "anon full access app_state"
  on public.app_state for all to anon using (true) with check (true);

do $$
begin
  begin
    alter publication supabase_realtime add table public.app_state;
  exception when duplicate_object then null;
  end;
end $$;
