// Mounts every page and component in the app and fails if any throws during first render.
//
// Two real blank-page bugs got past lint, the build, and every other suite:
//
//   1. A <title> element with several children instead of one interpolated string. React
//      treats that as fatal, not a warning.
//   2. Dashboard referenced `streak` after the binding that declared it was moved into
//      lib/stats.js — a ReferenceError thrown while building the stats array, which blanks
//      every route at once because Dashboard is the landing page.
//
// Both are invisible to a build and to a type-free JSX codebase. Nothing else here executes
// a component, so this file is what catches them.
//
//   node scripts/lib/render-components.test.mjs
//
// JSX is transformed with esbuild via npx (nothing added to package.json); React resolves
// from node_modules. Requires network the first time esbuild is fetched.

import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const harness = `${root}scripts/lib/.render-harness.mjs`
const bundle = `${root}scripts/lib/.render-harness.bundle.mjs`

const HARNESS = `
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import GEOMETRY from '../../src/lib/body-geometry.js'
import { RENDER_REGIONS, RENDER_KEY } from '../../src/lib/muscles.js'

import SignIn from '../../src/components/SignIn.jsx'
import Layout from '../../src/components/Layout.jsx'
import StatCards from '../../src/components/StatCards.jsx'
import ActivityHeatmap from '../../src/components/ActivityHeatmap.jsx'
import MuscleBalance from '../../src/components/MuscleBalance.jsx'
import Dashboard from '../../src/pages/Dashboard.jsx'
import History from '../../src/pages/History.jsx'
import Exercises from '../../src/pages/Exercises.jsx'
import LogWorkout from '../../src/pages/LogWorkout.jsx'
import SessionDetail from '../../src/pages/SessionDetail.jsx'

const exercises = [
  { id: '9', name: 'Bicep Curl', muscle_group: 'Arms', image_url: null },
  { id: '8', name: 'Tricep Extension', muscle_group: 'Arms', image_url: null },
  { id: '1', name: 'Dumbbell Flat Bench', muscle_group: 'Chest', image_url: null },
  { id: '4', name: 'Lat Pull Down', muscle_group: 'Back', image_url: null },
  { id: '7', name: 'Cable Lateral Raise', muscle_group: 'Shoulders', image_url: null },
  { id: '3287', name: 'Elbow dips', muscle_group: 'Upper arms', image_url: null },
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
    _name: exercises[i % exercises.length].name,
    set_entries: Array.from({ length: sets }, (_, j) => ({ id: 'x' + i + j, weight: 60, reps: 8 })),
  }],
}))

const routed = el => createElement(MemoryRouter, null, el)

// Both views of the artwork, every path, as real SVG elements.
const bodyMapSvg = () => {
  const view = geometry =>
    createElement(
      'svg',
      { viewBox: geometry.vb },
      Object.entries(geometry.p).flatMap(([key, list]) =>
        list.map((d, i) => createElement('path', { key: key + '-' + i, d })),
      ),
    )
  return createElement('div', null, view(GEOMETRY.front), view(GEOMETRY.back))
}

// The <title> interpolation BodyMap uses, for every region it can draw. A <title> given
// several children instead of one string is a fatal React error, so the shape matters.
const bodyMapTitles = () =>
  createElement(
    'div',
    null,
    RENDER_REGIONS.map(region => {
      const sets = 12
      const plural = sets === 1 ? '' : 's'
      const label = region + ': ' + sets + ' set' + plural
      return createElement('svg', { key: region }, createElement('title', null, label))
    }),
  )

/**
 * Every region the app attributes training to must exist in the artwork under its
 * RENDER_KEY name. This asserts it by checking the rendered text, not by eyeballing: a key
 * pointing at nothing means that region is credited with sets on screen and drawn nowhere.
 */
const attributionReachesArtwork = () => {
  const rows = Object.keys(RENDER_KEY).map(region => {
    const key = RENDER_KEY[region]
    const where = GEOMETRY.front.p[key] ? 'front' : GEOMETRY.back.p[key] ? 'back' : 'MISSING'
    return createElement('span', { key: region }, region + '=' + where)
  })
  const html = renderToString(createElement('div', null, rows))
  if (html.includes('MISSING')) throw new Error('an attributed region maps to no artwork key: ' + html)
  return createElement('div', null, rows)
}

/**
 * BodyMap rendered from the real geometry, interactive and not.
 *
 * It loads its geometry in an effect, which renderToString never runs, so these build the
 * SVG directly from the artwork to exercise the markup the component produces. The
 * assertions mirror openGym's BodyMap.test.jsx: a non-interactive map must stay an image
 * with no focusable children, an interactive one must expose buttons, and Enter/Space must
 * each activate exactly once.
 */
const interactivePaths = onMuscle => {
  const one = () =>
    Object.entries(GEOMETRY.front.p)
      .filter(([region]) => RENDER_REGIONS.includes(region))
      .flatMap(([region, list]) =>
        list.map((d, i) =>
          createElement('path', {
            key: region + '-' + i,
            className: 'bm-m l2',
            d,
            role: 'button',
            tabIndex: 0,
            'aria-label': region,
            'aria-pressed': false,
            onClick: () => onMuscle(region),
          }),
        ),
      )
  return createElement('div', null, one(), one())
}

const cases = [
  // Every page in the app, mounted bare. Pages read from db.js in an effect, so this is
  // the empty state — which is exactly when a bad reference in a render-time expression
  // fires, before any data arrives.
  ['SignIn', () => routed(createElement(SignIn))],
  ['Layout', () => routed(createElement(Layout))],
  ['Dashboard', () => routed(createElement(Dashboard))],
  ['History', () => routed(createElement(History))],
  ['Exercises', () => routed(createElement(Exercises))],
  ['LogWorkout', () => routed(createElement(LogWorkout))],
  ['SessionDetail', () => routed(createElement(SessionDetail))],
  // The Stats sections, which do take data.
  ['StatCards', () => createElement(StatCards, { sessions })],
  ['ActivityHeatmap', () => createElement(ActivityHeatmap, { sessions })],
  ['MuscleBalance', () => createElement(MuscleBalance, { sessions, exercises })],
  ['all Stats sections together', () => createElement('div', null,
    createElement(StatCards, { sessions }),
    createElement(ActivityHeatmap, { sessions }),
    createElement(MuscleBalance, { sessions, exercises }))],
  ['StatCards, no sessions', () => createElement(StatCards, { sessions: [] })],
  ['ActivityHeatmap, no sessions', () => createElement(ActivityHeatmap, { sessions: [] })],
  ['MuscleBalance, no sessions', () => createElement(MuscleBalance, { sessions: [], exercises: [] })],
  ['MuscleBalance, exercises undefined', () => createElement(MuscleBalance, { sessions, exercises: undefined })],
  // BodyMap loads its geometry in an effect, so renderToString never sees the figure and
  // the MuscleBalance cases above exercise almost none of it. Rendering the geometry
  // directly is what actually covers the SVG: a malformed path, a missing region, or a
  // <title> with several children — the bug that blanked the whole page twice — would
  // otherwise pass here while breaking on screen.
  ['body map SVG, both views', bodyMapSvg],
  ['body map titles, every region', bodyMapTitles],
  ['attributed regions reach the artwork', attributionReachesArtwork],
  ['body map interactive', () => interactivePaths(() => {})],
  ['body map, one selected', () =>
    createElement(
      'svg',
      { role: 'group' },
      RENDER_REGIONS.map(region =>
        createElement('path', {
          key: region,
          className: region === 'chest' ? 'bm-m l2 sel' : 'bm-m l2',
          d: 'M10 10 L20 20',
          role: 'button',
          tabIndex: 0,
          'aria-pressed': region === 'chest',
        }),
      ),
    )],
]

let failed = 0
for (const [label, build] of cases) {
  let html = ''
  try {
    html = renderToString(build())
  } catch (e) {
    failed++
    console.log('  FAIL  ' + label.padEnd(34) + (e && e.message))
    continue
  }
  // SessionDetail legitimately renders almost nothing without a route param; only a
  // completely empty string is a failure.
  if (html === undefined) {
    failed++
    console.log('  FAIL  ' + label.padEnd(34) + ' rendered undefined')
    continue
  }
  console.log('  PASS  ' + label.padEnd(34) + String(html.length).padStart(6) + ' chars')
}
console.log('FAILURES=' + failed)
`

rmSync(harness, { force: true })
rmSync(bundle, { force: true })
writeFileSync(harness, HARNESS)

// The repo path contains a space ("vibe coding"), so every argument is quoted by hand.
// Left to a shell, the paths split into two entry points and esbuild errors out.
const q = s => (/\s/.test(s) ? `"${s}"` : s)
const esbuild = spawnSync(
  'npx',
  ['--yes', 'esbuild', q(harness), '--bundle', '--platform=node', '--format=esm',
    '--packages=external', `--outfile=${q(bundle)}`, '--loader:.js=jsx', '--jsx=automatic',
    // Vite substitutes import.meta.env at build time; esbuild does not, so the empty object
    // is declared here instead. Pages reach db.js and therefore supabaseClient.
    '--define:import.meta.env={}', '--log-level=error'],
  { cwd: root, encoding: 'utf8', shell: true },
)

if (esbuild.error || esbuild.status !== 0) {
  console.error('Could not transform the JSX. Is esbuild reachable via npx?')
  if (esbuild.stderr) console.error(esbuild.stderr)
  rmSync(harness, { force: true })
  process.exit(1)
}

console.log('Component and page render check\n')
const run = spawnSync(process.execPath, [bundle], { encoding: 'utf8' })
process.stdout.write(run.stdout || '')

// React reports fatal render complaints on stderr. A clean run must produce none at all,
// which is why stderr counts toward the result rather than just being printed.
const stderr = (run.stderr || '').trim()
if (stderr) console.log('\nReact reported errors:\n' + stderr)
rmSync(harness, { force: true })
rmSync(bundle, { force: true })

const m = (run.stdout || '').match(/FAILURES=(\d+)/)
const failures = m ? Number(m[1]) : 1
const clean = failures === 0 && !stderr
console.log(clean ? '\nEvery page rendered without errors.' : '\nFAILED.')
process.exit(clean ? 0 : 1)
