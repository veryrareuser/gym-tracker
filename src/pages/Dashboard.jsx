// src/pages/Dashboard.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dumbbell, Flame, TrendingUp, ChevronRight, Plus } from 'lucide-react'
import { getSessions, getExercises } from '../lib/db'
import { formatDate, calcVolume, todayISO } from '../lib/utils'

export default function Dashboard() {
  const [sessions, setSessions] = useState([])
  const [exercises, setExercises] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    getSessions().then(setSessions)
    getExercises().then(setExercises)
  }, [])

  const lastSession = sessions[0]
  const today = todayISO()
  const loggedToday = lastSession?.date === today

  // streak: consecutive days with a session
  function calcStreak() {
    if (sessions.length === 0) return 0
    let streak = 0
    let check = new Date()
    const dateSet = new Set(sessions.map(s => s.date))
    while (true) {
      const d = check.toISOString().slice(0, 10)
      if (dateSet.has(d)) { streak++; check.setDate(check.getDate() - 1) }
      else break
    }
    return streak
  }

  const streak = calcStreak()
  const totalSessions = sessions.length
  const recentVolume = lastSession ? Math.round(calcVolume(lastSession)) : 0

  return (
    <div style={{ padding: '24px 16px' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ color: 'var(--color-muted)', fontSize: 13, marginBottom: 4 }}>
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, color: 'var(--color-text)' }}>
          {loggedToday ? 'Great work today 💪' : 'Ready to train?'}
        </h1>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 24 }}>
        {[
          { label: 'Streak', value: streak, unit: 'days', icon: Flame, color: '#ff8c42' },
          { label: 'Sessions', value: totalSessions, unit: 'total', icon: Dumbbell, color: 'var(--color-accent)' },
          { label: 'Last Volume', value: recentVolume, unit: 'kg', icon: TrendingUp, color: '#60a5fa' },
        ].map(({ label, value, unit, icon: Icon, color }) => (
          <div key={label} style={{
            background: 'var(--color-surface)',
            borderRadius: 14,
            padding: '14px 10px',
            border: '1px solid var(--color-border)',
            textAlign: 'center',
          }}>
            <Icon size={18} color={color} style={{ marginBottom: 6 }} />
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-text)', lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>{unit}</div>
            <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <button
        onClick={() => navigate('/log')}
        style={{
          width: '100%',
          padding: '16px',
          background: loggedToday ? 'var(--color-surface)' : 'var(--color-accent)',
          color: loggedToday ? 'var(--color-text)' : '#0f0f0f',
          fontWeight: 700,
          fontSize: 16,
          border: loggedToday ? '1px solid var(--color-border)' : 'none',
          borderRadius: 14,
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <Plus size={20} />
        {loggedToday ? 'Log Another Session' : 'Start Workout'}
      </button>

      {/* Last session preview */}
      {lastSession && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Last Session</h2>
            <button
              onClick={() => navigate('/history')}
              style={{ background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: 13, padding: 0, display: 'flex', alignItems: 'center', gap: 2 }}
            >
              See all <ChevronRight size={14} />
            </button>
          </div>
          <div
            onClick={() => navigate(`/history/${lastSession.id}`)}
            style={{
              background: 'var(--color-surface)',
              borderRadius: 14,
              border: '1px solid var(--color-border)',
              padding: '16px',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{formatDate(lastSession.date)}</div>
                <div style={{ color: 'var(--color-muted)', fontSize: 13 }}>{lastSession.exercise_logs?.length || 0} exercises</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: 'var(--color-accent)' }}>{Math.round(calcVolume(lastSession))} kg</div>
                <div style={{ color: 'var(--color-muted)', fontSize: 12 }}>volume</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(lastSession.exercise_logs || []).slice(0, 5).map(log => {
                const ex = exercises.find(e => e.id === log.exercise_id)
                return ex ? (
                  <span key={log.id} style={{
                    background: 'var(--color-surface2)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 20,
                    padding: '3px 10px',
                    fontSize: 12,
                    color: 'var(--color-muted)',
                  }}>{ex.name}</span>
                ) : null
              })}
              {(lastSession.exercise_logs?.length || 0) > 5 && (
                <span style={{ fontSize: 12, color: 'var(--color-muted)', padding: '3px 0' }}>
                  +{lastSession.exercise_logs.length - 5} more
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {sessions.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '40px 24px',
          color: 'var(--color-muted)',
        }}>
          <Dumbbell size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p style={{ margin: 0 }}>No sessions yet. Log your first workout!</p>
        </div>
      )}
    </div>
  )
}
