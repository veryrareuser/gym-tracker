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
        background: 'var(--canvas)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 360, textAlign: 'center' }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 'var(--rounded-pill)',
            background: 'var(--primary-wash)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
          }}
        >
          <Lock size={30} color="var(--primary)" />
        </div>

        <h1 className="screen-title" style={{ fontSize: 'var(--type-title)', letterSpacing: 'var(--tracking-title)', marginBottom: 8 }}>
          Gym Tracker
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0 0 32px', fontSize: 'var(--type-subhead)' }}>
          Enter your password to continue
        </p>

        <form onSubmit={handleSubmit} style={{ animation: shake ? 'shake 0.4s ease' : 'none' }}>
          <label
            htmlFor="gate-password"
            style={{ display: 'block', textAlign: 'left', fontSize: 'var(--type-subhead)', fontWeight: 600, color: 'var(--ink-muted)', marginBottom: 8 }}
          >
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
              borderColor: error ? 'var(--destructive)' : 'var(--line-control)',
              borderWidth: error ? 2 : 1,
              textAlign: 'center',
              fontSize: 'var(--type-title)',
              // Wide tracking spaces the characters of a masked password apart.
              // This is a functional override, not the tagline tracking.
              letterSpacing: '6px',
            }}
          />
          {error && (
            <p id="gate-error" role="alert" style={{ color: 'var(--destructive)', fontSize: 'var(--type-subhead)', margin: '0 0 12px' }}>
              Incorrect password
            </p>
          )}
          <button type="submit" className="btn-primary btn-block" style={{ minHeight: 50 }}>
            Unlock
          </button>
        </form>
      </div>
    </div>
  )
}
