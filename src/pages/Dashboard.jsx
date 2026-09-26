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
  const loggedToday = lastSession?.date === todayISO()

  // Consecutive days ending today or yesterday.
  function calcStreak() {
    if (sessions.length === 0) return 0
    const dates = new Set(sessions.map(s => s.date))
    const cursor = new Date()
    // Today not being logged yet should not break yesterday's streak.
    if (!dates.has(cursor.toISOString().slice(0, 10))) cursor.setDate(cursor.getDate() - 1)
    let streak = 0
    while (dates.has(cursor.toISOString().slice(0, 10))) {
      streak++
      cursor.setDate(cursor.getDate() - 1)
    }
    return streak
  }

  const stats = [
    { label: 'Streak', value: calcStreak(), unit: 'days', icon: Flame, color: 'var(--ink)' },
    { label: 'Sessions', value: sessions.length, unit: 'total', icon: Dumbbell, color: 'var(--primary)' },
    {
      label: 'Last Volume',
      value: lastSession ? Math.round(calcVolume(lastSession)) : 0,
      unit: 'kg',
      icon: TrendingUp,
      color: 'var(--primary)',
    },
  ]

  return (
    <div className="screen">
      <header style={{ paddingTop: 'calc(env(safe-area-inset-top) + 20px)', paddingBottom: 20 }}>
        <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)', margin: '0 0 2px' }}>
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1 className="screen-title">{loggedToday ? 'Session logged' : 'Ready to train?'}</h1>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 24 }}>
        {stats.map(({ label, value, unit, icon: Icon, color }) => (
          <div key={label} className="card" style={{ padding: '17px 8px', textAlign: 'center' }}>
            <Icon size={19} color={color} style={{ marginBottom: 8 }} aria-hidden="true" />
            <div className="tnum" style={{ fontSize: 'var(--type-title)', fontWeight: 600, lineHeight: 1.1 }}>
              {value}
            </div>
            <div style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)', marginTop: 2 }}>{unit}</div>
            <div style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>{label}</div>
          </div>
        ))}
      </div>

      <button
        onClick={() => navigate('/log')}
        className="btn-primary btn-block"
        style={{ minHeight: 50, marginBottom: 24 }}
      >
        <Plus size={20} />
        {loggedToday ? 'Log Another Session' : 'Start Workout'}
      </button>

      {lastSession ? (
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ fontSize: 'var(--type-title)', letterSpacing: 'var(--tracking-title)', fontWeight: 600, margin: 0 }}>Last Session</h2>
            <button onClick={() => navigate('/history')} className="btn-quiet" style={{ fontSize: 'var(--type-subhead)' }}>
              See all
              <ChevronRight size={15} />
            </button>
          </div>

          <button
            onClick={() => navigate(`/history/${lastSession.id}`)}
            className="card"
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: 16 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 'var(--type-headline)', letterSpacing: 'var(--tracking-headline)' }}>{formatDate(lastSession.date)}</div>
                <div style={{ color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)' }}>
                  {lastSession.exercise_logs?.length || 0} exercises
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="tnum" style={{ fontWeight: 600, color: 'var(--primary)' }}>
                  {Math.round(calcVolume(lastSession))} kg
                </div>
                <div style={{ color: 'var(--ink-muted)', fontSize: 'var(--type-fine)' }}>volume</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(lastSession.exercise_logs || []).slice(0, 5).map(log => {
                const name = exercises.find(e => e.id === log.exercise_id)?.name
                if (!name) return null
                return (
                  <span key={log.id} className="chip" style={{ textTransform: 'none' }}>
                    {name}
                  </span>
                )
              })}
              {(lastSession.exercise_logs?.length || 0) > 5 && (
                <span style={{ fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)', alignSelf: 'center' }}>
                  +{lastSession.exercise_logs.length - 5} more
                </span>
              )}
            </div>
          </button>
        </section>
      ) : (
        <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <Dumbbell size={36} color="var(--ink-faint)" style={{ marginBottom: 10 }} />
          <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)' }}>
            No sessions yet. Log your first workout.
          </p>
        </div>
      )}
    </div>
  )
}
