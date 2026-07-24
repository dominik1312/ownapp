-- Current-state schema for the Schedule module.

create table if not exists public.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  for_date date not null,
  title text not null check (char_length(title) between 1 and 160),
  start_time time not null,
  end_time time not null,
  category text not null default 'focus',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_entries_time_order check (end_time > start_time)
);

create index if not exists schedule_entries_day_start_idx
  on public.schedule_entries (for_date, start_time);

create table if not exists public.schedule_categories (
  key text primary key check (char_length(key) between 1 and 32),
  label text not null check (char_length(label) between 1 and 32),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.schedule_entries enable row level security;
alter table public.schedule_categories enable row level security;

drop policy if exists "anon full access schedule_entries" on public.schedule_entries;
create policy "anon full access schedule_entries"
  on public.schedule_entries for all to anon using (true) with check (true);

drop policy if exists "anon full access schedule_categories" on public.schedule_categories;
create policy "anon full access schedule_categories"
  on public.schedule_categories for all to anon using (true) with check (true);

do $$
begin
  begin
    alter publication supabase_realtime add table public.schedule_entries;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.schedule_categories;
  exception when duplicate_object then null;
  end;
end $$;
