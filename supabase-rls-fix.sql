-- supabase-rls-fix.sql
--
-- ⚠  THIS FILE USED TO CONTAIN `using (true)` POLICIES.
-- ⚠  It was written to silence the Supabase advisor, not to secure anything — and it
-- ⚠  did the opposite: `using (true)` with anon holding full CRUD meant the publishable
-- ⚠  key could read and rewrite the whole dataset. Do not restore the old version.
--
-- This is now the authoritative per-account RLS policy set, matching the migration
-- `per_account_rls_lockdown`. Kept as a file for fresh setups and for review; the live
-- database is changed through the migration, not by running this.
--
-- PREREQUISITE: the auth foundation must exist first — schema `private` with
-- `accounts`, `sessions`, `account_for_token()` and `current_account()`. Without
-- `private.current_account()` these policies cannot resolve a caller and will match
-- nothing, which fails closed (safe) but breaks the app.
--
-- Verify afterwards with:  npm run verify:lockdown
-- It needs only the publishable key and asserts a tokenless caller can do nothing.

-- ── ownership columns ───────────────────────────────────────────────────────
-- Already applied in the live database via `repoint_ownership_to_local_accounts`.
-- `user_id` references private.accounts, NOT auth.users. It is NOT NULL, and that
-- constraint is only safe to apply after the backfill has been verified at zero nulls.
--
--   alter table workout_sessions add column user_id uuid references private.accounts(id) on delete cascade;
--   alter table exercise_logs    add column user_id uuid references private.accounts(id) on delete cascade;
--   alter table set_entries      add column user_id uuid references private.accounts(id) on delete cascade;
--
-- Backfill before tightening, or a missed row becomes a permanent write error:
--   update workout_sessions set user_id = '<owner uuid>' where user_id is null;
--   update exercise_logs    set user_id = '<owner uuid>' where user_id is null;
--   update set_entries      set user_id = '<owner uuid>' where user_id is null;
--   alter table workout_sessions alter column user_id set not null;
--   alter table exercise_logs    alter column user_id set not null;
--   alter table set_entries      alter column user_id set not null;

-- ── enable RLS ──────────────────────────────────────────────────────────────
alter table exercises         enable row level security;
alter table workout_sessions  enable row level security;
alter table exercise_logs     enable row level security;
alter table set_entries       enable row level security;

-- ── retire every previous policy ────────────────────────────────────────────
-- Both the original catch-all and the advisor-silencing split are dropped by name.
-- Leaving either in place would silently OR its `using (true)` with the new rules.
drop policy if exists "Allow all for anon" on public.exercises;
drop policy if exists "exercises_select"   on public.exercises;
drop policy if exists "exercises_insert"   on public.exercises;
drop policy if exists "exercises_update"   on public.exercises;
drop policy if exists "exercises_delete"   on public.exercises;

drop policy if exists "Allow all for anon" on public.workout_sessions;
drop policy if exists "sessions_select"   on public.workout_sessions;
drop policy if exists "sessions_insert"   on public.workout_sessions;
drop policy if exists "sessions_update"   on public.workout_sessions;
drop policy if exists "sessions_delete"   on public.workout_sessions;

drop policy if exists "Allow all for anon" on public.exercise_logs;
drop policy if exists "logs_select"       on public.exercise_logs;
drop policy if exists "logs_insert"       on public.exercise_logs;
drop policy if exists "logs_update"       on public.exercise_logs;
drop policy if exists "logs_delete"       on public.exercise_logs;

drop policy if exists "Allow all for anon" on public.set_entries;
drop policy if exists "sets_select"       on public.set_entries;
drop policy if exists "sets_insert"       on public.set_entries;
drop policy if exists "sets_update"       on public.set_entries;
drop policy if exists "sets_delete"       on public.set_entries;

-- ── owned data: your rows only ──────────────────────────────────────────────
-- The (select ...) wrapper is deliberate. It lets the planner evaluate
-- current_account() once per statement as an initPlan rather than once per row.
-- auth.uid() is cheap enough to skip this, but this lookup is a two-table join,
-- so without the wrapper the policy degrades into a per-row subquery.
--
-- Note: every caller arrives as the `anon` Postgres role and is distinguished only
-- by the token. `to anon` is therefore correct here, and `to authenticated` is
-- included for completeness but is effectively unused.
create policy "sessions_read"   on public.workout_sessions for select to anon, authenticated using ((select private.current_account()) = user_id);
create policy "sessions_write"  on public.workout_sessions for insert to anon, authenticated with check ((select private.current_account()) = user_id);
create policy "sessions_edit"   on public.workout_sessions for update to anon, authenticated using ((select private.current_account()) = user_id) with check ((select private.current_account()) = user_id);
create policy "sessions_remove" on public.workout_sessions for delete to anon, authenticated using ((select private.current_account()) = user_id);

create policy "logs_read"   on public.exercise_logs for select to anon, authenticated using ((select private.current_account()) = user_id);
create policy "logs_write"  on public.exercise_logs for insert to anon, authenticated with check ((select private.current_account()) = user_id);
create policy "logs_edit"   on public.exercise_logs for update to anon, authenticated using ((select private.current_account()) = user_id) with check ((select private.current_account()) = user_id);
create policy "logs_remove" on public.exercise_logs for delete to anon, authenticated using ((select private.current_account()) = user_id);

create policy "sets_read"   on public.set_entries for select to anon, authenticated using ((select private.current_account()) = user_id);
create policy "sets_write"  on public.set_entries for insert to anon, authenticated with check ((select private.current_account()) = user_id);
create policy "sets_edit"   on public.set_entries for update to anon, authenticated using ((select private.current_account()) = user_id) with check ((select private.current_account()) = user_id);
create policy "sets_remove" on public.set_entries for delete to anon, authenticated using ((select private.current_account()) = user_id);

-- ── exercises: a shared catalogue, for signed-in callers only ────────────────
-- Intentionally NOT per-user. The library holds names and CDN image URLs, not
-- weight data, so sharing it means a new account immediately inherits every
-- exercise already discovered instead of starting from an empty list.
--
-- The non-null check is what stops a tokenless caller writing to it. A policy
-- alone is not enough: with anon holding INSERT, a `using (true)` select policy
-- would still leave an open write path.
create policy "exercises_read"   on public.exercises for select to anon, authenticated using ((select private.current_account()) is not null);
create policy "exercises_write"  on public.exercises for insert to anon, authenticated with check ((select private.current_account()) is not null);
create policy "exercises_edit"   on public.exercises for update to anon, authenticated using ((select private.current_account()) is not null) with check ((select private.current_account()) is not null);
create policy "exercises_remove" on public.exercises for delete to anon, authenticated using ((select private.current_account()) is not null);

-- ── grants ──────────────────────────────────────────────────────────────────
-- RLS decides rows; grants decide which operations are possible at all. The app
-- needs all four verbs on every table, and the policies above close every path a
-- tokenless caller has. Revoking the grants instead would break the app, since
-- there is no `authenticated` role for a token to arrive as.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.workout_sessions to anon, authenticated;
grant select, insert, update, delete on public.exercise_logs    to anon, authenticated;
grant select, insert, update, delete on public.set_entries      to anon, authenticated;
grant select, insert, update, delete on public.exercises         to anon, authenticated;

-- image_url, if this is a fresh setup rather than the existing database.
alter table public.exercises add column if not exists image_url text;
