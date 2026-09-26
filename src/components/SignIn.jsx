// src/components/SignIn.jsx
import { useState, useRef, useEffect } from 'react'
import { Lock, User } from 'lucide-react'
import { signIn, USERNAME_RE } from '../lib/auth'

export default function SignIn({ onSignedIn }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)
  const shakeTimer = useRef(null)

  useEffect(() => () => clearTimeout(shakeTimer.current), [])

  function fail(message) {
    setError(message)
    setShake(true)
    clearTimeout(shakeTimer.current)
    shakeTimer.current = setTimeout(() => setShake(false), 500)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await signIn(username, password)
      if (result.error) fail(result.error)
      else onSignedIn?.(result)
    } catch (err) {
      fail(err.message)
    } finally {
      setBusy(false)
    }
  }

  const usernameValid = USERNAME_RE.test(username.trim().toLowerCase())

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
      <div style={{ width: '100%', maxWidth: 360 }}>
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

        <h1 className="screen-title" style={{ fontSize: 'var(--type-title)', marginBottom: 8, textAlign: 'center' }}>
          Gym Tracker
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0 0 32px', fontSize: 'var(--type-subhead)', textAlign: 'center' }}>
          Sign in to your account
        </p>

        <form onSubmit={handleSubmit} style={{ animation: shake ? 'shake 0.4s ease' : 'none' }}>
          <label
            htmlFor="si-username"
            style={{ display: 'block', fontSize: 'var(--type-subhead)', fontWeight: 600, color: 'var(--ink-muted)', marginBottom: 8 }}
          >
            Username
          </label>
          <div style={{ position: 'relative', marginBottom: 17 }}>
            <User
              size={17}
              color="var(--ink-muted)"
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
            />
            <input
              id="si-username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck="false"
              enterKeyHint="next"
              value={username}
              onChange={e => {
                setUsername(e.target.value)
                setError(null)
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'si-error' : 'si-hint'}
              style={{ paddingLeft: 38, textTransform: 'lowercase' }}
            />
          </div>
          <p id="si-hint" style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)', margin: '-10px 0 17px' }}>
            {username && !usernameValid
              ? '3-20 characters: a-z, 0-9, or underscore'
              : 'Accounts are created by the app owner — there is no public sign-up.'}
          </p>

          <label
            htmlFor="si-password"
            style={{ display: 'block', fontSize: 'var(--type-subhead)', fontWeight: 600, color: 'var(--ink-muted)', marginBottom: 8 }}
          >
            Password
          </label>
          <input
            id="si-password"
            type="password"
            autoComplete="current-password"
            enterKeyHint="go"
            value={password}
            onChange={e => {
              setPassword(e.target.value)
              setError(null)
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'si-error' : undefined}
            style={{
              marginBottom: 12,
              borderColor: error ? 'var(--destructive)' : 'var(--line-control)',
              borderWidth: error ? 2 : 1,
            }}
          />

          {error && (
            <p
              id="si-error"
              role="alert"
              style={{ color: 'var(--destructive)', fontSize: 'var(--type-subhead)', margin: '0 0 12px' }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn-primary btn-block"
            style={{ minHeight: 50, opacity: busy ? 0.7 : 1 }}
          >
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
