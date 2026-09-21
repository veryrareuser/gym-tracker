// src/pages/Exercises.jsx
import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Check, X, GripVertical } from 'lucide-react'
import { getExercises, saveExercise, deleteExercise } from '../lib/db'
import { generateId } from '../lib/utils'

const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core', 'Cardio', 'Other']

function ExerciseRow({ exercise, onEdit, onDelete }) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 12,
      padding: '12px 14px',
      marginBottom: 8,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    }}>
      <GripVertical size={16} color="var(--color-border)" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {exercise.name}
        </div>
        {exercise.muscle_group && (
          <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>{exercise.muscle_group}</div>
        )}
      </div>
      <button onClick={() => onEdit(exercise)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', padding: 6 }}>
        <Pencil size={15} />
      </button>
      <button onClick={() => onDelete(exercise.id)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', padding: 6 }}>
        <Trash2 size={15} />
      </button>
    </div>
  )
}

function ExerciseForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '')
  const [muscle, setMuscle] = useState(initial?.muscle_group || '')

  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onSave({
      id: initial?.id || generateId(),
      name: name.trim(),
      muscle_group: muscle,
      order: initial?.order ?? Date.now(),
    })
  }

  return (
    <form onSubmit={handleSubmit} style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-accent)',
      borderRadius: 14,
      padding: '14px',
      marginBottom: 12,
    }}>
      <input
        placeholder="Exercise name"
        value={name}
        onChange={e => setName(e.target.value)}
        autoFocus
        style={{ marginBottom: 10 }}
      />
      <select value={muscle} onChange={e => setMuscle(e.target.value)} style={{ marginBottom: 12, color: muscle ? 'var(--color-text)' : 'var(--color-muted)' }}>
        <option value="">Muscle group (optional)</option>
        {MUSCLE_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" style={{
          flex: 1, padding: '10px', background: 'var(--color-accent)',
          color: '#0f0f0f', fontWeight: 700, border: 'none', borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <Check size={16} /> {initial ? 'Update' : 'Add Exercise'}
        </button>
        <button type="button" onClick={onCancel} style={{
          padding: '10px 14px', background: 'var(--color-surface2)',
          color: 'var(--color-muted)', border: '1px solid var(--color-border)',
          borderRadius: 10, display: 'flex', alignItems: 'center',
        }}>
          <X size={16} />
        </button>
      </div>
    </form>
  )
}

export default function Exercises() {
  const [exercises, setExercises] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)

  useEffect(() => {
    getExercises().then(setExercises)
  }, [])

  async function handleSave(exercise) {
    await saveExercise(exercise)
    // Optimistic update — no re-fetch needed, avoids Supabase race condition
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

  async function handleDelete(id) {
    if (!confirm('Remove this exercise? It will still appear in past sessions.')) return
    await deleteExercise(id)
    setExercises(prev => prev.filter(e => e.id !== id))
  }

  function handleEdit(exercise) {
    setEditing(exercise)
    setShowForm(false)
  }

  return (
    <div style={{ padding: '24px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Exercises</h1>
        <button
          onClick={() => { setShowForm(true); setEditing(null) }}
          style={{
            background: 'var(--color-accent)',
            color: '#0f0f0f',
            border: 'none',
            borderRadius: 10,
            padding: '8px 14px',
            fontWeight: 700,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Plus size={16} /> Add
        </button>
      </div>

      {showForm && (
        <ExerciseForm
          onSave={handleSave}
          onCancel={() => setShowForm(false)}
        />
      )}

      {editing && (
        <ExerciseForm
          initial={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}

      {exercises.length === 0 && !showForm && (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--color-muted)' }}>
          <p>No exercises yet. Add your first one!</p>
        </div>
      )}

      {exercises.map(ex => (
        <ExerciseRow
          key={ex.id}
          exercise={ex}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      ))}
    </div>
  )
}
