// src/pages/LogWorkout.jsx
import { useEffect, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2, ChevronDown, ChevronUp, Check, ArrowLeft, RotateCcw, Timer } from 'lucide-react'
import { getExercises, getSessions, saveSession } from '../lib/db'
import { generateId, todayISO } from '../lib/utils'
import { startTimer } from '../lib/timer'
import ExercisePicker from '../components/ExercisePicker'

const DRAFT_KEY = 'gym_draft'

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
    _image_url: exercise.image_url || null,
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
  const [hasDraft, setHasDraft] = useState(false)
  const [restDuration, setRestDuration] = useState(90)
  const [showPicker, setShowPicker] = useState(false)
  const [currentSessionId] = useState(() => sessionId || generateId())
  const isEditMode = Boolean(sessionId)
  // prevent draft write before initial load finishes
  const loadedRef = useRef(false)

  // ── Load on mount ──
  useEffect(() => {
    async function load() {
      const exs = await getExercises()
      setExercises(exs)

      if (isEditMode) {
        // Editing existing session — load from saved data
        const sessions = await getSessions()
        const existing = sessions.find(s => s.id === sessionId)
        if (existing) {
          setDate(existing.date)
          setSessionNotes(existing.notes || '')
          setLogs((existing.exercise_logs || []).map(log => ({
            ...log,
            _name: exs.find(e => e.id === log.exercise_id)?.name || 'Unknown',
            _image_url: exs.find(e => e.id === log.exercise_id)?.image_url || null,
          })))
        }
        loadedRef.current = true
        return
      }

      // New session — check for existing draft first
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        try {
          const draft = JSON.parse(raw)
          setDate(draft.date || todayISO())
          setSessionNotes(draft.sessionNotes || '')
          setLogs(draft.logs || [])
          setHasDraft(true)
          loadedRef.current = true
          return
        } catch {
          localStorage.removeItem(DRAFT_KEY)
        }
      }

      // No draft — pre-load all exercises as empty logs
      setLogs(exs.map((ex, i) => emptyLog(ex, i)))
      loadedRef.current = true
    }
    load()
  }, [sessionId])

  // ── Auto-save draft on every change (new sessions only) ──
  useEffect(() => {
    if (!loadedRef.current || isEditMode) return
    const draft = { logs, date, sessionNotes }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    setHasDraft(logs.some(l => l.set_entries.some(s => s.weight || s.reps)))
  }, [logs, date, sessionNotes])

  function discardDraft() {
    localStorage.removeItem(DRAFT_KEY)
    setHasDraft(false)
    setDate(todayISO())
    setSessionNotes('')
    setLogs(exercises.map((ex, i) => emptyLog(ex, i)))
  }

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
    localStorage.removeItem(DRAFT_KEY)
    setSaving(false)
    navigate('/history')
  }

  const usedExerciseIds = new Set(logs.map(l => l.exercise_id))
  const availableToAdd = exercises.filter(e => !usedExerciseIds.has(e.id))

  return (
    <div style={{ padding: '16px 16px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', padding: 0, flexShrink: 0 }}>
          <ArrowLeft size={22} />
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, flex: 1 }}>
          {isEditMode ? 'Edit Session' : 'Log Workout'}
        </h1>
        {hasDraft && !isEditMode && (
          <button
            onClick={discardDraft}
            title="Discard draft"
            style={{
              background: 'none',
              border: '1px solid var(--color-border)',
              color: 'var(--color-muted)',
              borderRadius: 8,
              padding: '5px 8px',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flexShrink: 0,
            }}
          >
            <RotateCcw size={13} /> Discard
          </button>
        )}
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          style={{ width: 'auto', fontSize: 13, padding: '6px 10px', flexShrink: 0 }}
        />
      </div>

      {/* Rest duration control */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Timer size={14} color="var(--color-muted)" />
        <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>Rest:</span>
        {[60, 90, 120, 180].map(s => (
          <button
            key={s}
            onClick={() => setRestDuration(s)}
            style={{
              padding: '4px 10px',
              borderRadius: 20,
              border: `1px solid ${restDuration === s ? 'var(--color-accent)' : 'var(--color-border)'}`,
              background: restDuration === s ? 'var(--color-accent-dim)' : 'none',
              color: restDuration === s ? 'var(--color-accent)' : 'var(--color-muted)',
              fontSize: 12,
              fontWeight: restDuration === s ? 700 : 400,
            }}
          >
            {s}s
          </button>
        ))}
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
              padding: '12px 14px',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {log._image_url && (
                <img
                  src={log._image_url}
                  alt=""
                  style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', background: 'var(--color-surface2)', flexShrink: 0 }}
                  loading="lazy"
                  onError={e => { e.target.style.display = 'none' }}
                />
              )}
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{log._name}</div>
                <div style={{ color: 'var(--color-muted)', fontSize: 12 }}>
                  {log.set_entries.length} set{log.set_entries.length !== 1 ? 's' : ''}
                  {log.set_entries.filter(s => s.weight).length > 0 && (
                    <> · {Math.max(...log.set_entries.map(s => parseFloat(s.weight) || 0))} kg top</>
                  )}
                </div>
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
            <div style={{ padding: '0 14px 14px' }}>
              {/* Set headers */}
              <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 1fr 32px 32px', gap: 6, marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', textAlign: 'center' }}>Set</div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', textAlign: 'center' }}>Weight (kg)</div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', textAlign: 'center' }}>Reps</div>
                <div />
                <div />
              </div>

              {log.set_entries.map(set => (
                <div key={set.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 1fr 32px 32px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
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
                    onClick={() => startTimer(restDuration)}
                    title={`Rest ${restDuration}s`}
                    style={{ background: 'none', border: 'none', color: 'var(--color-muted)', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Timer size={14} />
                  </button>
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

      {/* Add exercise button → opens full-screen picker */}
      <button
        onClick={() => setShowPicker(true)}
        style={{
          width: '100%',
          padding: '12px',
          background: 'none',
          border: '1px dashed var(--color-border)',
          borderRadius: 12,
          color: 'var(--color-muted)',
          fontSize: 14,
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <Plus size={16} /> Add Exercise
      </button>

      <ExercisePicker
        open={showPicker}
        onClose={() => setShowPicker(false)}
        usedIds={logs.map(l => l.exercise_id)}
        onSelect={ex => {
          addExercise(ex)
          setShowPicker(false)
        }}
      />

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
