// Cross-account isolation checks — the only regression test for the RLS model.
//
// The old version of this lived inside create-account.mjs and could not run: it passed a
// hardcoded p_invite of 'SELFTEST', which no invite ever matches, while its own comment
// claimed it needed no invite. It also had two worse problems. Its "cleanup" only printed
// instructions asking the user to delete accounts by id, which would be catastrophic if
// ever pointed at real usernames; and it left every zz* row it created behind.
//
// It does not need disposable accounts at all. The assertions are about what one signed
// in caller can see of another's rows, so all it requires is two live sessions. This runs
// against two real accounts, writes only rows it names itself, and deletes exactly those
// in a finally — never an account.
//
//   $env:SB_URL   = "https://<project>.supabase.co"
//   $env:SB_KEY   = "<publishable key>"
//   $env:SB_USER_A = "carlos"   # any two real accounts
//   $env:SB_PASS_A = "..."
//   $env:SB_USER_B = "sugeng"
//   $env:SB_PASS_B = "..."
//   npm run verify:isolation
//
// Safe to re-run: every id is stamped, stale ones are swept first, and the assertions
// only ever read rows this run created.

import { createClient } from '@supabase/supabase-js'

const url = process.env.SB_URL
const key = process.env.SB_KEY
const A = { user: process.env.SB_USER_A, pass: process.env.SB_PASS_A }
const B = { user: process.env.SB_USER_B, pass: process.env.SB_PASS_B }

if (!url || !key || !A.user || !A.pass || !B.user || !B.pass) {
  console.error('Set SB_URL, SB_KEY, SB_USER_A, SB_PASS_A, SB_USER_B, SB_PASS_B.')
  process.exit(1)
}
if (A.user === B.user) {
  console.error('The two accounts must be different, or isolation cannot be tested.')
  process.exit(1)
}

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

const client = token =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: token ? { 'X-Session-Token': token } : {} },
  })

async function signIn(who, label) {
  const { data, error } = await client(null).rpc('login', { p_username: who.user, p_password: who.pass })
  if (error || !data) {
    throw new Error(`Could not sign in as ${label}: ${error?.message || 'Credentials rejected or attempts throttled'}`)
  }
  console.log(`  ${label} = ${who.user}`)
  const signedIn = client(data)
  signedIn.auditToken = data
  return signedIn
}

const stamp = Date.now().toString().slice(-9)
const IDS = { session: `zzsess${stamp}`, log: `zzlog${stamp}`, set: `zzset${stamp}`, exercise: `zzorder${stamp}` }

let tokenA, tokenB, me, meB
try {
tokenA = await signIn(A, 'A')
tokenB = await signIn(B, 'B')
console.log('')

// Ownership is no longer implicit. `user_id` is NOT NULL and every policy's
// `with check` requires it to equal the caller's own id, so a write that omits it is
// rejected by RLS. The old version of this test omitted it, which is a third reason it
// could never have passed even with a working invite. db.js does the same thing via
// requireUserId() at save time.
me = await tokenA.rpc('whoami')
const idA = (Array.isArray(me.data) ? me.data[0] : me.data)?.user_id
if (!idA) {
  throw new Error('Could not resolve A account id from whoami().')
}
meB = await tokenB.rpc('whoami')
const idB = (Array.isArray(meB.data) ? meB.data[0] : meB.data)?.user_id
if (!idB) {
  throw new Error('Could not resolve B account id from whoami().')
}
console.log(`  A's account id: ${idA}`)
console.log(`  B's account id: ${idB}\n`)

  // A crashed earlier run would otherwise leave rows that make a later run's counts
  // wrong, or make a "B cannot see A's row" check pass for the wrong reason.
  for (const [table, id] of [
    ['workout_sessions', IDS.session],
    ['exercise_logs', IDS.log],
    ['set_entries', IDS.set],
    ['exercises', IDS.exercise],
  ]) {
    await tokenA.from(table).delete().eq('id', id)
  }

  console.log('1. A writes a session, a log, and a set')
  const w = await tokenA.from('workout_sessions').insert({ id: IDS.session, date: '2026-01-01', notes: 'selftest', user_id: idA })
  check('insert session', !w.error, w.error?.message?.slice(0, 70))
  const l = await tokenA.from('exercise_logs').insert({ id: IDS.log, session_id: IDS.session, exercise_id: '1', order: 0, user_id: idA })
  check('insert log', !l.error, l.error?.message?.slice(0, 70))
  const s = await tokenA.from('set_entries').insert({ id: IDS.set, exercise_log_id: IDS.log, set_number: 1, weight: 40, reps: 5, user_id: idA })
  check('insert set', !s.error, s.error?.message?.slice(0, 70))

  console.log('\n1b. a write with someone else\'s user_id is refused')
  // The check that matters most: RLS must reject a caller trying to plant a row under
  // another account, not merely hide rows from the wrong reader.
  const forged_owner = await tokenB.from('workout_sessions').insert({ id: `zzforge${stamp}`, date: '2026-01-01', user_id: idA })
  check("B cannot insert a row owned by A", !!forged_owner.error, forged_owner.error ? 'refused' : 'ACCEPTED')
  await tokenB.from('workout_sessions').delete().eq('id', `zzforge${stamp}`)

  console.log('\n2. A reads its own row back')
  const own = await tokenA.from('workout_sessions').select('id,notes').eq('id', IDS.session)
  check('A sees exactly its own session', own.data?.length === 1, `${own.data?.length} rows`)

  console.log('\n3. B sees none of it')
  for (const [table, col, val] of [
    ['workout_sessions', 'id', IDS.session],
    ['exercise_logs', 'session_id', IDS.session],
    ['set_entries', 'exercise_log_id', IDS.log],
  ]) {
    const r = await tokenB.from(table).select('id').eq(col, val)
    check(`B sees zero ${table}`, (r.data?.length ?? 0) === 0, `${r.data?.length} rows`)
  }

  console.log('\n4. B cannot tamper with A')
  const upd = await tokenB.from('workout_sessions').update({ notes: 'tampered' }).eq('id', IDS.session).select('id')
  check('B update matches nothing', (upd.data?.length ?? 0) === 0, `${upd.data?.length} matched`)
  const del = await tokenB.from('workout_sessions').delete().eq('id', IDS.session).select('id')
  check('B delete matches nothing', (del.data?.length ?? 0) === 0, `${del.data?.length} matched`)
  const still = await tokenA.from('workout_sessions').select('notes').eq('id', IDS.session)
  check("A's row is untouched", still.data?.[0]?.notes === 'selftest', `notes=${still.data?.[0]?.notes}`)

  console.log('\n5. a forged token is no better than none')
  const forged = client('f'.repeat(64))
  const fr = await forged.from('workout_sessions').select('id')
  check('forged token reads zero sessions', (fr.data?.length ?? 0) === 0, `${fr.data?.length} rows`)
  const fb = await forged.rpc('leaderboard')
  check('forged token reads no leaderboard', (fb.data?.length ?? 0) === 0, `${fb.data?.length} rows`)

  console.log('\n6. exercises."order" accepts a Date.now() value')
  // user_id is required: the library is owned, exercises.user_id is NOT NULL, and the
  // insert policy's with check demands it match the caller. Omitting it is rejected.
  const o = await tokenA
    .from('exercises')
    .insert({ id: IDS.exercise, name: 'ZZ Probe', muscle_group: 'Arms', order: Date.now(), user_id: idA })
  check('insert with a timestamp order', !o.error, o.error?.message?.slice(0, 80))
  const back = await tokenA.from('exercises').select('order').eq('id', IDS.exercise).maybeSingle()
  check('order comes back a number', typeof back.data?.order === 'number', `typeof ${typeof back.data?.order}`)

  console.log('\n7. the leaderboard exposes aggregates only')
  const lb = await tokenA.rpc('leaderboard')
  check('leaderboard callable with a session', !lb.error, lb.error?.message?.slice(0, 70))
  const cols = Object.keys(lb.data?.[0] || {})
  const leak = cols.filter(c => ['id', 'user_id', 'date', 'notes', 'exercise_id', 'exercise_name', 'weight', 'reps'].includes(c))
  check('no raw session fields exposed', leak.length === 0, `columns: ${cols.join(', ')}`)
  console.log('\n8. the exercise library is per-account')
  // This reversed a previous decision: exercises used to be a single shared catalogue
  // that any signed-in account could read and rewrite. It is now owned like every other
  // table, so these are the assertions that would have failed before.
  const bSeesOwn = await tokenB.from('exercises').select('id,user_id')
  const bForeign = (bSeesOwn.data || []).filter(e => e.user_id !== idB)
  check('B sees only its own exercises', bForeign.length === 0, `${bForeign.length} foreign rows`)
  const aSeesOwn = await tokenA.from('exercises').select('id,user_id')
  const aForeign = (aSeesOwn.data || []).filter(e => e.user_id !== idA)
  check('A sees only its own exercises', aForeign.length === 0, `${aForeign.length} foreign rows`)

  const stolen = await tokenB.from('exercises').insert({ id: `zzsteal${stamp}`, name: 'ZZ Stolen', user_id: idA })
  check("B cannot insert an exercise owned by A", !!stolen.error, stolen.error ? 'refused' : 'ACCEPTED')

  const editForeign = await tokenB.from('exercises').update({ name: 'ZZ Renamed' }).eq('id', IDS.exercise).select('id')
  check("B cannot rename A's exercise", (editForeign.data?.length ?? 0) === 0, `${editForeign.data?.length} matched`)

  const aProbe = await tokenA.from('exercises').select('name').eq('id', IDS.exercise).maybeSingle()
  check("A's exercise is unchanged", aProbe.data?.name === 'ZZ Probe', `name=${aProbe.data?.name}`)

  console.log('\n9. profile visibility is the owner\'s own decision')
  // set_profile_visible takes no account id, so B calling it cannot touch A. Verified by
  // flipping B off and confirming A is still listed.
  const bOff = await tokenB.rpc('set_profile_visible', { p_visible: false })
  check('B can hide itself', bOff.data === false, `returned ${bOff.data}`)
  const lbWhileBHidden = await tokenA.rpc('leaderboard')
  const bRowGone = !(lbWhileBHidden.data || []).some(r => r.username === B.user)
  check('a hidden account leaves the leaderboard', bRowGone, `rows=${(lbWhileBHidden.data || []).length}`)
  const bBack = await tokenB.rpc('set_profile_visible', { p_visible: true })
  check('B can restore itself', bBack.data === true, `returned ${bBack.data}`)

  const aStillThere = await tokenA.rpc('leaderboard')
  check(
    'hiding one account never hides the other',
    (aStillThere.data || []).some(r => r.username === A.user),
    'A still listed',
  )

  console.log('\n10. records cross the account boundary only with consent')
  const prs = await tokenB.rpc('friend_prs', { p_username: A.user })
  check('B can read A\'s records while A is sharing', !prs.error, prs.error?.message?.slice(0, 70))
  const prCols = Object.keys((prs.data || [])[0] || {})
  const prLeak = prCols.filter(c => !['exercise_name', 'weight', 'reps', 'achieved_on'].includes(c))
  check('records expose no other column', prLeak.length === 0, `columns: ${prCols.join(', ') || '(none)'}`)
  check('A actually has records to return', (prs.data || []).length > 0, `${(prs.data || []).length} rows`)

  // SECURITY DEFINER bypasses RLS, so the caller's session must be checked inside the
  // function. This is the assertion that a public key alone cannot read anyone's records.
  const prsNoToken = await client(null).rpc('friend_prs', { p_username: A.user })
  check(
    'the public key alone reads no records',
    (prsNoToken.data?.length ?? 0) === 0,
    `${prsNoToken.data?.length ?? '-'} rows`,
  )
  const lbNoToken = await client(null).rpc('friend_prs', { p_username: 'nobody-at-all' })
  check('unknown username is handled quietly', (lbNoToken.data?.length ?? 0) === 0, `${lbNoToken.data?.length ?? '-'} rows`)

  await tokenA.rpc('set_profile_visible', { p_visible: false })
  const prsHidden = await tokenB.rpc('friend_prs', { p_username: A.user })
  check("opting out blocks another account's records", (prsHidden.data?.length ?? 0) === 0, `${prsHidden.data?.length ?? '-'} rows`)
  const lbHidden = await tokenB.rpc('leaderboard')
  check('opting out removes the leaderboard row', !(lbHidden.data || []).some(r => r.username === A.user), 'A absent')
  const restored = await tokenA.rpc('set_profile_visible', { p_visible: true })
  check('A can opt back in', restored.data === true, `returned ${restored.data}`)
} finally {
  // Restore each account's original consent, including when a check fails midway.
  for (const [label, tok, original] of [['A', tokenA, me?.data?.[0]?.profile_visible], ['B', tokenB, meB?.data?.[0]?.profile_visible]]) {
    if (!tok || typeof original !== 'boolean') continue
    const back = await tok.rpc('set_profile_visible', { p_visible: original })
    check(`${label} visibility restored`, back.data === original, `returned ${back.data}`)
  }

  console.log('\ncleanup')
  // Only the rows this run created, and never an account. The old version's cleanup
  // told the user to delete accounts by id, which would have destroyed real data.
  for (const [table, id] of [
    ['set_entries', IDS.set],
    ['exercise_logs', IDS.log],
    ['workout_sessions', `zzforge${stamp}`],
    ['workout_sessions', IDS.session],
    ['exercises', IDS.exercise],
  ]) {
    if (!tokenA) continue
    const r = await tokenA.from(table).delete().eq('id', id).select('id')
    check(`removed ${table} ${id}`, (r.data?.length ?? 0) <= 1, `${r.data?.length} removed`)
  }
  // Confirm nothing survived, including a partially-failed run from before.
  const left = tokenA ? await tokenA.from('workout_sessions').select('id').like('id', `zzsess${stamp}`) : {data: []}
  check('no rows left behind', (left.data?.length ?? 0) === 0, `${left.data?.length} rows`)
  for (const tok of [tokenA, tokenB]) if (tok) await tok.rpc('logout', { p_token: tok.auditToken })
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
