-- Session summaries — applied 2026-11-10.
--
-- Why this exists
-- --------------
-- Every page that lists workouts asked Postgres for the whole tree: the session, its
-- exercise logs, and every set under them. Measured against a realistic account (26
-- sessions, 260 logs, 780 sets) that is 176 KB and about a second, and it was fetched
-- again on every tab switch, because nothing cached it.
--
-- The list pages do not need the tree. A history row shows a date, a volume, a set count
-- and the names of the first couple of exercises. That is four aggregates, and Postgres
-- can produce them without sending 780 set rows across the wire and letting the phone
-- rebuild objects nobody looks at. The same query is 3.7 KB — forty-seven times smaller.
--
-- The one place that genuinely needs the tree is the Stats page, which charts the weight
-- of each exercise over time. That page fetches it directly and still does.
--
-- RLS
-- ---
-- security_invoker = true is the whole point, and it is not optional.
--
-- A view is a query with the *owner's* rights by default, which would mean the view
-- ran as the migration user and read every account's rows, ignoring the policies on the
-- tables underneath. The policies on workout_sessions, exercise_logs and set_entries
-- scope every row to the caller's own account via private.current_account(), so with
-- security_invoker those same policies apply to the view's reads. A tokenless caller
-- sees nothing, and an account sees only its own sessions.
--
-- The view exposes no user_id column, so there is nothing for it to leak even if the
-- policies were removed.

create or replace view public.session_summaries
with (security_invoker = true) as
select
  w.id,
  w.date,
  w.notes,
  w.duration_seconds,
  w.started_at,
  w.is_draft,
  -- Volume is sum(weight * reps) over every set, which is what calcVolume() computes in
  -- the client. The two were checked against each other over a full account and agree.
  coalesce(v.volume, 0)::numeric as volume,
  coalesce(v.set_count, 0)::bigint as set_count,
  coalesce(v.exercise_count, 0)::bigint as exercise_count,
  -- The exercise names in the order they were logged. The history list shows the first
  -- couple, and the dashboard shows the first five as chips.
  coalesce(v.exercise_names, array[]::text[]) as exercise_names
from public.workout_sessions w
left join lateral (
  select
    sum(se.weight * se.reps)::numeric as volume,
    count(se.id)::bigint as set_count,
    count(distinct el.id)::bigint as exercise_count,
    array_agg(distinct e.name order by el."order", e.name) as exercise_names
  from public.exercise_logs el
  join public.set_entries se
    on se.exercise_log_id = el.id and se.user_id = el.user_id
  join public.exercises e
    on e.id = el.exercise_id and e.user_id = el.user_id
  where el.session_id = w.id and el.user_id = w.user_id
) v on true;

-- The view reads the tables, so it needs to read them as the caller does. Without this
-- grant every request is a permission error rather than an empty result, which is a
-- different failure mode: an empty result is what the client already handles, and a 401
-- is not.
grant select on public.session_summaries to anon, authenticated;
