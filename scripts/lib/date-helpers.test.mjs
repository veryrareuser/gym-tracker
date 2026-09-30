// Tests for the date helpers.
//
// The bug these guard: todayISO() used toISOString().slice(0, 10), which is UTC. At UTC+7
// that returns yesterday for seven hours every day, so a workout logged at 01:30 was filed
// under the previous date.
//
// An important subtlety this file had to be rewritten around: localISODate() uses
// getFullYear/getMonth/getDate, which read the *process* timezone. Writing an offset into
// an ISO string ("2026-09-28T20:00:00-04:00") does not move that — it only fixes the
// instant. So testing a zone by putting an offset in a literal tests nothing. The only way
// to exercise a zone is to launch the process with TZ set, which is what the runner below
// does. An earlier draft of this file "tested" UTC-4 that way and was in fact still
// running as Asia/Jakarta, which is how a broken expectation survived review.
//
//   node scripts/lib/date-helpers.test.mjs

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { localISODate, monthStartISO, monthLabel } from '../../src/lib/utils.js'

const ZONES = ['Asia/Jakarta', 'America/New_York', 'Europe/London', 'Pacific/Auckland', 'UTC']

// Instants chosen to sit where the UTC date and the local date disagree, which is exactly
// where a regression to toISOString() would show.
const INSTANTS = [
  '2026-09-28T01:30:00Z',
  '2026-09-28T17:30:00Z',
  '2026-09-30T16:30:00Z',
  '2026-10-01T02:00:00Z',
  '2026-12-31T23:30:00Z',
  '2027-01-01T00:30:00Z',
  '2026-03-01T07:00:00Z',
  '2026-06-15T23:45:00Z',
]

/** The local calendar date in an explicitly named zone, via a different code path. */
function expectedIn(zone, d) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const get = t => parts.find(p => p.type === t).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

function runInZone(zone) {
  // fileURLToPath, not URL.pathname: on Windows the pathname form is percent-encoded,
  // so the spaces in this repo's path come back as %20 and the child cannot load it.
  const self = fileURLToPath(import.meta.url)
  const r = spawnSync(process.execPath, [self, '--child'], {
    env: { ...process.env, TZ: zone },
    encoding: 'utf8',
  })
  process.stdout.write(r.stdout || '')
  if (r.stderr) process.stdout.write(r.stderr)
  const m = (r.stdout || '').match(/FAILURES=(\d+)/)
  return m ? Number(m[1]) : 1
}

if (process.argv.includes('--child')) {
  const zone = process.env.TZ
  console.log(`  zone resolved to: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`)

  // The core invariant, cross-checked against Intl rather than against itself.
  let mismatches = 0
  for (const iso of INSTANTS) {
    const d = new Date(iso)
    const got = localISODate(d)
    const want = expectedIn(zone, d)
    if (got !== want) {
      mismatches++
      console.log(`    ${iso}: got ${got}, expected ${want}`)
    }
  }
  check('localISODate matches the zone in Intl for every instant', mismatches === 0, `${INSTANTS.length} instants`)

  // Where the local and UTC calendar dates differ, the local one must be returned. An
  // earlier draft asserted the inverse and so failed everywhere: matching the UTC date is
  // correct for most instants, not a bug, so the test has to select the instants where the
  // two genuinely part company before it can say anything.
  const partWays = INSTANTS.filter(iso => expectedIn(zone, new Date(iso)) !== new Date(iso).toISOString().slice(0, 10))
  const returnedUtc = partWays.filter(iso => localISODate(new Date(iso)) === new Date(iso).toISOString().slice(0, 10))
  check(
    'where local and UTC dates differ, it returns the local one',
    returnedUtc.length === 0,
    partWays.length === 0
      ? 'this zone never differs from UTC, so nothing to check'
      : `${partWays.length} instants differ; ${returnedUtc.length} wrongly returned UTC`,
  )

  // Output shape and padding.
  const shape = INSTANTS.every(iso => /^\d{4}-\d{2}-\d{2}$/.test(localISODate(new Date(iso))))
  check('always YYYY-MM-DD', shape, `${INSTANTS.length} checked`)

  // Built in local time so it is the same calendar day in every zone. A fixed UTC instant
  // would be the 4th in New York, which is correct but tests nothing about padding.
  const janFifth = new Date(2026, 0, 5, 12)
  check('single-digit month and day are zero-padded', localISODate(janFifth) === '2026-01-05', localISODate(janFifth))

  // The leaderboard's month must come from the same clock, never the server's.
  const monthOk = INSTANTS.every(iso => {
    const d = new Date(iso)
    const want = `${expectedIn(zone, d).slice(0, 7)}-01`
    return monthStartISO(d) === want
  })
  check('monthStartISO agrees with the zone', monthOk)
  check(
    'monthStartISO is always the 1st',
    INSTANTS.every(iso => monthStartISO(new Date(iso)).endsWith('-01')),
  )
  check('monthLabel returns a real month name', /^[A-Z][a-z]+$/.test(monthLabel(new Date('2026-09-15T12:00:00Z'))), monthLabel(new Date('2026-09-15T12:00:00Z')))

  // The exact scenario that was reported: 01:30 local in Jakarta, where UTC said the 27th.
  if (zone === 'Asia/Jakarta') {
    const d = new Date('2026-09-28T01:30:00+07:00')
    check('the reported case: 01:30 Jakarta is the 28th', localISODate(d) === '2026-09-28', localISODate(d))
    check('  and UTC would indeed have said the 27th', d.toISOString().slice(0, 10) === '2026-09-27', d.toISOString().slice(0, 10))
    const midnight = new Date('2026-09-28T00:00:00+07:00')
    check('local midnight belongs to the new day', localISODate(midnight) === '2026-09-28', localISODate(midnight))
  }

  console.log(`FAILURES=${failures}`)
  process.exit(failures === 0 ? 0 : 1)
}

console.log('Date helpers, run once per timezone\n')
for (const zone of ZONES) {
  console.log(`${zone}`)
  failures += runInZone(zone)
  console.log('')
}
console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
