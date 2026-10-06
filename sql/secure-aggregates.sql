CREATE OR REPLACE FUNCTION public.leaderboard(p_month_start date DEFAULT NULL::date)
 RETURNS TABLE(username text, volume_month numeric, sessions_month bigint, best_set numeric, total_volume numeric, total_sessions bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

CREATE OR REPLACE FUNCTION public.friend_prs(p_username text)
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
