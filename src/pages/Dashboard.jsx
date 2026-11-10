// src/pages/Dashboard.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dumbbell, Flame, TrendingUp, ChevronRight, Plus, Clock } from 'lucide-react'
import { getSessionSummaries } from '../lib/db'
import { formatDate, todayISO, formatHoursDecimal } from '../lib/utils'
import { weekStreak, totalDurationSeconds } from '../lib/stats'

export default function Dashboard() {
  const [sessions, setSessions] = useState([])
  // Captured once on mount. Reading the clock during render is an impurity: the value
  // would change on every re-render, and React is free to re-render at any time, so the
  // greeting could disagree with the "logged today" check computed further down.
  const [today] = useState(() => new Date())
  const navigate = useNavigate()

  useEffect(() => {
    // The summaries, not the full session trees. The dashboard shows a date, a volume and
    // a few exercise names; shipping every set of every session to draw that is 176 KB
    // of data the page never reads.
    getSessionSummaries().then(setSessions)
  }, [])

  const lastSession = sessions[0]
  const loggedToday = lastSession?.date === todayISO()

  const streak = weekStreak(sessions)
  const totalHours = formatHoursDecimal(totalDurationSeconds(sessions))

  const stats = [
    {
      label: 'Streak',
      value: streak,
      unit: streak === 1 ? 'week' : 'weeks',
      icon: Flame,
    },
    { label: 'Sessions', value: sessions.length, unit: 'total', icon: Dumbbell },
    {
      label: 'Last Volume',
      value: lastSession ? Math.round(lastSession.volume) : 0,
      unit: 'kg',
      icon: TrendingUp,
    },
    {
      label: 'Time',
      value: totalHours,
      unit: 'hours',
      icon: Clock,
    },
  ]

  return (
    <div className="screen">
      <header style={{ paddingTop: 'calc(env(safe-area-inset-top) + 20px)', paddingBottom: 20 }}>
        <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)', margin: '0 0 2px' }}>
          {today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1 className="screen-title">{loggedToday ? 'Session logged' : 'Ready to train?'}</h1>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 24 }}>
        {stats.map(({ label, value, unit, icon: Icon }) => (
          <div key={label} className="card card-accent" style={{ padding: '17px 8px', textAlign: 'center' }}>
            <Icon size={19} color="var(--nb-black)" style={{ marginBottom: 8 }} aria-hidden="true" />
            <div className="tnum" style={{ fontSize: 'var(--type-title)', fontWeight: 700, lineHeight: 1.1 }}>
              {value}
            </div>
            <div style={{ fontSize: 'var(--type-fine)', color: 'var(--nb-black)', marginTop: 2, opacity: 0.7 }}>{unit}</div>
            <div style={{ fontSize: 'var(--type-fine)', color: 'var(--nb-black)', opacity: 0.7 }}>{label}</div>
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
                  {lastSession.exercise_count || 0} exercises
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="tnum" style={{ fontWeight: 600, color: 'var(--primary)' }}>
                  {Math.round(lastSession.volume)} kg
                </div>
                <div style={{ color: 'var(--ink-muted)', fontSize: 'var(--type-fine)' }}>volume</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(lastSession.exercise_names || []).slice(0, 5).map((name, i) => (
                <span key={`${name}-${i}`} className="chip" style={{ textTransform: 'none' }}>
                  {name}
                </span>
              ))}
              {(lastSession.exercise_names || []).length > 5 && (
                <span style={{ fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)', alignSelf: 'center' }}>
                  +{lastSession.exercise_names.length - 5} more
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
