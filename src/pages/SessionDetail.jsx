// src/pages/SessionDetail.jsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Dumbbell, Trash2 } from 'lucide-react'
import { getSessions, getExercises, deleteSession } from '../lib/db'
import { formatDate, calcVolume } from '../lib/utils'
import ConfirmDialog from '../components/ConfirmDialog'

export default function SessionDetail() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const [session, setSession] = useState(null)
  const [exercises, setExercises] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    Promise.all([getSessions(), getExercises()]).then(([sessions, exs]) => {
      setSession(sessions.find(s => s.id === sessionId) || null)
      setExercises(exs)
      setLoaded(true)
    })
  }, [sessionId])

  async function handleDelete() {
    setConfirming(false)
    try {
      await deleteSession(sessionId)
      navigate('/history', { replace: true })
    } catch (err) {
      alert(`Could not delete the session: ${err.message}`)
    }
  }

  if (!loaded) {
    return (
      <div className="screen" style={{ paddingTop: 80, textAlign: 'center', color: 'var(--ink-muted)' }}>
        Loading…
      </div>
    )
  }

  if (!session) {
    return (
      <div className="screen" style={{ paddingTop: 80, textAlign: 'center' }}>
        <p style={{ color: 'var(--ink-muted)', marginBottom: 16 }}>This session no longer exists.</p>
        <button onClick={() => navigate('/history')} className="btn-quiet">
          Back to History
        </button>
      </div>
    )
  }

  return (
    <div className="screen">
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingTop: 'calc(env(safe-area-inset-top) + 8px)',
          paddingBottom: 16,
        }}
      >
        <button onClick={() => navigate(-1)} aria-label="Back" className="hit" style={{ marginLeft: -10 }}>
          <ArrowLeft size={24} color="var(--primary)" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="screen-title" style={{ fontSize: 'var(--type-title)', letterSpacing: 'var(--tracking-title)' }}>
            {formatDate(session.date)}
          </h1>
          <div style={{ fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)' }}>
            {session.exercise_logs?.length || 0} exercises · {Math.round(calcVolume(session))} kg volume
          </div>
        </div>
        <button
          onClick={() => setConfirming(true)}
          aria-label="Delete session"
          className="btn-icon"
          style={{ flexShrink: 0 }}
        >
          <Trash2 size={18} color="var(--destructive)" />
        </button>
        <button
          onClick={() => navigate(`/log/${session.id}`)}
          className="btn-secondary"
          style={{ fontSize: 'var(--type-subhead)', padding: '8px 16px', flexShrink: 0 }}
        >
          <Pencil size={14} /> Edit
        </button>
      </header>

      {(session.exercise_logs || []).map(log => {
        const ex = exercises.find(e => e.id === log.exercise_id)
        const sets = log.set_entries || []
        const topWeight = sets.reduce((max, s) => Math.max(max, parseFloat(s.weight) || 0), 0)
        // Notes can differ per set, so collect them rather than reading one entry.
        const notes = [...new Set(sets.map(s => s.note).filter(Boolean))]

        return (
          <section key={log.id} className="card" style={{ padding: 17, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <span className="thumb" style={{ width: 44, height: 44 }}>
                  {ex?.image_url ? (
                    <img src={ex.image_url} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <Dumbbell size={18} color="var(--ink-faint)" />
                  )}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--type-headline)', letterSpacing: 'var(--tracking-headline)' }}>{ex?.name || 'Unknown'}</div>
                  {ex?.muscle_group && (
                    <div style={{ fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)' }}>{ex.muscle_group}</div>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div className="tnum" style={{ fontWeight: 600, fontSize: 'var(--type-headline)', color: 'var(--primary)' }}>
                  {topWeight} kg
                </div>
                <div style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>top set</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {['Set', 'Weight', 'Reps'].map(label => (
                <div
                  key={label}
                  style={{
                    fontSize: 'var(--type-fine)',
                    color: 'var(--ink-muted)',
                    textAlign: 'center',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    paddingBottom: 4,
                  }}
                >
                  {label}
                </div>
              ))}
              {sets.map(set => (
                <div key={set.id} style={{ display: 'contents' }}>
                  <div className="tnum" style={{ textAlign: 'center', fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)' }}>
                    {set.set_number}
                  </div>
                  <div className="tnum" style={{ textAlign: 'center', fontSize: 'var(--type-subhead)', fontWeight: 600 }}>
                    {set.weight} <span style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>kg</span>
                  </div>
                  <div className="tnum" style={{ textAlign: 'center', fontSize: 'var(--type-subhead)', fontWeight: 600 }}>
                    {set.reps}
                  </div>
                </div>
              ))}
            </div>

            {notes.length > 0 && (
              <p style={{ margin: '10px 0 0', fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)', fontStyle: 'italic' }}>
                {notes.join(' · ')}
              </p>
            )}
          </section>
        )
      })}

      {session.notes && (
        <section className="card" style={{ padding: 17, marginTop: 4 }}>
          <div className="section-label" style={{ marginBottom: 4 }}>
            Notes
          </div>
          <p style={{ margin: 0, fontSize: 'var(--type-subhead)' }}>{session.notes}</p>
        </section>
      )}

      <ConfirmDialog
        open={confirming}
        title="Delete this session?"
        message="All of its logged sets will be removed. This cannot be undone."
        onCancel={() => setConfirming(false)}
        onConfirm={handleDelete}
      />
    </div>
  )
}
