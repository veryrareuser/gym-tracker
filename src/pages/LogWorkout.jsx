// src/pages/LogWorkout.jsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2, ChevronDown, ChevronUp, Check, ArrowLeft } from 'lucide-react'
import { getExercises, getSessions, saveSession } from '../lib/db'
import { generateId, todayISO } from '../lib/utils'

function emptySet(n) {
  return { id: generateId(), set_number: n, weight: '', reps: '', note: '' }
}

function emptyLog(exercise, order) {
  return {
    id: generateId(),
    exercise_id: exercise.id,
    order,
    set_entries: [emptySet(1)],
    _name: exercise.name,
  }
}

export default function LogWorkout() {
  const navigate = useNavigate()
  const { sessionId } = useParams()
  const [exercises, setExercises] = useState([])
  const [date, setDate] = useState(todayISO())
  const [logs, setLogs] = useState([])
  const [collapsed, setCollapsed] = useState({})
  const [saving, setSaving] = useState(false)
  const [sessionNotes, setSessionNotes] = useState('')
  const [currentSessionId] = useState(() => sessionId || generateId())

  useEffect(() => {
    async function load() {
      const exs = await getExercises()
      setExercises(exs)

      if (sessionId) {
        const sessions = await getSessions()
        const existing = sessions.find(s => s.id === sessionId)
        if (existing) {
          setDate(existing.date)
          setSessionNotes(existing.notes || '')
          // Rehydrate logs with exercise names
          const hydratedLogs = (existing.exercise_logs || []).map(log => ({
            ...log,
            _name: exs.find(e => e.id === log.exercise_id)?.name || 'Unknown',
          }))
          setLogs(hydratedLogs)
          return
        }
      }

      // New session: pre-load all exercises
      setLogs(exs.map((ex, i) => emptyLog(ex, i)))
    }
    load()
  }, [sessionId])

  function updateSet(logId, setId, field, value) {
    setLogs(prev => prev.map(log =>
      log.id !== logId ? log : {
        ...log,
        set_entries: log.set_entries.map(s => s.id !== setId ? s : { ...s, [field]: value })
      }
    ))
  }

  function addSet(logId) {
    setLogs(prev => prev.map(log => {
      if (log.id !== logId) return log
      const n = log.set_entries.length + 1
      return { ...log, set_entries: [...log.set_entries, emptySet(n)] }
    }))
  }

  function removeSet(logId, setId) {
    setLogs(prev => prev.map(log => {
      if (log.id !== logId) return log
      const filtered = log.set_entries.filter(s => s.id !== setId)
      return { ...log, set_entries: filtered.map((s, i) => ({ ...s, set_number: i + 1 })) }
    }))
  }

  function addExercise(ex) {
    setLogs(prev => [...prev, emptyLog(ex, prev.length)])
  }

  function removeLog(logId) {
    setLogs(prev => prev.filter(l => l.id !== logId))
  }

  function toggleCollapse(logId) {
    setCollapsed(prev => ({ ...prev, [logId]: !prev[logId] }))
  }

  async function handleSave() {
    setSaving(true)
    const session = {
      id: currentSessionId,
      date,
      notes: sessionNotes,
      exercise_logs: logs
        .filter(log => log.set_entries.some(s => s.weight || s.reps))
        .map(log => ({
          id: log.id,
          exercise_id: log.exercise_id,
          order: log.order,
          set_entries: log.set_entries
            .filter(s => s.weight || s.reps)
            .map(s => ({ ...s, exercise_log_id: log.id })),
        }))
    }
    await saveSession(session)
    setSaving(false)
    navigate('/history')
  }

  const usedExerciseIds = new Set(logs.map(l => l.exercise_id))
  const availableToAdd = exercises.filter(e => !usedExerciseIds.has(e.id))

  return (
    <div style={{ padding: '16px 16px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', padding: 0 }}>
          <ArrowLeft size={22} />
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, flex: 1 }}>
          {sessionId ? 'Edit Session' : 'Log Workout'}
        </h1>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          style={{ width: 'auto', fontSize: 13, padding: '6px 10px' }}
        />
      </div>

      {/* Exercise logs */}
      {logs.map(log => (
        <div key={log.id} style={{
          background: 'var(--color-surface)',
          borderRadius: 14,
          border: '1px solid var(--color-border)',
          marginBottom: 12,
          overflow: 'hidden',
        }}>
          {/* Exercise header */}
          <div
            onClick={() => toggleCollapse(log.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{log._name}</div>
              <div style={{ color: 'var(--color-muted)', fontSize: 12 }}>
                {log.set_entries.length} set{log.set_entries.length !== 1 ? 's' : ''}
                {log.set_entries.filter(s => s.weight).length > 0 && (
                  <> · {Math.max(...log.set_entries.map(s => parseFloat(s.weight) || 0))} kg top</>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={e => { e.stopPropagation(); removeLog(log.id) }}
                style={{ background: 'none', border: 'none', color: 'var(--color-muted)', padding: 4 }}
              >
                <Trash2 size={16} />
              </button>
              {collapsed[log.id] ? <ChevronDown size={18} color="var(--color-muted)" /> : <ChevronUp size={18} color="var(--color-muted)" />}
            </div>
          </div>

          {!collapsed[log.id] && (
            <div style={{ padding: '0 16px 14px' }}>
              {/* Set headers */}
              <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 1fr 36px', gap: 6, marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', textAlign: 'center' }}>Set</div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', textAlign: 'center' }}>Weight (kg)</div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', textAlign: 'center' }}>Reps</div>
                <div />
              </div>

              {log.set_entries.map(set => (
                <div key={set.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 1fr 36px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                  <div style={{
                    width: 28, height: 28,
                    borderRadius: '50%',
                    background: set.weight && set.reps ? 'var(--color-accent-dim)' : 'var(--color-surface2)',
                    border: `1px solid ${set.weight && set.reps ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700,
                    color: set.weight && set.reps ? 'var(--color-accent)' : 'var(--color-muted)',
                  }}>
                    {set.set_number}
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={set.weight}
                    onChange={e => updateSet(log.id, set.id, 'weight', e.target.value)}
                    style={{ textAlign: 'center', padding: '8px 6px' }}
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="0"
                    value={set.reps}
                    onChange={e => updateSet(log.id, set.id, 'reps', e.target.value)}
                    style={{ textAlign: 'center', padding: '8px 6px' }}
                  />
                  <button
                    onClick={() => removeSet(log.id, set.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--color-muted)', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}

              <button
                onClick={() => addSet(log.id)}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'none',
                  border: '1px dashed var(--color-border)',
                  borderRadius: 10,
                  color: 'var(--color-muted)',
                  fontSize: 13,
                  marginTop: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <Plus size={14} /> Add Set
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Add exercise */}
      {availableToAdd.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <select
            defaultValue=""
            onChange={e => {
              const ex = exercises.find(x => x.id === e.target.value)
              if (ex) { addExercise(ex); e.target.value = '' }
            }}
            style={{ color: 'var(--color-muted)' }}
          >
            <option value="" disabled>+ Add exercise...</option>
            {availableToAdd.map(ex => (
              <option key={ex.id} value={ex.id}>{ex.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Notes */}
      <textarea
        placeholder="Session notes (optional)..."
        value={sessionNotes}
        onChange={e => setSessionNotes(e.target.value)}
        rows={2}
        style={{ marginBottom: 16, resize: 'none' }}
      />

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          width: '100%',
          padding: '16px',
          background: 'var(--color-accent)',
          color: '#0f0f0f',
          fontWeight: 800,
          fontSize: 16,
          border: 'none',
          borderRadius: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: saving ? 0.7 : 1,
        }}
      >
        <Check size={20} />
        {saving ? 'Saving...' : 'Save Session'}
      </button>
    </div>
  )
}
