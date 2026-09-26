// src/components/RestTimer.jsx
import { useState, useEffect, useRef } from 'react'
import { Timer, X } from 'lucide-react'
import { getTimerState, clearTimer } from '../lib/timer'

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function RestTimer() {
  const [timerState, setTimerState] = useState(() => getTimerState())
  const [finished, setFinished] = useState(false)
  const intervalRef = useRef(null)

  function tick() {
    const state = getTimerState()
    if (!state) {
      setTimerState(null)
      clearInterval(intervalRef.current)
      return
    }
    setTimerState(state)
    if (state.remaining <= 0) {
      clearInterval(intervalRef.current)
      setTimerState(null)
      setFinished(true)
      if (navigator.vibrate) navigator.vibrate([200, 100, 200])
      setTimeout(() => setFinished(false), 2000)
    }
  }

  useEffect(() => {
    function onTimerStart() {
      setTimerState(getTimerState())
      clearInterval(intervalRef.current)
      intervalRef.current = setInterval(tick, 1000)
    }

    window.addEventListener('gym_timer_start', onTimerStart)
    // The lazy useState initializer above already read localStorage, so this only
    // needs to cover a timer that was started before this component mounted.
    if (timerState) intervalRef.current = setInterval(tick, 1000)

    return () => {
      clearInterval(intervalRef.current)
      window.removeEventListener('gym_timer_start', onTimerStart)
    }
    // timerState is read only for its initial presence check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleDismiss() {
    clearTimer()
    clearInterval(intervalRef.current)
    setTimerState(null)
    setFinished(false)
  }

  if (!finished && !timerState) return null

  const remaining = timerState?.remaining ?? 0
  const progress = timerState ? remaining / timerState.total : 0
  const isLow = finished || remaining <= 10
  const tone = isLow ? 'var(--color-danger-fill)' : 'var(--color-accent)'

  return (
    <div
      // Sits directly above the tab bar, inside the same 520px column.
      style={{
        position: 'fixed',
        bottom: 'calc(var(--tab-bar-height) + env(safe-area-inset-bottom) + 8px)',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 520,
        zIndex: 200,
        padding: '0 12px',
        pointerEvents: 'none',
      }}
    >
      <div
        role="status"
        aria-live="polite"
        aria-label={finished ? 'Rest complete' : `Rest, ${formatTime(remaining)} remaining`}
        className="glass"
        style={{
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-float)',
          pointerEvents: 'auto',
        }}
      >
        {!finished && (
          <div style={{ height: 3, background: 'var(--color-fill)' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.max(0, progress) * 100}%`,
                background: tone,
                transition: 'width 0.9s linear',
              }}
            />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 8px 10px 14px', gap: 10 }}>
          <Timer size={18} color={tone} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 'var(--type-subhead)', color: 'var(--color-muted)', flex: 1 }}>
            {finished ? 'Rest over — go!' : 'Resting'}
          </span>
          <span
            className="tnum"
            style={{
              fontSize: 'var(--type-title)',
              fontWeight: 700,
              color: isLow ? 'var(--color-danger)' : 'var(--color-text)',
            }}
          >
            {finished ? '0:00' : formatTime(remaining)}
          </span>
          <button
            onClick={handleDismiss}
            aria-label="Dismiss rest timer"
            className="hit"
            style={{ width: 40, minHeight: 40, flexShrink: 0 }}
          >
            <X size={18} color="var(--color-muted)" />
          </button>
        </div>
      </div>
    </div>
  )
}
