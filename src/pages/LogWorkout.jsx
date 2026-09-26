// src/pages/LogWorkout.jsx
import { useEffect, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2, ChevronDown, ChevronUp, Check, ArrowLeft, RotateCcw, Timer, CircleAlert, Dumbbell } from 'lucide-react'
import { getExercises, getSessions, saveExercise, saveSession } from '../lib/db'
import { generateId, todayISO } from '../lib/utils'
import { imageUrl } from '../lib/exerciseDb'
import { startTimer } from '../lib/timer'
import ExercisePicker from '../components/ExercisePicker'

const DRAFT_KEY = 'gym_draft'
const REST_OPTIONS = [60, 90, 120, 180]

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
  const [saveError, setSaveError] = useState(null)
  const [sessionNotes, setSessionNotes] = useState('')
  const [hasDraft, setHasDraft] = useState(false)
  const [restDuration, setRestDuration] = useState(90)
  const [showPicker, setShowPicker] = useState(false)
  const [currentSessionId] = useState(() => sessionId || generateId())
  const isEditMode = Boolean(sessionId)
  // Prevents the draft effect from writing an empty draft during the async load.
  const loadedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const exs = await getExercises()
      if (cancelled) return
      setExercises(exs)

      if (isEditMode) {
        const sessions = await getSessions()
        if (cancelled) return
        const existing = sessions.find(s => s.id === sessionId)
        if (existing) {
          setDate(existing.date)
          setSessionNotes(existing.notes || '')
          setLogs(
            (existing.exercise_logs || []).map(log => {
              const ex = exs.find(e => e.id === log.exercise_id)
              return {
                ...log,
                _name: ex?.name || 'Unknown',
                _image_url: ex?.image_url || null,
              }
            }),
          )
        }
        loadedRef.current = true
        return
      }

      // New session — restore a draft before falling back to a blank slate.
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        try {
          const draft = JSON.parse(raw)
          if (cancelled) return
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

      setLogs(exs.map((ex, i) => emptyLog(ex, i)))
      loadedRef.current = true
    }
    load()
    return () => {
      cancelled = true
    }
  }, [sessionId, isEditMode])

  // Auto-save the draft on every change, new sessions only.
  useEffect(() => {
    if (!loadedRef.current || isEditMode) return
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ logs, date, sessionNotes }))
    setHasDraft(logs.some(l => l.set_entries.some(s => s.weight || s.reps)))
  }, [logs, date, sessionNotes, isEditMode])

  function discardDraft() {
    localStorage.removeItem(DRAFT_KEY)
    setHasDraft(false)
    setDate(todayISO())
    setSessionNotes('')
    setLogs(exercises.map((ex, i) => emptyLog(ex, i)))
  }

  function updateSet(logId, setId, field, value) {
    setLogs(prev =>
      prev.map(log =>
        log.id !== logId
          ? log
          : { ...log, set_entries: log.set_entries.map(s => (s.id !== setId ? s : { ...s, [field]: value })) },
      ),
    )
  }

  function addSet(logId) {
    setLogs(prev =>
      prev.map(log => {
        if (log.id !== logId) return log
        const n = log.set_entries.length + 1
        return { ...log, set_entries: [...log.set_entries, emptySet(n)] }
      }),
    )
  }

  function removeSet(logId, setId) {
    setLogs(prev =>
      prev.map(log => {
        if (log.id !== logId) return log
        const filtered = log.set_entries.filter(s => s.id !== setId)
        return { ...log, set_entries: filtered.map((s, i) => ({ ...s, set_number: i + 1 })) }
      }),
    )
  }

  /**
   * Persist the picked exercise to the library before adding it to the log.
   *
   * exercise_logs.exercise_id is a foreign key to exercises(id). Previously this
   * only touched React state, so the log insert failed the FK check, the error was
   * discarded, and every log in the session — including the pre-loaded ten — was
   * dropped from the cloud. History then showed the session with no exercises.
   */
  async function addExercise(ex) {
    const record = {
      id: ex.id,
      name: titleCase(ex.name),
      muscle_group: titleCase(ex.body_part),
      order: Date.now(),
      image_url: imageUrl(ex.image),
    }
    try {
      await saveExercise(record)
    } catch (err) {
      setSaveError(`Could not save “${record.name}” to your library: ${err.message}`)
      return
    }
    setExercises(prev => (prev.some(e => e.id === record.id) ? prev : [...prev, record]))
    setLogs(prev => [...prev, emptyLog(record, prev.length)])
  }

  function removeLog(logId) {
    setLogs(prev => prev.filter(l => l.id !== logId))
  }

  function toggleCollapse(logId) {
    setCollapsed(prev => ({ ...prev, [logId]: !prev[logId] }))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    const session = {
      id: currentSessionId,
      date,
      notes: sessionNotes,
      exercise_logs: logs
        .filter(log => log.set_entries.some(s => s.weight || s.reps))
        .map((log, i) => ({
          id: log.id,
          exercise_id: log.exercise_id,
          order: i,
          set_entries: log.set_entries
            .filter(s => s.weight || s.reps)
            .map(s => ({ ...s, exercise_log_id: log.id })),
        })),
    }
    try {
      await saveSession(session)
      localStorage.removeItem(DRAFT_KEY)
      navigate('/history')
    } catch (err) {
      setSaveError(`Could not save this session: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const loggedCount = logs.filter(l => l.set_entries.some(s => s.weight || s.reps)).length

  return (
    <div className="screen">
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingTop: 'calc(env(safe-area-inset-top) + 8px)',
          paddingBottom: 12,
        }}
      >
        <button onClick={() => navigate(-1)} aria-label="Back" className="hit" style={{ marginLeft: -10 }}>
          <ArrowLeft size={24} color="var(--color-accent-text)" />
        </button>
        <h1 className="screen-title" style={{ fontSize: 'var(--type-title)', flex: 1 }}>
          {isEditMode ? 'Edit Session' : 'Log Workout'}
        </h1>
        {hasDraft && !isEditMode && (
          <button onClick={discardDraft} className="chip" style={{ minHeight: 36 }}>
            <RotateCcw size={14} /> Discard
          </button>
        )}
        <input
          type="date"
          value={date}
          aria-label="Session date"
          onChange={e => setDate(e.target.value)}
          style={{ width: 'auto', flexShrink: 0, fontSize: 'var(--type-footnote)' }}
        />
      </div>

      {/* Rest duration */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Timer size={15} color="var(--color-muted)" />
        <span style={{ fontSize: 'var(--type-footnote)', color: 'var(--color-muted)' }}>Rest</span>
        {REST_OPTIONS.map(s => (
          <button
            key={s}
            onClick={() => setRestDuration(s)}
            aria-pressed={restDuration === s}
            className="chip"
            data-selected={restDuration === s}
            style={{ minHeight: 30 }}
          >
            {s}s
          </button>
        ))}
      </div>

      {/* Exercise logs */}
      {logs.map(log => {
        const isCollapsed = Boolean(collapsed[log.id])
        const topWeight = log.set_entries.reduce((max, s) => Math.max(max, parseFloat(s.weight) || 0), 0)

        return (
          <section key={log.id} className="card" style={{ marginBottom: 12, overflow: 'hidden' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 8px 10px 12px',
              }}
            >
              <button
                onClick={() => toggleCollapse(log.id)}
                aria-expanded={!isCollapsed}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  flex: 1,
                  minWidth: 0,
                  minHeight: 'var(--hit-min)',
                  textAlign: 'left',
                }}
              >
                <span className="thumb" style={{ width: 44, height: 44 }}>
                  {log._image_url ? (
                    <img src={log._image_url} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <Dumbbell size={18} color="var(--color-faint)" />
                  )}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 'var(--type-headline)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log._name}
                  </span>
                  <span style={{ display: 'block', color: 'var(--color-muted)', fontSize: 'var(--type-footnote)' }}>
                    {log.set_entries.length} set{log.set_entries.length !== 1 ? 's' : ''}
                    {topWeight > 0 && ` · ${topWeight} kg top`}
                  </span>
                </span>
                {isCollapsed ? (
                  <ChevronDown size={18} color="var(--color-muted)" style={{ flexShrink: 0 }} />
                ) : (
                  <ChevronUp size={18} color="var(--color-muted)" style={{ flexShrink: 0 }} />
                )}
              </button>
              <button
                onClick={() => removeLog(log.id)}
                aria-label={`Remove ${log._name}`}
                className="hit"
                style={{ width: 40, minHeight: 40, flexShrink: 0 }}
              >
                <Trash2 size={17} color="var(--color-muted)" />
              </button>
            </div>

            {!isCollapsed && (
              <div style={{ padding: '0 12px 12px' }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '32px 1fr 1fr 40px 40px',
                    gap: 6,
                    marginBottom: 6,
                  }}
                >
                  {['Set', 'kg', 'Reps', '', ''].map((label, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 'var(--type-min)',
                        color: 'var(--color-muted)',
                        textAlign: 'center',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: 0.03,
                      }}
                    >
                      {label}
                    </div>
                  ))}
                </div>

                {log.set_entries.map(set => {
                  const complete = Boolean(set.weight && set.reps)
                  return (
                    <div
                      key={set.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '32px 1fr 1fr 40px 40px',
                        gap: 6,
                        marginBottom: 6,
                        alignItems: 'center',
                      }}
                    >
                      <div
                        className="tnum"
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          background: complete ? 'var(--color-accent)' : 'var(--color-fill)',
                          color: complete ? 'var(--color-on-accent)' : 'var(--color-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 'var(--type-footnote)',
                          fontWeight: 700,
                        }}
                      >
                        {set.set_number}
                      </div>
                      <input
                        type="number"
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={`Set ${set.set_number} weight`}
                        value={set.weight}
                        onChange={e => updateSet(log.id, set.id, 'weight', e.target.value)}
                        className="tnum"
                        style={{ textAlign: 'center', padding: '9px 6px', fontSize: 'var(--type-body)' }}
                      />
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder="0"
                        aria-label={`Set ${set.set_number} reps`}
                        value={set.reps}
                        onChange={e => updateSet(log.id, set.id, 'reps', e.target.value)}
                        className="tnum"
                        style={{ textAlign: 'center', padding: '9px 6px', fontSize: 'var(--type-body)' }}
                      />
                      <button
                        onClick={() => startTimer(restDuration)}
                        aria-label={`Start ${restDuration} second rest`}
                        className="hit"
                        style={{ width: 40, minHeight: 40 }}
                      >
                        <Timer size={17} color="var(--color-muted)" />
                      </button>
                      <button
                        onClick={() => removeSet(log.id, set.id)}
                        aria-label={`Remove set ${set.set_number}`}
                        className="hit"
                        style={{ width: 40, minHeight: 40 }}
                      >
                        <Trash2 size={15} color="var(--color-muted)" />
                      </button>
                    </div>
                  )
                })}

                <button
                  onClick={() => addSet(log.id)}
                  style={{
                    width: '100%',
                    minHeight: 40,
                    marginTop: 4,
                    color: 'var(--color-accent-text)',
                    fontSize: 'var(--type-subhead)',
                    fontWeight: 500,
                  }}
                >
                  <Plus size={15} style={{ verticalAlign: -2, marginRight: 4 }} />
                  Add Set
                </button>
              </div>
            )}
          </section>
        )
      })}

      {/* Add exercise */}
      <button
        onClick={() => setShowPicker(true)}
        style={{
          width: '100%',
          minHeight: 'var(--hit-min)',
          borderRadius: 'var(--radius-md)',
          border: '1px dashed var(--color-border)',
          color: 'var(--color-accent-text)',
          fontSize: 'var(--type-headline)',
          fontWeight: 500,
          marginBottom: 16,
        }}
      >
        <Plus size={18} style={{ verticalAlign: -3, marginRight: 6 }} />
        Add Exercise
      </button>

      {showPicker && (
        <ExercisePicker
          onClose={() => setShowPicker(false)}
          usedIds={logs.map(l => l.exercise_id)}
          onSelect={ex => {
            addExercise(ex)
            setShowPicker(false)
          }}
        />
      )}

      {/* Notes */}
      <label htmlFor="session-notes" className="section-label" style={{ display: 'block' }}>
        Notes
      </label>
      <textarea
        id="session-notes"
        placeholder="How did it feel?"
        value={sessionNotes}
        onChange={e => setSessionNotes(e.target.value)}
        rows={2}
        style={{ marginBottom: 16, resize: 'none' }}
      />

      {saveError && (
        <div
          role="alert"
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            padding: 12,
            marginBottom: 16,
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-fill)',
            borderLeft: '3px solid var(--color-danger)',
          }}
        >
          <CircleAlert size={18} color="var(--color-danger)" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 'var(--type-subhead)', color: 'var(--color-text)' }}>{saveError}</span>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || loggedCount === 0}
        style={{
          width: '100%',
          minHeight: 52,
          background: 'var(--color-accent)',
          color: 'var(--color-on-accent)',
          fontWeight: 600,
          fontSize: 'var(--type-headline)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <Check size={20} />
        {saving ? 'Saving…' : loggedCount === 0 ? 'Enter a set to save' : 'Save Session'}
      </button>
    </div>
  )
}

function titleCase(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : ''
}
