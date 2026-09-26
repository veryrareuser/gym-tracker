// src/components/PasswordGate.jsx
import { useState, useRef, useEffect } from 'react'
import { Lock } from 'lucide-react'

export default function PasswordGate({ onLogin }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState(false)
  const [shake, setShake] = useState(false)
  const shakeTimer = useRef(null)

  useEffect(() => () => clearTimeout(shakeTimer.current), [])

  function handleSubmit(e) {
    e.preventDefault()
    if (onLogin(pw)) return
    setError(true)
    setShake(true)
    clearTimeout(shakeTimer.current)
    shakeTimer.current = setTimeout(() => setShake(false), 500)
    setPw('')
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: 'var(--color-bg)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 360, textAlign: 'center' }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: 'var(--color-accent-dim)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
          }}
        >
          <Lock size={30} color="var(--color-accent)" />
        </div>

        <h1 className="screen-title" style={{ fontSize: 'var(--type-title)', marginBottom: 6 }}>
          Gym Tracker
        </h1>
        <p style={{ color: 'var(--color-muted)', margin: '0 0 28px', fontSize: 'var(--type-subhead)' }}>
          Enter your password to continue
        </p>

        <form onSubmit={handleSubmit} style={{ animation: shake ? 'shake 0.4s ease' : 'none' }}>
          <label htmlFor="gate-password" style={{ display: 'block', textAlign: 'left', fontSize: 'var(--type-footnote)', fontWeight: 600, color: 'var(--color-muted)', marginBottom: 6 }}>
            Password
          </label>
          <input
            id="gate-password"
            type="password"
            autoComplete="current-password"
            value={pw}
            onChange={e => {
              setPw(e.target.value)
              setError(false)
            }}
            autoFocus
            aria-invalid={error}
            aria-describedby={error ? 'gate-error' : undefined}
            style={{
              marginBottom: 12,
              borderColor: error ? 'var(--color-danger)' : 'transparent',
              textAlign: 'center',
              fontSize: 'var(--type-title)',
              letterSpacing: 6,
              fontVariantNumeric: 'tabular-nums',
            }}
          />
          {error && (
            <p id="gate-error" role="alert" style={{ color: 'var(--color-danger)', fontSize: 'var(--type-subhead)', margin: '0 0 12px' }}>
              Incorrect password
            </p>
          )}
          <button
            type="submit"
            style={{
              width: '100%',
              minHeight: 'var(--hit-min)',
              background: 'var(--color-accent)',
              color: 'var(--color-on-accent)',
              fontWeight: 600,
              fontSize: 'var(--type-headline)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            Unlock
          </button>
        </form>
      </div>
    </div>
  )
}
