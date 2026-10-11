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
