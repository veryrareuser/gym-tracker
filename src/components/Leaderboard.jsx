// src/components/Leaderboard.jsx
import { useEffect, useState, useCallback, useRef } from 'react'
import { Trophy, Medal, ChevronDown, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { setProfileVisible } from '../lib/db'
import { monthStartISO, monthLabel } from '../lib/utils'
import PersonalRecords from './PersonalRecords'

/**
 * Standings across accounts, each account's personal records on demand, and the
 * caller's own switch for appearing in it at all.
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
 * The switch lives in this card rather than in a section of its own: it governs
 * membership of exactly this list, so a separate heading and icon restated what the
 * switch next to them already said.
 *
 * @param {string} username  the caller's own username, so their row can be marked
 */
export default function Leaderboard({ username }) {
  // Standings plus a request counter. load() bumps the counter and only writes its
  // result if no newer request started meanwhile, so a slow earlier response cannot
  // overwrite a fresher one. It also clears the rows up front, which is what puts the
  // card into its loading state.
  const requestId = useRef(0)
  const [standings, setStandings] = useState({ rows: null, error: null })
  const [openName, setOpenName] = useState(null)
  const [records, setRecords] = useState({})
  const [loadingName, setLoadingName] = useState(null)
  const [profileVisible, setVisible] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchStandings = useCallback(async (showLoading = true) => {
    const id = ++requestId.current
    if (showLoading) setStandings({ rows: null, error: null })
    const [{ data, error }, me] = await Promise.all([
      // The month comes from the device clock, not the server's. Between local midnight
      // and 07:00 the server is still in the previous month, and a board that silently
      // resets a day early is the same defect that misdated early-morning workouts.
      supabase.rpc('leaderboard', { p_month_start: monthStartISO() }),
      supabase.rpc('whoami'),
    ])
    if (id !== requestId.current) return
    const row = Array.isArray(me.data) ? me.data[0] : me.data
    if (row) setVisible(row.profile_visible !== false)
    setStandings({ rows: error ? null : Array.isArray(data) ? data : [], error: error ? error.message : null })
  }, [])

  useEffect(() => {
    // No showLoading: the state already starts empty, which *is* the loading state, so
    // resetting it synchronously here would only cascade an extra render.
    // The rule flags the setState inside fetchStandings, but it cannot see that it sits
    // after an await — this is mount-time fetching, which is what effects are for.
    // eslint-disable-next-line react/set-state-in-effect
    fetchStandings(false)
  }, [fetchStandings])

  const rows = standings.rows
  const error = standings.error

  async function toggleVisibility(next) {
    setSaving(true)
    try {
      setVisible(await setProfileVisible(next))
      await fetchStandings()
    } catch {
      setVisible(profileVisible)
    } finally {
      setSaving(false)
    }
  }

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

  const leaderboardGrid = 'minmax(0, 1fr) 64px 68px 48px'
  const colHead = {
    fontSize: 'var(--type-fine)',
    lineHeight: 1,
    color: 'var(--ink-muted)',
    textAlign: 'right',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
  }
  const month = monthLabel()

  return (
    <section className="card" style={{ padding: 17, marginTop: 8 }}>
      {header}
      <p style={{ margin: '0 0 14px', fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>
        Ranked on volume this month, so the board resets on the 1st and measures the same
        stretch for both of you. Tap someone to see their records.
      </p>

      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)' }}>
          {profileVisible ? 'Nobody is sharing a profile yet.' : "You're hidden, so the board looks empty. Your switch is below."}
        </p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: leaderboardGrid, gap: 8, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
            <div style={colHead} />
            <div style={colHead}>{month}</div>
            <div style={colHead}>Best ever</div>
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
                    gridTemplateColumns: leaderboardGrid,
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
                    {Math.round(Number(row.volume_month)).toLocaleString()}
                  </span>
                  <span className="tnum" style={{ textAlign: 'right', fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)' }}>
                    {Number(row.best_set)}
                  </span>
                  <span className="tnum" style={{ textAlign: 'right', fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)' }}>
                    {row.sessions_month}
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
            Volume in kg for {month}, from the 1st to today. "Best ever" is the heaviest single set
            either of you has ever lifted, so it carries over between months. Only totals are shared
            here — opening a profile reveals that person's records, never the sessions behind them.
          </p>

          {/* One boolean, so one hairline-separated row. A card with its own icon and
              heading restated what the switch beside it already says. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginTop: 14,
              paddingTop: 13,
              borderTop: '1px solid var(--line)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--type-subhead)', fontWeight: 600 }}>Show my profile</div>
              <div style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>
                {profileVisible ? 'Your standings and records are visible to others.' : 'You are hidden.'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={profileVisible}
              aria-label="Show my profile to the other account"
              disabled={saving}
              onClick={() => toggleVisibility(!profileVisible)}
              style={{ flexShrink: 0, width: 44, minWidth: 44 }}
            >
              {/* Track 44x26 with a 20px knob inset 3px. The previous 51x31 track carried a
                  27px knob, which left 2px of blue at the widest point — the knob read as a
                  crescent and the control outshouted its own heading. The button keeps the
                  global 44px min-height, so the hit target is still a full 44px. */}
              <span
                style={{
                  display: 'block',
                  position: 'relative',
                  width: 44,
                  height: 26,
                  borderRadius: 'var(--rounded-pill)',
                  background: profileVisible ? 'var(--primary)' : 'var(--line-control)',
                  transition: 'background 0.18s ease',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 3,
                    left: profileVisible ? 21 : 3,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: '#fff',
                    transition: 'left 0.18s ease',
                  }}
                />
              </span>
            </button>
          </div>
        </>
      )}
    </section>
  )
}
