// src/lib/stats.js
//
// Derived figures for the Stats page, and the streak the Dashboard shows.
//
// Every function here reads from the session list the data layer already hands us and
// returns a number. Nothing talks to storage, and nothing writes.

import { calcVolume, localISODate, monthStartISO, weekStartISO, weekStartOfSession } from './utils'

/** Sessions in the device's current calendar month. */
export function sessionsThisMonth(sessions, now = new Date()) {
  const month = monthStartISO(now).slice(0, 7)
  return sessions.filter(s => s.date.slice(0, 7) === month).length
}

/**
 * Training volume over a trailing window, inclusive of today.
 *
 * A window ending "today", not the calendar month: the card is labelled 30d, and a
 * calendar-month figure would silently halve on the 1st and read as lost data.
 *
 * The floor is clamped to today because a session cannot be dated in the future — the Log
 * page caps its date input and the database rejects one — so the bound can never exclude a
 * real session. It exists to stop a clock skew from widening the window silently.
 */
export function volumeLast30Days(sessions, now = new Date()) {
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - 29)
  const floor = localISODate(cutoff)
  const today = localISODate(now)
  const from = floor < today ? floor : today
  return sessions.filter(s => s.date >= from).reduce((total, s) => total + calcVolume(s), 0)
}

/**
 * Consecutive weeks containing at least one session, counting back from this week or last.
 *
 * Weeks rather than days, because nobody trains every day: a daily streak resets on every
 * rest day, so on any normal 3-4x schedule it sat at zero.
 *
 * The current week is not held against you until it has passed, so a Monday-morning check
 * still shows last week's streak rather than 0.
 */
export function weekStreak(sessions, now = new Date()) {
  if (!sessions || sessions.length === 0) return 0
  const weeks = new Set(sessions.map(s => weekStartOfSession(s.date)).filter(Boolean))
  if (weeks.size === 0) return 0
  let cursor = weekStartISO(now)
  if (!weeks.has(cursor)) {
    const lastWeek = new Date(now)
    lastWeek.setDate(lastWeek.getDate() - 7)
    cursor = weekStartISO(lastWeek)
  }
  let streak = 0
  while (weeks.has(cursor)) {
    streak++
    const prev = new Date(`${cursor}T00:00:00`)
    prev.setDate(prev.getDate() - 7)
    cursor = weekStartISO(prev)
  }
  return streak
}

/** Per-day activity across a trailing window, keyed by local calendar date. */
export function dailyActivity(sessions, days, now = new Date()) {
  const out = new Map()
  const cursor = new Date(now)
  cursor.setHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(cursor)
    d.setDate(d.getDate() - i)
    out.set(localISODate(d), { date: localISODate(d), sessions: 0, volume: 0 })
  }
  for (const s of sessions) {
    const entry = out.get(s.date)
    // A session older than the window simply lands outside `out` and is dropped, which is
    // what "last N days" means.
    if (entry) {
      entry.sessions += 1
      entry.volume += calcVolume(s)
    }
  }
  return [...out.values()]
}

/**
 * The trailing `months` window, as a day count.
 *
 * Real calendar months, not months * 30: six months is 181-184 days depending on which
 * months are involved, so the approximation shifts the grid's start by up to four days and
 * the first column no longer opens at a month boundary. Counting back month by month from
 * today keeps the window ending on today, which is the property that actually matters.
 */
export function daysInMonths(months, now = new Date()) {
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const from = new Date(now.getFullYear(), now.getMonth() - months, now.getDate())
  return Math.round((to - from) / 86400000) + 1
}

/**
 * Training volume grouped into the buckets a bar chart can actually show.
 *
 * Per-session volume was the original chart, and it does not scale: one bar per session
 * means one bar per training day, so a month of history fills the width and the axis starts
 * thinning labels until it no longer says which bar is which. Grouping is the fix — the
 * number of bars is bounded by the period, not by how often you train.
 *
 * `week` is the default because it is the granularity people actually think in. `month`
 * answers "how am I trending". `session` keeps the original view for spotting a single
 * heavy day, and is honest about its own crowding rather than silently dropping the
 * oldest sessions — which is what it used to do, and which made the chart disagree with
 * the History page.
 *
 * Empty periods are included as zero bars. A gap in training is the thing worth seeing,
 * and leaving it out would draw a straight line through a break in the streak.
 *
 * @returns {Array<{key,label,volume,sets,sessions,count}>} ordered oldest first
 */
export function volumeBuckets(sessions, period = 'week', now = new Date()) {
  const list = sessions || []
  if (list.length === 0) return []

  const byKey = new Map()
  for (const s of list) {
    let key
    if (period === 'month') {
      key = s.date.slice(0, 7)
    } else if (period === 'session') {
      // Keyed by session id, not date: you can train twice in a day, and two sessions on
      // one date are two workouts. Keying on the date collapsed them into one bar, which is
      // the same silent loss of data the chart was rebuilt to remove.
      key = `s:${s.id}`
    } else {
      key = weekStartOfSession(s.date)
    }
    if (!key) continue
    let b = byKey.get(key)
    if (!b) {
      b = { key, date: s.date, volume: 0, sets: 0, sessions: 0, labels: [] }
      byKey.set(key, b)
    }
    b.volume += calcVolume(s)
    b.sets += (s.exercise_logs || []).reduce((n, l) => n + (l.set_entries || []).length, 0)
    b.sessions += 1
    b.labels.push(s.date)
  }

  // Fill the gaps so a missed week is visible rather than compressed away.
  if (period !== 'session') {
    const stepDays = period === 'month' ? null : 7
    const keys = [...byKey.keys()].sort()
    const first = keys[0]
    const last = currentPeriodKey(period, now)
    if (stepDays) {
      const cursor = new Date(`${first}T00:00:00`)
      const end = new Date(`${last}T00:00:00`)
      while (cursor <= end) {
        const key = weekStartOfSession(localISODate(cursor))
        if (!byKey.has(key)) byKey.set(key, { key, date: key, volume: 0, sets: 0, sessions: 0, labels: [] })
        cursor.setDate(cursor.getDate() + stepDays)
      }
    } else {
      const [fy, fm] = first.split('-').map(Number)
      const [ty, tm] = last.split('-').map(Number)
      let y = fy
      let m = fm
      while (y < ty || (y === ty && m <= tm)) {
        const key = `${y}-${String(m).padStart(2, '0')}`
        if (!byKey.has(key)) byKey.set(key, { key, date: `${key}-01`, volume: 0, sets: 0, sessions: 0, labels: [] })
        m += 1
        if (m > 12) { m = 1; y += 1 }
      }
    }
  }

  return [...byKey.values()]
    .sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date.localeCompare(b.date)))
    .map(b => ({ ...b, label: bucketLabel(b, period), count: b.labels.length }))
}

/** The bucket the current date falls into, used as the far edge of the range. */
function currentPeriodKey(period, now) {
  if (period === 'month') return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return weekStartOfSession(localISODate(now))
}

/**
 * Axis label for one bar.
 *
 * Session bars show a day number, switching to "Oct 2" when the month changes so a label
 * is never ambiguous about which month it belongs to — the previous chart labelled every
 * bar "09-21" style, which cannot distinguish years and cannot distinguish two sessions on
 * the same day.
 */
function bucketLabel(bucket, period) {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const d = new Date(`${bucket.date}T00:00:00`)
  if (period === 'month') return MONTHS[d.getMonth()]
  if (period === 'week') return `${d.getDate()} ${MONTHS[d.getMonth()]}`
  return String(d.getDate())
}

/**
 * True when this bar is the first of a new month, so the caller can label it in full.
 *
 * Compares dates rather than keys: session bars are keyed by session id, which carries no
 * month information. Accepts either a bucket or a plain date string for `previous`, since
 * the natural call site has a bucket to hand.
 */
export function startsNewMonth(bucket, previous) {
  if (!previous) return true
  const previousDate = typeof previous === 'string' ? previous : previous.date
  return bucket.date.slice(0, 7) !== previousDate.slice(0, 7)
}

/**
 * Bucket a value into one of five levels for the heatmap, against the busiest day.
 *
 * Scaled to the maximum present rather than to a fixed range, so a light week still shows
 * its structure instead of one saturated cell among empty ones. Day 0 stays neutral.
 */
export function heatLevel(value, max) {
  if (!value || !max) return 0
  const ratio = value / max
  if (ratio <= 0.2) return 1
  if (ratio <= 0.4) return 2
  if (ratio <= 0.6) return 3
  if (ratio < 1) return 4
  return 5
}
