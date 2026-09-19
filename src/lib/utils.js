// src/lib/utils.js
export function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
}

export function formatDate(isoDate) {
  if (!isoDate) return ''
  const d = new Date(isoDate + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
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
