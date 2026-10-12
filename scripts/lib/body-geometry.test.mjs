// Checks that src/lib/body-geometry.js is openGym's male figure, copied whole.
//
//   node scripts/lib/body-geometry.test.mjs
//
// This exists because the geometry is third-party artwork that the page depends on being
// correct. Three separate failures were caught by assertions of this kind while building
// it:
//
//   1. The generator guessed three upstream key names wrong (lats, glutes, hamstrings)
//      and produced a file missing upper back, glutes and hamstrings. BodyMap renders
//      whatever paths it finds, so those regions would have silently vanished.
//   2. An earlier filtered build dropped 9 of 21 front regions for no stated reason.
//   3. A region with no path renders as nothing, which reads as a data bug rather than a
//      missing shape.
//
// The upstream source is not vendored into this repo, so the equality check runs against a
// copy when one is available and is skipped otherwise. Everything else runs unconditionally.

import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const harness = `${root}scripts/lib/.geometry-harness.mjs`

// Optional: an openGym checkout, for the verbatim comparison. Not required.
const UPSTREAM = process.env.OPEN_GYM_BODY_PATHS

const HARNESS = `
import GEOMETRY from '../../src/lib/body-geometry.js'
import { REGIONS, RENDER_REGIONS, RENDER_KEY, RENDER_LABEL } from '../../src/lib/muscles.js'

let bad = 0
const chk = (label, ok, detail) => {
  if (!ok) bad++
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  ' + detail : ''))
}

const views = [GEOMETRY.front, GEOMETRY.back].filter(Boolean)
chk('both views present', views.length === 2, views.length + ' views')
chk('viewBoxes present', Boolean(GEOMETRY.front && GEOMETRY.front.vb && GEOMETRY.back && GEOMETRY.back.vb))

// Every region the artwork can draw, gathered across both views.
const artworkRegions = new Set()
let pathCount = 0
for (const view of views) {
  for (const [key, list] of Object.entries(view.p || {})) {
    artworkRegions.add(key)
    pathCount += list.length
  }
}
chk('artwork carries regions', artworkRegions.size > 0, artworkRegions.size + ' regions, ' + pathCount + ' paths')

// Every path must be a real SVG path string.
const allPaths = views.flatMap(v => Object.values(v.p || {}).flat())
const malformed = allPaths.filter(d => typeof d !== 'string' || d.length < 10 || !/^[Mm]/.test(d))
chk('every path is a valid SVG path string', malformed.length === 0, allPaths.length + ' paths checked')

// Every muscle this app draws must exist in the artwork, or it silently renders as nothing.
const missingGeometry = RENDER_REGIONS.filter(r => !artworkRegions.has(r))
chk('every render region has geometry somewhere', missingGeometry.length === 0, missingGeometry.join(', '))

// The attribution set must map onto real artwork keys, and must stay a subset of what is
// drawn. A region in REGIONS with no RENDER_KEY entry would never receive its sets.
const unmapped = REGIONS.filter(r => !RENDER_KEY[r])
chk('every attributed region maps to an artwork key', unmapped.length === 0, unmapped.join(', '))
const mappedNowhere = Object.values(RENDER_KEY).filter(k => !artworkRegions.has(k))
chk('every RENDER_KEY target exists in the artwork', mappedNowhere.length === 0, mappedNowhere.join(', '))

// The split the two lists exist for: attribution is a strict subset of what is drawn.
const notDrawn = REGIONS.filter(r => !RENDER_REGIONS.includes(RENDER_KEY[r]))
chk('attributed regions are all drawable', notDrawn.length === 0, notDrawn.join(', '))
chk('drawing more regions than we attribute', RENDER_REGIONS.length > REGIONS.length,
  RENDER_REGIONS.length + ' drawn vs ' + REGIONS.length + ' attributed')

// Every drawn region needs a tooltip, or it shows a raw key on hover.
const unlabelled = RENDER_REGIONS.filter(r => !RENDER_LABEL[r])
chk('every render region has a label', unlabelled.length === 0, unlabelled.join(', '))

console.log('FAILURES=' + bad)
`

rmSync(harness, { force: true })
rmSync(harness + '.bundle.mjs', { force: true })
writeFileSync(harness, HARNESS)

const q = s => (/\s/.test(s) ? `"${s}"` : s)
const esbuild = spawnSync(
  'npx',
  ['--yes', 'esbuild', q(harness), '--bundle', '--platform=node', '--format=esm',
    '--packages=external', `--outfile=${q(harness + '.bundle.mjs')}`, '--log-level=error'],
  { cwd: root, encoding: 'utf8', shell: true },
)
if (esbuild.error || esbuild.status !== 0) {
  console.error('Could not build the harness. Is esbuild reachable via npx?')
  if (esbuild.stderr) console.error(esbuild.stderr)
  rmSync(harness, { force: true })
  process.exit(1)
}

console.log('Body geometry\n')
const run = spawnSync(process.execPath, [harness + '.bundle.mjs'], { encoding: 'utf8' })
process.stdout.write(run.stdout || '')

// Verbatim comparison, when an openGym checkout is supplied. This is the assertion that
// makes "copied whole, unfiltered" a checked fact rather than a claim.
if (UPSTREAM && existsSync(UPSTREAM)) {
  const compare = spawnSync(
    process.execPath,
    ['-e', `
      const fs = require('fs')
      const up = JSON.parse(fs.readFileSync(process.argv[1], 'utf8').match(/\\{[\\s\\S]*\\}/)[0])
      const mine = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').match(/export default ([\\s\\S]*)\\s*$/)[1])
      // The generator writes male's contents at the top level.
      const same = JSON.stringify(mine) === JSON.stringify(up.male)
      console.log(same ? '  PASS  byte-for-byte identical to upstream male' : '  FAIL  differs from upstream male')
      process.exit(same ? 0 : 1)
    `, UPSTREAM, `${root}src/lib/body-geometry.js`],
    { encoding: 'utf8' },
  )
  process.stdout.write(compare.stdout || '')
  if (compare.status !== 0) {
    console.error('  FAIL  geometry is not a verbatim copy of upstream')
    rmSync(harness, { force: true })
    rmSync(harness + '.bundle.mjs', { force: true })
    process.exit(1)
  }
} else {
  console.log('  SKIP  upstream comparison (set OPEN_GYM_BODY_PATHS to enable)')
}

rmSync(harness, { force: true })
rmSync(harness + '.bundle.mjs', { force: true })

const m = (run.stdout || '').match(/FAILURES=(\d+)/)
const clean = m && Number(m[1]) === 0
console.log(clean ? '\nGeometry is sound.' : '\nFAILED.')
process.exit(clean ? 0 : 1)
