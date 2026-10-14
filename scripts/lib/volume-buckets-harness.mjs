// Entry point for volume-buckets.test.mjs. Kept separate from the test on purpose.
//
// The test and its bundle cannot share a directory: esbuild treats every .mjs there as an
// entry point, so on the second run the previous bundle becomes an input and the build
// fails with "Could not resolve <the bundle it was about to write>". That cost several
// cycles. This file lives on its own and imports the module under test by absolute path.
//
// It also has to bundle at all: stats.js imports './utils' without an extension, which
// Vite resolves and plain node does not.

import { volumeBuckets, startsNewMonth } from '../../src/lib/stats.js'

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

const session = (date, weight = 100, reps = 3) => ({
  id: date + weight,
  date,
  exercise_logs: [{ id: 'l', set_entries: [{ id: 's', weight, reps }] }],
})

// 2026-09-04 is a Friday; its week began Monday 2026-08-31.
const data = [
  session('2026-08-31'),
  session('2026-09-04'),
  session('2026-09-07'),
  session('2026-09-21'),
  session('2026-09-21', 200, 3),
  session('2026-09-28'),
  session('2026-10-05'), // crosses into October, so a month boundary exists to test
]
const now = new Date('2026-10-14T09:00:00')

console.log('Volume bucketing\n')

{
  const w = volumeBuckets(data, 'week', now)
  check('weeks start on a Monday', w.every(b => new Date(`${b.key}T00:00:00`).getDay() === 1), w.map(b => b.key).join(' '))
  check('the two 31 Aug / 4 Sep sessions share a bucket', w[0].sessions === 2, `${w[0].sessions} sessions`)
  check('their volume adds up', w[0].volume === 600, String(w[0].volume))
  check('a gap week is still drawn', w.some(b => b.sessions === 0), `${w.filter(b => b.sessions === 0).length} empty`)
  check('the current week is included', w[w.length - 1].key === '2026-10-12', w[w.length - 1].key)
  check('no session is dropped',
    w.reduce((n, b) => n + b.sessions, 0) === data.length,
    `${w.reduce((n, b) => n + b.sessions, 0)} of ${data.length}`)
}

{
  const m = volumeBuckets(data, 'month', now)
  check('months bucket correctly', m.map(b => b.key).join(' ') === '2026-08 2026-09 2026-10', m.map(b => b.key).join(' '))
  check('a month aggregates its sessions', m[1].sessions === 5, `${m[1].sessions} in September`)
  check('month labels are names', /^[A-Z][a-z]{2}$/.test(m[0].label), m.map(b => b.label).join(' '))
}

{
  const s = volumeBuckets(data, 'session', now)
  check('one bucket per session', s.length === data.length, `${s.length} of ${data.length}`)
  check('two sessions on one day stay separate',
    s.filter(b => b.date === '2026-09-21').length === 2,
    `${s.filter(b => b.date === '2026-09-21').length} bars on 21 Sep`)
  check('no bucket is empty in session mode', s.every(b => b.sessions > 0))
  check('session labels are day numbers', s.every(b => /^\d{1,2}$/.test(b.label)), s.map(b => b.label).join(' '))
  check('the first bar announces its month', startsNewMonth(s[0], null))
  // The last bar is 5 Oct, the first in its month.
  check('a bar opening a new month is flagged', startsNewMonth(s[s.length - 1], s[s.length - 2]))
  check('a bar inside the same month is not flagged', !startsNewMonth(s[2], s[1]))
}

{
  check('no sessions gives no buckets', volumeBuckets([], 'week', now).length === 0)
  check('undefined is safe', Array.isArray(volumeBuckets(undefined, 'month', now)))
  const one = volumeBuckets([session('2026-10-12')], 'week', now)
  check('a single session still buckets', one.length === 1 && one[0].sessions === 1)
}

// The old chart's behaviour, for contrast: sessions were silently dropped.
{
  const kept = data.slice(-3).length
  check('slice(-12) would have dropped some', kept < data.length, `old kept ${kept} of ${data.length}`)
}

console.log(`\n${failures === 0 ? 'Bucketing is correct.' : `${failures} FAILED.`}`)
process.exit(failures === 0 ? 0 : 1)
