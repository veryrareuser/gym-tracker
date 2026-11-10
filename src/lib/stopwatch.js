// src/lib/stopwatch.js
//
// The stopwatch that times a workout.
//
// Started by hand, not by opening the page
// ----------------------------------------
// Opening the Log page used to start the clock by itself. It meant that simply
// looking at the app recorded time nobody spent training, and the total drifted
// away from the truth. The clock now waits for a deliberate Start.
//
// Why this is not a timer that counts up
// --------------------------------------
// The elapsed time is derived from a wall-clock instant, never from counting ticks.
//
// A tick counter has to run to advance, so it stops the moment the tab is hidden, the
// phone is locked, or the app is killed. The user asked for the opposite: "keep
// counting until it hit saved. Not just when visible. Even when i logged out." Storing
// the instant a segment began and subtracting it from the current time gives that for
// free, because time passes whether or not anybody is watching.
//
// What a paused stopwatch needs
// -----------------------------
// A stopwatch that can pause is two numbers, not one. The time already counted has to
// be kept somewhere, because the instant a segment began cannot express "forty
// minutes, then a break, then another twenty".
//
// So a record holds:
//
//   accumulatedMs   the time counted so far, from segments that have finished
//   runningSince    when the current segment began, or null when not counting
//
// and the elapsed time is the two added together:
//
//   elapsed = accumulatedMs + (runningSince ? now - runningSince : 0)
//
// The state machine
// -----------------
//
//   idle ──Start──► running ──Pause──► paused ──Resume──► running
//                      │                  │
//                      └────Stop──────────┴──► stopped ──Start over──► idle
//
// Pause and Stop differ in what they mean, not in the arithmetic: a paused
// measurement can be resumed, a stopped one is final.
//
// Where the record lives
// ----------------------
// Two places, deliberately.
//
// localStorage, under a key that survives sign-out. The measurement is the only
// record of how long a workout has been going, and losing it would silently shorten
// the session. It is namespaced by account, so one account's timer can never be
// resumed by another.
//
// The draft row in the database, split across two columns. That is what carries the
// timer to a different device: the draft already survives the tab closing, the app
// being killed, and signing out and back in.
//
//   duration_seconds   the accumulated time — the segments that have finished
//   started_at         when the current segment began, null when not counting
//
// The elapsed time is therefore recoverable from the draft alone, and exactly:
//
//   elapsed = duration_seconds + (started_at ? now - started_at : 0)
//
// which is why the two columns carry those two things and not something else.
//
// Not in APP_KEY
// --------------
// browserSession.js clears every APP_KEY-listed key on sign-out, so that the next
// person at the keyboard does not inherit a half-finished workout. The stopwatch is
// deliberately outside that set: signing out must not shorten a workout that is still
// going. It holds a timestamp and a session id, not training data, and it is
// namespaced by account.

const KEY_PREFIX = 'gym_stopwatch:'

/** The localStorage key for one account's stopwatch. */
export function stopwatchKey(userId) {
  return `${KEY_PREFIX}${userId ?? 'anon'}`
}

/**
 * The stopwatch for an account, or null when there is no measurement.
 *
 * Read on every render of the timer, so it must never throw: a browser in private
 * mode refuses localStorage outright, and a stopwatch that crashes the page it is
 * measuring is worse than one that quietly does not run.
 */
export function readStopwatch(userId) {
  try {
    const raw = localStorage.getItem(stopwatchKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.sessionId !== 'string') return null
    return {
      sessionId: parsed.sessionId,
      startedAt: positive(parsed.startedAt) ?? 0,
      accumulatedMs: positive(parsed.accumulatedMs) ?? 0,
      runningSince: positive(parsed.runningSince) ?? null,
      finished: parsed.finished === true,
    }
  } catch {
    return null
  }
}

function writeStopwatch(userId, record) {
  try {
    localStorage.setItem(stopwatchKey(userId), JSON.stringify(record))
  } catch {
    /* Storage refused. The timer still runs in memory for this page view. */
  }
}

/**
 * Start counting, or resume a paused measurement.
 *
 * A measurement that has been stopped is not resumed: it is over, and pressing Start
 * again means measuring something new. The caller offers "Start over" for that, and
 * this is the path behind it.
 */
export function startStopwatch(userId, sessionId) {
  const existing = readStopwatch(userId)
  if (existing && !existing.finished) {
    if (existing.runningSince) {
      // Already counting. Nothing to do, but keep the session id current.
      const record = { ...existing, sessionId }
      writeStopwatch(userId, record)
      return record
    }
    // A paused measurement, resumed from where it left off.
    const record = { ...existing, sessionId, runningSince: Date.now(), finished: false }
    writeStopwatch(userId, record)
    return record
  }

  const now = Date.now()
  const record = { sessionId, startedAt: now, accumulatedMs: 0, runningSince: now, finished: false }
  writeStopwatch(userId, record)
  return record
}

/**
 * Freeze the count.
 *
 * The time counted so far is kept. A paused measurement can be resumed, which is the
 * only thing that separates it from a stopped one.
 */
export function pauseStopwatch(userId) {
  const existing = readStopwatch(userId)
  if (!existing) return null
  const record = {
    ...existing,
    accumulatedMs: existing.accumulatedMs + (existing.runningSince ? Date.now() - existing.runningSince : 0),
    runningSince: null,
    finished: false,
  }
  writeStopwatch(userId, record)
  return record
}

/**
 * End the measurement.
 *
 * The total is kept and is what gets saved. Stopping is not discarding: the workout
 * happened, and the number of minutes it took is a fact about it.
 */
export function stopStopwatch(userId) {
  const paused = pauseStopwatch(userId)
  if (!paused) return null
  const record = { ...paused, finished: true }
  writeStopwatch(userId, record)
  return record
}

/** Throw the measurement away entirely. The next Start begins from zero. */
export function clearStopwatch(userId) {
  try {
    localStorage.removeItem(stopwatchKey(userId))
  } catch {
    /* Storage refused; nothing to clear. */
  }
}

/**
 * Rebuild a measurement from what a cloud draft says.
 *
 * The draft carries the accumulated time and the start of the current segment, which
 * between them give the elapsed time exactly. This is the path that carries a
 * workout's timer to a different device.
 */
export function restoreStopwatch(userId, sessionId, { accumulatedMs = 0, runningSince = null } = {}) {
  const record = {
    sessionId,
    startedAt: positive(runningSince) ?? Date.now(),
    accumulatedMs: positive(accumulatedMs) ?? 0,
    runningSince: positive(runningSince) ?? null,
    finished: false,
  }
  writeStopwatch(userId, record)
  return record
}

/**
 * The elapsed milliseconds.
 *
 * Derived from the clock, so it is correct after the tab has been asleep, and it does
 * not need the page to have been running the whole time.
 */
export function elapsedMs(record, now = Date.now()) {
  if (!record) return 0
  const running = record.runningSince ? Math.max(0, now - record.runningSince) : 0
  return Math.max(0, record.accumulatedMs + running)
}

/**
 * The elapsed time in whole seconds, for storing on the session.
 *
 * Rounded rather than floored, so a workout that lasted 95 seconds records 95 rather
 * than 94. A fraction of a second is noise either way.
 */
export function elapsedSeconds(record, now = Date.now()) {
  return Math.round(elapsedMs(record, now) / 1000)
}

/** Whether the clock is counting right now. */
export function isRunning(record) {
  return Boolean(record && record.runningSince)
}

/** A positive finite number, or null. */
function positive(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}
