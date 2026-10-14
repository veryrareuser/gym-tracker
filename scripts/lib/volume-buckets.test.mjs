// Tests the volume chart's bucketing.
//
//   node scripts/lib/volume-buckets.test.mjs
//
// The chart used to slice(-12): one bar per session, oldest sessions silently dropped, and
// every label "MM-DD" so two bars on the same day were indistinguishable. These checks pin
// the properties that fix addresses — nothing dropped, gaps visible, labels unambiguous.
//
// All assertions live in a separate harness file (volume-buckets-harness.mjs) and this one
// only builds and runs it. Two reasons, both learned the hard way:
//
//   - esbuild treats every .mjs in a directory as an entry point. With the assertions in
//     this file, the previous run's bundle became an input and the build died with
//     "Could not resolve <the file it was about to write>".
//   - stats.js imports './utils' without an extension. Vite resolves that; plain node does
//     not, so the harness is bundled either way. Keeping the bundle out of this directory
//     avoids the first problem entirely.

import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = fileURLToPath(new URL('../../', import.meta.url))
const harnessSrc = fileURLToPath(new URL('./volume-buckets-harness.mjs', import.meta.url))
// In the temp dir, so it is never an esbuild input on a subsequent run.
const bundle = join(tmpdir(), 'gym-volume-buckets.bundle.mjs')

const q = s => (/\s/.test(s) ? `"${s}"` : s)
rmSync(bundle, { force: true })

const build = spawnSync(
  'npx',
  ['--yes', 'esbuild', q(harnessSrc), '--bundle', '--platform=node', '--format=esm',
    '--packages=external', `--outfile=${q(bundle)}`, '--log-level=error'],
  { cwd: root, encoding: 'utf8', shell: true },
)
if (build.status !== 0) {
  console.error('Could not build the harness.')
  if (build.stderr) console.error(build.stderr)
  process.exit(1)
}

const run = spawnSync(process.execPath, [bundle], { encoding: 'utf8' })
process.stdout.write(run.stdout || '')
if (run.stderr) process.stdout.write('\n' + run.stderr.split('\n').slice(0, 10).join('\n'))
rmSync(bundle, { force: true })

// The harness prints "N FAILED." only when something failed and "Bucketing is correct."
// otherwise, so the success line is the reliable signal — matching on "FAILED" alone
// reported a clean run as an error.
const out = run.stdout || ''
const ok = out.includes('Bucketing is correct.')
const m = out.match(/(\d+) FAILED/)
const failed = m ? Number(m[1]) : ok ? 0 : 1
process.exit(failed === 0 && ok ? 0 : 1)
