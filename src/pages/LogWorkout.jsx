// src/pages/LogWorkout.jsx
import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2, ChevronDown, ChevronUp, Check, ArrowLeft, RotateCcw, Clock, CircleAlert, Dumbbell } from 'lucide-react'
import { getExercises, getSession, getDraft, discardDraft, saveExercise, saveSession, getRoutines, saveRoutine, setRoutineExercises } from '../lib/db'
import { generateId, todayISO, formatDate, formatDuration, formatStopwatch } from '../lib/utils'
import { imageUrl } from '../lib/exerciseDb'
import { startStopwatch, pauseStopwatch, stopStopwatch, clearStopwatch, restoreStopwatch, readStopwatch, elapsedSeconds, elapsedMs, isRunning } from '../lib/stopwatch'
import useAutosave from '../lib/useAutosave'
import { mergeWithLibrary } from '../lib/draft'
import { mergeOrder, mergeRoutineCards, cardHasContent } from '../lib/routines'
import { currentUserId } from '../lib/auth'
import ExercisePicker from '../components/ExercisePicker'
import RoutinePicker from '../components/RoutinePicker'
import RoutineEditor from '../components/RoutineEditor'

// The draft is namespaced per user for the same reason the session cache is: an
// in-progress workout belongs to whoever is typing it, and on a shared device an
// unprefixed key would hand your half-finished session to the next person.
const draftKey = () => `gym_draft:${currentUserId() ?? 'anon'}`
// Mirror of the draft in localStorage, which survives closing the browser window.
//
// sessionStorage dies with the tab, and the token lives there too — so closing the
// browser mid-workout used to take the draft with it and the sets were simply gone.
// This holds nothing but the form's own state (exercises, sets, date, notes); no
// credentials. The name deliberately matches the gym_draft pattern in browserSession
// so sign-out and the legacy sweep clear it too, instead of stranding it on a shared
// device. Local-first restore is in `load()` below.
const draftBackupKey = () => `gym_draft:backup:${currentUserId() ?? 'anon'}`

// The mirror is best-effort. localStorage throws outright in some restricted
// browsing modes, and an unguarded throw here would take the sessionStorage draft
// down with it — losing the protection that already worked. A missing mirror means
// the next warning prompt instead; never a lost workout.
function mirrorDraft(op, payload) {
  try {
    if (op === 'set') localStorage.setItem(draftBackupKey(), payload)
    else localStorage.removeItem(draftBackupKey())
  } catch { /* Restricted browser storage. */ }
}

function readDraft() {
  try {
    return sessionStorage.getItem(draftKey()) || localStorage.getItem(draftBackupKey())
  } catch {
    return null
  }
}

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
  // Which picker is open, if any: 'session' to add an exercise to the workout being
  // logged, 'routine' to add one to the routine being edited.
  const [pickerMode, setPickerMode] = useState(null)
  const isEditMode = Boolean(sessionId)
  // Prevents the draft effect from writing an empty draft during the async load.
  const loadedRef = useRef(false)
  // Autosave resumes a cloud draft under its own id, so this is state, not a constant
  // initialised from the route. Editing an existing session must keep that session's id.
  const [currentSessionId, setCurrentSessionId] = useState(() => sessionId || generateId())
  // The id this page was opened with.
  //
  // The load effect needs it, and it must not depend on currentSessionId: the effect
  // itself replaces that id when a cloud draft is restored, so listing it as a dependency
  // would re-run the load and re-fetch the draft it just restored. A ref captures the
  // opening value once, which is what the effect means by "the session I am opening".
  const openingSessionIdRef = useRef(currentSessionId)
  // The measurement, or null when there is none.
  //
  // This is the stopwatch's whole state: the time already counted, and the instant
  // the current segment began. Null means no measurement has been started, which is
  // the normal state — the clock waits for a deliberate Start rather than starting
  // itself when the page opens.
  const [timer, setTimer] = useState(null)
  // The measured length of the session, in seconds. Set on save; the field below lets
  // it be corrected by hand, which is the only way to time a workout that was not
  // measured — a session logged from memory, or one whose draft was lost.
  const [durationSeconds, setDurationSeconds] = useState(null)
  // The routines, and which one is being logged.
  //
  // `routines` is the account's list. `routineId` is the routine the current session
  // was started from, or null when the session is not tied to one — the "log without
  // a routine" escape hatch, and every session logged before routines existed.
  const [routines, setRoutines] = useState([])
  const [routineId, setRoutineId] = useState(null)
  // Whether the routine list is showing. The Log tab opens on the list, because the
  // whole point of routines is not having to scroll a long exercise list to find the
  // six things you are actually doing.
  const [picking, setPicking] = useState(true)
  // The reorder editor for the current routine.
  const [editingRoutine, setEditingRoutine] = useState(false)
  // A duration typed in by hand: the hours and the minutes, as separate fields.
  //
  // Two fields rather than one number, because that is what a person is entering —
  // "an hour and a half" is two numbers. Null means "not entered", so the measured
  // elapsed time is used instead.
  //
  // They are kept apart rather than stored as one duration in seconds. Sharing a
  // single value between the two inputs means each keystroke has to recompute the
  // other one from the value it is replacing, and the two can overwrite each other:
  // setting the hours while the minutes field has not been read yet quietly throws
  // the minutes away.
  const [durationHours, setDurationHours] = useState(null)
  const [durationMinutes, setDurationMinutes] = useState(null)
  // Whether the duration fields have been touched.
  //
  // The fields are pre-filled with the recorded duration, and they show hours and
  // minutes but not seconds. A workout recorded as 23 seconds therefore pre-fills as
  // "0h 0m", and saving the notes of an unrelated edit would quietly turn a
  // 23-second workout into a 0-second one. The recorded value is kept until a field
  // is actually edited.
  const [durationTouched, setDurationTouched] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [exs, routineList] = await Promise.all([getExercises(), getRoutines()])
      if (cancelled) return
      setExercises(exs)
      setRoutines(routineList)

      // The exercises a routine holds, in the routine's order, as library entries.
      // An exercise that has since been deleted from the library is left out rather
      // than shown as a blank card.
      const routineExercises = id => {
        const routine = routineList.find(r => r.id === id)
        if (!routine) return []
        return routine.exercise_ids
          .map(eid => exs.find(e => e.id === eid))
          .filter(Boolean)
      }

      if (isEditMode) {
        // Only the one session being edited. This used to load every session in the
        // account and pick one out of the result, which on a phone meant downloading
        // 176 KB of other workouts to change this one.
        const existing = await getSession(sessionId)
        if (cancelled) return
        if (existing) {
          setDate(existing.date)
          setSessionNotes(existing.notes || '')
          // The routine the workout was logged from. Editing a workout must not wipe
          // that: the save writes the routine id back, and an edit form that does not
          // know it would quietly untie the workout from the plan it came from.
          setRoutineId(existing.routine_id || null)
          // Editing shows the workout. The routine list is for choosing what to log,
          // and there is nothing to choose when a workout already exists.
          setPicking(false)
          const recorded = Number.isFinite(existing.duration_seconds) ? existing.duration_seconds : null
          setDurationSeconds(recorded)
          // The fields are pre-filled with the recorded duration rather than left
          // blank. A workout that was measured should open its editor showing that
          // measurement — otherwise the number is hidden behind an empty box, and
          // saving would replace it with whatever the fields happened to say.
          setDurationHours(recorded === null ? null : Math.floor(recorded / 3600))
          setDurationMinutes(recorded === null ? null : Math.floor((recorded % 3600) / 60))
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
      //
      // Two copies are read, and they are not interchangeable. The cloud draft is the
      // copy that survives the tab being killed or the account being signed out, and
      // the one that carries a workout to another device. The local mirror is the copy
      // this device actually has, and it is fresher.
      const cloud = await getDraft()
      if (cancelled) return

      // The local mirror. It holds every card, including the empty ones the cloud
      // draft drops — and it is where the user's last *navigation* lives.
      //
      // That second part matters. The cloud draft remembers which routine a workout
      // belongs to, but it has no way of saying "the Log tab was left on the routine
      // list". So it reopened the routine you had deliberately walked out of, and
      // the Log tab argued with you every time you came back to it. The mirror is
      // the only place that can remember which screen you left from.
      let mirror = null
      const raw = readDraft()
      if (raw) {
        try {
          mirror = JSON.parse(raw)
        } catch {
          sessionStorage.removeItem(draftKey())
          mirrorDraft('clear')
        }
      }

      // The measurement is restored from the local record first, and from the cloud
      // draft only when there is no local record.
      //
      // The local record is written the moment the clock is started, paused or
      // stopped, so on the device that took the measurement it is always at least as
      // fresh as the draft, which is written on a debounce. The draft is what carries
      // the measurement to a *different* device, and there is no local record to
      // disagree with it.
      const stopwatch = readStopwatch(currentUserId())

      if (cloud || mirror) {
        const draftId = cloud ? cloud.id : openingSessionIdRef.current
        if (cloud) setCurrentSessionId(cloud.id)
        // The mirror wins where the two disagree.
        //
        // It is written the instant something changes, where the cloud draft is
        // written on a debounce — and not at all if the app is left inside that
        // window, which is exactly when a note or a set is most likely to be
        // missing from it. The cloud draft is the copy that carries a workout to
        // another device, and the copy that survives a killed tab; the mirror is the
        // copy this device actually has. Same rule the stopwatch already follows.
        const draftRoutineId = mirror
          ? mirror.routineId || null
          : cloud.routine_id || null
        setRoutineId(draftRoutineId)
        setDate(mirror ? mirror.date || todayISO() : cloud.date || todayISO())
        setSessionNotes(mirror ? (mirror.sessionNotes ?? '') : (cloud.notes || ''))
        // …unless you left the Log tab on the routine list. Then the list is where
        // you come back to: the list is the screen you choose what to log from, and
        // being dropped into a routine you walked out of is not a choice anybody
        // made.
        const onRoutineList = Boolean(mirror && mirror.picking === true)
        setPicking(onRoutineList)
        // Merged back into the routine, not used as the whole editor. The draft only holds
        // exercises with a logged set, so restoring it verbatim would reopen the page with
        // one card — the one you happened to fill last. Re-seeding puts every exercise
        // back, empty ones included, which is what you were looking at when you left.
        const source = draftRoutineId ? routineExercises(draftRoutineId) : exs
        // The cloud draft keeps only the cards that were filled. The mirror keeps every
        // card, so the empty ones are filtered out here for the same reason.
        const savedLogs = mirror
          ? (mirror.logs || []).filter(cardHasContent)
          : cloud.exercise_logs
        setLogs(mergeWithLibrary(source, savedLogs, generateId))
        setHasDraft(true)
        if (stopwatch) {
          setTimer({ ...stopwatch, sessionId: draftId })
        } else if (mirror && mirror.timer) {
          setTimer({ ...mirror.timer, sessionId: draftId })
        } else if (cloud) {
          // The draft carries the time already counted and the start of the current
          // segment, which between them give the elapsed time exactly.
          setTimer(
            restoreStopwatch(currentUserId(), cloud.id, {
              accumulatedMs: (cloud.duration_seconds || 0) * 1000,
              runningSince: cloud.started_at ? Date.parse(cloud.started_at) : null,
            }),
          )
        }
        loadedRef.current = true
        return
      }

      // Nothing in progress: the Log tab opens on the routine list.
      //
      // It used to open on the whole exercise library, which is the thing this
      // feature exists to fix — a list of dozens of rows, of which you do six.
      // The editor stays empty until a routine is picked.
      setLogs([])
      setPicking(true)
      // No clock is started here. Opening the Log page used to start one by itself,
      // which meant that simply looking at the app recorded time nobody spent
      // training. The measurement waits for a deliberate Start.
      //
      // A measurement left over from an earlier visit is restored, though: the clock
      // keeps counting while the app is closed or the account is signed out, so
      // coming back to it should show the time that passed, not zero.
      if (stopwatch) setTimer({ ...stopwatch, sessionId: openingSessionIdRef.current })
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
    // Only persist a draft that holds something worth restoring.
    //
    // This used to write on every render, including the one triggered by merely opening
    // the page — a draft of nothing but a date. Because the restore path adopts the
    // draft's date, visiting Log on one day and logging on another silently filed the
    // workout under the first day. That is exactly how a session dated the 26th ended
    // up created on the 28th, with only a bare "Discard" chip to hint at it.
    // A running measurement is content too. The draft is what carries the timer to
    // another device, and a workout that was started but not yet written down would
    // otherwise lose its clock the moment the tab closed.
    const hasContent =
      logs.some(l => l.set_entries.some(s => s.weight || s.reps)) ||
      sessionNotes.trim().length > 0 ||
      timer !== null
    if (hasContent) {
      // The measurement rides along so a restored draft picks the clock up where it
      // was — running, paused or stopped — and so does the routine it belongs to.
      //
      // `picking` is the screen the Log tab was left on. Without it the restore could
      // only reopen the routine the draft belonged to, and leaving that routine by
      // tapping "Routines" meant the next visit threw you straight back into it.
      const payload = JSON.stringify({ logs, date, sessionNotes, timer, routineId, picking })
      sessionStorage.setItem(draftKey(), payload)
      mirrorDraft('set', payload)
    } else {
      sessionStorage.removeItem(draftKey())
      mirrorDraft('clear')
    }
    setHasDraft(hasContent)
  }, [logs, date, sessionNotes, timer, routineId, picking, isEditMode])

  // Warn before the window closes or reloads with an unsaved workout.
  //
  // The draft survives a closed window now, so this is no longer the last line of
  // defence — it is the first. A prompt the user can dismiss is better than a silent
  // reload they never asked for, and this covers the cases localStorage cannot: a
  // browser kill, a crash, a laptop lid, or switching away mid-set.
  useEffect(() => {
    if (!loadedRef.current || isEditMode || !hasDraft) return
    const warn = e => {
      e.preventDefault()
      // Chrome requires returnValue to be set; the string it shows is now ignored.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasDraft, isEditMode])

  // Clears both copies of the draft: the local mirror and the cloud row. The cloud delete
  // is fire-and-forget — the screen has already reset, and a failure here would leave a
  // draft that the next autosave replaces anyway (one draft per account).
  function discardCurrentDraft() {
    sessionStorage.removeItem(draftKey())
    mirrorDraft('clear')
    discardDraft().catch(() => {})
    setHasDraft(false)
    setDate(todayISO())
    setSessionNotes('')
    setDurationHours(null)
    setDurationMinutes(null)
    setDurationTouched(false)
    const fresh = generateId()
    setCurrentSessionId(fresh)
    // The cards go back to the routine the session is logging, or to the whole library
    // when it is not tied to one. The screen stays where it was: discarding a draft is
    // not the same as leaving the routine.
    const source = routineId ? routineExerciseEntries(routineId) : exercises
    setLogs(source.map((ex, i) => emptyLog(ex, i)))
    // The abandoned workout's measurement goes with it. The next one starts from zero,
    // and waits for a deliberate Start like any other.
    clearStopwatch(currentUserId())
    setTimer(null)
  }

  // What autosave writes. Same shape handleSave builds, minus the filtering that only
  // makes sense at commit time: a draft keeps every set the user has typed, including
  // half-filled ones, because that is the state being protected.
  //
  // The measurement rides along in two pieces, and between them they give the elapsed
  // time exactly:
  //
  //   duration_seconds   the time already counted, from segments that have finished
  //   started_at         when the current segment began, null when not counting
  //
  // elapsed = duration_seconds + (started_at ? now - started_at : 0)
  const autosaveSession = useMemo(
    () => ({
      id: currentSessionId,
      date,
      notes: sessionNotes,
      duration_seconds: timer ? Math.round(timer.accumulatedMs / 1000) : undefined,
      started_at: timer?.runningSince ? new Date(timer.runningSince).toISOString() : null,
      // Which routine this session belongs to. It is what lets the Log tab reopen the
      // same routine after a reload, instead of dropping you back on the list.
      routine_id: routineId,
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
    }),
    [currentSessionId, date, sessionNotes, timer, routineId, logs],
  )

  // Autosave runs for new sessions only. Editing a saved workout is a deliberate, brief
  // change to something that already exists in the cloud, and a draft row for it would
  // mean two copies of one session.
  const { state: autosaveState } = useAutosave(autosaveSession, { enabled: !isEditMode })

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

  /* ── Routines ──
   *
   * A routine is a named, ordered list of exercises drawn from the shared library.
   * The Log tab opens on the list of routines rather than on the library, because the
   * library is long and the routine is short and is what you actually meant.
   */

  // The routine's exercises, in the routine's order, as library entries.
  const routineExerciseEntries = useCallback(
    id => {
      const routine = routines.find(r => r.id === id)
      if (!routine) return []
      return routine.exercise_ids.map(eid => exercises.find(e => e.id === eid)).filter(Boolean)
    },
    [routines, exercises],
  )

  // Put the session's cards into a given order of exercise ids.
  //
  // Anything not named in the order keeps its sets and moves to the end, so switching
  // routines halfway through a workout does not quietly throw away what was logged.
  const orderLogs = (cards, ids) => {
    const byExercise = new Map(cards.map(card => [card.exercise_id, card]))
    const ordered = []
    for (const id of ids) {
      const card = byExercise.get(id)
      if (!card) continue
      ordered.push(card)
      byExercise.delete(id)
    }
    for (const card of byExercise.values()) ordered.push(card)
    return ordered.map((card, i) => ({ ...card, order: i }))
  }

  /**
   * Start logging a routine.
   *
   * The cards become the routine's exercises, in its order. Anything already logged
   * that the new routine does not contain keeps its sets and stays at the end of the
   * list, so nothing is lost by changing your mind halfway through.
   */
  function pickRoutine(id) {
    // The routine's exercises, or the whole library when the workout is not tied to
    // one — "log without a routine" is the same operation with a different source.
    const source = id ? routineExerciseEntries(id) : exercises
    const wanted = source.map(ex => ex.id)
    setRoutineId(id)
    setPicking(false)
    setEditingRoutine(false)
    // The merge is in lib/routines.js, where a plain node test can check it exactly.
    // It used to live here, and it dropped every card that was in both the previous
    // cards and the new routine: picking the routine you were already logging
    // emptied the workout, and "log without a routine" emptied it too.
    setLogs(prev => mergeRoutineCards(prev, source, wanted, emptyLog))
  }

  /**
   * Create a routine and open it.
   *
   * The new routine goes straight into the reorder editor, because a routine with no
   * exercises in it is not much of a routine.
   */
  async function createRoutine(name) {
    const id = generateId()
    await saveRoutine({ id, name })
    const fresh = await getRoutines()
    setRoutines(fresh)
    setRoutineId(id)
    setPicking(false)
    setEditingRoutine(true)
  }

  /**
   * Write a new order for the routine.
   *
   * The session's cards follow, so what you reorder is what you log.
   */
  async function reorderRoutine(ids) {
    if (!routineId) return
    await setRoutineExercises(routineId, ids)
    setRoutines(prev => prev.map(r => (r.id === routineId ? { ...r, exercise_ids: ids } : r)))
    setLogs(prev => orderLogs(prev, mergeOrder(ids, prev.map(c => c.exercise_id))))
  }

  /**
   * Take an exercise out of the routine.
   *
   * The card stays in the session if it has sets — removing it from the routine is a
   * statement about the plan, not about the workout you are doing.
   */
  async function removeFromRoutine(exerciseId) {
    if (!routineId) return
    const ids = (routines.find(r => r.id === routineId)?.exercise_ids || []).filter(id => id !== exerciseId)
    await setRoutineExercises(routineId, ids)
    setRoutines(prev => prev.map(r => (r.id === routineId ? { ...r, exercise_ids: ids } : r)))
  }

  /**
   * Add an exercise to the routine.
   *
   * It joins the end of the routine and appears in the session, because a routine you
   * just added something to should show it.
   */
  async function addToRoutine(exercise) {
    if (!routineId) return
    const ids = routines.find(r => r.id === routineId)?.exercise_ids || []
    if (ids.includes(exercise.id)) return
    const next = [...ids, exercise.id]
    await setRoutineExercises(routineId, next)
    setRoutines(prev => prev.map(r => (r.id === routineId ? { ...r, exercise_ids: next } : r)))
    setLogs(prev => {
      // The exercise that was passed in, not a lookup: the library entry was added a
      // moment ago, so this render's `exercises` does not have it yet. Looking it up
      // here would find nothing and the card would silently not appear.
      if (prev.some(card => card.exercise_id === exercise.id)) return prev
      return [...prev, emptyLog(exercise, prev.length)]
    })
  }

  /**
   * Put a dataset exercise in the library, if it is not there already.
   *
   * An exercise that is already in the library is left exactly as it is. Writing it
   * again would give it a fresh `order`, which moves it to the end of the library —
   * and with routines the library order is cosmetic, but the Exercises tab still shows
   * it, and an exercise jumping about is its own small mystery.
   */
  async function ensureInLibrary(ex) {
    const existing = exercises.find(e => e.id === ex.id)
    if (existing) return existing

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
      return null
    }
    setExercises(prev => (prev.some(e => e.id === record.id) ? prev : [...prev, record]))
    return record
  }

  /**
   * Add a dataset exercise to the routine being edited.
   *
   * It has to exist in the library first: routine_exercises.exercise_id is a foreign
   * key to exercises(id), and a routine cannot hold an exercise that does not exist.
   */
  async function addExerciseToRoutine(ex) {
    const record = await ensureInLibrary(ex)
    if (!record) return
    await addToRoutine(record)
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
    const record = await ensureInLibrary(ex)
    if (!record) return
    setLogs(prev => [...prev, emptyLog(record, prev.length)])
  }

  function removeLog(logId) {
    setLogs(prev => prev.filter(l => l.id !== logId))
  }

  function toggleCollapse(logId) {
    setCollapsed(prev => ({ ...prev, [logId]: !prev[logId] }))
  }

  // ── The measurement ──
  //
  // Four controls, and the state machine they drive:
  //
  //   idle ──Start──► running ──Pause──► paused ──Resume──► running
  //                      │                  │
  //                      └────Stop──────────┴──► stopped ──Start over──► idle
  //
  // Pause and Stop do the same arithmetic and mean different things: a paused
  // measurement can be resumed, a stopped one is final.

  function handleStartTimer() {
    setTimer(startStopwatch(currentUserId(), currentSessionId))
  }

  function handlePauseTimer() {
    const paused = pauseStopwatch(currentUserId())
    if (paused) setTimer(paused)
  }

  function handleStopTimer() {
    const stopped = stopStopwatch(currentUserId())
    if (stopped) setTimer(stopped)
  }

  function handleResetTimer() {
    clearStopwatch(currentUserId())
    setTimer(null)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    // How long the workout took.
    //
    // The hand-entered value wins when there is one: it is how a workout that was not
    // timed gets a duration at all. Otherwise the measured elapsed time is used, which
    // is correct even when the app was closed for part of the session, because the
    // elapsed time comes from the clock rather than from ticks.
    //
    // A measurement that is still running is frozen first, so the total includes the
    // segment in progress. Saving ends the workout's timing.
    const frozen = isRunning(timer) ? stopStopwatch(currentUserId()) : timer
    const measured = frozen ? elapsedSeconds(frozen) : null
    // A duration typed in by hand wins when there is one: it is how a workout that was
    // not timed gets a duration at all.
    //
    // When the fields have not been touched, the recorded duration is kept as it is —
    // in edit mode they are pre-filled but only show whole minutes, so recomputing
    // from them would quietly round a 23-second workout down to zero.
    //
    // Otherwise the measured elapsed time is used, which is correct even when the app
    // was closed for part of the session, because the elapsed time comes from the clock
    // rather than from ticks.
    const duration = durationTouched
      ? durationHours === null && durationMinutes === null
        ? null
        : (durationHours || 0) * 3600 + (durationMinutes || 0) * 60
      : durationSeconds ?? measured
    const session = {
      id: currentSessionId,
      date,
      notes: sessionNotes,
      duration_seconds: duration,
      // The measurement is over, so there is no segment still counting. The column is
      // set to null rather than left alone, because a draft's started_at is the start
      // of a segment and this row is the finished workout.
      //
      // Editing a saved workout is different: it was never being timed, and the row's
      // own start instant is left exactly as it was.
      ...(isEditMode ? {} : { started_at: null }),
      // Which routine the session was logged from, so the history can say where it
      // came from and the Log tab can reopen it.
      routine_id: routineId,
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
      // draft: false promotes whatever autosave wrote: same row, same id, flag flipped.
      // There is no copy step, so a draft cannot survive a successful save.
      await saveSession(session, { draft: false })
      sessionStorage.removeItem(draftKey())
      mirrorDraft('clear')
      // The workout is over, so the measurement goes with it. Clearing it here rather
      // than on unmount means leaving the page without saving keeps the clock running,
      // which is the behaviour that was asked for.
      clearStopwatch(currentUserId())
      setTimer(null)
      navigate('/history')
    } catch (err) {
      setSaveError(`Could not save this session: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const loggedCount = logs.filter(l => l.set_entries.some(s => s.weight || s.reps)).length

  // The name of the routine being logged, for the header.
  const routineName = routines.find(r => r.id === routineId)?.name || 'Workout'

  return (
    <div className="screen">
      {/* Header.
          Two rows, and the split is not cosmetic.

          One row cannot hold the back button, the title, the draft chip, the autosave
          chip and the date picker: measured on a 390px phone that comes to about 520px
          of content in a 356px box. The date picker was the casualty — it was pushed
          clean off the right edge, so the date of the workout could not be changed at
          all.

          The first row keeps what the page is: where you are and what day it is. The
          second row carries the two things that only sometimes exist. */}
      <div style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)', paddingBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => navigate(-1)} aria-label="Back" className="hit" style={{ marginLeft: -10 }}>
            <ArrowLeft size={24} color="var(--primary)" />
          </button>
          <h1
            className="screen-title"
            style={{
              fontSize: 'var(--type-title)',
              letterSpacing: 'var(--tracking-title)',
              flex: 1,
              minWidth: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {isEditMode ? 'Edit Session' : editingRoutine ? routineName : picking ? 'Log Workout' : routineName}
          </h1>
          {!picking && !editingRoutine && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <input
                type="date"
                value={date}
                max={todayISO()}
                aria-label="Session date"
                onChange={e => setDate(e.target.value)}
                style={{ width: 'auto', flexShrink: 0, fontSize: 'var(--type-subhead)', padding: '0 10px' }}
              />
              {/* Standing guard rather than an error message. If the badge is absent, the
                  date is not today — which is the one thing worth noticing here, and the
                  thing that was previously silent. */}
              {date === todayISO() ? (
                <span
                  className="tnum"
                  style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}
                >
                  Today
                </span>
              ) : (
                <span
                  className="tnum"
                  style={{ fontSize: 'var(--type-fine)', color: 'var(--destructive)', whiteSpace: 'nowrap' }}
                >
                  Not today
                </span>
              )}
            </div>
          )}
        </div>

        {(hasDraft || autosaveState || (!picking && !editingRoutine && !isEditMode)) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {!picking && !editingRoutine && !isEditMode && (
              <>
                <button
                  onClick={() => { setPicking(true); setEditingRoutine(false) }}
                  className="chip"
                  style={{ minHeight: 36 }}
                >
                  <ArrowLeft size={14} /> Routines
                </button>
                {routineId && (
                  <button onClick={() => setEditingRoutine(true)} className="chip" style={{ minHeight: 36 }}>
                    Edit routine
                  </button>
                )}
              </>
            )}
            {hasDraft && !isEditMode && (
              <button onClick={discardCurrentDraft} className="chip" style={{ minHeight: 36 }}>
                <RotateCcw size={14} /> {formatDate(date)}
              </button>
            )}
            {/* Autosave is quiet by design — it should not compete with the workout for
                attention. But "Saved" must never appear before the write has actually
                succeeded. The earlier version showed the chip while the request was in flight,
                so a failed save looked identical to a successful one — which is precisely how
                this went unnoticed. The state here is 'saved' only once it is true. */}
            {!isEditMode && autosaveState && (
              <span
                className="chip"
                role="status"
                style={{
                  minHeight: 36,
                  pointerEvents: 'none',
                  opacity: 0.75,
                  color: autosaveState === 'failed' ? 'var(--destructive)' : 'var(--ink-muted)',
                }}
              >
                {autosaveState === 'saving' && 'Saving…'}
                {autosaveState === 'saved' && 'Saved'}
                {autosaveState === 'failed' && 'Not saved'}
              </span>
            )}
          </div>
        )}
      </div>

      {editingRoutine ? (
        <RoutineEditor
          exercises={routineExerciseEntries(routineId)}
          onReorder={reorderRoutine}
          onRemove={removeFromRoutine}
          onAdd={() => setPickerMode('routine')}
          onDone={() => setEditingRoutine(false)}
        />
      ) : picking ? (
        <RoutinePicker routines={routines} onPick={pickRoutine} onCreate={createRoutine} />
      ) : (
        <>
      {/* Session time.
          The live readout while logging, and the editable field when editing a session
          that was already saved. One place for both, because it is the same fact: how
          long this workout took.

          The clock is started by hand. Opening the Log page used to start it by
          itself, which meant that merely looking at the app recorded time nobody
          spent training. */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isEditMode ? 0 : 10, flexWrap: 'wrap' }}>
          <Clock size={15} color="var(--ink-muted)" />
          <span style={{ fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)' }}>Session time</span>

          {isEditMode ? (
            <>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="24"
                placeholder="h"
                aria-label="Duration in hours"
                value={durationHours === null ? '' : durationHours}
                onChange={e => {
                  setDurationTouched(true)
                  setDurationHours(e.target.value === '' ? null : Number(e.target.value))
                }}
                className="tnum"
                style={{ width: 64, textAlign: 'center', padding: '8px 6px' }}
              />
              <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)' }}>h</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="59"
                placeholder="m"
                aria-label="Duration in minutes"
                value={durationMinutes === null ? '' : durationMinutes}
                onChange={e => {
                  setDurationTouched(true)
                  setDurationMinutes(e.target.value === '' ? null : Number(e.target.value))
                }}
                className="tnum"
                style={{ width: 64, textAlign: 'center', padding: '8px 6px' }}
              />
              <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)' }}>m</span>
              {durationHours === null && durationMinutes === null && durationSeconds !== null && (
                <span style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>
                  recorded {formatDuration(durationSeconds)}
                </span>
              )}
            </>
          ) : (
            <>
              <span style={{ fontSize: 'var(--type-title)', fontWeight: 600, color: 'var(--ink)' }}>
                <TimerReadout timer={timer} />
              </span>
              <span style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>
                {timerStateLabel(timer)}
              </span>
            </>
          )}
        </div>

        {!isEditMode && <TimerControls timer={timer} onStart={handleStartTimer} onPause={handlePauseTimer} onStop={handleStopTimer} onReset={handleResetTimer} />}
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
                    gridTemplateColumns: '32px 1fr 1fr 44px',
                    gap: 4,
                    marginBottom: 6,
                  }}
                >
                  {['Set', 'kg', 'Reps', ''].map((label, i) => (
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
                        gridTemplateColumns: '32px 1fr 1fr 44px',
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
      <button onClick={() => setPickerMode('session')} className="btn-secondary btn-block" style={{ marginBottom: 16 }}>
        <Plus size={18} />
        Add Exercise
      </button>

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
        </>
      )}

      {pickerMode && (
        <ExercisePicker
          onClose={() => setPickerMode(null)}
          usedIds={pickerMode === 'routine'
            ? (routines.find(r => r.id === routineId)?.exercise_ids || [])
            : logs.map(l => l.exercise_id)}
          onSelect={ex => {
            if (pickerMode === 'routine') addExerciseToRoutine(ex)
            else addExercise(ex)
            setPickerMode(null)
          }}
        />
      )}
    </div>
  )
}

function titleCase(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : ''
}

/**
 * The running clock.
 *
 * It re-renders once a second so the number moves, but the value it shows is always
 * derived from the start instant rather than accumulated from ticks. That is what makes
 * it keep counting when the tab is hidden or the app is closed: coming back after ten
 * minutes shows ten minutes more, not zero.
 */
/**
 * The elapsed time, as a running readout.
 *
 * It re-renders once a second while the clock is counting, but the value it shows is
 * always derived from the stored instants rather than accumulated from ticks. That is
 * what makes it keep counting when the tab is hidden or the app is closed: coming back
 * after ten minutes shows ten minutes more, not zero.
 *
 * A paused or stopped measurement does not tick at all — its value is fixed, and
 * re-rendering it every second would be work for nothing.
 */
function TimerReadout({ timer }) {
  const [now, setNow] = useState(() => Date.now())
  const running = isRunning(timer)

  useEffect(() => {
    if (!running) return undefined
    // A backgrounded tab throttles its timers, so the interval is a nudge to re-read the
    // clock rather than the thing that counts. One second is enough for a display that
    // only shows seconds.
    const id = setInterval(() => setNow(Date.now()), 1000)
    // Coming back to the tab should show the right time immediately.
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [running])

  // The clock is read from the stored instants, so a stale `now` cannot make the
  // readout wrong — it can only make it a second behind. When a segment has just
  // begun, `now - runningSince` is negative and clamps to zero, which is exactly what
  // the elapsed time is at that instant.
  //
  // formatStopwatch, not formatDuration: this is a running counter, so it shows seconds
  // and reads as mm:ss the way a phone's own timer does. formatDuration drops the
  // seconds once a minute is reached, which would make the clock look stuck.
  return <span className="tnum">{formatStopwatch(elapsedMs(timer, now))}</span>
}

/** What the measurement is doing, in words. */
function timerStateLabel(timer) {
  if (!timer) return 'not started'
  if (timer.finished) return 'stopped'
  if (isRunning(timer)) return 'running'
  return 'paused'
}

/**
 * The four controls.
 *
 * Which ones are offered depends on where the measurement is, so that there is only
 * ever one sensible next action. Pause and Stop differ in what they mean rather than
 * in what they do: a paused measurement can be resumed, a stopped one is final.
 */
function TimerControls({ timer, onStart, onPause, onStop, onReset }) {
  const running = isRunning(timer)
  const paused = Boolean(timer) && !running && !timer.finished
  const stopped = Boolean(timer) && timer.finished

  // Every control is a ghost pill. The Save button below is the page's primary action,
  // and two competing primaries on one screen is one too many.
  const button = (label, onClick, key) => (
    <button
      key={key}
      onClick={onClick}
      className="btn-secondary"
      style={{ minHeight: 44, padding: '10px 18px', fontSize: 'var(--type-subhead)' }}
    >
      {label}
    </button>
  )

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {!timer && button('Start', onStart, 'start')}
      {running && button('Pause', onPause, 'pause')}
      {running && button('Stop', onStop, 'stop')}
      {paused && button('Resume', onStart, 'resume')}
      {paused && button('Stop', onStop, 'stop')}
      {stopped && button('Start over', onReset, 'reset')}
    </div>
  )
}
