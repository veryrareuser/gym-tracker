// Asserts that an in-progress workout cannot be counted anywhere.
//
//   node scripts/lib/draft-isolation.test.mjs
//
// Autosave writes a real row in public.workout_sessions, its logs in exercise_logs and its
// sets in set_entries. Only an `is_draft` flag separates it from a finished workout, so
// every surface that aggregates those tables has to honour the flag. This checks the
// places that can silently regress:
//
//   - the client read that feeds history, stats, the heatmap and the streak
//   - the SQL both SECURITY DEFINER functions use, which bypass the client entirely
//   - the cache the client falls back to when the network is unavailable
//
// The server-side half is duplicated in SQL because it is the half that cannot be checked
// from here: a draft leaking onto a public leaderboard is a privacy bug, not a display one.

import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const harness = `${root}scripts/lib/.draft-harness.mjs`

// Built as an array of lines and joined, not a template literal. Inside a template
// literal the ${...} in the check descriptions would be interpolated by THIS file, and the
// harness would throw before printing anything — which is exactly what happened.
const HARNESS = [
  "import { readFileSync } from 'node:fs'",
  "const db = readFileSync('src/lib/db.js', 'utf8')",
  "const page = readFileSync('src/pages/LogWorkout.jsx', 'utf8')",
  "const autosave = readFileSync('src/lib/useAutosave.js', 'utf8')",
  "const aggregates = readFileSync('sql/secure-aggregates.sql', 'utf8')",
  '',
  'let bad = 0',
  'const chk = (label, ok, detail) => {',
  '  if (!ok) bad++',
  "  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  ' + detail : ''))",
  '}',
  'const has = (hay, needle) => hay.includes(needle)',
  'const count = (hay, needle) => hay.split(needle).length - 1',
  '// True when the sessions cache is written inside the draft guard rather than after it.',
  'const guard = () => {',
  "  const start = db.indexOf('if (!draft) {')",
  "  const end = db.indexOf(\"localSet('sessions'\")",
  '  return start >= 0 && end > start && end - start < 400',
  '}',
  '',
  '// --- the one place the client filters ---------------------------------------',
  'chk("cloud read excludes drafts", has(db, ".eq(\'is_draft\', false)"))',
  "chk('local fallback excludes drafts', has(db, '.filter(s => !s.is_draft)'))",
  '',
  '// A draft must never enter the cache that history and stats read offline.',
  "chk('draft saves skip the session cache', has(db, 'if (!draft) {'))",
  '// The session-cache write must sit inside that guard. Scoped to the sessions cache',
  '// specifically: db.js also caches exercises, where the practice does not apply.',
  "chk('session cache write is inside the draft guard', guard) ,",
  "  guard()",
  '',
  '// --- the draft lifecycle ---------------------------------------------------',
  "chk('drafts are written with the flag', has(db, 'is_draft: draft'))",
  'chk(' + "'saving a draft replaces the previous one'" + ', has(db, ' + '"' + '.delete().eq(\'is_draft\', true)' + '"' + '))',
  "chk('discard is scoped to drafts', has(db, 'discard draft'))",
  '',
  '// --- the client promotes rather than copying -------------------------------',
  "chk('Save writes a non-draft', has(page, 'saveSession(session, { draft: false })'))",
  '',
  '// --- autosave --------------------------------------------------------------',
  "chk('autosave saves as a draft', has(autosave, 'draft: true'))",
  "chk('autosave waits for typing to stop', has(autosave, 'DEBOUNCE_MS'))",
  "chk('autosave fires when the app is backgrounded', has(autosave, 'visibilitychange'))",
  "chk('autosave fires on page hide', has(autosave, 'pagehide'))",
  "chk('autosave skips an empty workout', has(autosave, 'hasContent'))",
  "chk('autosave failures are recorded, not thrown', has(autosave, \"setState('failed')\"))",
  '// The chip must not claim success while the request is in flight. Showing "Saved"',
  '// during the attempt is what hid the original failure, so this asserts the three',
  '// states are distinct rather than a boolean that is true for both.',
  "chk('saving and saved are distinct states', has(autosave, \"setState('saving')\") && has(autosave, \"setState('saved')\"))",
  '',
  '// --- the aggregates, which bypass the client entirely -----------------------',
  "chk('leaderboard filters drafts', has(aggregates, 'not coalesce(w.is_draft, false)'))",
  "chk('friend PRs filter drafts', has(aggregates, 'not coalesce(s.is_draft, false)'))",
  '// monthly, lifetime and best each need their own predicate; one is not enough.',
  "chk('every leaderboard aggregate filters', count(aggregates, 'not coalesce(w.is_draft, false)') === 3,",
  "  count(aggregates, 'not coalesce(w.is_draft, false)') + ' of 3')",
  '',
  "console.log('FAILURES=' + bad)",
].join('\n')

rmSync(harness, { force: true })
rmSync(harness + '.bundle.mjs', { force: true })
writeFileSync(harness, HARNESS)

const q = s => (/\s/.test(s) ? `"${s}"` : s)
const b = spawnSync(
  'npx',
  ['--yes', 'esbuild', q(harness), '--bundle', '--platform=node', '--format=esm',
    '--packages=external', `--outfile=${q(harness + '.bundle.mjs')}`, '--log-level=error'],
  { cwd: root, encoding: 'utf8', shell: true },
)
if (b.status !== 0) { console.error(b.stderr); rmSync(harness, { force: true }); process.exit(1) }

console.log('Draft isolation\n')
const run = spawnSync(process.execPath, [harness + '.bundle.mjs'], { cwd: root, encoding: 'utf8' })
process.stdout.write(run.stdout || '')
rmSync(harness, { force: true })
rmSync(harness + '.bundle.mjs', { force: true })

const m = (run.stdout || '').match(/FAILURES=(\d+)/)
const clean = m && Number(m[1]) === 0
console.log(clean ? '\nA draft cannot be counted anywhere.' : '\nFAILED.')
process.exit(clean ? 0 : 1)
