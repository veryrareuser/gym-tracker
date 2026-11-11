// src/components/RoutinePicker.jsx
//
// The Log tab's first screen: the list of routines.
//
// This is what the Log page used to be missing. It used to open on the whole
// exercise library, which after a few months is dozens of rows long, so finding the
// six exercises you were actually doing meant scrolling past everything you were
// not. Here you pick a routine and only its exercises appear.
//
// A routine holds a handful of exercises in the order you want them. Adding a leg
// exercise to a Leg Day routine leaves the Upper Body routine alone.

import { useState } from 'react'
import { ChevronRight, Plus, Dumbbell } from 'lucide-react'

/**
 * @param routines  [{ id, name, exercise_ids }]
 * @param onPick    called with a routine's id, or null for "log without a routine"
 * @param onCreate  called with a new routine's name; it returns the new routine
 */
export default function RoutinePicker({ routines = [], onPick, onCreate }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    const clean = name.trim()
    if (!clean || busy) return
    setBusy(true)
    setError('')
    try {
      await onCreate(clean)
      setName('')
      setCreating(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)', margin: '0 0 16px' }}>
        Pick a routine to log.
      </p>

      {routines.length === 0 && !creating && (
        <div className="card card-accent" style={{ padding: 20, marginBottom: 12, textAlign: 'center' }}>
          <Dumbbell size={24} color="var(--nb-black)" style={{ marginBottom: 10 }} />
          <p style={{ margin: 0, fontWeight: 700, fontSize: 'var(--type-headline)' }}>No routines yet</p>
          <p style={{ margin: '6px 0 0', fontSize: 'var(--type-subhead)', color: 'var(--nb-black)', opacity: 0.75 }}>
            A routine is a short list of exercises in the order you want them.
          </p>
        </div>
      )}

      {routines.map(routine => (
        <button
          key={routine.id}
          onClick={() => onPick(routine.id)}
          className="card"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            width: '100%',
            padding: 16,
            marginBottom: 10,
            textAlign: 'left',
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: 'block',
                fontWeight: 700,
                fontSize: 'var(--type-headline)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {routine.name}
            </span>
            <span style={{ display: 'block', color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)' }}>
              {routine.exercise_ids.length} exercise{routine.exercise_ids.length === 1 ? '' : 's'}
            </span>
          </span>
          <ChevronRight size={20} color="var(--ink-muted)" style={{ flexShrink: 0 }} />
        </button>
      ))}

      {creating ? (
        <form onSubmit={submit} className="card" style={{ padding: 16, marginBottom: 10 }}>
          <label htmlFor="routine-name" className="section-label" style={{ display: 'block' }}>
            New routine
          </label>
          <input
            id="routine-name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Upper Body"
            maxLength={100}
            autoFocus
            style={{ marginBottom: 10 }}
          />
          {error && (
            <p role="alert" style={{ margin: '0 0 10px', color: 'var(--destructive)', fontSize: 'var(--type-subhead)' }}>
              {error}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn-primary" disabled={busy || !name.trim()} style={{ flex: 1 }}>
              {busy ? 'Creating…' : 'Create'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => { setCreating(false); setName(''); setError('') }}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setCreating(true)} className="btn-secondary btn-block" style={{ marginBottom: 16 }}>
          <Plus size={18} />
          New routine
        </button>
      )}

      {/* The escape hatch. Someone who does not use routines is not stuck: they can
          still log anything, with the long list they had before. */}
      <button
        onClick={() => onPick(null)}
        className="btn-quiet"
        style={{ width: '100%', justifyContent: 'center', minHeight: 'var(--hit-min)' }}
      >
        Log without a routine
      </button>
    </div>
  )
}
