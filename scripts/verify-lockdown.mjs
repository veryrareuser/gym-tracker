// Lockdown checker. Runs with the *publishable* key only — no account, no token, no
// service key — because that is the entire point: the key sitting in the public
// bundle must be worth nothing to a stranger who copies it.
//
//   $env:SB_URL = "https://<project>.supabase.co"
//   $env:SB_KEY = "<publishable key>"
//
// A note on what these assertions check. RLS filtering is not an error: a request
// from a tokenless caller returns 200 with zero rows. So the meaningful test is the
// *effect* — did anything come back, did anything change — not the status code.
// Asserting "must be 4xx" would pass for the wrong reason and would break the day
// Postgres started returning an empty result instead of an error.
//
// Tests that need a real session token live in `create-account.mjs --selftest`.

const base = process.env.SB_URL
const key = process.env.SB_KEY

if (!base || !key) {
  console.error('Set SB_URL and SB_KEY in this shell.')
  process.exit(1)
}

const headers = (token) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  ...(token ? { 'X-Session-Token': token } : {}),
})

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

async function req(method, path, { query = '', body, token, prefer } = {}) {
  const res = await fetch(`${base}/rest/v1/${path}${query}`, {
    method,
    headers: { ...headers(token), Prefer: prefer || 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: res.status, data, rows: Array.isArray(data) ? data.length : null }
}

const TABLES = ['workout_sessions', 'exercise_logs', 'set_entries', 'exercises']

console.log('1. a tokenless caller reads nothing')
for (const t of TABLES) {
  const r = await req('get', t, { query: '?select=*' })
  check(`${t} returns no rows`, r.rows === 0 || r.status >= 400, `HTTP ${r.status}, ${r.rows ?? '-'} rows`)
}

console.log('\n2. a tokenless caller cannot write')
const ins = await req('post', 'workout_sessions', {
  body: { id: `zz-anon-${Date.now()}`, date: '2026-01-01', notes: 'anon probe' },
})
check('insert is rejected', ins.status >= 400, `HTTP ${ins.status}`)

// These carry a filter that matches every row (`not.is.null`) on purpose. An
// unfiltered DELETE or PATCH is refused by PostgREST with a 400 before RLS is ever
// consulted, so it would look like a pass while testing nothing. A filter that
// matches everything reaches the policy, and RLS is what has to stop it.
const ALL_ROWS = '?id=not.is.null&select=id'

const upd = await req('PATCH', 'workout_sessions', { query: ALL_ROWS, body: { notes: 'tampered' } })
check('an update matching every row touches nothing', upd.rows === 0, `HTTP ${upd.status}, ${upd.rows ?? '-'} rows`)

const del = await req('DELETE', 'workout_sessions', { query: ALL_ROWS })
check('a delete matching every row removes nothing', del.rows === 0, `HTTP ${upd.status}, ${del.rows ?? '-'} rows`)

const delSets = await req('DELETE', 'set_entries', { query: ALL_ROWS })
check('the same for set_entries', delSets.rows === 0, `HTTP ${delSets.status}, ${delSets.rows ?? '-'} rows`)

const delLogs = await req('DELETE', 'exercise_logs', { query: ALL_ROWS })
check('the same for exercise_logs', delLogs.rows === 0, `HTTP ${delLogs.status}, ${delLogs.rows ?? '-'} rows`)

console.log('\n3. a forged token is no better than none')
const forged = 'f'.repeat(64)
for (const t of TABLES) {
  const r = await req('get', t, { query: '?select=*', token: forged })
  check(`${t} still returns no rows`, r.rows === 0 || r.status >= 400, `HTTP ${r.status}, ${r.rows ?? '-'} rows`)
}
const forgedWrite = await req('post', 'workout_sessions', {
  body: { id: `zz-forged-${Date.now()}`, date: '2026-01-01' },
  token: forged,
})
check('a forged token cannot insert', forgedWrite.status >= 400, `HTTP ${forgedWrite.status}`)

console.log('\n4. the leaderboard needs a session too')
const lb = await req('post', 'rpc/leaderboard', { body: {} })
check('no standings without a token', lb.rows === 0 || lb.status >= 400, `HTTP ${lb.status}, ${lb.rows ?? '-'} rows`)

console.log('\n5. identity helpers do not leak')
const who = await req('post', 'rpc/whoami', { body: {} })
check('whoami is empty without a token', who.rows === 0 || who.status >= 400, `HTTP ${who.status}, ${who.rows ?? '-'} rows`)

console.log('\n6. sign-in rejects bad credentials without revealing why')
const bad = await req('post', 'rpc/login', { body: { p_username: 'nobody-here', p_password: 'wrong-password' } })
check('unknown user is rejected', bad.status >= 400, `HTTP ${bad.status}`)
const msg1 = bad.data?.message || ''
const wrong = await req('post', 'rpc/login', { body: { p_username: 'carlo', p_password: 'definitely-wrong' } })
const msg2 = wrong.data?.message || ''
check('wrong password is rejected', wrong.status >= 400, `HTTP ${wrong.status}`)
check(
  'the two failures are indistinguishable',
  msg1 === msg2 && msg1.length > 0,
  `"${msg1}" vs "${msg2}"`,
)

console.log('\n7. a weak password cannot be set through the API')
const weak = await req('post', 'rpc/login', { body: { p_username: 'x', p_password: 'y' } })
check('a malformed login is rejected, not coerced', weak.status >= 400, `HTTP ${weak.status}`)

console.log(
  failures === 0
    ? '\nAll checks passed. A stranger with the public key can do nothing.'
    : `\n${failures} check(s) FAILED — the database is not locked down as intended.`,
)
process.exit(failures === 0 ? 0 : 1)
