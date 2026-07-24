-- Archived upgrade: already incorporated into sql/finance.sql and
-- supabase/schemas/06_finance.sql.
-- Run ONCE in the Supabase SQL Editor. SAFE / NON-DESTRUCTIVE:
-- this only adds optional goal metadata and a deposit-history column.
-- Existing goals, saved amounts, accounts, subscriptions and Flow rows remain unchanged.

alter table public.finance_items
  add column if not exists goal_date date,
  add column if not exists is_primary boolean not null default false,
  add column if not exists deposits jsonb not null default '[]'::jsonb;

create unique index if not exists finance_items_one_primary_goal_idx
  on public.finance_items (is_primary)
  where list = 'goals' and is_primary = true;
