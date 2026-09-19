// src/pages/Analytics.jsx
import { useEffect, useState, useMemo } from 'react'
import { TrendingUp, Award, Zap, ChevronDown } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts'
import { getSessions, getExercises } from '../lib/db'
import { calcVolume, getTopSet } from '../lib/utils'

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--color-surface2)', border: '1px solid var(--color-border)',
      borderRadius: 10, padding: '8px 12px', fontSize: 13,
    }}>
      <div style={{ color: 'var(--color-muted)', marginBottom: 2 }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: 'var(--color-accent)', fontWeight: 700 }}>
          {p.value} {p.name === 'volume' ? 'kg vol' : 'kg'}
        </div>
      ))}
    </div>
  )
}

export default function Analytics() {
  const [sessions, setSessions] = useState([])
  const [exercises, setExercises] = useState([])
  const [selectedExercise, setSelectedExercise] = useState('')

  useEffect(() => {
    Promise.all([getSessions(), getExercises()]).then(([s, e]) => {
      setSessions(s.sort((a, b) => a.date.localeCompare(b.date)))
      setExercises(e)
      if (e.length > 0) setSelectedExercise(e[0].id)
    })
  }, [])

  /* ─── Weight progression data ─── */
  const weightData = useMemo(() => {
    if (!selectedExercise) return []
    return sessions
      .filter(s => s.exercise_logs?.some(l => l.exercise_id === selectedExercise))
      .map(s => {
        const log = s.exercise_logs.find(l => l.exercise_id === selectedExercise)
        const top = getTopSet(log?.set_entries || [])
        return {
          date: s.date.slice(5), // MM-DD
          weight: parseFloat(top?.weight) || 0,
        }
      })
  }, [sessions, selectedExercise])

  /* ─── Volume per session ─── */
  const volumeData = useMemo(() => {
    return sessions.slice(-12).map(s => ({
      date: s.date.slice(5),
      volume: Math.round(calcVolume(s)),
    }))
  }, [sessions])

  /* ─── Personal Records ─── */
  const prs = useMemo(() => {
    const map = {}
    sessions.forEach(s => {
      ;(s.exercise_logs || []).forEach(log => {
        const top = getTopSet(log.set_entries || [])
        if (!top) return
        const w = parseFloat(top.weight) || 0
        if (!map[log.exercise_id] || w > map[log.exercise_id].weight) {
          map[log.exercise_id] = { weight: w, reps: top.reps, date: s.date }
        }
      })
    })
    return Object.entries(map)
      .map(([exId, data]) => ({
        name: exercises.find(e => e.id === exId)?.name || 'Unknown',
        ...data,
      }))
      .sort((a, b) => b.weight - a.weight)
  }, [sessions, exercises])

  return (
    <div style={{ padding: '24px 16px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 20 }}>Progress</h1>

      {sessions.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--color-muted)' }}>
          <TrendingUp size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p>Log some sessions to see your progress.</p>
        </div>
      )}

      {sessions.length > 0 && (
        <>
          {/* ── Section A: Weight Progression ── */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <TrendingUp size={16} color="var(--color-accent)" />
              <span style={{ fontWeight: 700, fontSize: 15 }}>Weight Progression</span>
            </div>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <select
                value={selectedExercise}
                onChange={e => setSelectedExercise(e.target.value)}
                style={{ paddingRight: 32, appearance: 'none' }}
              >
                {exercises.map(ex => (
                  <option key={ex.id} value={ex.id}>{ex.name}</option>
                ))}
              </select>
              <ChevronDown size={14} color="var(--color-muted)" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            </div>
            {weightData.length < 2 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-muted)', fontSize: 13 }}>
                Need at least 2 sessions with this exercise to show a chart.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={weightData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="date" tick={{ fill: 'var(--color-muted)', fontSize: 10 }} />
                  <YAxis tick={{ fill: 'var(--color-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="weight" stroke="var(--color-accent)" strokeWidth={2.5} dot={{ fill: 'var(--color-accent)', r: 4 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── Section B: Volume per Session ── */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Zap size={16} color="#60a5fa" />
              <span style={{ fontWeight: 700, fontSize: 15 }}>Total Volume per Session</span>
            </div>
            {volumeData.length < 1 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-muted)', fontSize: 13 }}>No data yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={volumeData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="date" tick={{ fill: 'var(--color-muted)', fontSize: 10 }} />
                  <YAxis tick={{ fill: 'var(--color-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="volume" radius={[4, 4, 0, 0]}>
                    {volumeData.map((_, i) => (
                      <Cell key={i} fill={i === volumeData.length - 1 ? 'var(--color-accent)' : '#60a5fa'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── Section C: Personal Records ── */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Award size={16} color="#f59e0b" />
              <span style={{ fontWeight: 700, fontSize: 15 }}>Personal Records</span>
            </div>
            {prs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--color-muted)', fontSize: 13 }}>No records yet.</div>
            ) : (
              <div>
                {prs.map((pr, i) => (
                  <div key={pr.name} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 0',
                    borderBottom: i < prs.length - 1 ? '1px solid var(--color-border)' : 'none',
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{pr.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>{pr.date}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800, fontSize: 16, color: '#f59e0b' }}>{pr.weight} kg</div>
                      <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>{pr.reps} reps</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
