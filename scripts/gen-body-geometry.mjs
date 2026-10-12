// Regenerates src/lib/body-geometry.js from openGym's body-paths.js.
//
//   node scripts/gen-body-geometry.mjs <path-to-openGym>/frontend/src/lib/body-paths.js
//
// The `male` figure is copied whole — every region, every path, both views. Nothing is
// filtered, so this file is byte-for-byte what openGym ships for that body. `scripts/lib/
// body-geometry.test.mjs` asserts exactly that, which is what makes "verbatim" checkable
// rather than a claim.
//
// The female figure is deliberately not included: it would nearly double the payload to
// ~93 KB and the app has no setting to choose it.
//
// Upstream geometry is derived from MuscleMap by Melih Colpan under the MIT License.
// See NOTICE-THIRD-PARTY.md.

import { readFileSync, writeFileSync } from 'node:fs'

const src = process.argv[2]
if (!src) {
  console.error('Usage: node scripts/gen-body-geometry.mjs <path-to-body-paths.js>')
  process.exit(1)
}

const raw = readFileSync(src, 'utf8')
const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)[0])

if (!parsed.male) {
  console.error('No "male" body in that file. Expected openGym body-paths.js shape.')
  process.exit(1)
}

// Copied whole, not rebuilt: preserving key order and path order keeps the output
// comparable against upstream, which the equality check in the test depends on.
const male = parsed.male

const header = `// Body diagram geometry — GENERATED, do not edit by hand.
//
// Regenerate with:
//   node scripts/gen-body-geometry.mjs <openGym>/frontend/src/lib/body-paths.js
//
// The \`male\` figure from openGym (DuarteSantos8/openGym), copied whole: both views,
// every region, every path. Upstream geometry derives from MuscleMap by Melih Colpan and
// is MIT licensed; openGym's own code is AGPL v3.0 and none of it is reproduced here.
// See NOTICE-THIRD-PARTY.md.
//
// ${countPaths(male)} paths across ${countRegions(male)} regions.
export default ${JSON.stringify(male)}
`

writeFileSync('src/lib/body-geometry.js', header, 'utf8')

function countRegions(body) {
  const set = new Set()
  for (const view of Object.values(body)) {
    for (const key of Object.keys(view.p)) set.add(key)
  }
  return set.size
}

function countPaths(body) {
  let n = 0
  for (const view of Object.values(body)) {
    for (const paths of Object.values(view.p)) n += paths.length
  }
  return n
}

console.log(`wrote src/lib/body-geometry.js`)
console.log(`  regions: ${countRegions(male)}`)
console.log(`  paths:   ${countPaths(male)}`)
console.log(`  bytes:   ${Buffer.byteLength(header)}`)
