// src/pages/History.jsx
import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ChevronUp, ChevronDown, RotateCcw, Dumbbell, Trash2, ChevronLeft, Clock } from 'lucide-react'
import { getSessionSummaries, getDiscardedSessions, deleteSession, restoreSession, purgeSession } from '../lib/db'
import { todayISO, formatDate, formatDuration } from '../lib/utils'
import ConfirmDialog from '../components/ConfirmDialog'

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** When a row was discarded, in the device's own time. */
function discardedWhen(value) {
  if (!value) return ''
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function CalendarGrid({ year, month, sessionsByDate, onDayClick }) {
  // todayISO, not an inline toISOString: UTC would highlight the wrong day for anyone
  // east of UTC between local midnight and the offset.
  const today = todayISO()
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7 // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells = [...Array(startOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
      {cells.map((day, idx) => {
        if (!day) return <div key={`pad-${idx}`} />
        const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const session = sessionsByDate[iso]
        const isToday = iso === today
        const hasSession = Boolean(session)

        return (
          <button
            key={iso}
            onClick={() => hasSession && onDayClick(session)}
            disabled={!hasSession}
            aria-label={hasSession ? `${day}, session logged` : `${day}`}
            className="tnum"
            style={{
              aspectRatio: '1',
              borderRadius: 'var(--rounded-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 0,
              fontSize: 'var(--type-subhead)',
              fontWeight: hasSession ? 600 : 400,
              // configurator-option-chip-selected: the spec's own selection cue
              background: hasSession ? 'var(--primary)' : 'var(--surface)',
              color: hasSession ? 'var(--on-primary)' : 'var(--ink-muted)',
              border: isToday ? '2px solid var(--primary-focus)' : '1px solid var(--line)',
            }}
          >
            {day}
          </button>
        )
      })}
    </div>
  )
}

/**
 * One discarded row, exported so a render test can mount it with real data. The page
 * fetches in an effect, which renderToString never runs, so the section used to be
 * tested only when empty — exactly where an undefined name hid until it blanked the app.
 */
export function DiscardedRow({ row, onRestore, onPurge }) {
  return (
    <div className="card" style={{ padding: 12, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--type-subhead)' }}>
            {formatDate(row.date)}
          </div>
          <div style={{ color: 'var(--ink-muted)', fontSize: 'var(--type-fine)' }}>
            {row.is_draft ? 'Unfinished workout' : 'Deleted workout'}
            {row.deleted_at && ` · discarded ${discardedWhen(row.deleted_at)}`}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="tnum" style={{ fontWeight: 600, color: 'var(--primary)', fontSize: 'var(--type-subhead)' }}>
            {Math.round(row.volume)} kg
          </div>
          <div style={{ color: 'var(--ink-muted)', fontSize: 'var(--type-fine)' }}>
            {row.exercise_count || 0} ex · {row.set_count || 0} sets
            {row.duration_seconds ? ` · ${formatDuration(row.duration_seconds)}` : ''}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button onClick={() => onRestore(row)} className="btn-secondary" style={{ flex: 1 }}>
          <RotateCcw size={15} />
          {row.is_draft ? 'Resume workout' : 'Restore'}
        </button>
        <button
          onClick={() => onPurge(row)}
          className="btn-quiet"
          style={{ color: 'var(--destructive)' }}
        >
          <Trash2 size={15} /> Delete forever
        </button>
      </div>
    </div>
  )
}

export function DiscardedList({ rows, onRestore, onPurge }) {
  const [open, setOpen] = useState(false)
  if (!rows || rows.length === 0) return null

  return (
    <section style={{ marginBottom: 24 }}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="btn-quiet"
        style={{ width: '100%', justifyContent: 'space-between', marginBottom: open ? 8 : 0 }}
      >
        <span>Discarded ({rows.length})</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {open && rows.map(row => (
        <DiscardedRow key={row.id} row={row} onRestore={onRestore} onPurge={onPurge} />
      ))}
    </section>
  )
}

export default function History() {
  const [sessions, setSessions] = useState([])
  const [pendingDelete, setPendingDelete] = useState(null)
  // Discarded rows live below the real workouts, collapsed by default. Nothing is
  // hidden permanently: "discarded" now means "recoverable", not "gone".
  const [discarded, setDiscarded] = useState([])
  const [pendingPurge, setPendingPurge] = useState(null)
  const navigate = useNavigate()

  // Captured once on mount: the calendar opens on the month the user is looking at, and a
  // clock read during render would be an impurity React can invalidate on any re-render.
  const [now] = useState(() => new Date())
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth())

  // Both lists together, so a restore or a purge refreshes the live workouts and the
  // discarded rows in the same pass and the two never disagree about where a row is.
  async function refresh() {
    const [live, gone] = await Promise.all([getSessionSummaries(), getDiscardedSessions()])
    setSessions(live)
    setDiscarded(gone)
  }

  useEffect(() => {
    // The summaries, not the full session trees. This list shows a date, a volume, an
    // exercise count and a couple of names — and every set of every session used to
    // travel over the network to produce them.
    refresh()
  }, [])

  async function confirmRestore(row) {
    await restoreSession(row.id)
    // A restored draft belongs in the Log tab, where the editor picks it up and the
    // workout can simply be continued. A restored saved workout belongs back here.
    if (row.is_draft) navigate('/log')
    else await refresh()
  }

  async function confirmPurge() {
    const target = pendingPurge
    setPendingPurge(null)
    if (!target) return
    try {
      await purgeSession(target.id)
      await refresh()
    } catch (err) {
      alert(`Could not delete the discarded workout: ${err.message}`)
    }
  }

  const sessionsByDate = useMemo(() => {
    const map = {}
    for (const s of sessions) map[s.date] = s
    return map
  }, [sessions])

  const grouped = useMemo(() => {
    const acc = {}
    for (const s of sessions) {
      const key = s.date.slice(0, 7)
      ;(acc[key] ||= []).push(s)
    }
    return acc
  }, [sessions])
  const months = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  function shiftMonth(delta) {
    const next = calMonth + delta
    if (next < 0) {
      setCalMonth(11)
      setCalYear(y => y - 1)
    } else if (next > 11) {
      setCalMonth(0)
      setCalYear(y => y + 1)
    } else {
      setCalMonth(next)
    }
  }

  async function confirmDelete() {
    const target = pendingDelete
    setPendingDelete(null)
    if (!target) return
    try {
      await deleteSession(target.id)
      setSessions(prev => prev.filter(s => s.id !== target.id))
      // The row moved to Discarded rather than disappearing, so refresh that list too.
      const gone = await getDiscardedSessions()
      setDiscarded(gone)
    } catch (err) {
      alert(`Could not delete the session: ${err.message}`)
    }
  }

  return (
    <div className="screen">
      <h1 className="screen-title" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 20px)', marginBottom: 16 }}>
        History
      </h1>

      <section className="card" style={{ padding: 12, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="hit">
            <ChevronLeft size={20} color="var(--primary)" />
          </button>
          <span style={{ fontWeight: 600, fontSize: 'var(--type-headline)', letterSpacing: 'var(--tracking-headline)' }}>
            {MONTH_LABELS[calMonth]} {calYear}
          </span>
          <button onClick={() => shiftMonth(1)} aria-label="Next month" className="hit">
            <ChevronRight size={20} color="var(--primary)" />
          </button>
        </div>

        {/* Day-of-week header, initials only — full names do not fit seven across. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
          {DAY_LABELS.map((d, i) => (
            <div
              key={i}
              style={{
                textAlign: 'center',
                fontSize: 'var(--type-fine)',
                color: 'var(--ink-muted)',
                fontWeight: 600,
                paddingBottom: 4,
              }}
            >
              {d}
            </div>
          ))}
        </div>

        <CalendarGrid
          year={calYear}
          month={calMonth}
          sessionsByDate={sessionsByDate}
          onDayClick={session => navigate(`/history/${session.id}`)}
        />
      </section>

      {sessions.length === 0 && (
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <Dumbbell size={36} color="var(--ink-faint)" style={{ marginBottom: 10 }} />
          <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)' }}>
            No sessions logged yet.
          </p>
        </div>
      )}

      {months.map(key => {
        const [y, m] = key.split('-')
        return (
          <section key={key} style={{ marginBottom: 24 }}>
            <h2 className="section-label" style={{ margin: '0 4px 8px' }}>
              {MONTH_LABELS[Number(m) - 1]} {y}
            </h2>
            {grouped[key].map(session => {
              const names = session.exercise_names || []
              return (
                <div key={session.id} className="card" style={{ display: 'flex', alignItems: 'center', marginBottom: 8, overflow: 'hidden' }}>
                  <button
                    onClick={() => navigate(`/history/${session.id}`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, padding: 12, textAlign: 'left' }}
                  >
                    <div
                      className="tnum"
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: 0,
                        background: 'var(--nb-yellow)',
                        border: '2px solid var(--outline)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ fontSize: 'var(--type-headline)', fontWeight: 700, lineHeight: 1, color: 'var(--nb-black)' }}>
                        {Number(session.date.slice(8))}
                      </span>
                      <span style={{ fontSize: 'var(--type-fine)', color: 'var(--nb-black)', textTransform: 'uppercase' }}>
                        {new Date(session.date + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short' })}
                      </span>
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 'var(--type-subhead)' }}>
                        {new Date(session.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' })}
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--type-subhead)',
                          color: 'var(--ink-muted)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {names.slice(0, 2).join(' · ') || 'No exercises'}
                        {names.length > 2 && ` +${names.length - 2}`}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div className="tnum" style={{ fontWeight: 600, fontSize: 'var(--type-subhead)', color: 'var(--primary)' }}>
                        {Math.round(session.volume)} kg
                      </div>
                      <div style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>
                        {session.exercise_count || 0} ex
                      </div>
                    </div>
                  </button>

                  {/* The measured length of the session. Sessions logged before the
                      stopwatch existed have no duration, so there is nothing to show
                      rather than a misleading zero. */}
                  {session.duration_seconds ? (
                    <div
                      className="tnum"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '0 10px',
                        alignSelf: 'stretch',
                        borderLeft: '1px solid var(--line)',
                        color: 'var(--ink-muted)',
                        fontSize: 'var(--type-fine)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <Clock size={12} />
                      {formatDuration(session.duration_seconds)}
                    </div>
                  ) : null}

                  <button
                    onClick={() => setPendingDelete(session)}
                    aria-label={`Delete session from ${session.date}`}
                    className="btn-icon"
                    style={{ alignSelf: 'stretch', borderLeft: '1px solid var(--line)' }}
                  >
                    <Trash2 size={16} color="var(--destructive)" />
                  </button>
                </div>
              )
            })}
          </section>
        )
      })}

      <DiscardedList rows={discarded} onRestore={confirmRestore} onPurge={setPendingPurge} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this session?"
        message={
          pendingDelete
            ? `${new Date(pendingDelete.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} and all of its logged sets will move to Discarded. You can restore it from there.`
            : ''
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={Boolean(pendingPurge)}
        title="Delete forever?"
        message={
          pendingPurge
            ? `This permanently removes the ${pendingPurge.is_draft ? 'unfinished workout' : 'workout'} from ${formatDate(pendingPurge.date)} and all of its logged sets. It cannot be undone.`
            : ''
        }
        confirmLabel="Delete forever"
        onCancel={() => setPendingPurge(null)}
        onConfirm={confirmPurge}
      />
    </div>
  )
}
