// src/components/Leaderboard.jsx
import { useEffect, useState } from 'react'
import { Trophy, Medal } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'

/**
 * Aggregate standings across accounts.
 *
 * Reads a single SECURITY DEFINER RPC that returns numbers only — no session ids,
 * dates, exercise names, weights or reps ever cross the boundary. That is the whole
 * privacy model: you can see that a friend moved 12,000 kg, never what they lifted.
 */
export default function Leaderboard({ username }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase.rpc('leaderboard').then(({ data, error: err }) => {
      if (cancelled) return
      if (err) setError(err.message)
      else setRows(Array.isArray(data) ? data : [])
    })
    return () => {
      cancelled = true
    }
  }, [])

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <Trophy size={18} color="var(--primary)" />
      <h2 style={{ fontSize: 'var(--type-headline)', fontWeight: 600, margin: 0 }}>Leaderboard</h2>
    </div>
  )

  if (error) {
    return (
      <section className="card" style={{ padding: 17, marginTop: 8 }}>
        {header}
        <p style={{ margin: 0, fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)' }}>
          Could not load standings: {error}
        </p>
      </section>
    )
  }

  if (rows === null) {
    return (
      <section className="card" style={{ padding: 17, marginTop: 8 }}>
        {header}
        <p style={{ margin: 0, fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)' }}>Loading…</p>
      </section>
    )
  }

  const colHead = { fontSize: 'var(--type-min)', color: 'var(--ink-muted)', textAlign: 'right', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }

  return (
    <section className="card" style={{ padding: 17, marginTop: 8 }}>
      {header}
      <p style={{ margin: '0 0 14px', fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>
        Ranked on volume over the last 30 days, so it measures recent work rather than who started first.
      </p>

      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)' }}>No standings yet.</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 76px 64px 56px', gap: 8, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
            <div style={colHead} />
            <div style={colHead}>30-day</div>
            <div style={colHead}>Best set</div>
            <div style={colHead}>Sess.</div>
          </div>

          {rows.map((row, i) => {
            const isMe = row.username === username
            return (
              <div
                key={row.username}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 76px 64px 56px',
                  gap: 8,
                  alignItems: 'center',
                  padding: '12px 8px',
                  margin: '0 -8px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                  borderRadius: 'var(--rounded-sm)',
                  // The caller's own row is tinted, not recoloured, so the single
                  // accent is not spent on decoration.
                  background: isMe ? 'var(--primary-wash)' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {i < 3 ? (
                    <Medal size={17} color={i === 0 ? 'var(--primary)' : 'var(--ink-faint)'} style={{ flexShrink: 0 }} />
                  ) : (
                    <span style={{ width: 17, flexShrink: 0 }} />
                  )}
                  <span style={{ fontWeight: 600, fontSize: 'var(--type-subhead)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.username}
                    {isMe && <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}> (you)</span>}
                  </span>
                </div>
                <span className="tnum" style={{ textAlign: 'right', fontSize: 'var(--type-subhead)', fontWeight: 600 }}>
                  {Math.round(Number(row.volume_30d)).toLocaleString()}
                </span>
                <span className="tnum" style={{ textAlign: 'right', fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)' }}>
                  {Number(row.best_set)}
                </span>
                <span className="tnum" style={{ textAlign: 'right', fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)' }}>
                  {row.sessions_30d}
                </span>
              </div>
            )
          })}
          <p style={{ margin: '10px 0 0', fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>
            Volume in kg over the trailing 30 days. Only totals are shared — never the sessions behind them.
          </p>
        </>
      )}
    </section>
  )
}
