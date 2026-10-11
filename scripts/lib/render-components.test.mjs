// Renders every component on the Stats page and fails on any React error.
//
// This exists because a <title> element was given several children instead of one
// interpolated string. React treats that as a fatal render error, not a warning — the
// whole page went blank in production while lint, the build, and every other check passed.
// Nothing else in the suites executes a component, so nothing noticed.
//
//   node scripts/lib/render-components.test.mjs
//
// The JSX is transformed with esbuild via npx (nothing added to package.json); React and
// react-dom resolve from node_modules at run time. Requires network the first time.

import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const harness = `${root}scripts/lib/.render-harness.mjs`
const bundle = `${root}scripts/lib/.render-harness.bundle.mjs`

const HARNESS = `
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import StatCards from '../../src/components/StatCards.jsx'
import ActivityHeatmap from '../../src/components/ActivityHeatmap.jsx'
import MuscleBalance from '../../src/components/MuscleBalance.jsx'

const exercises = [
  { id: '9', name: 'Bicep Curl', muscle_group: 'Arms' },
  { id: '8', name: 'Tricep Extension', muscle_group: 'Arms' },
  { id: '1', name: 'Dumbbell Flat Bench', muscle_group: 'Chest' },
  { id: '4', name: 'Lat Pull Down', muscle_group: 'Back' },
  { id: '7', name: 'Cable Lateral Raise', muscle_group: 'Shoulders' },
  { id: '3287', name: 'Elbow dips', muscle_group: 'Upper arms' },
]
const perDay = [
  ['2026-09-04', 11], ['2026-09-09', 13], ['2026-09-16', 11], ['2026-09-19', 10], ['2026-09-21', 13],
  ['2026-09-21', 9], ['2026-09-23', 12], ['2026-09-25', 17], ['2026-09-26', 5], ['2026-09-28', 13],
  ['2026-09-30', 21], ['2026-10-02', 18], ['2026-10-05', 18], ['2026-10-07', 17], ['2026-10-09', 18],
]
const sessions = perDay.map(([date, sets], i) => ({
  id: 's' + i, date,
  exercise_logs: [{
    id: 'l' + i, exercise_id: exercises[i % exercises.length].id,
    set_entries: Array.from({ length: sets }, (_, j) => ({ id: 'x' + i + j, weight: 60, reps: 8 })),
  }],
}))

const cases = [
  ['StatCards', () => createElement(StatCards, { sessions })],
  ['ActivityHeatmap', () => createElement(ActivityHeatmap, { sessions })],
  ['MuscleBalance', () => createElement(MuscleBalance, { sessions, exercises })],
  ['all three together', () => createElement('div', null,
    createElement(StatCards, { sessions }),
    createElement(ActivityHeatmap, { sessions }),
    createElement(MuscleBalance, { sessions, exercises }))],
  ['StatCards, no sessions', () => createElement(StatCards, { sessions: [] })],
  ['ActivityHeatmap, no sessions', () => createElement(ActivityHeatmap, { sessions: [] })],
  ['MuscleBalance, no sessions', () => createElement(MuscleBalance, { sessions: [], exercises: [] })],
  ['MuscleBalance, exercises undefined', () => createElement(MuscleBalance, { sessions, exercises: undefined })],
]

let failed = 0
for (const [label, build] of cases) {
  let html = ''
  try {
    html = renderToString(build())
  } catch (e) {
    failed++
    console.log('  FAIL  ' + label + '  threw: ' + e.message)
    continue
  }
  if (!html || html.length < 500) {
    failed++
    console.log('  FAIL  ' + label + '  rendered only ' + html.length + ' chars')
    continue
  }
  console.log('  PASS  ' + label.padEnd(36) + html.length + ' chars')
}
console.log('FAILURES=' + failed)
`

rmSync(harness, { force: true })
rmSync(bundle, { force: true })
writeFileSync(harness, HARNESS)

// The repo path contains a space ("vibe coding"), so every argument is quoted by hand and
// the command run without a shell. Going through a shell splits the paths into two inputs
// and esbuild then complains about multiple entry points.
const q = s => (/\s/.test(s) ? `"${s}"` : s)
const esbuild = spawnSync(
  'npx',
  ['--yes', 'esbuild', q(harness), '--bundle', '--platform=node', '--format=esm',
    '--packages=external', `--outfile=${q(bundle)}`, '--loader:.js=jsx', '--jsx=automatic',
    '--log-level=error'],
  { cwd: root, encoding: 'utf8', shell: true },
)

if (esbuild.error || esbuild.status !== 0) {
  console.error('Could not transform the JSX. Is esbuild reachable via npx?')
  if (esbuild.stderr) console.error(esbuild.stderr)
  rmSync(harness, { force: true })
  process.exit(1)
}

console.log('Component render check\n')
const run = spawnSync(process.execPath, [bundle], { encoding: 'utf8' })
process.stdout.write(run.stdout || '')

// React reports fatal render complaints on stderr. A clean run must produce none at all,
// which is why stderr counts toward the result rather than just being printed.
const stderr = (run.stderr || '').trim()
if (stderr) {
  console.log('\nReact reported errors:\n' + stderr)
}
rmSync(harness, { force: true })
rmSync(bundle, { force: true })

const m = (run.stdout || '').match(/FAILURES=(\d+)/)
const failures = m ? Number(m[1]) : 1
const clean = failures === 0 && !stderr
console.log(clean ? '\nAll components rendered without React errors.' : '\nFAILED.')
process.exit(clean ? 0 : 1)
