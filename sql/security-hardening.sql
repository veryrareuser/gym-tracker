-- Reviewed live migration: security_hardening_20261006. Back up before applying.
-- Not a fresh-project bootstrap; prerequisites are the existing token-auth schema.

alter table public.workout_sessions add constraint sessions_owner_id unique (user_id, id);
alter table public.exercise_logs add constraint logs_owner_id unique (user_id, id);
alter table public.exercise_logs drop constraint exercise_logs_session_id_fkey;
alter table public.exercise_logs add constraint logs_owned_session foreign key (user_id, session_id)
  references public.workout_sessions(user_id, id) on delete cascade;
alter table public.set_entries drop constraint set_entries_exercise_log_id_fkey;
alter table public.set_entries add constraint sets_owned_log foreign key (user_id, exercise_log_id)
  references public.exercise_logs(user_id, id) on delete cascade;
alter table public.exercise_logs alter column session_id set not null;
alter table public.exercise_logs alter column exercise_id set not null;
alter table public.set_entries alter column exercise_log_id set not null;

alter table public.exercises add constraint exercises_bounds check (
  length(id) between 1 and 100 and length(trim(name)) between 1 and 200
  and (muscle_group is null or length(muscle_group) <= 100)
  and (image_url is null or (length(image_url) <= 1000 and image_url ~ '^https://raw[.]githubusercontent[.]com/hasaneyldrm/exercises-dataset/')));
alter table public.workout_sessions add constraint sessions_bounds check (
  length(id) between 1 and 100 and date between '1900-01-01'::date and '2100-01-01'::date
  and (notes is null or length(notes) <= 10000));
alter table public.exercise_logs add constraint logs_bounds check (
  length(id) between 1 and 100 and ("order" is null or "order" between 0 and 1000));
alter table public.set_entries add constraint sets_bounds check (
  length(id) between 1 and 100 and set_number between 1 and 1000
  and (weight is null or weight between 0 and 2000)
  and (reps is null or reps between 0 and 1000)
  and (note is null or length(note) <= 2000));
create index if not exists idx_set_entries_user on public.set_entries(user_id);

alter table private.accounts enable row level security;
alter table private.sessions enable row level security;
revoke all on private.accounts, private.sessions from public, anon, authenticated;
revoke truncate, references, trigger on public.exercises, public.workout_sessions,
  public.exercise_logs, public.set_entries from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
-- Supabase reserves supabase_admin default privileges for its control plane.
-- All application migrations run as postgres, whose defaults are locked down above.

create table private.login_limits (
  bucket text primary key,
  started_at timestamptz not null,
  attempts integer not null check (attempts >= 0)
);
alter table private.login_limits enable row level security;
revoke all on private.login_limits from public, anon, authenticated;

create function private.take_auth_attempt(p_name text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_global integer;
  v_account integer;
  v_key text := encode(extensions.digest(p_name, 'sha256'), 'hex');
begin
  -- ponytail: one global counter serializes auth for two people; use a gateway
  -- limiter if this becomes a larger product. No trust in caller-supplied IP headers.
  insert into private.login_limits values ('global', clock_timestamp(), 1)
  on conflict (bucket) do update set
    attempts = case when login_limits.started_at < clock_timestamp() - interval '1 minute' then 1 else least(login_limits.attempts + 1, 1000000) end,
    started_at = case when login_limits.started_at < clock_timestamp() - interval '1 minute' then clock_timestamp() else login_limits.started_at end
  returning attempts into v_global;
  if v_global > 60 then return false; end if;
  delete from private.login_limits where bucket <> 'global' and started_at < clock_timestamp() - interval '1 day';
  insert into private.login_limits values (v_key, clock_timestamp(), 1)
  on conflict (bucket) do update set
    attempts = case when login_limits.started_at < clock_timestamp() - interval '15 minutes' then 1 else least(login_limits.attempts + 1, 1000000) end,
    started_at = case when login_limits.started_at < clock_timestamp() - interval '15 minutes' then clock_timestamp() else login_limits.started_at end
  returning attempts into v_account;
  return v_account <= 10;
end;
$$;
revoke all on function private.take_auth_attempt(text) from public, anon, authenticated;

create or replace function public.login(p_username text, p_password text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_account private.accounts%rowtype;
  v_token text;
  v_hash text;
  v_dummy constant text := '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
  v_name text := lower(trim(coalesce(p_username, '')));
begin
  -- Return NULL instead of raising: an exception would roll back the attempt
  -- counter, making throttling disappear precisely when a password is wrong.
  if length(v_name) > 20 or v_name !~ '^[a-z0-9_]{3,20}$'
     or p_password is null or octet_length(p_password) not between 1 and 72 then return null; end if;
  if not private.take_auth_attempt(v_name) then return null; end if;
  select * into v_account from private.accounts where username = v_name;
  v_hash := coalesce(v_account.password_hash, v_dummy);
  -- Exactly one bcrypt verification for both unknown names and wrong passwords.
  if extensions.crypt(p_password, v_hash) <> v_hash or v_account.id is null then return null; end if;
  delete from private.sessions where expires_at <= now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.sessions(token_hash, account_id, expires_at)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_account.id, now() + interval '7 days');
  -- Bound active sessions too, retaining the newest 10 for this account.
  delete from private.sessions where token_hash in (
    select token_hash from private.sessions where account_id = v_account.id
    order by created_at desc, token_hash desc offset 10
  );
  return v_token;
end;
$$;
update private.sessions set expires_at = least(expires_at, created_at + interval '7 days');
delete from private.sessions where expires_at <= now();

create function public.revoke_other_sessions() returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := private.current_account();
begin
  if v_id is null then raise exception 'Not signed in'; end if;
  delete from private.sessions where account_id = v_id and token_hash <>
    encode(extensions.digest(current_setting('request.headers', true)::json ->> 'x-session-token', 'sha256'), 'hex');
  return true;
end;
$$;

create function public.change_password(p_current text, p_new text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := private.current_account();
  v_account private.accounts%rowtype;
begin
  if v_id is null then raise exception 'Not signed in'; end if;
  select * into v_account from private.accounts where id = v_id;
  if not private.take_auth_attempt(v_account.username) then return false; end if;
  if p_current is null or octet_length(p_current) not between 1 and 72 then return false; end if;
  if extensions.crypt(p_current, v_account.password_hash) <> v_account.password_hash then return false; end if;
  if p_new is null or length(p_new) < 12 or octet_length(p_new) > 72 or p_new = p_current then return false; end if;
  -- Keep the same cost as unknown-user verification to avoid a new timing oracle.
  update private.accounts set password_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)) where id = v_id;
  perform public.revoke_other_sessions();
  return true;
end;
$$;
revoke all on function public.revoke_other_sessions(), public.change_password(text,text) from public;
grant execute on function public.revoke_other_sessions(), public.change_password(text,text) to anon, authenticated;

create function private.enforce_row_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.current_account();
  v_count bigint;
  v_limit integer;
begin
  -- Privileged maintenance has no app session; RLS still checks public callers.
  if v_actor is null then return new; end if;
  if new.user_id <> v_actor then raise exception 'Invalid owner'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text, 0));
  v_limit := case tg_table_name when 'exercises' then 5000 when 'workout_sessions' then 10000 when 'exercise_logs' then 100000 else 500000 end;
  -- Supabase upsert uses INSERT ... ON CONFLICT UPDATE. Existing rows don't consume quota.
  execute format('select count(*) from public.%I where user_id = $1 and id <> $2', tg_table_name)
    into v_count using v_actor, new.id;
  if v_count >= v_limit then raise exception 'Account storage limit reached'; end if;
  if tg_table_name = 'workout_sessions' then
    if new.date > (now() at time zone 'Asia/Jakarta')::date then
      raise exception 'Workout date cannot be in the future';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_row_quota() from public, anon, authenticated;
create trigger exercises_quota before insert or update on public.exercises for each row execute function private.enforce_row_quota();
create trigger sessions_quota before insert or update on public.workout_sessions for each row execute function private.enforce_row_quota();
create trigger logs_quota before insert or update on public.exercise_logs for each row execute function private.enforce_row_quota();
create trigger sets_quota before insert or update on public.set_entries for each row execute function private.enforce_row_quota();
