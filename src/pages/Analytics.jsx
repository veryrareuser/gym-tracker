// src/pages/Analytics.jsx
import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, Zap, ChevronDown } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts'
import { getSessions, getExercises } from '../lib/db'
import { formatDate, getTopSet } from '../lib/utils'
import { volumeBuckets, startsNewMonth } from '../lib/stats'
import { useColorScheme, useChartTheme, CHART_COLORS, ChartThemeContext } from '../lib/useColorScheme'
import { currentUsername } from '../lib/auth'
import Leaderboard from '../components/Leaderboard'
import PersonalRecords from '../components/PersonalRecords'
import StatCards from '../components/StatCards'
import ActivityHeatmap from '../components/ActivityHeatmap'
import MuscleBalance from '../components/MuscleBalance'

/**
 * Grouping options for the volume chart, and the short month name it needs.
 *
 * Week first: it bounds the bar count by the calendar rather than by how often you train,
 * which is the thing that made one-bar-per-session unusable. Month answers "how am I
 * trending"; Session keeps the original view for spotting a single heavy day.
 */
const VOLUME_PERIODS = [
  { key: 'week', label: 'Week', short: 'W' },
  { key: 'month', label: 'Month', short: 'M' },
  { key: 'session', label: 'Session', short: 'S' },
]

function monthAbbr(iso) {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    new Date(`${iso}T00:00:00`).getMonth()
  ]
}

/** Declared at module scope so it is not remounted on every render. */
function ChartTooltip({ active, payload, label, unit }) {
  const c = useChartTheme()
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        background: c.surface,
        border: `1px solid ${c.grid}`,
        borderRadius: 11,
        padding: '8px 12px',
        fontSize: 14,
        color: c.text,
      }}
    >
      <div style={{ color: c.axis, marginBottom: 2 }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} className="tnum" style={{ color: c.series, fontWeight: 600 }}>
          {p.value} {unit}
        </div>
      ))}
    </div>
  )
}

export default function Analytics() {
  const [sessions, setSessions] = useState([])
  const [exercises, setExercises] = useState([])
  const [selectedExercise, setSelectedExercise] = useState('')
  const navigate = useNavigate()
  const scheme = useColorScheme()
  const c = CHART_COLORS[scheme]
  const username = currentUsername()

  useEffect(() => {
    Promise.all([getSessions(), getExercises()]).then(([s, e]) => {
      setSessions([...s].sort((a, b) => a.date.localeCompare(b.date)))
      setExercises(e)
      if (e.length > 0) setSelectedExercise(e[0].id)
    })
  }, [])

  // Only offer exercises that actually have logged sets, so the picker never
  // lands on an exercise that cannot render a chart.
  const trackedExercises = useMemo(() => {
    const used = new Set()
    for (const s of sessions) for (const log of s.exercise_logs || []) used.add(log.exercise_id)
    const available = exercises.filter(e => used.has(e.id))
    return available.length > 0 ? available : exercises
  }, [sessions, exercises])

  const weightData = useMemo(() => {
    if (!selectedExercise) return []
    return sessions
      .filter(s => s.exercise_logs?.some(l => l.exercise_id === selectedExercise))
      .map(s => {
        const log = s.exercise_logs.find(l => l.exercise_id === selectedExercise)
        return { date: s.date.slice(5), weight: parseFloat(getTopSet(log?.set_entries || [])?.weight) || 0 }
      })
  }, [sessions, selectedExercise])

  // Volume is grouped rather than one-bar-per-session. One bar per session means one bar
  // per training day, so the chart filled up and recharts began thinning the axis labels
  // until they no longer identified which bar was which. It also did slice(-12), which
  // silently dropped the oldest sessions — so the chart disagreed with the History page.
  //
  // Week is the default: it is the granularity people think in, and it bounds the bar count
  // by the calendar rather than by how often you train.
  const [volumePeriod, setVolumePeriod] = useState('week')

  const volumeData = useMemo(() => {
    const buckets = volumeBuckets(sessions, volumePeriod)
    return buckets.map((b, i) => ({
      ...b,
      volume: Math.round(b.volume),
      // A bar opening a new month is labelled in full ("Oct 5"); the rest show the day alone,
      // which is what makes a run of them readable. Every bar keeps its date for the
      // tooltip regardless.
      axis:
        volumePeriod === 'session' && !startsNewMonth(b, buckets[i - 1])
          ? b.label
          : `${monthAbbr(b.date)} ${new Date(`${b.date}T00:00:00`).getDate()}`,
      full: volumePeriod === 'session' ? formatDate(b.date) : `${b.sessions} session${b.sessions === 1 ? '' : 's'}`,
    }))
  }, [sessions, volumePeriod])

  const prs = useMemo(() => {
    const best = {}
    for (const s of sessions) {
      for (const log of s.exercise_logs || []) {
        const top = getTopSet(log.set_entries || [])
        if (!top) continue
        const w = parseFloat(top.weight) || 0
        if (!best[log.exercise_id] || w > best[log.exercise_id].weight) {
          best[log.exercise_id] = { weight: w, reps: top.reps, date: s.date }
        }
      }
    }
    return Object.entries(best)
      .map(([exerciseId, data]) => ({
        key: exerciseId,
        name: exercises.find(e => e.id === exerciseId)?.name || 'Unknown',
        ...data,
      }))
      .sort((a, b) => b.weight - a.weight)
  }, [sessions, exercises])

  const axisProps = { tick: { fill: c.axis, fontSize: 11 }, tickLine: false, axisLine: false }

  return (
    <ChartThemeContext.Provider value={c}>
      <div className="screen">
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, paddingTop: 'calc(env(safe-area-inset-top) + 20px)', marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h1 className="screen-title" style={{ margin: 0 }}>
            Stats
          </h1>
          <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)', margin: '2px 0 0' }}>
            Progress &amp; history
          </p>
        </div>
        <button onClick={() => navigate('/history')} className="btn-secondary" style={{ minHeight: 36, flexShrink: 0 }}>
          History
        </button>
      </header>

      {sessions.length === 0 && (
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <TrendingUp size={36} color="var(--ink-faint)" style={{ marginBottom: 10 }} />
          <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)' }}>
            Log some sessions to see your progress.
          </p>
        </div>
      )}

      {sessions.length > 0 && (
        <>
          <StatCards sessions={sessions} />

          <ActivityHeatmap sessions={sessions} />

          <MuscleBalance sessions={sessions} exercises={exercises} />

          <section className="card" style={{ padding: 17, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <TrendingUp size={18} color={c.series} />
              <h2 style={{ fontSize: 'var(--type-headline)', fontWeight: 600, margin: 0 }}>Weight Progression</h2>
            </div>

            <div style={{ position: 'relative', marginBottom: 14 }}>
              <select
                value={selectedExercise}
                aria-label="Exercise to chart"
                onChange={e => setSelectedExercise(e.target.value)}
                style={{ paddingRight: 36, appearance: 'none', fontSize: 'var(--type-subhead)' }}
              >
                {trackedExercises.map(ex => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={16}
                color="var(--ink-muted)"
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
              />
            </div>

            {weightData.length < 2 ? (
              <p style={{ textAlign: 'center', padding: '24px 0', color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)', margin: 0 }}>
                Log this exercise twice to see a trend.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={weightData} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                  <XAxis dataKey="date" {...axisProps} />
                  <YAxis {...axisProps} width={40} />
                  <Tooltip content={<ChartTooltip unit="kg" />} cursor={{ stroke: c.grid }} />
                  <Line
                    type="monotone"
                    dataKey="weight"
                    stroke={c.series}
                    strokeWidth={2.5}
                    dot={{ fill: c.series, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </section>

          <section className="card" style={{ padding: 17, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Zap size={18} color="var(--primary)" />
              <h2 style={{ fontSize: 'var(--type-headline)', fontWeight: 600, margin: 0, flex: 1 }}>
                Volume per {VOLUME_PERIODS.find(p => p.key === volumePeriod).label}
              </h2>
              <div
                role="group"
                aria-label="Volume period"
                style={{ display: 'inline-flex', background: 'var(--fill)', borderRadius: 'var(--rounded-pill)', padding: 2 }}
              >
                {VOLUME_PERIODS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => setVolumePeriod(p.key)}
                    aria-pressed={volumePeriod === p.key}
                    style={{
                      border: 0,
                      background: volumePeriod === p.key ? 'var(--surface)' : 'transparent',
                      color: volumePeriod === p.key ? 'var(--ink)' : 'var(--ink-muted)',
                      fontSize: 'var(--type-fine)',
                      fontWeight: volumePeriod === p.key ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                      padding: '5px 10px',
                      borderRadius: 'var(--rounded-pill)',
                      cursor: 'pointer',
                    }}
                  >
                    {p.short}
                  </button>
                ))}
              </div>
            </div>
            {/* Scrolls only when the bars genuinely do not fit. In session mode a long
                history is wider than a phone, and scrolling beats thinning the axis until
                the labels stop meaning anything. */}
            <div className="vol-scroll">
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={volumeData} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                  <XAxis dataKey="axis" {...axisProps} interval={0} angle={0} />
                  <YAxis {...axisProps} width={40} />
                  <Tooltip
                    cursor={{ fill: c.grid, opacity: 0.4 }}
                    content={({ active, payload }) =>
                      active && payload?.length ? (
                        <div
                          style={{
                            background: c.surface,
                            border: `1px solid ${c.grid}`,
                            borderRadius: 11,
                            padding: '8px 12px',
                            fontSize: 14,
                            color: c.text,
                          }}
                        >
                          <div style={{ color: c.axis, marginBottom: 2 }}>{formatDate(payload[0].payload.date)}</div>
                          <div className="tnum" style={{ color: c.series, fontWeight: 600 }}>
                            {payload[0].value.toLocaleString()} kg · {payload[0].payload.full}
                          </div>
                        </div>
                      ) : null
                    }
                  />
                  <Bar dataKey="volume" radius={[8, 8, 0, 0]} maxBarSize={28}>
                    {volumeData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={i === volumeData.length - 1 ? c.series : c.muted}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Say plainly how much of the history is on screen. The old chart hid the
                oldest sessions without saying so. */}
            <p style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)', margin: '10px 0 0' }}>
              {volumePeriod === 'session'
                ? `${volumeData.length} session${volumeData.length === 1 ? '' : 's'}, all of them`
                : `${sessions.length} session${sessions.length === 1 ? '' : 's'} grouped · ${volumeData.filter(b => b.sessions > 0).length} with training`}
            </p>
          </section>

          <PersonalRecords records={prs} />
        </>
      )}

        <Leaderboard username={username} />
      </div>
    </ChartThemeContext.Provider>
  )
}
