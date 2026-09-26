// src/pages/Exercises.jsx
import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Check, X, Dumbbell, CircleAlert, ListChecks } from 'lucide-react'
import { getExercises, saveExercise, deleteExercise } from '../lib/db'
import { generateId } from '../lib/utils'
import { imageUrl } from '../lib/exerciseDb'
import ExercisePicker from '../components/ExercisePicker'
import ConfirmDialog from '../components/ConfirmDialog'

const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core', 'Cardio', 'Other']

function ExerciseForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '')
  const [muscle, setMuscle] = useState(initial?.muscle_group || '')

  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onSave({
      ...initial,
      id: initial?.id || generateId(),
      name: name.trim(),
      muscle_group: muscle,
      order: initial?.order ?? Date.now(),
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="card"
      style={{ padding: 17, marginBottom: 12, border: '2px solid var(--primary-focus)' }}
    >
      <label htmlFor="ex-name" className="section-label">
        Name
      </label>
      <input
        id="ex-name"
        placeholder="Exercise name"
        value={name}
        onChange={e => setName(e.target.value)}
        autoFocus
        style={{ marginBottom: 12 }}
      />
      <label htmlFor="ex-muscle" className="section-label">
        Muscle group
      </label>
      <select id="ex-muscle" value={muscle} onChange={e => setMuscle(e.target.value)} style={{ marginBottom: 17 }}>
        <option value="">None</option>
        {MUSCLE_GROUPS.map(g => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn-primary" style={{ flex: 1 }}>
          <Check size={18} /> {initial ? 'Update' : 'Add'}
        </button>
        <button type="button" onClick={onCancel} aria-label="Cancel" className="btn-icon">
          <X size={18} color="var(--ink-muted)" />
        </button>
      </div>
    </form>
  )
}

export default function Exercises() {
  const [exercises, setExercises] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [showPicker, setShowPicker] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    getExercises().then(setExercises)
  }, [])

  async function handleSave(exercise) {
    setError(null)
    try {
      await saveExercise(exercise)
    } catch (err) {
      setError(`Could not save “${exercise.name}”: ${err.message}`)
      return
    }
    // Optimistic: a re-fetch would race the upsert and return a stale list.
    setExercises(prev => {
      const idx = prev.findIndex(e => e.id === exercise.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = exercise
        return next
      }
      return [...prev, exercise]
    })
    setShowForm(false)
    setEditing(null)
  }

  async function confirmDelete() {
    const target = pendingDelete
    setPendingDelete(null)
    if (!target) return
    try {
      await deleteExercise(target.id)
      setExercises(prev => prev.filter(e => e.id !== target.id))
    } catch {
      // exercise_logs.exercise_id is NO ACTION, so an exercise that past sessions
      // reference cannot be removed. Say so rather than reporting a false success.
      setError(
        `“${target.name}” is used in past sessions and can’t be removed. Rename it instead, or delete those sessions first.`,
      )
    }
  }

  async function handlePick(ex) {
    const record = {
      id: ex.id,
      name: ex.name.charAt(0).toUpperCase() + ex.name.slice(1),
      muscle_group: ex.body_part.charAt(0).toUpperCase() + ex.body_part.slice(1),
      order: Date.now(),
      image_url: imageUrl(ex.image),
    }
    setShowPicker(false)
    await handleSave(record)
  }

  const sorted = [...exercises].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  return (
    <div className="screen">
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          paddingTop: 'calc(env(safe-area-inset-top) + 20px)',
          paddingBottom: 16,
        }}
      >
        <h1 className="screen-title" style={{ fontSize: 'var(--type-title)', letterSpacing: 'var(--tracking-title)' }}>
          Exercises
        </h1>
        <button
          onClick={() => {
            setEditing(null)
            setShowForm(v => !v)
          }}
          className="btn-primary"
          style={{ fontSize: 'var(--type-subhead)', padding: '8px 16px' }}
        >
          <Plus size={16} /> Custom
        </button>
      </header>

      {error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            gap: 10,
            padding: 12,
            marginBottom: 12,
            borderRadius: 'var(--rounded-md)',
            background: 'var(--fill)',
            borderLeft: '3px solid var(--destructive)',
          }}
        >
          <CircleAlert size={18} color="var(--destructive)" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 'var(--type-subhead)' }}>{error}</span>
        </div>
      )}

      {showForm && <ExerciseForm onSave={handleSave} onCancel={() => setShowForm(false)} />}
      {editing && <ExerciseForm initial={editing} onSave={handleSave} onCancel={() => setEditing(null)} />}

      <button onClick={() => setShowPicker(true)} className="btn-secondary btn-block" style={{ marginBottom: 16 }}>
        <ListChecks size={17} />
        Browse the exercise library
      </button>

      {showPicker && (
        <ExercisePicker
          onClose={() => setShowPicker(false)}
          usedIds={exercises.map(e => e.id)}
          onSelect={handlePick}
        />
      )}

      {sorted.length === 0 && !showForm && (
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <Dumbbell size={36} color="var(--ink-faint)" style={{ marginBottom: 10 }} />
          <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)' }}>
            No exercises yet. Add one from the library or create your own.
          </p>
        </div>
      )}

      {sorted.map(ex => (
        <div key={ex.id} className="card" style={{ display: 'flex', alignItems: 'center', marginBottom: 8, overflow: 'hidden' }}>
          <span className="thumb" style={{ width: 44, height: 44, margin: 10, borderRadius: 'var(--rounded-sm)' }}>
            {ex.image_url ? <img src={ex.image_url} alt="" loading="lazy" decoding="async" /> : <Dumbbell size={18} color="var(--ink-faint)" />}
          </span>
          <div style={{ flex: 1, minWidth: 0, padding: '12px 0' }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--type-subhead)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ex.name}
            </div>
            {ex.muscle_group && (
              <div style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>{ex.muscle_group}</div>
            )}
          </div>
          <button
            onClick={() => {
              setShowForm(false)
              setEditing(ex)
            }}
            aria-label={`Edit ${ex.name}`}
            className="btn-icon"
          >
            <Pencil size={16} color="var(--ink-muted)" />
          </button>
          <button
            onClick={() => setPendingDelete(ex)}
            aria-label={`Remove ${ex.name}`}
            className="btn-icon"
            style={{ borderLeft: '1px solid var(--line)' }}
          >
            <Trash2 size={16} color="var(--destructive)" />
          </button>
        </div>
      ))}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Remove “${pendingDelete?.name ?? ''}”?`}
        message="If any past session uses this exercise it cannot be removed, and you will be told why."
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
