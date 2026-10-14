// Exercises the autosave decision logic and the debounce wiring.
//
//   node scripts/lib/autosave-behaviour.test.mjs
//
// Symptom: a workout is logged, the "Saved" chip appears, the app is closed, and on return
// the log page is empty — with no draft row in the database. So flush either never fires
// with content, or fires and throws.
//
// There is no DOM library in this project and React's renderer refuses a fake one, so this
// tests the two halves separately: the guard that decides whether a save is warranted, and
// the wiring that decides when. Both have silently no-opped before.

import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const harness = `${root}scripts/lib/.autosave-harness.mjs`

const HARNESS = [
  "import { readFileSync } from 'node:fs'",
  '',
  'const src = readFileSync("src/lib/useAutosave.js", "utf8")',
  'const page = readFileSync("src/pages/LogWorkout.jsx", "utf8")',
  '',
  'let bad = 0',
  'const chk = (label, ok, detail) => {',
  '  if (!ok) bad++',
  "  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  ' + detail : ''))",
  '}',
  'const has = (hay, needle) => hay.includes(needle)',
  '',
  '// The guard, reproduced exactly as the hook writes it.',
  'const guard = current =>',
  '  current.exercise_logs.some(l => l.set_entries.some(s => s.weight || s.reps)) ||',
  "  (current.notes || '').trim().length > 0",
  '',
  'const set = (weight, reps) => ({ id: "s1", weight, reps, exercise_log_id: "l1" })',
  'const log = (...sets) => ({ id: "l1", exercise_id: "1", order: 0, set_entries: sets })',
  'const sess = (logs, notes) => ({ id: "s", date: "2026-10-14", notes, exercise_logs: logs })',
  '',
  'console.log("--- the guard ---")',
  'chk("weight and reps is content", guard(sess([log(set("60", "8"))], "")))',
  'chk("a note alone is content", guard(sess([], "felt strong")))',
  'chk("placeholder sets are not content", !guard(sess([log(set("", ""))], "")))',
  'chk("a zero-weight set is content", guard(sess([log(set("0", "10"))], "")), "0 is falsy in JS but the field is filled")',
  'chk("a blank workout is not content", !guard(sess([], "")))',
  'chk("no logs at all is not content", !guard({ id: "s", date: "d", notes: "  ", exercise_logs: [] }))',
  '',
  '// A string weight is what the inputs produce, so this is the real shape.',
  'chk("string weights are handled", guard(sess([log(set("100", ""))], "")), "weight only")',
  '',
  'console.log("")',
  'console.log("--- the wiring ---")',
  'chk("the guard is the one above", has(src, "current.exercise_logs.some(l => l.set_entries.some(s => s.weight || s.reps))"))',
  'chk("flush writes a draft", has(src, "saveSession(current, { draft: true })"))',
  'chk("debounce is armed on every edit", has(src, "if (enabled && session) schedule()"))',
  'chk("backgrounding flushes", has(src, "visibilitychange"))',
  'chk("pagehide flushes", has(src, "pagehide"))',
  '',
  '// THE ORDERING QUESTION.',
  '// flush() reads sessionRef.current, and sessionRef is written in an effect. If the',
  '// scheduling effect ran first, the timer would fire against the PREVIOUS session —',
  '// which is still a valid workout, so it would save stale data rather than none.',
  'const refEffect = src.indexOf("sessionRef.current = session")',
  'const scheduleEffect = src.indexOf("if (enabled && session) schedule()")',
  'chk("the ref is updated before the debounce is armed",',
  '  refEffect >= 0 && scheduleEffect >= 0 && refEffect < scheduleEffect,',
  '  refEffect + " < " + scheduleEffect)',
  '',
  'console.log("")',
  'console.log("--- the component ---")',
  'chk("autosave is enabled for a new workout", has(page, "useAutosave(autosaveSession, { enabled: !isEditMode })"))',
  'chk("autosaveSession carries the logs", has(page, "exercise_logs: logs")),',
  '',
  "console.log('FAILURES=' + bad)",
].join('\n')

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

console.log('Autosave behaviour\n')
const run = spawnSync(process.execPath, [harness + '.bundle.mjs'], { cwd: root, encoding: 'utf8' })
process.stdout.write(run.stdout || '')
if (run.stderr) process.stdout.write('\n' + run.stderr.split('\n').slice(0, 8).join('\n'))
rmSync(harness, { force: true })
rmSync(harness + '.bundle.mjs', { force: true })

const m = (run.stdout || '').match(/FAILURES=(\d+)/)
const clean = m && Number(m[1]) === 0
console.log(clean ? '\nAutosave decides correctly.' : '\nFAILED.')
process.exit(clean ? 0 : 1)
