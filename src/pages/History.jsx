// src/pages/History.jsx
import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Dumbbell, Trash2, ChevronLeft } from 'lucide-react'
import { getSessions, getExercises, deleteSession } from '../lib/db'
import { calcVolume } from '../lib/utils'
import ConfirmDialog from '../components/ConfirmDialog'

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function CalendarGrid({ year, month, sessionsByDate, onDayClick }) {
  const today = new Date().toISOString().slice(0, 10)
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
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'var(--type-footnote)',
              fontWeight: hasSession ? 700 : 400,
              background: hasSession ? 'var(--color-accent)' : 'transparent',
              color: hasSession ? 'var(--color-on-accent)' : 'var(--color-muted)',
              boxShadow: isToday ? 'inset 0 0 0 2px var(--color-accent)' : 'none',
              opacity: hasSession ? 1 : 1,
            }}
          >
            {day}
          </button>
        )
      })}
    </div>
  )
}

export default function History() {
  const [sessions, setSessions] = useState([])
  const [exercises, setExercises] = useState([])
  const [pendingDelete, setPendingDelete] = useState(null)
  const navigate = useNavigate()

  const now = new Date()
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth())

  useEffect(() => {
    getSessions().then(setSessions)
    getExercises().then(setExercises)
  }, [])

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
            <ChevronLeft size={20} color="var(--color-accent-text)" />
          </button>
          <span style={{ fontWeight: 600, fontSize: 'var(--type-headline)' }}>
            {MONTH_LABELS[calMonth]} {calYear}
          </span>
          <button onClick={() => shiftMonth(1)} aria-label="Next month" className="hit">
            <ChevronRight size={20} color="var(--color-accent-text)" />
          </button>
        </div>

        {/* Day-of-week header, initials only — full names do not fit seven across. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
          {DAY_LABELS.map((d, i) => (
            <div
              key={i}
              style={{
                textAlign: 'center',
                fontSize: 'var(--type-min)',
                color: 'var(--color-muted)',
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
          <Dumbbell size={36} color="var(--color-faint)" style={{ marginBottom: 10 }} />
          <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 'var(--type-subhead)' }}>
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
              const names = (session.exercise_logs || [])
                .map(log => exercises.find(e => e.id === log.exercise_id)?.name)
                .filter(Boolean)
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
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--color-accent-dim)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ fontSize: 'var(--type-headline)', fontWeight: 700, lineHeight: 1, color: 'var(--color-accent-text)' }}>
                        {Number(session.date.slice(8))}
                      </span>
                      <span style={{ fontSize: 'var(--type-min)', color: 'var(--color-accent-text)', textTransform: 'uppercase' }}>
                        {new Date(session.date + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short' })}
                      </span>
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 'var(--type-subhead)' }}>
                        {new Date(session.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' })}
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--type-footnote)',
                          color: 'var(--color-muted)',
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
                      <div className="tnum" style={{ fontWeight: 700, fontSize: 'var(--type-subhead)', color: 'var(--color-accent-text)' }}>
                        {Math.round(calcVolume(session))} kg
                      </div>
                      <div style={{ fontSize: 'var(--type-caption)', color: 'var(--color-muted)' }}>
                        {session.exercise_logs?.length || 0} ex
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => setPendingDelete(session)}
                    aria-label={`Delete session from ${session.date}`}
                    className="hit"
                    style={{ width: 40, alignSelf: 'stretch', borderLeft: '1px solid var(--color-border)' }}
                  >
                    <Trash2 size={16} color="var(--color-danger)" />
                  </button>
                </div>
              )
            })}
          </section>
        )
      })}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this session?"
        message={
          pendingDelete
            ? `${new Date(pendingDelete.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} and all of its logged sets will be removed. This cannot be undone.`
            : ''
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
