-- Dominik's Dashboard — Fitness cloud sync store.
-- Run ONCE in the Supabase SQL Editor of the project the fitness page uses
-- (gcqaaunceyzjciwbwphj — the same one the gym section hardcodes). Safe to run
-- even if the table already exists: everything here is create-if-not-exists.
--
-- One row per app section. `data` is the whole section state as JSONB:
--   key = 'po-coach'    -> gym / weight / photos state
--   key = 'endurance'   -> runs + swims logs, config, rotation
-- The browser talks to Supabase with the publishable/anon key, so we grant
-- anon read/write and rely on this being a single-user personal project.

create table if not exists public.app_state (
  key         text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.app_state enable row level security;

-- Recreate the policy idempotently (drop-if-exists then create).
drop policy if exists "anon full access app_state" on public.app_state;
create policy "anon full access app_state"
  on public.app_state for all
  to anon using (true) with check (true);

-- Realtime: make sure this table is in the realtime publication so other
-- devices get instant updates. Ignore the error if it's already added.
do $$
begin
  begin
    alter publication supabase_realtime add table public.app_state;
  exception when duplicate_object then
    null;
  end;
end $$;
