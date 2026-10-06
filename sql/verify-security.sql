-- Run through the privileged SQL connection. Every fixture and change rolls back.
begin;
insert into private.accounts(id,username,password_hash) values
 ('00000000-0000-4000-8000-0000000000a1','zz_security_a',extensions.crypt('Fixture-password-A!123',extensions.gen_salt('bf',10))),
 ('00000000-0000-4000-8000-0000000000b1','zz_security_b',extensions.crypt('Fixture-password-B!123',extensions.gen_salt('bf',10)));
insert into private.sessions(token_hash,account_id,expires_at) values
 (encode(extensions.digest(repeat('a',64),'sha256'),'hex'),'00000000-0000-4000-8000-0000000000a1',now()+interval '1 hour'),
 (encode(extensions.digest(repeat('b',64),'sha256'),'hex'),'00000000-0000-4000-8000-0000000000b1',now()+interval '1 hour');
insert into public.exercises(id,name,user_id) values
 ('zz-security-ex-a','Fixture A','00000000-0000-4000-8000-0000000000a1'),
 ('zz-security-ex-b','Fixture B','00000000-0000-4000-8000-0000000000b1');
insert into public.workout_sessions(id,date,user_id) values
 ('zz-security-session-a','2026-01-01','00000000-0000-4000-8000-0000000000a1'),
 ('zz-security-session-b','2026-01-01','00000000-0000-4000-8000-0000000000b1');
insert into public.exercise_logs(id,session_id,exercise_id,user_id) values
 ('zz-security-log-a','zz-security-session-a','zz-security-ex-a','00000000-0000-4000-8000-0000000000a1');
select set_config('request.headers','{"x-session-token":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}',true);
set local role anon;
do $$
begin
  if exists(select 1 from public.workout_sessions where id='zz-security-session-a') then raise exception 'Cross-account read allowed'; end if;
  begin
    insert into public.exercise_logs(id,session_id,exercise_id,user_id) values
      ('zz-security-attack-log','zz-security-session-a','zz-security-ex-b','00000000-0000-4000-8000-0000000000b1');
    raise exception 'Cross-owner log accepted';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.set_entries(id,exercise_log_id,set_number,weight,reps,user_id) values
      ('zz-security-attack-set','zz-security-log-a',1,10,1,'00000000-0000-4000-8000-0000000000b1');
    raise exception 'Cross-owner set accepted';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.workout_sessions(id,date,user_id) values
      ('zz-security-owner-forge','2026-01-01','00000000-0000-4000-8000-0000000000a1');
    raise exception 'Foreign owner accepted';
  exception when insufficient_privilege or raise_exception then
    if sqlerrm not in ('Invalid owner','new row violates row-level security policy for table "workout_sessions"') then raise; end if;
  end;
  if public.change_password('wrong','New-fixture-password-B!123') then raise exception 'Wrong password accepted'; end if;
  if not public.change_password('Fixture-password-B!123','New-fixture-password-B!123') then raise exception 'Password change failed'; end if;
  if not public.revoke_other_sessions() then raise exception 'Revoke failed'; end if;
  if (select jsonb_agg(to_jsonb(t) order by username) from public.leaderboard('2026-01-01') t)
    is distinct from (select jsonb_agg(to_jsonb(t) order by username) from public.leaderboard('2026-01-20') t)
    then raise exception 'Leaderboard accepts daily windows'; end if;
end $$;
reset role;
do $$
declare v text;
begin
  -- Test an unused fixture name, never consume a real user's allowance.
  for i in 1..10 loop
    v := public.login('zz_limit_fixture','intentionally-incorrect');
    if v is not null then raise exception 'Invalid login succeeded'; end if;
  end loop;
  if private.take_auth_attempt('zz_limit_fixture') then raise exception 'Rate limit failed'; end if;
  if (select attempts from private.login_limits where bucket=encode(extensions.digest('zz_limit_fixture','sha256'),'hex'))<>11
    then raise exception 'Failed attempts were rolled back'; end if;
  v := public.login('zz_security_a','Fixture-password-A!123');
  if v is null or length(v)<>64 then raise exception 'Valid login failed'; end if;
  if not exists(select 1 from private.sessions where token_hash=encode(extensions.digest(v,'sha256'),'hex') and expires_at<=now()+interval '7 days')
    then raise exception 'Session expiry incorrect'; end if;
end $$;
select set_config('request.headers','{}',true);
set local role anon;
do $$
begin
  if exists(select 1 from public.workout_sessions) then raise exception 'Anonymous read allowed'; end if;
  if exists(select 1 from public.leaderboard()) then raise exception 'Anonymous leaderboard allowed'; end if;
  if exists(select 1 from public.friend_prs('carlos')) then raise exception 'Anonymous records allowed'; end if;
  if has_table_privilege('private.accounts','SELECT') then raise exception 'Private accounts readable'; end if;
end $$;
reset role;
rollback;
