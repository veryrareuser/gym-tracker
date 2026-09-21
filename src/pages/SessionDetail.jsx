// src/pages/SessionDetail.jsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Edit2, Dumbbell } from 'lucide-react'
import { getSessions, getExercises } from '../lib/db'
import { formatDate, calcVolume } from '../lib/utils'

export default function SessionDetail() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const [session, setSession] = useState(null)
  const [exercises, setExercises] = useState([])

  useEffect(() => {
    Promise.all([getSessions(), getExercises()]).then(([sessions, exs]) => {
      setSession(sessions.find(s => s.id === sessionId) || null)
      setExercises(exs)
    })
  }, [sessionId])

  if (!session) return (
    <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-muted)' }}>
      Loading...
    </div>
  )

  return (
    <div style={{ padding: '16px 16px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', padding: 0 }}>
          <ArrowLeft size={22} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{formatDate(session.date)}</h1>
          <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>
            {session.exercise_logs?.length || 0} exercises · {Math.round(calcVolume(session))} kg total volume
          </div>
        </div>
        <button
          onClick={() => navigate(`/log/${session.id}`)}
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
        >
          <Edit2 size={14} /> Edit
        </button>
      </div>

      {/* Exercise cards */}
      {(session.exercise_logs || []).map(log => {
        const ex = exercises.find(e => e.id === log.exercise_id)
        const sets = log.set_entries || []
        const topWeight = sets.length > 0 ? Math.max(...sets.map(s => parseFloat(s.weight) || 0)) : 0

        return (
          <div key={log.id} style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 14,
            padding: '16px',
            marginBottom: 12,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 10,
                  background: 'var(--color-surface2)',
                  border: '1px solid var(--color-border)',
                  overflow: 'hidden',
                  flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {ex?.image_url
                    ? <img src={ex.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" onError={e => { e.target.style.display = 'none' }} />
                    : <Dumbbell size={20} color="var(--color-border)" />
                  }
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{ex?.name || 'Unknown'}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>{ex?.muscle_group}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--color-accent)' }}>{topWeight} kg</div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>top set</div>
              </div>
            </div>

            {/* Sets table */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--color-muted)', textAlign: 'center', paddingBottom: 4 }}>Set</div>
              <div style={{ fontSize: 11, color: 'var(--color-muted)', textAlign: 'center', paddingBottom: 4 }}>Weight</div>
              <div style={{ fontSize: 11, color: 'var(--color-muted)', textAlign: 'center', paddingBottom: 4 }}>Reps</div>
              {sets.map(set => (
                <>
                  <div key={`s-${set.id}`} style={{ textAlign: 'center', fontSize: 14, fontWeight: 600, color: 'var(--color-muted)' }}>
                    {set.set_number}
                  </div>
                  <div key={`w-${set.id}`} style={{ textAlign: 'center', fontSize: 14, fontWeight: 700 }}>
                    {set.weight} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-muted)' }}>kg</span>
                  </div>
                  <div key={`r-${set.id}`} style={{ textAlign: 'center', fontSize: 14, fontWeight: 700 }}>
                    {set.reps}
                  </div>
                </>
              ))}
            </div>

            {set => set.note && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-muted)', fontStyle: 'italic' }}>
                {set.note}
              </div>
            )}
          </div>
        )
      })}

      {session.notes && (
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 14,
          padding: 16,
          marginTop: 8,
        }}>
          <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>Session notes</div>
          <div style={{ fontSize: 14 }}>{session.notes}</div>
        </div>
      )}
    </div>
  )
}
