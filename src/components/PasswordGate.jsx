// src/components/PasswordGate.jsx
import { useState } from 'react'
import { Lock } from 'lucide-react'

export default function PasswordGate({ onLogin }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState(false)
  const [shake, setShake] = useState(false)

  function handleSubmit(e) {
    e.preventDefault()
    const ok = onLogin(pw)
    if (!ok) {
      setError(true)
      setShake(true)
      setTimeout(() => setShake(false), 500)
      setPw('')
    }
  }

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      background: 'var(--color-bg)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '360px',
        textAlign: 'center',
      }}>
        <div style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: 'var(--color-accent-dim)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 24px',
        }}>
          <Lock size={28} color="var(--color-accent)" />
        </div>

        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 6px', color: 'var(--color-text)' }}>
          Gym Tracker
        </h1>
        <p style={{ color: 'var(--color-muted)', marginBottom: 32, fontSize: 14 }}>
          Enter your password to continue
        </p>

        <form onSubmit={handleSubmit} style={{
          animation: shake ? 'shake 0.4s ease' : 'none',
        }}>
          <input
            type="password"
            placeholder="Password"
            value={pw}
            onChange={e => { setPw(e.target.value); setError(false) }}
            autoFocus
            style={{
              marginBottom: 12,
              borderColor: error ? 'var(--color-danger)' : undefined,
              textAlign: 'center',
              fontSize: 18,
              letterSpacing: 4,
            }}
          />
          {error && (
            <p style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 12 }}>
              Incorrect password
            </p>
          )}
          <button
            type="submit"
            style={{
              width: '100%',
              padding: '14px',
              background: 'var(--color-accent)',
              color: '#0f0f0f',
              fontWeight: 700,
              fontSize: 15,
              border: 'none',
              borderRadius: 12,
            }}
          >
            Unlock
          </button>
        </form>
      </div>

      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20%,60% { transform: translateX(-8px); }
          40%,80% { transform: translateX(8px); }
        }
      `}</style>
    </div>
  )
}
