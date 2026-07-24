# Legacy SQL Editor scripts

These files are retained as convenient, idempotent setup scripts for individual
modules. The organized current-state schema now lives in `supabase/schemas/`.

## Active module scripts

- `finance.sql`
- `finance_flow.sql`
- `fitness_sync.sql`
- `health.sql`
- `mind.sql`
- `schedule.sql`

## Archive

The files in `archive/` are historical upgrades that are already incorporated
into the active Finance scripts and the current schema. Do not run them for a
new installation.

For future database changes, create a timestamped Supabase migration instead of
adding another one-off SQL Editor page.
