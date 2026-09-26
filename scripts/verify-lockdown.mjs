// Lockdown checker. Runs with the *publishable* key only — no account, no service
// key — because that is the entire point: the key any stranger can copy out of the
// public bundle must be able to do nothing.
//
// The authenticated regression suite (FK write ordering, bigint sort keys,
// cross-user denial) lives in `create-account.mjs --selftest`, which needs a service
// key to create disposable accounts.
//
//   $env:SB_URL = "https://<project>.supabase.co"
//   $env:SB_KEY = "<publishable key>"

const base = process.env.SB_URL
const key = process.env.SB_KEY

if (!base || !key) {
  console.error('Set SB_URL and SB_KEY in this shell.')
  process.exit(1)
}

const anon = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

let failures = 0
function check(label, condition, detail = '') {
  if (!condition) failures++
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
}

async function req(method, path, { query = '', body, prefer } = {}) {
  const res = await fetch(`${base}/rest/v1/${path}${query}`, {
    method,
    headers: { ...anon, Prefer: prefer || 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: res.status, data }
}

console.log('--- 1. anon must not read any training data ---')
for (const table of ['workout_sessions', 'exercise_logs', 'set_entries', 'exercises', 'profiles']) {
  const r = await req('get', table, { query: '?select=*' })
  const denied = r.status === 401 || r.status === 403 || r.status === 42501
  const empty = r.status === 200 && Array.isArray(r.data) && r.data.length === 0
  check(`${table}: no rows reachable`, denied || empty, `HTTP ${r.status}`)
}

console.log('\n--- 2. anon must not write ---')
const del = await req('delete', 'workout_sessions', {
  query: '?id=eq.zz-should-never-exist',
  prefer: 'return=minimal',
})
check('delete is rejected', del.status >= 400, `HTTP ${del.status}`)

const ins = await req('post', 'workout_sessions', {
  body: { id: `zz-anon-${Date.now()}`, date: '2026-01-01', notes: 'anon probe' },
  prefer: 'return=minimal',
})
check(
  'insert is rejected',
  ins.status >= 400,
  `HTTP ${ins.status} ${JSON.stringify(ins.data || '').slice(0, 90)}`,
)

const upd = await req('patch', 'workout_sessions', {
  query: '?id=eq.zz-should-never-exist',
  body: { notes: 'tampered' },
  prefer: 'return=minimal',
})
check('update is rejected', upd.status >= 400, `HTTP ${upd.status}`)

console.log('\n--- 3. anon must not read the leaderboard ---')
const lb = await req('post', 'rpc/leaderboard', { body: {} })
check('leaderboard RPC is rejected', lb.status >= 400, `HTTP ${lb.status}`)

console.log('\n--- 4. sign-in endpoint is still live ---')
const token = await fetch(`${base}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'definitely-not-real@gym.invalid', password: 'x' }),
})
check('a bad password is rejected, so real sign-ins work', token.status === 400, `HTTP ${token.status}`)

console.log(failures === 0 ? '\nAll checks passed — anon is fully locked out.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
