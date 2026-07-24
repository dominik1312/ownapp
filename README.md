# Dominik's Dashboard

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

## Data model

The linked Supabase project currently contains 15 public tables:

| module | tables |
|---|---|
| Core | `tasks`, `settings` |
| Habits | `habits`, `habit_logs` |
| Schedule | `schedule_entries`, `schedule_categories` |
| Health | `health_logs`, `health_supplements`, `health_supplement_logs` |
| Mind | `mind_logs` |
| Money | `finance_items`, `finance_flow` |
| Fitness | `app_state` |
| Legacy, currently unused | `events`, `goals` |

The organized current-state definitions live in [`supabase/schemas`](supabase/schemas).
See [`supabase/README.md`](supabase/README.md) for the migration workflow. The
older files under [`sql`](sql) remain as convenient module setup scripts; their
superseded upgrade scripts are kept in `sql/archive`.
