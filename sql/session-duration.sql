-- Session duration (stopwatch) — applied 2026-11-10.
--
-- Why this exists
-- --------------
-- The rest timer counted down between sets. It could not answer "how long was this
-- workout", because it was about the gap between two sets, not the session around them.
-- The timer is now a stopwatch: it starts when the Log page opens and stops when the
-- session is saved, so every workout carries its own length.
--
-- Two columns, because two different facts.
--
--   duration_seconds  the measured length of a finished workout. NULL means "not
--                     measured" — a session logged before this change, or one edited
--                     without ever starting the timer. It is deliberately nullable: a
--                     missing measurement and a zero-length workout are different
--                     things, and conflating them would show "0m" for a workout that
--                     was simply never timed.
--
--   started_at        when the stopwatch began, carried on the draft row while the
--                     workout is still in progress. The draft is the only durable
--                     record of an unfinished workout (it survives the tab closing,
--                     the app being killed, and signing out and back in), so it is
--                     where the start instant belongs. Elapsed time is then derived
--                     from the wall clock rather than counted in ticks, which is what
--                     makes it keep running while the phone is in a pocket.
--
-- Bounds
-- ------
-- duration_seconds is capped at 24 hours and started_at at the same 1900-2100 window
-- the session date already uses. A workout that could report a million hours would
-- be a broken client, not a hard session, and the column is used in a SUM() that
-- feeds the cumulative "time trained" figure — so one absurd row would corrupt it.
--
-- Backfill
-- --------
-- The 25 sessions that existed before the stopwatch existed are given 1h45m each,
-- so the cumulative figure starts from a real-looking number instead of zero. The
-- value is written as an ordinary measurement with no "estimated" marker: the
-- database has no way to tell the difference, and adding one would mean a column
-- that only ever has one value, which is worse than saying nothing.

alter table public.workout_sessions
  add column if not exists duration_seconds integer,
  add column if not exists started_at timestamptz;

alter table public.workout_sessions
  drop constraint if exists sessions_duration_bounds;

alter table public.workout_sessions
  add constraint sessions_duration_bounds check (
    (duration_seconds is null or (duration_seconds >= 0 and duration_seconds <= 86400))
    and (started_at is null or (started_at >= '1900-01-01'::timestamptz and started_at <= '2100-01-01'::timestamptz))
  );

-- 1h45m, in seconds. The account is resolved by username rather than by its uuid, so
-- the statement does not hardcode a generated id.
update public.workout_sessions
set duration_seconds = 6300
where user_id = (select id from private.accounts where username = 'carlos')
  and not is_draft
  and duration_seconds is null;
