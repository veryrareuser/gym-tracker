-- Routines — applied 2026-11-11.
--
-- Why this exists
-- --------------
-- The Log page listed every exercise in the library. After a few months at a few
-- different gyms that list is dozens of rows long, and logging a workout meant
-- scrolling past exercises you were not doing that day to find the ones you were.
-- It also made a mistyped set easy: the wrong exercise was right there, one row
-- away from the right one.
--
-- A routine is a named, ordered list of exercises. The Log page shows the
-- routines, and tapping one shows only the exercises in it, in the order you put
-- them in.
--
-- Routines reference the shared exercise library rather than copying it.
--
-- One exercise can sit in several routines — the same "Dumbbell Flat Bench" in an
-- Upper Body routine and in a Push routine — and renaming it in the library
-- renames it in both. It also means the library and the sessions already logged
-- need no migration at all: a session's exercise_logs still point at
-- exercises(id), and they always did.
--
-- ── 1. the two tables ──────────────────────────────────────────────────────────

create table if not exists public.routines (
  id          text primary key,
  name        text not null,
  "order"     bigint,
  created_at  timestamptz,
  user_id     uuid not null references private.accounts(id) on delete cascade,
  -- A composite key as well, so routine_exercises can carry ownership in its own
  -- foreign key rather than trusting a routine id on its own.
  unique (user_id, id),
  constraint routines_bounds check (
    (length(id) >= 1) and (length(id) <= 100) and
    (length(trim(both from name)) >= 1) and (length(trim(both from name)) <= 100)
  )
);

create table if not exists public.routine_exercises (
  id          text primary key,
  routine_id  text not null,
  exercise_id text not null,
  "order"     bigint not null,
  user_id     uuid not null references private.accounts(id) on delete cascade,
  -- An exercise appears at most once in a routine. The order is the position in
  -- the list, which is what the drag handle rewrites.
  unique (user_id, routine_id, exercise_id),
  constraint routine_exercises_bounds check (
    (length(id) >= 1) and (length(id) <= 100) and ("order" >= 0)
  ),
  -- Composite, so a routine can only hold an exercise its own owner holds, and a
  -- row can only belong to a routine its own owner holds.
  foreign key (user_id, routine_id)
    references public.routines(user_id, id) on delete cascade,
  -- No action, like the exercise_logs → exercises foreign key: an exercise that is
  -- in a routine cannot be deleted out from under it.
  foreign key (user_id, exercise_id)
    references public.exercises(user_id, id)
);

-- ── 2. the session remembers where it came from ───────────────────────────────
--
-- So the Log page can reopen the same routine after a reload, and so a session
-- knows which routine it was logged from. Null when the session was not built from
-- a routine.
--
-- A plain foreign key rather than a composite one, because the delete action has to
-- be SET NULL: on a composite foreign key, SET NULL would try to null the user_id
-- too, which is NOT NULL. Deleting a routine therefore unpins its sessions and
-- leaves their logged exercises alone — a workout you did is a fact, and it does
-- not stop being a fact because you tidied up a routine.
alter table public.workout_sessions
  add column if not exists routine_id text references public.routines(id) on delete set null;

-- ── 3. RLS ────────────────────────────────────────────────────────────────────
--
-- Owner-scoped, exactly like the other four public tables: a row is visible only
-- to the account that owns it.

alter table public.routines enable row level security;
alter table public.routine_exercises enable row level security;

drop policy if exists routines_read on public.routines;
create policy routines_read on public.routines
  for select to anon, authenticated
  using (( SELECT private.current_account() AS current_account) = user_id);

drop policy if exists routines_write on public.routines;
create policy routines_write on public.routines
  for insert to anon, authenticated
  with check (( SELECT private.current_account() AS current_account) = user_id);

drop policy if exists routines_edit on public.routines;
create policy routines_edit on public.routines
  for update to anon, authenticated
  using (( SELECT private.current_account() AS current_account) = user_id)
  with check (( SELECT private.current_account() AS current_account) = user_id);

drop policy if exists routines_remove on public.routines;
create policy routines_remove on public.routines
  for delete to anon, authenticated
  using (( SELECT private.current_account() AS current_account) = user_id);

drop policy if exists routine_exercises_read on public.routine_exercises;
create policy routine_exercises_read on public.routine_exercises
  for select to anon, authenticated
  using (( SELECT private.current_account() AS current_account) = user_id);

drop policy if exists routine_exercises_write on public.routine_exercises;
create policy routine_exercises_write on public.routine_exercises
  for insert to anon, authenticated
  with check (( SELECT private.current_account() AS current_account) = user_id);

drop policy if exists routine_exercises_edit on public.routine_exercises;
create policy routine_exercises_edit on public.routine_exercises
  for update to anon, authenticated
  using (( SELECT private.current_account() AS current_account) = user_id)
  with check (( SELECT private.current_account() AS current_account) = user_id);

drop policy if exists routine_exercises_remove on public.routine_exercises;
create policy routine_exercises_remove on public.routine_exercises
  for delete to anon, authenticated
  using (( SELECT private.current_account() AS current_account) = user_id);

-- ── 4. grants ─────────────────────────────────────────────────────────────────
--
-- The publishable key is public, so these grants are what the app has. They grant
-- nothing without a session token: the RLS policies above are the real gate.

grant select, insert, update, delete on public.routines to anon, authenticated;
grant select, insert, update, delete on public.routine_exercises to anon, authenticated;

-- ── 5. the quota trigger ──────────────────────────────────────────────────────
--
-- The same guard the other four tables carry: it stops a runaway client from
-- filling the account's storage, and it refuses a row whose owner does not match
-- the caller's.

drop trigger if exists routines_quota on public.routines;
create trigger routines_quota
  before insert or update on public.routines
  for each row execute function private.enforce_row_quota();

drop trigger if exists routine_exercises_quota on public.routine_exercises;
create trigger routine_exercises_quota
  before insert or update on public.routine_exercises
  for each row execute function private.enforce_row_quota();
