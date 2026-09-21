// src/pages/History.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Dumbbell, Trash2, ChevronLeft } from 'lucide-react'
import { getSessions, getExercises, deleteSession } from '../lib/db'
import { formatDate, calcVolume } from '../lib/utils'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function CalendarGrid({ year, month, sessionsByDate, onDayClick }) {
  const today = new Date().toISOString().slice(0, 10)
  // month is 0-indexed
  const firstDay = new Date(year, month, 1)
  // Mon=0 ... Sun=6 offset
  let startOffset = firstDay.getDay() - 1
  if (startOffset < 0) startOffset = 6
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells = []
  // empty cells before first day
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  function isoDate(day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  return (
    <div>
      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
        {DAY_LABELS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, color: 'var(--color-muted)', fontWeight: 600, paddingBottom: 4 }}>
            {d}
          </div>
        ))}
      </div>
      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map((day, idx) => {
          if (!day) return <div key={`empty-${idx}`} />
          const iso = isoDate(day)
          const session = sessionsByDate[iso]
          const isToday = iso === today
          const hasSession = Boolean(session)

          return (
            <div
              key={iso}
              onClick={() => hasSession && onDayClick(session)}
              style={{
                aspectRatio: '1',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: hasSession ? 800 : 400,
                cursor: hasSession ? 'pointer' : 'default',
                background: hasSession ? 'var(--color-accent-dim)' : 'transparent',
                border: isToday
                  ? '2px solid var(--color-accent)'
                  : hasSession
                    ? '1px solid rgba(200,241,53,0.3)'
                    : '1px solid transparent',
                color: hasSession ? 'var(--color-accent)' : 'var(--color-muted)',
                transition: 'background 0.1s',
                position: 'relative',
              }}
            >
              {day}
              {hasSession && (
                <div style={{
                  position: 'absolute',
                  bottom: 3,
                  width: 4,
                  height: 4,
                  borderRadius: '50%',
                  background: 'var(--color-accent)',
                }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function History() {
  const [sessions, setSessions] = useState([])
  const [exercises, setExercises] = useState([])
  const [deleting, setDeleting] = useState(null)
  const navigate = useNavigate()

  const now = new Date()
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth()) // 0-indexed

  useEffect(() => {
    getSessions().then(setSessions)
    getExercises().then(setExercises)
  }, [])

  async function handleDelete(e, id) {
    e.stopPropagation()
    if (!confirm('Delete this session?')) return
    setDeleting(id)
    await deleteSession(id)
    setSessions(prev => prev.filter(s => s.id !== id))
    setDeleting(null)
  }

  // O(1) lookup: date string → session
  const sessionsByDate = sessions.reduce((acc, s) => {
    acc[s.date] = s
    return acc
  }, {})

  function prevMonth() {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11) }
    else setCalMonth(m => m - 1)
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0) }
    else setCalMonth(m => m + 1)
  }

  const calMonthLabel = new Date(calYear, calMonth).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  // Group sessions by month for the list below
  const grouped = sessions.reduce((acc, s) => {
    const key = s.date.slice(0, 7)
    if (!acc[key]) acc[key] = []
    acc[key].push(s)
    return acc
  }, {})
  const months = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  function monthLabel(key) {
    const [y, m] = key.split('-')
    return new Date(y, m - 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  }

  return (
    <div style={{ padding: '24px 16px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>History</h1>

      {/* ── Calendar ── */}
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 16,
        padding: '14px',
        marginBottom: 24,
      }}>
        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button onClick={prevMonth} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', padding: 4, display: 'flex' }}>
            <ChevronLeft size={18} />
          </button>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{calMonthLabel}</span>
          <button onClick={nextMonth} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', padding: 4, display: 'flex' }}>
            <ChevronRight size={18} />
          </button>
        </div>

        <CalendarGrid
          year={calYear}
          month={calMonth}
          sessionsByDate={sessionsByDate}
          onDayClick={session => navigate(`/history/${session.id}`)}
        />

        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
          <div style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--color-accent-dim)', border: '1px solid rgba(200,241,53,0.3)' }} />
          <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>Trained</span>
          <div style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid var(--color-accent)', marginLeft: 8 }} />
          <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>Today</span>
        </div>
      </div>

      {/* ── Session list ── */}
      {sessions.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--color-muted)' }}>
          <Dumbbell size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p style={{ margin: 0 }}>No sessions logged yet.</p>
        </div>
      )}

      {months.map(month => (
        <div key={month} style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-muted)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
            {monthLabel(month)}
          </div>
          {grouped[month].map(session => (
            <div
              key={session.id}
              onClick={() => navigate(`/history/${session.id}`)}
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 14,
                padding: '14px 16px',
                marginBottom: 10,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              {/* Date badge */}
              <div style={{
                minWidth: 44,
                height: 44,
                borderRadius: 12,
                background: 'var(--color-accent-dim)',
                border: '1px solid rgba(200,241,53,0.2)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1, color: 'var(--color-accent)' }}>
                  {parseInt(session.date.slice(8))}
                </span>
                <span style={{ fontSize: 9, color: 'var(--color-accent)', textTransform: 'uppercase' }}>
                  {new Date(session.date + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short' })}
                </span>
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
                  {new Date(session.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' })}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {(session.exercise_logs || []).slice(0, 3).map(log => {
                    const ex = exercises.find(e => e.id === log.exercise_id)
                    return ex?.name
                  }).filter(Boolean).join(' · ')}
                  {(session.exercise_logs?.length || 0) > 3 && ` +${session.exercise_logs.length - 3}`}
                </div>
              </div>

              {/* Volume + action */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-accent)' }}>
                  {Math.round(calcVolume(session))} <span style={{ fontSize: 11, fontWeight: 400 }}>kg</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                  {session.exercise_logs?.length || 0} ex
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <ChevronRight size={16} color="var(--color-border)" />
                <button
                  onClick={e => handleDelete(e, session.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--color-muted)', padding: 2 }}
                  disabled={deleting === session.id}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
