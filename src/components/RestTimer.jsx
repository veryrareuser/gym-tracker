// src/components/RestTimer.jsx
import { useState, useEffect, useRef } from 'react'
import { X, Timer } from 'lucide-react'
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
      // Vibrate on finish
      if (navigator.vibrate) navigator.vibrate([200, 100, 200])
      setTimeout(() => setFinished(false), 2000)
    }
  }

  useEffect(() => {
    // Re-read on mount in case timer was started on another tab / page
    setTimerState(getTimerState())

    function onTimerStart() {
      setTimerState(getTimerState())
      clearInterval(intervalRef.current)
      intervalRef.current = setInterval(tick, 1000)
    }

    window.addEventListener('gym_timer_start', onTimerStart)

    // Start interval if timer already running
    if (getTimerState()) {
      intervalRef.current = setInterval(tick, 1000)
    }

    return () => {
      clearInterval(intervalRef.current)
      window.removeEventListener('gym_timer_start', onTimerStart)
    }
  }, [])

  function handleDismiss() {
    clearTimer()
    clearInterval(intervalRef.current)
    setTimerState(null)
    setFinished(false)
  }

  if (finished) {
    return (
      <div style={{
        position: 'fixed',
        bottom: 64,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 480,
        zIndex: 200,
        padding: '0 12px',
        pointerEvents: 'none',
      }}>
        <div style={{
          background: 'var(--color-danger)',
          borderRadius: 12,
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          color: '#fff',
          fontWeight: 700,
          fontSize: 14,
          animation: 'timerFlash 0.4s ease',
        }}>
          <Timer size={16} /> Rest over — go!
        </div>
        <style>{`
          @keyframes timerFlash {
            0%,100% { opacity: 1; } 50% { opacity: 0.4; }
          }
        `}</style>
      </div>
    )
  }

  if (!timerState) return null

  const progress = timerState.remaining / timerState.total
  const isLow = timerState.remaining <= 10

  return (
    <div style={{
      position: 'fixed',
      bottom: 64,
      left: '50%',
      transform: 'translateX(-50%)',
      width: '100%',
      maxWidth: 480,
      zIndex: 200,
      padding: '0 12px',
    }}>
      <div style={{
        background: 'var(--color-surface)',
        border: `1px solid ${isLow ? 'var(--color-danger)' : 'var(--color-border)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      }}>
        {/* Progress bar */}
        <div style={{
          height: 3,
          background: 'var(--color-surface2)',
        }}>
          <div style={{
            height: '100%',
            width: `${progress * 100}%`,
            background: isLow ? 'var(--color-danger)' : 'var(--color-accent)',
            transition: 'width 0.9s linear',
          }} />
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 14px',
          gap: 10,
        }}>
          <Timer size={16} color={isLow ? 'var(--color-danger)' : 'var(--color-accent)'} />
          <span style={{ fontSize: 13, color: 'var(--color-muted)', flex: 1 }}>Rest</span>
          <span style={{
            fontSize: 20,
            fontWeight: 800,
            fontVariantNumeric: 'tabular-nums',
            color: isLow ? 'var(--color-danger)' : 'var(--color-text)',
            letterSpacing: 1,
          }}>
            {formatTime(timerState.remaining)}
          </span>
          <button
            onClick={handleDismiss}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-muted)',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
