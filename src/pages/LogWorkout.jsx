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
          <ArrowLeft size={24} color="var(--primary)" />
        </button>
        <h1 className="screen-title" style={{ fontSize: 'var(--type-title)', letterSpacing: 'var(--tracking-title)', flex: 1 }}>
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
          style={{ width: 'auto', flexShrink: 0, fontSize: 'var(--type-subhead)', padding: '0 10px' }}
        />
      </div>

      {/* Rest duration */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Timer size={15} color="var(--ink-muted)" />
        <span style={{ fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)' }}>Rest</span>
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
                    <Dumbbell size={18} color="var(--ink-faint)" />
                  )}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 'var(--type-headline)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log._name}
                  </span>
                  <span style={{ display: 'block', color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)' }}>
                    {log.set_entries.length} set{log.set_entries.length !== 1 ? 's' : ''}
                    {topWeight > 0 && ` · ${topWeight} kg top`}
                  </span>
                </span>
                {isCollapsed ? (
                  <ChevronDown size={18} color="var(--ink-muted)" style={{ flexShrink: 0 }} />
                ) : (
                  <ChevronUp size={18} color="var(--ink-muted)" style={{ flexShrink: 0 }} />
                )}
              </button>
              <button
                onClick={() => removeLog(log.id)}
                aria-label={`Remove ${log._name}`}
                className="btn-icon"
                style={{ flexShrink: 0 }}
              >
                <Trash2 size={17} color="var(--ink-muted)" />
              </button>
            </div>

            {!isCollapsed && (
              <div style={{ padding: '0 12px 12px' }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '32px 1fr 1fr 44px 44px',
                    gap: 4,
                    marginBottom: 6,
                  }}
                >
                  {['Set', 'kg', 'Reps', '', ''].map((label, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 'var(--type-fine)',
                        color: 'var(--ink-muted)',
                        textAlign: 'center',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
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
                        gridTemplateColumns: '32px 1fr 1fr 44px 44px',
                        gap: 4,
                        marginBottom: 4,
                        alignItems: 'center',
                      }}
                    >
                      <div
                        className="tnum"
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 'var(--rounded-pill)',
                          background: complete ? 'var(--primary)' : 'var(--fill)',
                          color: complete ? 'var(--on-primary)' : 'var(--ink-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 'var(--type-subhead)',
                          fontWeight: 600,
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
                        style={{ textAlign: 'center', padding: '11px 6px' }}
                      />
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder="0"
                        aria-label={`Set ${set.set_number} reps`}
                        value={set.reps}
                        onChange={e => updateSet(log.id, set.id, 'reps', e.target.value)}
                        className="tnum"
                        style={{ textAlign: 'center', padding: '11px 6px' }}
                      />
                      <button
                        onClick={() => startTimer(restDuration)}
                        aria-label={`Start ${restDuration} second rest`}
                        className="btn-icon"
                      >
                        <Timer size={17} color="var(--ink-muted)" />
                      </button>
                      <button
                        onClick={() => removeSet(log.id, set.id)}
                        aria-label={`Remove set ${set.set_number}`}
                        className="btn-icon"
                      >
                        <Trash2 size={15} color="var(--ink-muted)" />
                      </button>
                    </div>
                  )
                })}

                {/* button-secondary-pill: a real box with a visible 1px Action Blue
                    edge. The previous version had no fill, no border, and relied on
                    a baseline hack for the icon, so it read as loose text. */}
                <button
                  onClick={() => addSet(log.id)}
                  className="btn-secondary"
                  style={{ width: '100%', marginTop: 8, fontSize: 'var(--type-subhead)' }}
                >
                  <Plus size={15} />
                  Add Set
                </button>
              </div>
            )}
          </section>
        )
      })}

      {/* Add exercise — a ghost pill, not a dashed outline. The old border was
          1.37:1, which is indistinguishable from no border at all. */}
      <button onClick={() => setShowPicker(true)} className="btn-secondary btn-block" style={{ marginBottom: 16 }}>
        <Plus size={18} />
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
        style={{ marginBottom: 16 }}
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
            borderRadius: 'var(--rounded-md)',
            background: 'var(--fill)',
            borderLeft: '3px solid var(--destructive)',
          }}
        >
          <CircleAlert size={18} color="var(--destructive)" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 'var(--type-subhead)', color: 'var(--ink)' }}>{saveError}</span>
        </div>
      )}

      <button onClick={handleSave} disabled={saving || loggedCount === 0} className="btn-primary btn-block" style={{ minHeight: 50 }}>
        <Check size={20} />
        {saving ? 'Saving…' : loggedCount === 0 ? 'Enter a set to save' : 'Save Session'}
      </button>
    </div>
  )
}

function titleCase(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : ''
}
