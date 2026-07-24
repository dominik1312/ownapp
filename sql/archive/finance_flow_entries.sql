-- Archived upgrade: already incorporated into sql/finance_flow.sql and
-- supabase/schemas/06_finance.sql.
-- Run ONCE in the Supabase SQL Editor. This is safe and non-destructive: it
-- only adds a column and does not change or delete existing totals or rows.

alter table public.finance_flow
  add column if not exists entries jsonb not null default '[]'::jsonb;
