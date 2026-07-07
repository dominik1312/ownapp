# Life OS

Personal life dashboard. Phase 1: project skeleton + Main module (day-progress ring + today's tasks).

## Stack

- **Frontend:** vanilla HTML/CSS/JS, multi-page (one HTML file per module). No framework, no build step.
- **Data:** Supabase (Postgres) via `@supabase/supabase-js@2` from CDN — the only dependency.
- **Hosting:** Vercel, static for now (`/api` serverless comes in a later phase).
- **Timezone:** all date/"today" logic runs in `Europe/Budapest` (helpers in `assets/js/ui.js`, each spot flagged with a `TZ:` comment).

## Setup

1. Open `assets/js/supabase.js` and fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY`
   (Supabase → Project settings → API). `.env.example` documents the same two
   names for the future serverless phase — the static frontend itself reads the
   constants from `supabase.js`, since there is no build step to inject env vars.
2. Serve the folder with any static server, e.g.:
   ```
   npx serve .
   ```
   and open the printed localhost URL.
3. Deploy: push to a Git repo connected to Vercel (or run `vercel`). No build settings needed — it's a plain static site.

## How to add a new module

1. Create `modules/<id>.html` (copy one of the placeholder pages, e.g. `modules/body.html`).
2. Add one entry to `MODULE_REGISTRY` in `assets/js/config.js` (`id`, `name`, `emoji`, `sub`, `href`, `tint` as `"r,g,b"`, `size` of `big` | `wide` | `sm`).

That's it — the home grid on `index.html` renders from the registry only; no grid code changes.

## Data model (already applied in Supabase — do not recreate)

| table | columns |
|---|---|
| `events` | id, type, value, meta jsonb, source, logged_at, created_at |
| `tasks` | id, title, category, scheduled_at, done, done_at, for_date, sort, created_at |
| `habits` | id, name, icon, target_per_week, active, sort, created_at |
| `habit_logs` | id, habit_id, for_date, logged_at |
| `goals` | id, module, metric, target, period, created_at |
| `settings` | key, value jsonb, updated_at — seeded: `day_window = {"wake":"07:00","sleep":"23:00"}` |
