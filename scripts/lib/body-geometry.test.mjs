// src/lib/body-geometry.js is generated from openGym's body-paths.js. This checks that the
// generated file actually covers everything the Stats page will ask it to draw.
//
// It exists because the generator silently produced a file missing three regions when the
// upstream key names were guessed wrong (`lats` and `glutes` instead of `upper-back`,
// `gluteal` and `hamstring`). Nothing downstream complained: BodyMap renders whatever
// paths it finds, so a region with no geometry just never appears — the map would have
// quietly lost upper back, glutes and hamstrings, and every check would still pass.
//
//   node scripts/lib/body-geometry.test.mjs

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { writeFileSync, rmSync } from 'node:fs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const harness = `${root}scripts/lib/.geometry-harness.mjs`

const HARNESS = `
import { REGIONS } from '../../src/lib/muscles.js'
import GEOMETRY from '../../src/lib/body-geometry.js'

const front = GEOMETRY.front.p
const back = GEOMETRY.back.p
let bad = 0
const chk = (label, ok, detail) => {
  if (!ok) bad++
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  ' + detail : ''))
}

// A region with no geometry simply never renders, so the map would quietly lose it.
const noPaths = REGIONS.filter(r => !(front[r] || []).length && !(back[r] || []).length)
chk('every region has geometry on at least one view', noPaths.length === 0, noPaths.join(', '))

const all = [...Object.values(front).flat(), ...Object.values(back).flat()]
const malformed = all.filter(d => typeof d !== 'string' || d.length < 10 || !/^[Mm]/.test(d))
chk('every path is a valid SVG path string', malformed.length === 0, all.length + ' paths')

chk('front silhouette present', GEOMETRY.front.inert.length > 0, String(GEOMETRY.front.inert.length) + ' parts')
chk('back silhouette present', GEOMETRY.back.inert.length > 0, String(GEOMETRY.back.inert.length) + ' parts')
chk('viewBoxes present', Boolean(GEOMETRY.front.vb && GEOMETRY.back.vb), GEOMETRY.front.vb + ' | ' + GEOMETRY.back.vb)

// Only regions this app reports may ship: the upstream file carries 21 muscles and
// carrying the unused ones would push ~60 KB of dead geometry to every visitor.
const stray = [...Object.keys(front), ...Object.keys(back)].filter(k => !REGIONS.includes(k))
chk('no regions this app does not report are shipped', stray.length === 0, stray.join(', '))

console.log('FAILURES=' + bad)
`

writeFileSync(harness, HARNESS)
const q = s => (/\s/.test(s) ? `"${s}"` : s)
const b = spawnSync(
  'npx',
  ['--yes', 'esbuild', q(harness), '--bundle', '--platform=node', '--format=esm',
    '--packages=external', `--outfile=${q(harness + '.bundle.mjs')}`, '--log-level=error'],
  { cwd: root, encoding: 'utf8', shell: true },
)
if (b.status !== 0) { console.error(b.stderr); rmSync(harness, { force: true }); process.exit(1) }

console.log('Body geometry coverage\n')
const run = spawnSync(process.execPath, [harness + '.bundle.mjs'], { encoding: 'utf8' })
process.stdout.write(run.stdout || '')
rmSync(harness, { force: true })
rmSync(harness + '.bundle.mjs', { force: true })

const m = (run.stdout || '').match(/FAILURES=(\d+)/)
const clean = m && Number(m[1]) === 0
console.log(clean ? '\nGeometry covers every region.' : '\nFAILED.')
process.exit(clean ? 0 : 1)
