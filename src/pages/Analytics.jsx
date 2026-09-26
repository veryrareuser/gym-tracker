// src/pages/Analytics.jsx
import { useEffect, useState, useMemo } from 'react'
import { TrendingUp, Award, Zap, ChevronDown } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts'
import { getSessions, getExercises } from '../lib/db'
import { calcVolume, getTopSet } from '../lib/utils'
import { useColorScheme, useChartTheme, CHART_COLORS, ChartThemeContext } from '../lib/useColorScheme'

/** Declared at module scope so it is not remounted on every render. */
function ChartTooltip({ active, payload, label, unit }) {
  const c = useChartTheme()
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        background: c.surface,
        border: `1px solid ${c.grid}`,
        borderRadius: 12,
        padding: '8px 12px',
        fontSize: 13,
        color: c.text,
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
      }}
    >
      <div style={{ color: c.axis, marginBottom: 2 }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} className="tnum" style={{ color: c.series, fontWeight: 700 }}>
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
  const scheme = useColorScheme()
  const c = CHART_COLORS[scheme]

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

  const volumeData = useMemo(
    () => sessions.slice(-12).map(s => ({ date: s.date.slice(5), volume: Math.round(calcVolume(s)) })),
    [sessions],
  )

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
      <h1 className="screen-title" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 20px)', marginBottom: 20 }}>
        Progress
      </h1>

      {sessions.length === 0 && (
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <TrendingUp size={36} color="var(--color-faint)" style={{ marginBottom: 10 }} />
          <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 'var(--type-subhead)' }}>
            Log some sessions to see your progress.
          </p>
        </div>
      )}

      {sessions.length > 0 && (
        <>
          <section className="card" style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <TrendingUp size={18} color={c.series} />
              <h2 style={{ fontSize: 'var(--type-headline)', fontWeight: 700, margin: 0 }}>Weight Progression</h2>
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
                color="var(--color-muted)"
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
              />
            </div>

            {weightData.length < 2 ? (
              <p style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-muted)', fontSize: 'var(--type-footnote)', margin: 0 }}>
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

          <section className="card" style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Zap size={18} color="var(--color-warning-fill)" />
              <h2 style={{ fontSize: 'var(--type-headline)', fontWeight: 700, margin: 0 }}>Volume per Session</h2>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={volumeData} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                <XAxis dataKey="date" {...axisProps} />
                <YAxis {...axisProps} width={40} />
                <Tooltip content={<ChartTooltip unit="kg vol" />} cursor={{ fill: c.grid, opacity: 0.4 }} />
                <Bar dataKey="volume" radius={[6, 6, 0, 0]} maxBarSize={28}>
                  {volumeData.map((_, i) => (
                    <Cell key={i} fill={i === volumeData.length - 1 ? c.series : c.muted} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </section>

          <section className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Award size={18} color="var(--color-warning-fill)" />
              <h2 style={{ fontSize: 'var(--type-headline)', fontWeight: 700, margin: 0 }}>Personal Records</h2>
            </div>
            {prs.length === 0 ? (
              <p style={{ color: 'var(--color-muted)', fontSize: 'var(--type-footnote)', margin: 0 }}>No records yet.</p>
            ) : (
              prs.map((pr, i) => (
                <div
                  key={pr.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 0',
                    borderTop: i === 0 ? 'none' : '1px solid var(--color-border)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 'var(--type-subhead)' }}>{pr.name}</div>
                    <div style={{ fontSize: 'var(--type-caption)', color: 'var(--color-muted)' }}>{pr.date}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="tnum" style={{ fontWeight: 700, fontSize: 'var(--type-headline)', color: 'var(--color-warning)' }}>
                      {pr.weight} kg
                    </div>
                    <div className="tnum" style={{ fontSize: 'var(--type-caption)', color: 'var(--color-muted)' }}>
                      {pr.reps} reps
                    </div>
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      )}
      </div>
    </ChartThemeContext.Provider>
  )
}
