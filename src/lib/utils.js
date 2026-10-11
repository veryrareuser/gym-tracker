// src/lib/utils.js
export function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
}

export function formatDate(isoDate) {
  if (!isoDate) return ''
  const d = new Date(isoDate + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * The calendar date in the *device's* timezone, as YYYY-MM-DD.
 *
 * Deliberately not `new Date().toISOString().slice(0, 10)`. toISOString() is always UTC,
 * so for anyone east of UTC it returns yesterday between local midnight and the UTC
 * offset. At UTC+7 that is a seven-hour window every day, including every workout logged
 * before 07:00 — it filed those under the previous day, and made the streak and the
 * "logged today" check disagree with the calendar beside them.
 *
 * A session date is a plain calendar day with no timezone attached, so it has to be
 * derived from the same clock the user reads it off.
 */
export function localISODate(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayISO() {
  return localISODate()
}

/**
 * First day of the device's current calendar month, as YYYY-MM-DD.
 *
 * The leaderboard takes this rather than letting the server call
 * date_trunc('month', current_date), because the server's clock is UTC — it would pick
 * the wrong month for the first seven hours of every month at UTC+7. Same bug class as
 * the one above, so it is not being reintroduced through the back door.
 */
export function monthStartISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** Month name for headings, e.g. "September". */
export function monthLabel(d = new Date()) {
  return d.toLocaleDateString('en-GB', { month: 'long' })
}

/**
 * First day of the device's current week (Monday), as YYYY-MM-DD.
 *
 * Weeks start on Monday, following ISO 8601. Built from the local getters for the same
 * reason as localISODate above: a week boundary derived from the UTC date lands on the
 * wrong week for anyone east of UTC during the first hours of Monday, which would
 * silently drop the newest session out of the streak.
 *
 * The `new Date(y, m, d)` form is deliberate. It pins local midnight rather than parsing
 * an ISO string, which JavaScript would read as UTC.
 */
export function weekStartISO(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  // getDay() is 0=Sunday; shift so Monday is 0, then step back to it.
  const offset = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - offset)
  return localISODate(start)
}

/**
 * Week start for a stored session date.
 *
 * A session date is a plain calendar day, so it is anchored to local midnight. Passing it
 * to `new Date()` directly would parse it as UTC midnight and — west of UTC — hand back
 * the previous day, putting Sunday's workout in the week that ended on Saturday.
 */
export function weekStartOfSession(isoDate) {
  if (!isoDate) return null
  return weekStartISO(new Date(`${isoDate}T00:00:00`))
}

export function calcVolume(session) {
  return (session.exercise_logs || []).reduce((total, log) => {
    return total + (log.set_entries || []).reduce((s, set) => {
      return s + (parseFloat(set.weight) || 0) * (parseInt(set.reps) || 0)
    }, 0)
  }, 0)
}

export function getTopSet(sets) {
  if (!sets || sets.length === 0) return null
  return sets.reduce((best, s) => {
    const w = parseFloat(s.weight) || 0
    return w > (parseFloat(best?.weight) || 0) ? s : best
  }, sets[0])
}
