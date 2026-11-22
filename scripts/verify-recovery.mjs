// Proves the discard → list → restore → purge round trip against the live database.
//
//   $env:SB_USER = "zzrecover"        # a throwaway account
//   $env:SB_PASSWORD = "..."
//   node scripts/verify-recovery.mjs
//
// Needs SB_URL and SB_KEY as well. No browser: the data-layer round trip is the claim
// here, and the UI wiring is checked by the credential-free verify:recovery suite.
//
// The account's login throttle is ten attempts a quarter of an hour. This script signs
// in once; clear its bucket between runs if that one attempt gets throttled:
//
//   delete from private.login_limits
//    where bucket = encode(extensions.digest('<username>', 'sha256'), 'hex');
//
// Everything this script creates is deleted in `finally`, including the exercise it
// adds to the throwaway account's library.

import { randomUUID } from 'node:crypto'

const base = process.env.SB_URL
const key = process.env.SB_KEY
const user = process.env.SB_USER
const pass = process.env.SB_PASSWORD

if (!base || !key || !user || !pass) {
  console.error('Set SB_URL, SB_KEY, SB_USER and SB_PASSWORD in this shell.')
  process.exit(1)
}

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

const headers = token => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  ...(token ? { 'X-Session-Token': token } : {}),
})

async function req(method, path, { query = '', body, token } = {}) {
  const res = await fetch(`${base}/rest/v1/${path}${query}`, {
    method,
    headers: { ...headers(token), Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: res.status, data, rows: Array.isArray(data) ? data : null }
}

const id = `zz-recovery-${randomUUID()}`
const exerciseId = `zz-recovery-ex-${randomUUID()}`
const logId = `zz-recovery-log-${randomUUID()}`
const setId = `zz-recovery-set-${randomUUID()}`
const date = '2026-11-22'
let token = null

async function cleanEverything() {
  if (!token) return
  await req('delete', 'set_entries', { query: '?id=neq.__none__', token })
  await req('delete', 'exercise_logs', { query: '?id=neq.__none__', token })
  await req('delete', 'workout_sessions', { query: '?id=neq.__none__', token })
  await req('delete', 'exercises', { query: `?id=eq.${exerciseId}`, token })
}

try {
  console.log('1. signs in once')
  const login = await req('post', 'rpc/login', { body: { p_username: user, p_password: pass } })
  token = typeof login.data === 'string' ? login.data : null
  check('signed in', Boolean(token), token ? '' : `HTTP ${login.status}: ${JSON.stringify(login.data)}`)
  if (!token) throw new Error('sign-in failed')

  const me = await req('post', 'rpc/whoami', { body: {}, token })
  const account = Array.isArray(me.data) ? me.data[0] : me.data
  const userId = account?.user_id
  check('account id is known', Boolean(userId), JSON.stringify(account))
  if (!userId) throw new Error('whoami returned no account')

  // A clean account, so every row this script reads was written by this script.
  await cleanEverything()

  console.log('\n2. creates a draft with a set')
  const ex = await req('post', 'exercises', {
    body: { id: exerciseId, name: 'Recovery Probe', muscle_group: 'Chest', order: Date.now(), user_id: userId },
    token,
  })
  check('the exercise exists', ex.status === 201 || ex.rows?.length === 1, `HTTP ${ex.status}`)

  const session = await req('post', 'workout_sessions', {
    body: { id, date, notes: 'recovery probe', is_draft: true, duration_seconds: 600, user_id: userId },
    token,
  })
  check('the draft was written', session.rows?.length === 1 && session.rows[0].is_draft === true, `HTTP ${session.status}`)

  const log = await req('post', 'exercise_logs', {
    body: { id: logId, session_id: id, exercise_id: exerciseId, order: 0, user_id: userId },
    token,
  })
  check('its log was written', log.rows?.length === 1, `HTTP ${log.status}`)

  const set = await req('post', 'set_entries', {
    body: { id: setId, exercise_log_id: logId, set_number: 1, weight: 60, reps: 8, user_id: userId },
    token,
  })
  check('its set was written', set.rows?.length === 1, `HTTP ${set.status}`)

  console.log('\n3. discards it')
  const discard = await req('patch', 'workout_sessions', {
    query: `?id=eq.${id}&is_draft=eq.true&deleted_at=is.null`,
    body: { deleted_at: new Date().toISOString() },
    token,
  })
  check('the row was stamped, not deleted', discard.rows?.length === 1 && Boolean(discard.rows[0].deleted_at),
    `HTTP ${discard.status}`)
  const children = await req('get', 'exercise_logs', { query: `?session_id=eq.${id}&select=id`, token })
  check('the log survived the discard', children.rows?.length === 1, `HTTP ${children.status}`)

  const discarded = await req('get', 'session_summaries', {
    query: '?select=id,is_draft,deleted_at,exercise_count,set_count,volume&deleted_at=not.is.null',
    token,
  })
  const row = (discarded.rows || []).find(r => r.id === id)
  check('the discarded list shows it', Boolean(row), JSON.stringify(discarded.rows))
  check('  and keeps its aggregates', row?.exercise_count === 1 && row?.set_count === 1 && Number(row?.volume) === 480,
    JSON.stringify(row))

  const live = await req('get', 'session_summaries', {
    query: `?select=id&id=eq.${id}&deleted_at=is.null`,
    token,
  })
  check('the live list does not show it', live.rows?.length === 0, `HTTP ${live.status}`)

  console.log('\n4. restores it')
  const restore = await req('patch', 'workout_sessions', {
    query: `?id=eq.${id}`,
    body: { deleted_at: null },
    token,
  })
  check('the stamp was cleared', restore.rows?.length === 1 && restore.rows[0].deleted_at === null,
    `HTTP ${restore.status}`)
  const draftRead = await req('get', 'workout_sessions', {
    query: `?select=id,is_draft&id=eq.${id}&is_draft=eq.true&deleted_at=is.null`,
    token,
  })
  check('getDraft would find it again', draftRead.rows?.length === 1, `HTTP ${draftRead.status}`)
  const stillDiscarded = await req('get', 'session_summaries', {
    query: `?select=id&id=eq.${id}&deleted_at=not.is.null`,
    token,
  })
  check('it left the discarded list', stillDiscarded.rows?.length === 0, `HTTP ${stillDiscarded.status}`)

  // The partial unique index turns a two-tab race into an error rather than a second
  // live draft. This draft is live, so a second one must be rejected.
  const second = await req('post', 'workout_sessions', {
    body: { id: `${id}-second`, date, is_draft: true, user_id: userId },
    token,
  })
  check('a second live draft is rejected', second.status >= 400, `HTTP ${second.status}`)
  if (second.status < 400) {
    await req('delete', 'workout_sessions', { query: `?id=eq.${id}-second`, token })
  }

  console.log('\n5. purges it for good')
  await req('patch', 'workout_sessions', {
    query: `?id=eq.${id}`,
    body: { deleted_at: new Date().toISOString() },
    token,
  })
  const purge = await req('delete', 'workout_sessions', {
    query: `?id=eq.${id}&deleted_at=not.is.null`,
    token,
  })
  check('the row was deleted', purge.rows?.length === 1, `HTTP ${purge.status}`)
  const gone = await req('get', 'session_summaries', { query: `?select=id&id=eq.${id}`, token })
  check('nothing is left', gone.rows?.length === 0, `HTTP ${gone.status}`)
} catch (error) {
  check('the database run completed', false, error.message)
} finally {
  await cleanEverything().catch(() => {})
  try {
    if (token) await req('post', 'rpc/logout', { body: { p_token: token }, token: null })
  } catch { /* sign-out is best effort in a throwaway account */ }
}

console.log(`\n${failures === 0 ? 'Discard, restore and purge round-trip.' : `${failures} FAILED.`}`)
process.exit(failures === 0 ? 0 : 1)
