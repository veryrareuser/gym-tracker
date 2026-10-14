-- Autosave drafts — applied 2026-10-14.
--
-- Why this exists: a workout in progress was held only in browser storage, so closing the
-- app, losing the tab, or being signed out lost it. On a phone that is not a deliberate
-- choice — the OS kills backgrounded tabs, iOS reclaims memory, a swipe dismisses the app,
-- and `beforeunload` fires in none of those cases. Writing the row out is the only thing
-- that survives.
--
-- Two migrations, applied in this order.

-- ── 1. the flag ────────────────────────────────────────────────────────────
--
-- default false is the whole point: every existing row is a real workout and stays one.
-- There is no backfill, so there is no window in which a live session is invisible, and a
-- column with a constant default does not rewrite the table on Postgres 11+.
--
-- Partial index: only draft rows are indexed, which is at most one per account.
alter table public.workout_sessions
  add column if not exists is_draft boolean not null default false;

create index if not exists idx_sessions_draft
  on public.workout_sessions (user_id, created_at desc)
  where is_draft;

-- ── 2. the aggregates ──────────────────────────────────────────────────────
--
-- leaderboard() and friend_prs() are SECURITY DEFINER and read workout_sessions
-- directly, so neither goes through the client's is_draft filter. Without the predicate
-- below, a half-finished set would count toward public standings and could surface in a
-- friend-visible record. Every aggregate over workout_sessions filters drafts for that
-- reason, and this is the only place that has to be true.
--
-- Both were dropped explicitly first. CREATE OR REPLACE cannot change an argument list:
-- it silently creates a second overload and leaves the old one callable, and PostgREST then
-- answers unparameterised calls with HTTP 300 because the list is ambiguous. That happened
-- on this project once already (see PROJECT_UNDERSTANDING.md, Trap 1).

drop function if exists public.leaderboard(date);

create function public.leaderboard(p_month_start date default null)
  returns table(username text, volume_month numeric, sessions_month bigint, best_set numeric, total_volume numeric, total_sessions bigint)
  language sql
  stable security definer
  set search_path to ''
as $function$
  with bounds as (
    select
      date_trunc('month', coalesce(p_month_start, (now() at time zone 'Asia/Jakarta')::date))::date as start_at,
      -- Clamped to today, so a future-dated session can never count toward this month.
      -- least() against the month's own end keeps a completed month complete.
      least(
        (date_trunc('month', coalesce(p_month_start, (now() at time zone 'Asia/Jakarta')::date))::date + interval '1 month - 1 day')::date,
        (now() at time zone 'Asia/Jakarta')::date
      ) as end_at
  ),
  monthly as (
    select
      w.user_id,
      sum(s.weight * s.reps)::numeric as volume,
      count(distinct w.id)::bigint as sessions
    from public.workout_sessions w
    join public.exercise_logs l on l.session_id = w.id and l.user_id = w.user_id
    join public.set_entries s on s.exercise_log_id = l.id and s.user_id = l.user_id
    cross join bounds b
    where w.date between b.start_at and b.end_at
      and not coalesce(w.is_draft, false)
    group by w.user_id
  ),
  lifetime as (
    select
      w.user_id,
      sum(s.weight * s.reps)::numeric as volume,
      count(distinct w.id)::bigint as sessions
    from public.workout_sessions w
    join public.exercise_logs l on l.session_id = w.id and l.user_id = w.user_id
    join public.set_entries s on s.exercise_log_id = l.id and s.user_id = l.user_id
    where not coalesce(w.is_draft, false)
    group by w.user_id
  ),
  best as (
    select
      w.user_id,
      max(s.weight)::numeric as heaviest
    from public.workout_sessions w
    join public.exercise_logs l on l.session_id = w.id and l.user_id = w.user_id
    join public.set_entries s on s.exercise_log_id = l.id and s.user_id = l.user_id
    where s.weight is not null
      and not coalesce(w.is_draft, false)
    group by w.user_id
  )
  select
    a.username,
    coalesce(m.volume, 0)::numeric,
    coalesce(m.sessions, 0)::bigint,
    coalesce(b.heaviest, 0)::numeric,
    coalesce(l.volume, 0)::numeric,
    coalesce(l.sessions, 0)::bigint
  from private.accounts a
  left join monthly m on m.user_id = a.id
  left join lifetime l on l.user_id = a.id
  left join best b on b.user_id = a.id
  where a.profile_visible
    and private.current_account() is not null
  order by coalesce(m.volume, 0) desc, coalesce(b.heaviest, 0) desc, a.username asc
$function$
;

drop function if exists public.friend_prs(text);

create function public.friend_prs(p_username text)
  returns table(exercise_name text, weight numeric, reps integer, achieved_on date)
  language sql
  stable security definer
  set search_path to ''
as $function$
  with target as (
    select a.id
    from private.accounts a
    where a.username = lower(trim(coalesce(p_username, '')))
      and a.profile_visible
      -- SECURITY DEFINER bypasses RLS, so the caller's session is checked explicitly.
      -- Without this, anyone holding the public key could enumerate any account's records
      -- without signing in at all.
      and private.current_account() is not null
  ),
  ranked as (
    select
      l.exercise_id,
      se.weight,
      se.reps,
      s.date,
      row_number() over (
        partition by l.exercise_id
        order by se.weight desc, s.date desc
      ) as rn
    from public.exercise_logs l
    join public.set_entries se on se.exercise_log_id = l.id and se.user_id = l.user_id
    join public.workout_sessions s on s.id = l.session_id and s.user_id = l.user_id
    where l.user_id = (select id from target)
      and se.weight is not null
      -- A friend's records are the most privacy-sensitive surface in the app. An
      -- in-progress set must never be published there.
      and not coalesce(s.is_draft, false)
  )
  select
    e.name,
    r.weight,
    r.reps,
    r.date
  from ranked r
  join public.exercises e on e.user_id = (select id from target) and e.id = r.exercise_id
  where r.rn = 1
$function$
;

-- ── What was verified against the live database, 2026-10-14 ─────────────────
--
--   * Every existing row remained a real workout: 17 rows, 17 non-draft, 0 drafts.
--   * A draft carrying a 2000 kg x 500 set was inserted, and the aggregates returned
--     byte-identical numbers to the pre-migration baseline (49254.50 kg / 16 sessions /
--     73 kg best). A draft cannot inflate the leaderboard or a friend's records.
--   * Deleting the draft cascaded to its log and set, leaving 17 rows and no residue.
--   * No public RPC gained an overload; all eight carry a single signature.
--
-- The bounds check rejected the first probe row (weight 9999 against `weight between 0 and
-- 2000`), which is the October hardening working as intended.
