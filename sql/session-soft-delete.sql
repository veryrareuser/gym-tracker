-- Soft delete for workout_sessions — 2026-11-22.
--
-- Why: a workout was destroyed by a button that did not say "delete". A hard DELETE
-- leaves nothing to restore and nothing to inspect. A timestamp leaves the row, its
-- logs and its sets exactly where they are, and makes Restore one UPDATE.
--
-- Additive only. Existing rows get NULL, which means live. No backfill, no rewrite.
-- The old client keeps working against this; the new client cannot run without it,
-- so this migration must be applied before the new client is deployed.

-- A discarded row keeps its whole tree. NULL means live.
alter table public.workout_sessions
  add column if not exists deleted_at timestamptz;

comment on column public.workout_sessions.deleted_at is
  'When the owner discarded this row. NULL means live. Kept so a discard can be undone.';

-- The Recently discarded list: one account's discarded rows, newest first.
create index if not exists idx_sessions_discarded
  on public.workout_sessions (user_id, deleted_at desc)
  where deleted_at is not null;

-- One live draft per account, enforced rather than assumed. The client retires the
-- previous draft before writing a new one; this is what makes a two-tab race fail
-- loudly (23505) instead of leaving two drafts.
create unique index if not exists idx_sessions_one_live_draft
  on public.workout_sessions (user_id)
  where is_draft and deleted_at is null;

-- The view gains deleted_at so the discarded list can read it. Appended, so CREATE
-- OR REPLACE keeps the OID and anon/authenticated SELECT grants. security_invoker
-- stays true: it is what makes the view honour the RLS policies underneath.
create or replace view public.session_summaries
with (security_invoker = true) as
select
  w.id,
  w.date,
  w.notes,
  w.duration_seconds,
  w.started_at,
  w.is_draft,
  coalesce(v.volume, 0) as volume,
  coalesce(v.set_count, 0) as set_count,
  coalesce(x.exercise_count, 0) as exercise_count,
  coalesce(x.exercise_names, array[]::text[]) as exercise_names,
  w.deleted_at
from public.workout_sessions w
left join lateral (
  select sum(se.weight * se.reps::numeric) as volume,
         count(se.id) as set_count
  from public.exercise_logs el
  join public.set_entries se
    on se.exercise_log_id = el.id and se.user_id = el.user_id
  where el.session_id = w.id and el.user_id = w.user_id
) v on true
left join lateral (
  select count(el.id) as exercise_count,
         array_agg(e.name order by el."order", e.name) as exercise_names
  from public.exercise_logs el
  join public.exercises e
    on e.id = el.exercise_id and e.user_id = el.user_id
  where el.session_id = w.id and el.user_id = w.user_id
) x on true;

grant select on public.session_summaries to anon, authenticated;

-- Both aggregates bypass the client entirely: they are SECURITY DEFINER and read
-- workout_sessions directly. A discarded workout must never reach the public
-- leaderboard or a friend's records. Signatures are unchanged, so CREATE OR REPLACE
-- is safe; if a signature ever changes, drop the old one first (two overloads make
-- an unparameterised call return HTTP 300).

create or replace function public.leaderboard(p_month_start date DEFAULT NULL::date)
 RETURNS TABLE(username text, volume_month numeric, sessions_month bigint, best_set numeric, total_volume numeric, total_sessions bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with bounds as (
    select
      date_trunc('month', coalesce(p_month_start, (now() at time zone 'Asia/Jakarta')::date))::date as start_at,
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
      and w.deleted_at is null
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
      and w.deleted_at is null
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
      and w.deleted_at is null
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

create or replace function public.friend_prs(p_username text)
 RETURNS TABLE(exercise_name text, weight numeric, reps integer, achieved_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with target as (
    select a.id
    from private.accounts a
    where a.username = lower(trim(coalesce(p_username, '')))
      and a.profile_visible
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
      and not coalesce(s.is_draft, false)
      and s.deleted_at is null
  )
  select
    e.name,
    r.weight,
    r.reps,
    r.date
  from ranked r
  join public.exercises e
    on e.user_id = (select id from target)
   and e.id = r.exercise_id
  where r.rn = 1
  order by r.weight desc, e.name asc
$function$
;
