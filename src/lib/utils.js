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
