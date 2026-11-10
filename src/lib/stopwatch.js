// src/lib/stopwatch.js
//
// The stopwatch that times a workout.
//
// Why this is not a timer that counts up
// --------------------------------------
// The elapsed time is derived from a wall-clock instant, never from counting ticks.
//
// A tick counter has to run to advance, so it stops the moment the tab is hidden, the
// phone is locked, or the app is killed. The user asked for the opposite: "keep
// counting until it hit saved. Not just when visible. Even when i logged out." Storing
// the instant the workout started and subtracting it from the current time gives that
// for free, because time passes whether or not anybody is watching.
//
// Where the start instant lives
// ----------------------------
// Two places, deliberately.
//
// localStorage, under a key that survives sign-out. The start instant is the only
// record of how long a workout has been going, and losing it would silently shorten
// the session. It is namespaced by account, so one account's timer can never be
// resumed by another.
//
// The draft row in the database, as started_at. That is what carries the timer to a
// different device: the draft already survives the tab closing, the app being killed,
// and signing out and back in, and the stopwatch belongs to the same workout.
//
// The two are reconciled on load — see resumeStopwatch — with the cloud draft winning,
// because the draft is the record of the workout that is actually being edited.
//
// Not in APP_KEY
// --------------
// browserSession.js clears every APP_KEY-listed key on sign-out, so that the next
// person at the keyboard does not inherit a half-finished workout. The stopwatch is
// deliberately outside that set, for the same reason the rest timer was: signing out
// must not shorten a workout that is still going. It holds a timestamp and a session
// id, not training data, and it is namespaced by account.

const KEY_PREFIX = 'gym_stopwatch:'

/** The localStorage key for one account's running stopwatch. */
export function stopwatchKey(userId) {
  return `${KEY_PREFIX}${userId ?? 'anon'}`
}

/**
 * The running stopwatch for an account, or null.
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
    if (!parsed || !parsed.sessionId || !Number.isFinite(parsed.startedAt)) return null
    return parsed
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
 * Start a stopwatch, or resume the one already running.
 *
 * A stopwatch that is still running always belongs to the workout that is still
 * going. It is cleared when the session is saved and when a draft is discarded, so
 * its presence means there is a workout in progress — and that workout's clock must
 * not restart because the page was closed, the app was killed, or the account was
 * signed out. The user asked for exactly this: "keep counting until it hit saved.
 * Not just when visible. Even when I logged out."
 *
 * The session id is written forward rather than used as a gate. It records which
 * workout the clock belongs to, and it is updated to the session now being edited —
 * but a mismatch is not a reason to throw the elapsed time away.
 *
 * @returns the instant the workout started, in epoch milliseconds
 */
export function startStopwatch(userId, sessionId, startedAt) {
  const existing = readStopwatch(userId)
  if (existing) {
    writeStopwatch(userId, { sessionId, startedAt: existing.startedAt })
    return existing.startedAt
  }

  const start = Number.isFinite(startedAt) && startedAt > 0 ? startedAt : Date.now()
  writeStopwatch(userId, { sessionId, startedAt: start })
  return start
}

/**
 * The instant to resume from, given what a draft says.
 *
 * The draft is authoritative because it is the record of the workout being edited: it
 * is the only thing that carries the timer to another device. The local stopwatch is
 * the fallback for the case where no draft exists yet, which is the moment between
 * opening the Log page and the first autosave.
 *
 * The start instant arrives in two shapes, and both have to be understood. The cloud
 * draft carries it as an ISO timestamp, because that is what Postgres stores. The
 * local mirror carries it as epoch milliseconds, because that is what the app works
 * in. Treating the number as a string and running it through Date.parse() gives NaN,
 * which silently restarts the clock — the workout would appear to have taken no time
 * at all, and the recorded duration would be wrong by however long the session had
 * been going.
 */
export function resumeStopwatch(userId, sessionId, draftStartedAt) {
  const draftStart = parseInstant(draftStartedAt)
  if (draftStart) {
    writeStopwatch(userId, { sessionId, startedAt: draftStart })
    return draftStart
  }
  return startStopwatch(userId, sessionId)
}

/**
 * An epoch-milliseconds instant from either a number or an ISO timestamp.
 *
 * Returns null when the value is missing or unusable, rather than a number that
 * would make every elapsed time wrong in a way nobody would notice.
 */
function parseInstant(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** Stop the stopwatch and discard it. Called when the session is saved. */
export function stopStopwatch(userId) {
  try {
    localStorage.removeItem(stopwatchKey(userId))
  } catch {
    /* Storage refused; nothing to clear. */
  }
}

/**
 * The elapsed milliseconds since the workout started.
 *
 * Derived from the clock, so it is correct after the tab has been asleep, and it does
 * not need the page to have been running the whole time.
 */
export function elapsedMs(startedAt, now = Date.now()) {
  if (!startedAt) return 0
  return Math.max(0, now - startedAt)
}

/**
 * The elapsed time in whole seconds, for storing on the session.
 *
 * Rounded rather than floored, so a workout that lasted 95 seconds records 95 rather
 * than 94. A fraction of a second is noise either way.
 */
export function elapsedSeconds(startedAt, now = Date.now()) {
  return Math.round(elapsedMs(startedAt, now) / 1000)
}
