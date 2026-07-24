# Supabase schema workflow

This directory is the clean source of truth for the dashboard database.

## Structure

- `schemas/01_core.sql` — tasks, settings, and retained legacy tables
- `schemas/02_habits.sql` — habits and daily completion logs
- `schemas/03_schedule.sql` — schedule entries and categories
- `schemas/04_health.sql` — health logs and supplement tracking
- `schemas/05_mind.sql` — mood, energy, and focus check-ins
- `schemas/06_finance.sql` — accounts, goals, subscriptions, and monthly flow
- `schemas/07_fitness.sql` — JSON cloud state used by Body and endurance
- `seed.sql` — development defaults only
- `migrations/` — generated, timestamped database changes

## Baseline status

The schema was reconstructed on 2026-07-24 from:

1. a read-only inventory of every table and column exposed by the linked live
   project;
2. the SQL scripts under `sql/`;
3. the insert, update, query, and relation contracts in the browser app.

No production rows were changed. A privileged schema dump was not available
because the local machine has no Supabase account access token. Before the
first migration deployment, replace or confirm this baseline with an
authoritative pull:

```powershell
npx --yes supabase@latest init
npx --yes supabase@latest login
npx --yes supabase@latest link --project-ref ievuxqksyhemdkzyzlkg
npx --yes supabase@latest db pull
```

Never paste an access token or database password into a tracked file.

## Future changes

1. Edit the relevant file in `schemas/`.
2. Generate a migration with `supabase db diff -f <change_name>`.
3. Review the generated SQL carefully.
4. Test locally with `supabase db reset`.
5. Deploy with `supabase db push`.

Do not make permanent production schema changes in miscellaneous SQL Editor
tabs after adopting this workflow. SQL Editor tabs are still useful for
read-only diagnostics and one-off analysis.

## Security note

The current static app has no user login and uses the public anonymous key.
The schema therefore preserves the existing `anon` read/write policies so the
app continues to work. These policies should be replaced with authenticated,
user-scoped policies when authentication is added.
