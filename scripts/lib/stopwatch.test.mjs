// Tests the stopwatch's state machine and its arithmetic.
//
//   node scripts/lib/stopwatch.test.mjs
//
// Two things are easy to get wrong here, and both fail silently.
//
// The first is the arithmetic. A stopwatch that can pause is two numbers, not one:
// the time already counted, and the instant the current segment began. Getting that
// wrong loses either the paused time or the time since the resume, and the number on
// the screen is plausible either way — so nothing looks broken.
//
// The second is that the clock must not be tied to the page. A tick counter stops when
// the tab is hidden or the app is killed, which is the opposite of what was asked for:
// "keep counting until it hit saved. Not just when visible. Even when i logged out."
// So the elapsed time is always derived from the stored instant and the clock, and
// these tests move the clock to prove it.
//
// The clock and localStorage are both stubbed, so every assertion is exact rather
// than approximate.

import {
  startStopwatch,
  pauseStopwatch,
  stopStopwatch,
  clearStopwatch,
  readStopwatch,
  restoreStopwatch,
  elapsedMs,
  elapsedSeconds,
  isRunning,
  stopwatchKey,
} from '../../src/lib/stopwatch.js'

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

/* ── A controllable clock and a fake localStorage ── */

const store = new Map()
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  key: i => [...store.keys()][i] ?? null,
  get length() { return store.size },
}

let clock = 1_700_000_000_000
const realNow = Date.now
Date.now = () => clock
const advance = ms => { clock += ms }

const USER = 'account-1'
const reset = () => {
  store.clear()
  clock = 1_700_000_000_000
}

console.log('The state machine\n')

reset()
check('nothing is measured to begin with', readStopwatch(USER) === null)
check('and the elapsed time is zero', elapsedMs(null) === 0)

// --- Start ---
{
  const record = startStopwatch(USER, 'session-a')
  check('starting records a measurement', Boolean(record), JSON.stringify(record))
  check('and it is counting', isRunning(record) === true)
  check('the elapsed time starts at zero', elapsedMs(record) === 0, String(elapsedMs(record)))

  advance(5000)
  check('and then follows the clock', elapsedMs(record) === 5000, String(elapsedMs(record)))
  advance(2000)
  check('and keeps following it', elapsedMs(record) === 7000, String(elapsedMs(record)))
}

// --- Pause ---
{
  const record = pauseStopwatch(USER)
  check('pausing freezes the count', isRunning(record) === false)
  const atPause = elapsedMs(record)
  check('and keeps what was counted', atPause === 7000, String(atPause))

  // The clock keeps moving. A paused measurement must not.
  advance(60_000)
  check('a paused measurement does not count the time that passes', elapsedMs(record) === 7000, String(elapsedMs(record)))
}

// --- Resume ---
{
  const record = startStopwatch(USER, 'session-a')
  check('resuming counts again', isRunning(record) === true)
  check('and keeps the time from before the pause', elapsedMs(record) === 7000, String(elapsedMs(record)))
  advance(3000)
  check('and then adds to it', elapsedMs(record) === 10000, String(elapsedMs(record)))
}

// --- Stop ---
{
  const record = stopStopwatch(USER)
  check('stopping ends the count', isRunning(record) === false)
  check('and keeps the total', elapsedMs(record) === 10000, String(elapsedMs(record)))
  check('and marks the measurement finished', record.finished === true)
  advance(120_000)
  check('a stopped measurement does not count the time that passes', elapsedMs(record) === 10000, String(elapsedMs(record)))
}

// --- Start over ---
{
  const record = startStopwatch(USER, 'session-b')
  // A finished measurement is not resumed: it is over, and starting again means
  // measuring something new.
  check('starting again after a stop begins from zero', elapsedMs(record) === 0, String(elapsedMs(record)))
  clearStopwatch(USER)
  check('and clearing throws the measurement away', readStopwatch(USER) === null)
}

console.log('\nThe measurement survives being put down\n')

reset()
{
  startStopwatch(USER, 'session-a')
  advance(30_000)
  const before = elapsedMs(readStopwatch(USER))

  // The page is closed, the app is killed, the tab is hidden. The record is in
  // localStorage, which is not cleared by any of those.
  advance(600_000)
  const after = elapsedMs(readStopwatch(USER))

  check('the elapsed time keeps counting while nothing is looking', after === before + 600_000, `${before} -> ${after}`)
  check('and it is not a counter that was incremented', after > before, `${before} -> ${after}`)
}

console.log('\nThe measurement is namespaced per account\n')

reset()
{
  startStopwatch('account-1', 'session-a')
  advance(1000)
  check('one account has a measurement', readStopwatch('account-1') !== null)
  check('another account does not', readStopwatch('account-2') === null)
  check('and the keys are different', stopwatchKey('account-1') !== stopwatchKey('account-2'))
}

console.log('\nA measurement carried by a cloud draft\n')

reset()
{
  // What a draft carries: the time already counted, and when the current segment began.
  const record = restoreStopwatch(USER, 'session-a', {
    accumulatedMs: 25_000,
    runningSince: clock - 10_000,
  })
  check('it is counting again on the other device', isRunning(record) === true)
  check('and the elapsed time is the two halves added together', elapsedMs(record) === 35_000, String(elapsedMs(record)))
  advance(5000)
  check('and it carries on counting', elapsedMs(record) === 40_000, String(elapsedMs(record)))
}

reset()
{
  // Two devices whose clocks disagree. A segment that "began" in the future must not
  // make the elapsed time negative.
  const record = restoreStopwatch(USER, 'session-a', {
    accumulatedMs: 25_000,
    runningSince: clock + 60_000,
  })
  check('a segment that starts in the future counts as zero', elapsedMs(record) === 25_000, String(elapsedMs(record)))
}

reset()
{
  // A paused measurement: the accumulated time, and no segment running.
  const record = restoreStopwatch(USER, 'session-a', {
    accumulatedMs: 25_000,
    runningSince: null,
  })
  check('a paused one is not counting', isRunning(record) === false)
  check('and holds what was counted', elapsedMs(record) === 25_000, String(elapsedMs(record)))
  advance(5000)
  check('and does not count the time that passes', elapsedMs(record) === 25_000, String(elapsedMs(record)))
}

console.log('\nStoring a measurement\n')

reset()
{
  startStopwatch(USER, 'session-a')
  advance(95_400)
  check('the seconds are rounded, not floored', elapsedSeconds(readStopwatch(USER)) === 95, String(elapsedSeconds(readStopwatch(USER))))
  check('and the milliseconds are exact', elapsedMs(readStopwatch(USER)) === 95_400)
}

reset()
{
  // A record written by an older version of the app, or corrupted, must not throw.
  store.set(stopwatchKey(USER), 'not json')
  check('a corrupt record reads as no measurement', readStopwatch(USER) === null)
  store.set(stopwatchKey(USER), JSON.stringify({ sessionId: 'x' }))
  const partial = readStopwatch(USER)
  check('a partial record is repaired rather than rejected', partial !== null && partial.accumulatedMs === 0)
  check('and it has no segment running', isRunning(partial) === false)
}

reset()
{
  // localStorage can refuse outright — a private-mode browser throws on setItem.
  const real = globalThis.localStorage
  globalThis.localStorage = {
    getItem: () => { throw new Error('denied') },
    setItem: () => { throw new Error('denied') },
    removeItem: () => { throw new Error('denied') },
  }
  let threw = false
  try { readStopwatch(USER) } catch { threw = true }
  check('reading a refused storage does not throw', threw === false)
  globalThis.localStorage = real
}

Date.now = realNow

console.log(`\n${failures === 0 ? 'The stopwatch behaves.' : `${failures} FAILED.`}`)
process.exit(failures === 0 ? 0 : 1)
