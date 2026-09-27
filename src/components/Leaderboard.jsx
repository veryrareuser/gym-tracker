// src/components/Leaderboard.jsx
import { useEffect, useState, useCallback } from 'react'
import { Trophy, Medal, ChevronDown, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import PersonalRecords from './PersonalRecords'

/**
 * Standings across accounts, and each account's personal records on demand.
 *
 * Two different levels of visibility, deliberately separated:
 *
 *   - The standings come from one SECURITY DEFINER RPC that returns numbers only. No
 *     session id, date, exercise name, weight or rep ever crosses that boundary.
 *   - Opening someone's row calls a second RPC that returns one row per exercise: the
 *     name, their best weight, the reps at that weight, and the date. So you learn what
 *     a friend trains and what they have lifted — not their history, their volume, or
 *     their notes.
 *
 * Both respect the profile owner's switch. Opting out removes the account from the
 * standings entirely, which also removes the only way to reach its records.
 *
 * @param {string} username  the caller's own username, so their row can be marked
 * @param {number} refreshKey  bump to re-fetch after the visibility switch changes
 */
export default function Leaderboard({ username, refreshKey = 0 }) {
  // The fetched standings are tagged with the refreshKey they belong to. Stale data is
  // then treated as still-loading during render, rather than resetting state inside the
  // effect — resetting there is what would trigger a cascading render.
  const [result, setResult] = useState({ key: -1, rows: null, error: null })
  const [openName, setOpenName] = useState(null)
  const [records, setRecords] = useState({})
  const [loadingName, setLoadingName] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase.rpc('leaderboard').then(({ data, error: err }) => {
      if (cancelled) return
      setResult({
        key: refreshKey,
        rows: err ? null : Array.isArray(data) ? data : [],
        error: err ? err.message : null,
      })
    })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  const rows = result.key === refreshKey ? result.rows : null
  const error = result.key === refreshKey ? result.error : null

  const openProfile = useCallback(async name => {
    if (openName === name) {
      setOpenName(null)
      return
    }
    setOpenName(name)
    if (records[name]) return
    setLoadingName(name)
    const { data, error: err } = await supabase.rpc('friend_prs', { p_username: name })
    setLoadingName(null)
    if (err) {
      setRecords(prev => ({ ...prev, [name]: [] }))
      return
    }
    setRecords(prev => ({
      ...prev,
      [name]: (Array.isArray(data) ? data : []).map((r, i) => ({
        key: `${name}-${i}`,
        name: r.exercise_name,
        weight: Number(r.weight),
        reps: r.reps,
        date: r.achieved_on,
      })),
    }))
  }, [openName, records])

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
        Ranked on volume over the last 30 days, so it measures recent work rather than who started first. Tap
        someone to see their records.
      </p>

      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)' }}>
          Nobody is sharing a profile yet.
        </p>
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
            const isOpen = openName === row.username
            // Your own row is not a link: your records are already on this page, above.
            const canOpen = !isMe
            const list = records[row.username] || []
            return (
              <div key={row.username}>
                <div
                  role={canOpen ? 'button' : undefined}
                  tabIndex={canOpen ? 0 : undefined}
                  aria-expanded={canOpen ? isOpen : undefined}
                  onClick={canOpen ? () => openProfile(row.username) : undefined}
                  onKeyDown={
                    canOpen
                      ? e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            openProfile(row.username)
                          }
                        }
                      : undefined
                  }
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
                    cursor: canOpen ? 'pointer' : 'default',
                    minHeight: canOpen ? 44 : undefined,
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
                    {canOpen && (
                      <ChevronDown
                        size={15}
                        color="var(--ink-faint)"
                        style={{ flexShrink: 0, marginLeft: 'auto', transform: isOpen ? 'rotate(180deg)' : 'none' }}
                      />
                    )}
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

                {isOpen && (
                  <div style={{ padding: '2px 8px 12px' }}>
                    {loadingName === row.username ? (
                      <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)', margin: '8px 0' }}>
                        Loading records…
                      </p>
                    ) : list.length === 0 ? (
                      <p style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)', margin: '8px 0' }}>
                        <EyeOff size={15} color="var(--ink-faint)" style={{ flexShrink: 0 }} />
                        {row.username} has no records yet, or is not sharing them.
                      </p>
                    ) : (
                      <PersonalRecords records={list} emptyText="" />
                    )}
                  </div>
                )}
              </div>
            )
          })}
          <p style={{ margin: '10px 0 0', fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>
            Volume in kg over the trailing 30 days. Only totals are shared here — opening a profile reveals that
            person's best set per exercise, never the sessions behind them.
          </p>
        </>
      )}
    </section>
  )
}
