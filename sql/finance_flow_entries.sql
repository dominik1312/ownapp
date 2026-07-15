-- Dominik's Dashboard — Money · Flow: itemized amounts per budget category.
-- Run ONCE in the Supabase SQL Editor. This is safe and non-destructive: it
-- only adds a column and does not change or delete existing totals or rows.

alter table public.finance_flow
  add column if not exists entries jsonb not null default '[]'::jsonb;
