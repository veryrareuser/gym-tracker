// Integration check for the Bug 1 fix, run against the live Supabase project with
// the same anon key the app ships with. It replays exactly what the app now does:
// saveExercise() before saveSession(), then reads the session back.
//
// Everything it creates is deleted at the end.

const URL_BASE = process.env.SB_URL
const KEY = process.env.SB_KEY
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

const stamp = Date.now()
const testExerciseId = `zz-test-${stamp}`
const testSessionId = `zz-test-session-${stamp}`
const testLogId = `zz-test-log-${stamp}`
const testSetId = `zz-test-set-${stamp}`
async function req(method, table, opts = {}) {
  const url = `${URL_BASE}/rest/v1/${table}${opts.query || ''}`
  const res = await fetch(url, {
    method,
    headers: { ...HEAD, Prefer: opts.prefer || 'return=representation' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
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

async function cleanup() {
  await req('delete', 'workout_sessions', { query: `?id=eq.${testSessionId}`, prefer: 'return=minimal' })
  await req('delete', 'exercises', { query: `?id=eq.${testExerciseId}`, prefer: 'return=minimal' })
}

let failures = 0
function check(label, condition, detail = '') {
  const mark = condition ? 'PASS' : 'FAIL'
  if (!condition) failures++
  console.log(`${mark}  ${label}${detail ? `  — ${detail}` : ''}`)
}

async function main() {
  console.log('--- 1. Reproduce the old bug: write a log WITHOUT saving the exercise first ---')
  await req('post', 'workout_sessions', { body: { id: testSessionId, date: '2026-01-01', notes: 'pre-fix repro' } })
  const noEx = await req('post', 'exercise_logs', {
    body: { id: testLogId, session_id: testSessionId, exercise_id: testExerciseId, order: 0 },
  })
  check(
    'log insert is rejected when the exercise row is missing',
    noEx.status >= 400,
    `HTTP ${noEx.status} ${noEx.data?.message || noEx.data || ''}`.slice(0, 120),
  )

  console.log('\n--- 2. The fix: saveExercise() first, then the same log insert ---')
  const saved = await req('post', 'exercises', {
    body: {
      id: testExerciseId,
      name: 'ZZ Integration Test Row',
      muscle_group: 'Chest',
      order: 999999,
      image_url: 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/refs/heads/main/images/0289-SpYC0Kp.jpg',
    },
  })
  check('exercise row is written', saved.status < 300, `HTTP ${saved.status}`)

  const withEx = await req('post', 'exercise_logs', {
    body: { id: testLogId, session_id: testSessionId, exercise_id: testExerciseId, order: 0 },
  })
  check('log insert now succeeds', withEx.status < 300, `HTTP ${withEx.status}`)

  const sets = await req('post', 'set_entries', {
    body: { id: testSetId, exercise_log_id: testLogId, set_number: 1, weight: 42.5, reps: 8, note: null },
    prefer: 'return=minimal',
  })
  check('set insert succeeds', sets.status < 300, `HTTP ${sets.status}`)

  console.log('\n--- 3. Read the session back the way History does ---')
  const read = await req('get', 'workout_sessions', {
    query: `?id=eq.${testSessionId}&select=*,exercise_logs(*,set_entries(*))`,
  })
  const session = Array.isArray(read.data) ? read.data[0] : null
  const logCount = session?.exercise_logs?.length ?? 0
  check('session comes back with its log', logCount === 1, `exercise_logs length = ${logCount}`)
  check(
    'the log carries its set',
    (session?.exercise_logs?.[0]?.set_entries?.length ?? 0) === 1,
    `set_entries length = ${session?.exercise_logs?.[0]?.set_entries?.length ?? 0}`,
  )

  const exRead = await req('get', 'exercises', { query: `?id=eq.${testExerciseId}&select=id,name,image_url` })
  const ex = Array.isArray(exRead.data) ? exRead.data[0] : null
  check('exercise is resolvable by id (so History can name it)', ex?.id === testExerciseId, ex?.name || 'not found')
  check('image_url round-trips', typeof ex?.image_url === 'string' && ex.image_url.length > 0)

  console.log('\n--- 4. Prune path: removing a log cascades to its sets ---')
  const del = await req('delete', 'exercise_logs', { query: `?id=eq.${testLogId}`, prefer: 'return=minimal' })
  check('log delete succeeds', del.status < 300, `HTTP ${del.status}`)
  const setsGone = await req('get', 'set_entries', { query: `?id=eq.${testSetId}&select=id` })
  check('its set was cascaded away', (Array.isArray(setsGone.data) ? setsGone.data.length : 0) === 0)

  console.log('\n--- 5. Seeded exercises have image_url ---')
  const seeded = await req('get', 'exercises', { query: '?id=in.(1,2,3,4,5,6,7,8,9,10)&select=id,image_url' })
  const withImage = (Array.isArray(seeded.data) ? seeded.data : []).filter(r => r.image_url).length
  check('all 10 seeded exercises carry an image_url', withImage === 10, `${withImage}/10`)

  // Regression guard: new exercises are appended with order = Date.now() so the
  // newest sorts last without a read-before-write. That is ~1.79e12, which overflows
  // an integer column (max 2147483647) and made every save of a new exercise fail with
  // 'value ... is out of range for type integer'. exercises.order must be bigint.
  console.log('\n--- 6. exercises.order accepts a Date.now() sort key ---')
  const orderedId = `zz-order-${stamp}`
  const ordered = await req('post', 'exercises', {
    body: { id: orderedId, name: 'ZZ Order Probe', muscle_group: 'Arms', order: stamp },
    prefer: 'return=minimal',
  })
  check('insert with order = Date.now() is accepted', ordered.status < 300, `HTTP ${ordered.status} ${JSON.stringify(ordered.data || '')}`.slice(0, 140))

  const back = await req('get', 'exercises', { query: `?id=eq.${orderedId}&select=id,order` })
  const probe = Array.isArray(back.data) ? back.data[0] : null
  check('order round-trips as a JSON number, not a string', typeof probe?.order === 'number', `typeof = ${typeof probe?.order}`)
  check('order round-trips exactly (no float precision loss)', probe?.order === stamp, `${probe?.order} vs ${stamp}`)

  // The Exercises tab sorts with (a.order ?? 0) - (b.order ?? 0), so the value has to
  // behave as a number both server-side and client-side.
  const listed = await req('get', 'exercises', { query: '?select=id,order&order=order' })
  const rows = Array.isArray(listed.data) ? listed.data : []
  check('new exercise sorts last among the seeded rows', rows[rows.length - 1]?.id === orderedId, `last = ${rows[rows.length - 1]?.id}`)
  const clientSorted = [...rows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  check('client-side numeric sort agrees', clientSorted[clientSorted.length - 1]?.id === orderedId)
  check(
    'max bigint is not silently clamped',
    rows.some(r => r.order === stamp),
  )

  await req('delete', 'exercises', { query: `?id=eq.${orderedId}`, prefer: 'return=minimal' })
}

main()
  .catch(err => {
    console.error('Unexpected failure:', err.message)
    failures++
  })
  .finally(async () => {
    await cleanup()
    console.log(`\nCleanup done. ${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`)
    process.exit(failures === 0 ? 0 : 1)
  })
