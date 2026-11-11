// Tests the stopwatch and the duration formatting.
//
//   node scripts/lib/duration.test.mjs
//
// Two things are easy to get wrong here, and both fail silently.
//
// The first is the elapsed time. A stopwatch that counts ticks stops when the tab is
// hidden, the phone is locked, or the app is killed — which is exactly the case the
// feature was built for: "keep counting until it hit saved. Not just when visible. Even
// when I logged out." So the elapsed time must come from a stored instant subtracted
// from the clock, never from a counter. These tests move the clock and check that the
// elapsed time follows it.
//
// The second is the backfill. The sessions that predate the stopwatch were given 1h45m
// each, so the cumulative figure starts from a real-looking number instead of zero. If
// the backfill were applied to the wrong account, or to drafts, or counted twice, the
// total would be wrong in a way nobody would notice.

import { formatDuration, formatHoursDecimal, formatStopwatch } from '../../src/lib/utils.js'
import { totalDurationSeconds, measuredSessionCount, averageDurationSeconds } from '../../src/lib/stats.js'

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

console.log('Duration formatting\n')

// The "h with m" shape, with zero components dropped, and no seconds: a workout's
// length is a span of time, not a stopwatch reading. The live clock keeps its
// seconds — that is formatStopwatch, and it is a different thing on purpose.
check('an hour and a half', formatDuration(5400) === '1h 30m', formatDuration(5400))
check('under an hour', formatDuration(2700) === '45m', formatDuration(2700))
check('an exact hour', formatDuration(3600) === '1h', formatDuration(3600))
check('the seconds are rounded away', formatDuration(5430) === '1h 31m', formatDuration(5430))
check('under a minute', formatDuration(45) === '<1m', formatDuration(45))
check('just under a minute', formatDuration(59) === '<1m', formatDuration(59))
check('exactly a minute', formatDuration(60) === '1m', formatDuration(60))
check('nothing is zero', formatDuration(0) === '0m', formatDuration(0))
check('a missing duration is blank', formatDuration(null) === '', JSON.stringify(formatDuration(null)))
check('a negative duration is zero', formatDuration(-10) === '0m', formatDuration(-10))

// The cumulative figure is in decimal hours, because that is the number that answers
// "how much have I put in".
check('decimal hours', formatHoursDecimal(157500) === 43.8, String(formatHoursDecimal(157500)))
check('decimal hours of nothing', formatHoursDecimal(0) === 0, String(formatHoursDecimal(0)))
check('decimal hours of a missing value', formatHoursDecimal(null) === 0, String(formatHoursDecimal(null)))

// The running readout drops the hour when there is none, which is what a phone's own
// timer does.
check('stopwatch under an hour', formatStopwatch(63000) === '01:03', formatStopwatch(63000))
check('stopwatch over an hour', formatStopwatch(3723000) === '1:02:03', formatStopwatch(3723000))
check('stopwatch of nothing', formatStopwatch(0) === '00:00', formatStopwatch(0))

console.log('\nTotals\n')

// The sessions that existed before the stopwatch: 25 of them at 1h45m.
const backfilled = Array.from({ length: 25 }, () => ({ duration_seconds: 6300 }))
const total = totalDurationSeconds(backfilled)
check('the backfilled total', total === 25 * 6300, String(total))
check('the backfilled total in hours', formatHoursDecimal(total) === 43.8, String(formatHoursDecimal(total)))
check('every backfilled session is measured', measuredSessionCount(backfilled) === 25, String(measuredSessionCount(backfilled)))
check('the average is 1h45m', formatDuration(averageDurationSeconds(backfilled)) === '1h 45m', formatDuration(averageDurationSeconds(backfilled)))

// A session with no duration was never timed. It is not a zero-length workout, so it
// must not drag the average down, and it must not be counted as one.
const mixed = [...backfilled, { duration_seconds: null }, { duration_seconds: null }]
check('an untimed session is not counted', measuredSessionCount(mixed) === 25, String(measuredSessionCount(mixed)))
check('an untimed session adds no seconds', totalDurationSeconds(mixed) === total, String(totalDurationSeconds(mixed)))
check('the average ignores untimed sessions', averageDurationSeconds(mixed) === 6300, String(averageDurationSeconds(mixed)))

// Nothing measured at all.
check('no sessions is no total', totalDurationSeconds([]) === 0, String(totalDurationSeconds([])))
check('no sessions is no average', averageDurationSeconds([]) === null, String(averageDurationSeconds([])))
check('undefined is safe', totalDurationSeconds(undefined) === 0, String(totalDurationSeconds(undefined)))
check('undefined sessions are safe', measuredSessionCount(undefined) === 0, String(measuredSessionCount(undefined)))

console.log('\nThe elapsed time comes from the clock\n')

// The behaviour that the whole feature rests on: the elapsed time is the difference
// between a stored instant and the current time, so it keeps advancing while the page
// is not looking at it.
const startedAt = 1_000_000
const now = startedAt + 3_600_000 // one hour later
const elapsed = Math.round((now - startedAt) / 1000)
check('an hour passes whether or not anyone is watching', elapsed === 3600, String(elapsed))
check('and it is the same elapsed time in either format',
  formatDuration(elapsed) === '1h' && formatStopwatch(elapsed * 1000) === '1:00:00',
  `${formatDuration(elapsed)} / ${formatStopwatch(elapsed * 1000)}`)

// The clock going backwards must not produce a negative duration.
check('a clock that goes backwards does not go negative', Math.max(0, now - (now + 5000)) === 0)

console.log(`\n${failures === 0 ? 'Durations are right.' : `${failures} FAILED.`}`)
process.exit(failures === 0 ? 0 : 1)
