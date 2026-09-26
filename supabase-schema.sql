-- Supabase SQL schema for Gym Tracker
-- Run this in your Supabase SQL editor (https://app.supabase.com → SQL Editor)

-- 1. Exercises (master list)
-- "order" is bigint, not integer: new exercises are appended with Date.now() so the
-- newest sorts last without a read-before-write. Date.now() is ~1.79e12 and does not
-- fit in an integer (max 2147483647), which made every save of a new exercise fail
-- with "value ... is out of range for type integer".
create table if not exists exercises (
  id text primary key,
  name text not null,
  muscle_group text,
  "order" bigint default 0,
  created_at timestamptz default now()
);

-- 2. Workout sessions
create table if not exists workout_sessions (
  id text primary key,
  date date not null,
  notes text,
  created_at timestamptz default now()
);

-- 3. Exercise logs (link session → exercise)
create table if not exists exercise_logs (
  id text primary key,
  session_id text references workout_sessions(id) on delete cascade,
  exercise_id text references exercises(id),
  "order" integer default 0
);

-- 4. Individual sets
create table if not exists set_entries (
  id text primary key,
  exercise_log_id text references exercise_logs(id) on delete cascade,
  set_number integer not null,
  weight numeric,
  reps integer,
  note text
);

-- Indexes for common queries
create index if not exists idx_exercise_logs_session on exercise_logs(session_id);
create index if not exists idx_exercise_logs_exercise on exercise_logs(exercise_id);
create index if not exists idx_set_entries_log on set_entries(exercise_log_id);
create index if not exists idx_sessions_date on workout_sessions(date desc);

-- Row-level security: disable for personal single-user app
-- (anon key is already protected behind the password gate)
alter table exercises enable row level security;
alter table workout_sessions enable row level security;
alter table exercise_logs enable row level security;
alter table set_entries enable row level security;

create policy "Allow all for anon" on exercises for all using (true) with check (true);
create policy "Allow all for anon" on workout_sessions for all using (true) with check (true);
create policy "Allow all for anon" on exercise_logs for all using (true) with check (true);
create policy "Allow all for anon" on set_entries for all using (true) with check (true);

-- Seed default 10 exercises
insert into exercises (id, name, muscle_group, "order") values
  ('1', 'Dumbbell Flat Bench', 'Chest', 1),
  ('2', 'Incline Dumbbell Press', 'Chest', 2),
  ('3', 'Shoulder Press', 'Shoulders', 3),
  ('4', 'Lat Pull Down', 'Back', 4),
  ('5', 'Close Grip Row', 'Back', 5),
  ('6', 'Wide Grip Row', 'Back', 6),
  ('7', 'Cable Lateral Raise', 'Shoulders', 7),
  ('8', 'Tricep Extension', 'Arms', 8),
  ('9', 'Bicep Curl', 'Arms', 9),
  ('10', 'Hammer Curl', 'Arms', 10)
on conflict (id) do nothing;

-- image_url is written by the app on every save. Seeded rows need it populated or
-- every Log and SessionDetail card renders without a thumbnail, because
-- getExercises() prefers Supabase over localStorage. The dataset image paths are in
-- src/lib/exerciseDb.js -> DEFAULT_EXERCISE_IMAGE_MAP.
update exercises set image_url = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/refs/heads/main/images/0289-SpYC0Kp.jpg' where id = '1' and image_url is null;
update exercises set image_url = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/refs/heads/main/images/0314-ns0SIbU.jpg' where id = '2' and image_url is null;
update exercises set image_url = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/refs/heads/main/images/0405-znQUdHY.jpg' where id = '3' and image_url is null;
update exercises set image_url = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/refs/heads/main/images/2330-LEprlgG.jpg' where id = '4' and image_url is null;
update exercises set image_url = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/refs/heads/main/images/0160-veXwo0D.jpg' where id = '5' and image_url is null;
update exercises set image_url = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/refs/heads/main/images/0159-kesXOpB.jpg' where id = '6' and image_url is null;
update exercises set image_url = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/refs/heads/main/images/0178-goJ6ezq.jpg' where id = '7' and image_url is null;
update exercises set image_url = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/refs/heads/main/images/0173-Hx1WC8I.jpg' where id = '8' and image_url is null;
update exercises set image_url = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/refs/heads/main/images/1634-otqIxU4.jpg' where id = '9' and image_url is null;
update exercises set image_url = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/refs/heads/main/images/0165-HPlPoQA.jpg' where id = '10' and image_url is null;
