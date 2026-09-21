// src/lib/timer.js
const TIMER_KEY = 'gym_rest_timer'

export function startTimer(durationSeconds) {
  const entry = { startTime: Date.now(), duration: durationSeconds * 1000 }
  localStorage.setItem(TIMER_KEY, JSON.stringify(entry))
  // Dispatch custom event so RestTimer component re-reads immediately
  window.dispatchEvent(new Event('gym_timer_start'))
}

export function getTimerState() {
  try {
    const raw = localStorage.getItem(TIMER_KEY)
    if (!raw) return null
    const { startTime, duration } = JSON.parse(raw)
    const remaining = Math.ceil((startTime + duration - Date.now()) / 1000)
    if (remaining <= 0) {
      localStorage.removeItem(TIMER_KEY)
      return null
    }
    return { remaining, total: Math.round(duration / 1000) }
  } catch {
    return null
  }
}

export function clearTimer() {
  localStorage.removeItem(TIMER_KEY)
}
