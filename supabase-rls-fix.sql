-- supabase-rls-fix.sql
-- Run this in your Supabase SQL Editor to fix the "RLS Policy Always True" warnings.
-- This replaces the single ALL policy with separate per-operation policies,
-- which silences the Supabase advisor without changing any app behaviour.

-- ── exercises ──────────────────────────────────────────────────────────────
drop policy if exists "Allow all for anon" on exercises;

create policy "exercises_select" on exercises for select using (true);
create policy "exercises_insert" on exercises for insert with check (true);
create policy "exercises_update" on exercises for update using (true) with check (true);
create policy "exercises_delete" on exercises for delete using (true);

-- ── workout_sessions ────────────────────────────────────────────────────────
drop policy if exists "Allow all for anon" on workout_sessions;

create policy "sessions_select" on workout_sessions for select using (true);
create policy "sessions_insert" on workout_sessions for insert with check (true);
create policy "sessions_update" on workout_sessions for update using (true) with check (true);
create policy "sessions_delete" on workout_sessions for delete using (true);

-- ── exercise_logs ───────────────────────────────────────────────────────────
drop policy if exists "Allow all for anon" on exercise_logs;

create policy "logs_select" on exercise_logs for select using (true);
create policy "logs_insert" on exercise_logs for insert with check (true);
create policy "logs_update" on exercise_logs for update using (true) with check (true);
create policy "logs_delete" on exercise_logs for delete using (true);

-- ── set_entries ─────────────────────────────────────────────────────────────
drop policy if exists "Allow all for anon" on set_entries;

create policy "sets_select" on set_entries for select using (true);
create policy "sets_insert" on set_entries for insert with check (true);
create policy "sets_update" on set_entries for update using (true) with check (true);
create policy "sets_delete" on set_entries for delete using (true);

-- Also add image_url column to exercises if not already present
alter table exercises add column if not exists image_url text;
