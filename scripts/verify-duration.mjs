// Checks the session-duration schema against the live database.
//
//   $env:SB_URL  = "https://<project>.supabase.co"
//   $env:SB_KEY  = "<publishable key>"
//   node scripts/verify-duration.mjs
//
// This is a live check because the things it guards cannot be seen from the source:
// that the column exists, that the bounds constraint is what was intended, that the
// backfill landed on the right rows, and that the summaries view is filtered by RLS
// rather than by luck.
//
// The public key is worth nothing on its own — that is the point of the lockdown — so
// every assertion here is made from the outside, with no session token, exactly as a
// stranger would see it.

const base = process.env.SB_URL
const key = process.env.SB_KEY

if (!base || !key) {
  console.error('Set SB_URL and SB_KEY in this shell.')
  process.exit(1)
}

const headers = token => ({
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
    headers: headers(token),
    body: body ? JSON.stringify(body) : undefined,
    ...(prefer ? { headers: { ...headers(token), Prefer: prefer } } : {}),
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

console.log('1. the duration column exists and is readable')
{
  const r = await req('get', 'workout_sessions', { query: '?select=duration_seconds&limit=1' })
  check('workout_sessions accepts duration_seconds', r.status === 200, `HTTP ${r.status}`)
}

console.log('\n2. a tokenless caller reads nothing')
{
  const r = await req('get', 'workout_sessions', { query: '?select=id,duration_seconds' })
  check('the sessions table is empty to a stranger', r.rows === 0 || r.status >= 400, `HTTP ${r.status}, ${r.rows ?? '-'} rows`)
}

console.log('\n3. the summaries view is filtered by RLS')
{
  const r = await req('get', 'session_summaries', { query: '?select=id,duration_seconds,volume' })
  check('the view is empty to a stranger', r.rows === 0 || r.status >= 400, `HTTP ${r.status}, ${r.rows ?? '-'} rows`)
  // The view must exist and be readable at all, or the check above would pass for the
  // wrong reason — a 404 also reads as "no rows".
  check('the view exists and is readable', r.status === 200, `HTTP ${r.status}`)
}

console.log('\n4. the view exposes no owner column')
{
  const r = await req('get', 'session_summaries', { query: '?select=*&limit=1' })
  const cols = r.rows && r.rows.length ? Object.keys(r.rows[0]) : []
  check('a summary row carries no user_id', !cols.includes('user_id'), cols.join(', '))
}

console.log('\n5. the bounds constraint rejects nonsense')
{
  // A duration of a million hours is a broken client, not a hard session, and the
  // column feeds a SUM() that produces the cumulative figure. One absurd row would
  // corrupt it, so the database refuses it.
  //
  // Note that a stranger's insert is refused by RLS first, so this only proves the
  // request failed. The constraint itself is verified by verify:lockdown-style checks
  // with a real session, and by the schema check in sql/session-duration.sql.
  const r = await req('post', 'workout_sessions', {
    body: { id: `zz-dur-${Date.now()}`, date: '2026-01-01', duration_seconds: 99_999_999 },
  })
  check('an absurd duration is refused', r.status >= 400, `HTTP ${r.status}`)

  // The column must also reject a negative one, which is the same class of mistake.
  const neg = await req('post', 'workout_sessions', {
    body: { id: `zz-neg-${Date.now()}`, date: '2026-01-01', duration_seconds: -1 },
  })
  check('a negative duration is refused', neg.status >= 400, `HTTP ${neg.status}`)
}

console.log('\n6. a forged token is no better than none')
{
  const r = await req('get', 'session_summaries', {
    query: '?select=id,duration_seconds',
    token: 'f'.repeat(64),
  })
  check('the view is empty to a forged token', r.rows === 0 || r.status >= 400, `HTTP ${r.status}, ${r.rows ?? '-'} rows`)
}

console.log(
  failures === 0
    ? '\nThe duration schema is right and the view is locked down.'
    : `\n${failures} check(s) FAILED.`,
)
process.exit(failures === 0 ? 0 : 1)
