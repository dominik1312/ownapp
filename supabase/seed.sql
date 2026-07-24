-- Development seed data only. This file does not run against production unless
-- explicitly included in a deployment command.

insert into public.settings (key, value, updated_at)
values ('day_window', '{"wake":"07:00","sleep":"23:00"}'::jsonb, now())
on conflict (key) do nothing;

insert into public.schedule_categories (key, label, color, sort) values
  ('training', 'Training', '#6BE3A4', 0),
  ('work', 'Work', '#F36F4F', 1),
  ('focus', 'Focus', '#6AA8FF', 2),
  ('meal', 'Meals', '#F2C063', 3),
  ('rest', 'Rest', '#9B7BD4', 4),
  ('personal', 'Personal', '#FF8FA3', 5)
on conflict (key) do nothing;
