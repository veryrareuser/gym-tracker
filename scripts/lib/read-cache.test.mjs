// Tests the read cache in db.js — the thing that stops the app asking the network for
// the same rows four times over.
//
//   node scripts/lib/read-cache.test.mjs
//
// The bug this guards against is invisible in the code and obvious in the network tab:
// every page that lists workouts fetched the whole session tree, on every visit, and
// the app did it again on its own start-up. Switching tabs on a phone re-downloaded
// 176 KB to redraw a list that had not changed.
//
// The cache is asserted on three properties, because each one fails differently:
// concurrent callers share one request, a recent result is served without a request,
// and a write invalidates it.
//
// The real db.js runs here, with only its three imports swapped for stand-ins. The
// stand-in client counts the queries, so what is measured is the number of requests
// the app actually makes — not the number of times a function was called.

import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const harness = `${root}scripts/lib/.read-cache-harness.mjs`

const HARNESS = `
import { readFileSync } from 'node:fs'

// db.js reaches for sessionStorage, localStorage and the Supabase client, so all three
// are stood in for here, and the queries are counted.
const store = {}
const fakeStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: k => { delete store[k] },
  key: i => Object.keys(store)[i] ?? null,
  get length() { return Object.keys(store).length },
}
globalThis.localStorage = fakeStorage
globalThis.sessionStorage = fakeStorage
globalThis.window = {
  localStorage: fakeStorage,
  sessionStorage: fakeStorage,
  addEventListener() {},
  removeEventListener() {},
}

globalThis.queries = 0
globalThis.offline = false

const rows = [{
  id: 's1', date: '2026-10-14', notes: null, is_draft: false,
  duration_seconds: 6300, volume: 1000, set_count: 3, exercise_count: 2,
  exercise_names: ['Bench'],
}]
globalThis.rows = rows

// A stand-in for the Supabase client that counts the queries and answers with rows.
globalThis.__client = {
  from: () => {
    globalThis.queries++
    if (globalThis.offline) throw new Error('network down')
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: rows[0], error: null }),
      upsert: async () => ({ data: null, error: null }),
      delete: () => builder,
      then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    }
    return builder
  },
  rpc: async () => ({ data: null, error: null }),
}

// The real db.js, with only its three imports swapped for the stand-ins above.
let src = readFileSync('src/lib/db.js', 'utf8')
src = src
  .replace(/import \\{ supabase \\} from '\\.\\/supabaseClient'/, 'const supabase = globalThis.__client')
  .replace(/import \\{ currentUserId \\} from '\\.\\/auth'/, "const currentUserId = () => 'u1'")
  .replace(/import \\{ imageUrl, DEFAULT_EXERCISE_IMAGE_MAP \\} from '\\.\\/exerciseDb'/, 'const imageUrl = p => p; const DEFAULT_EXERCISE_IMAGE_MAP = {}')
  // The stub for ./utils matters more than it looks: the module is loaded from a
  // data: URL, and a data: URL has no base to resolve a relative import against, so
  // an unstubbed import fails with "Invalid relative URL or base scheme is not
  // hierarchical" before a single assertion runs.
  .replace(/import \{ generateId \} from '\\.\\/utils'/, 'const generateId = () => "gen-" + Math.random()')

const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))

let bad = 0
const chk = (label, ok, detail) => {
  if (!ok) bad++
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  ' + detail : ''))
}

console.log('--- one request for concurrent readers ---')
globalThis.queries = 0
const [a, b, c] = await Promise.all([
  mod.getSessionSummaries(),
  mod.getSessionSummaries(),
  mod.getSessionSummaries(),
])
chk('three concurrent readers make one request', globalThis.queries === 1, 'queries=' + globalThis.queries)
chk('and all three get the rows', a.length === 1 && b.length === 1 && c.length === 1)

console.log('')
console.log('--- a recent result is served without a request ---')
globalThis.queries = 0
await mod.getSessionSummaries()
await mod.getExercises()
globalThis.queries = 0
await mod.getSessionSummaries()
await mod.getExercises()
chk('a second read makes no request', globalThis.queries === 0, 'queries=' + globalThis.queries)

console.log('')
console.log('--- a write invalidates it ---')
await mod.saveExercise({ id: 'e1', name: 'Bench', muscle_group: 'Chest', order: 1 })
globalThis.queries = 0
await mod.getExercises()
chk('the edited exercise is read again', globalThis.queries === 1, 'queries=' + globalThis.queries)

console.log('')
console.log('--- a failed read is not remembered ---')
// getSessions() rather than getSessionSummaries(): the summaries were cached by the
// checks above, so a failure would never reach the network. What is being tested is
// that a failed read is not remembered as a result, so it has to be a read that has
// not succeeded yet.
globalThis.offline = true
let threw = false
try { await mod.getSessions() } catch { threw = true }
chk('the failure surfaces', threw)

let threwAgain = false
try { await mod.getSessions() } catch { threwAgain = true }
chk('and it is tried again rather than remembered', threwAgain)
globalThis.offline = false

console.log('FAILURES=' + bad)
`

rmSync(harness, { force: true })
writeFileSync(harness, HARNESS)

const q = s => (/\s/.test(s) ? `"${s}"` : s)
const b = spawnSync(
  'npx',
  ['--yes', 'esbuild', q(harness), '--bundle', '--platform=node', '--format=esm',
    '--packages=external', `--outfile=${q(harness + '.bundle.mjs')}`, '--log-level=error'],
  { cwd: root, encoding: 'utf8', shell: true },
)
if (b.status !== 0) { console.error(b.stderr); rmSync(harness, { force: true }); process.exit(1) }

console.log('The read cache\n')
const run = spawnSync(process.execPath, [harness + '.bundle.mjs'], { cwd: root, encoding: 'utf8' })
process.stdout.write(run.stdout || '')
if (run.stderr) process.stdout.write('\n' + run.stderr.split('\n').slice(0, 10).join('\n'))
rmSync(harness, { force: true })
rmSync(harness + '.bundle.mjs', { force: true })

const m = (run.stdout || '').match(/FAILURES=(\d+)/)
const clean = m && Number(m[1]) === 0
console.log(clean ? '\nThe app asks once.' : '\nFAILED.')
process.exit(clean ? 0 : 1)
