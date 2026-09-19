// src/pages/History.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Dumbbell, Trash2 } from 'lucide-react'
import { getSessions, getExercises, deleteSession } from '../lib/db'
import { formatDate, calcVolume } from '../lib/utils'

export default function History() {
  const [sessions, setSessions] = useState([])
  const [exercises, setExercises] = useState([])
  const [deleting, setDeleting] = useState(null)
  const navigate = useNavigate()

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

  // Group by month
  const grouped = sessions.reduce((acc, s) => {
    const key = s.date.slice(0, 7) // "2025-09"
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
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 20 }}>History</h1>

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
