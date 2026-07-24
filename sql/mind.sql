-- Dominik's Dashboard — Mind module storage. Run ONCE in the Supabase SQL Editor.
-- One row per Budapest calendar day (for_date), upserted on every check-in.
-- Each day carries a 1–5 rating for mood / energy / focus (any subset may be set).
-- Follows the conventions of the existing tables (public schema, anon key, RLS on).

create table if not exists public.mind_logs (
  id uuid primary key default gen_random_uuid(),
  for_date date not null unique,               -- the Budapest day this check-in is for
  mood   smallint check (mood   between 1 and 5),
  energy smallint check (energy between 1 and 5),
  focus  smallint check (focus  between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The browser talks to Supabase with the ANON key; give it read/write access
-- (RLS is on by default when tables are created from the dashboard).
alter table public.mind_logs enable row level security;
drop policy if exists "anon full access mind_logs" on public.mind_logs;
create policy "anon full access mind_logs"
  on public.mind_logs for all
  to anon using (true) with check (true);

-- Optional starter data — uncomment to seed a few days:
-- insert into public.mind_logs (for_date, mood, energy, focus) values
--   (current_date,               4, 3, 4),
--   (current_date - interval '1 day', 3, 4, 3),
--   (current_date - interval '2 day', 5, 4, 4);
