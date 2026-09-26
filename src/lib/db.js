// src/lib/db.js
// Abstraction layer: reads/writes localStorage, syncs to Supabase when available.
import { supabase } from './supabaseClient'
import { imageUrl, DEFAULT_EXERCISE_IMAGE_MAP } from './exerciseDb'

const KEYS = {
  exercises: 'gym_exercises',
  sessions: 'gym_sessions',
}

/* ─── Local helpers ─── */
function localGet(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || []
  } catch {
    return []
  }
}
function localSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

/**
 * Every Supabase write goes through here. Previously the `{ error }` returned by
 * these calls was discarded, which is how a foreign-key violation on
 * exercise_logs.exercise_id silently discarded a whole session's data.
 */
function unwrap({ error }, context) {
  if (error) {
    const err = new Error(error.message)
    err.context = context
    throw err
  }
}

/* ─── Default exercises ─── */
const DEFAULT_EXERCISE_ROWS = [
  ['1', 'Dumbbell Flat Bench', 'Chest'],
  ['2', 'Incline Dumbbell Press', 'Chest'],
  ['3', 'Shoulder Press', 'Shoulders'],
  ['4', 'Lat Pull Down', 'Back'],
  ['5', 'Close Grip Row', 'Back'],
  ['6', 'Wide Grip Row', 'Back'],
  ['7', 'Cable Lateral Raise', 'Shoulders'],
  ['8', 'Tricep Extension', 'Arms'],
  ['9', 'Bicep Curl', 'Arms'],
  ['10', 'Hammer Curl', 'Arms'],
]

export const DEFAULT_EXERCISES = DEFAULT_EXERCISE_ROWS.map(([id, name, muscle_group], i) => ({
  id,
  name,
  muscle_group,
  order: i + 1,
  image_url: imageUrl(DEFAULT_EXERCISE_IMAGE_MAP[id]),
}))

/**
 * Backfills image_url for the 10 seeded rows when the cloud copy is missing it.
 * The seed predates the image_url column, so a stale row would otherwise render
 * every Log card without a thumbnail.
 */
function withFallbackImages(exercises) {
  return exercises.map(ex => {
    if (ex.image_url) return ex
    const fallback = DEFAULT_EXERCISE_IMAGE_MAP[ex.id]
    return fallback ? { ...ex, image_url: imageUrl(fallback) } : ex
  })
}

/* ─── Exercises ─── */
export async function getExercises() {
  if (supabase) {
    const { data, error } = await supabase.from('exercises').select('*').order('order')
    if (!error && data) {
      const hydrated = withFallbackImages(data)
      localSet(KEYS.exercises, hydrated)
      return hydrated
    }
  }
  const local = localGet(KEYS.exercises)
  if (local.length === 0) {
    localSet(KEYS.exercises, DEFAULT_EXERCISES)
    return DEFAULT_EXERCISES
  }
  return withFallbackImages(local)
}

export async function saveExercise(exercise) {
  const exercises = localGet(KEYS.exercises)
  const idx = exercises.findIndex(e => e.id === exercise.id)
  if (idx >= 0) exercises[idx] = exercise
  else exercises.push(exercise)
  localSet(KEYS.exercises, exercises)

  if (supabase) {
    // exercise_logs.exercise_id references exercises(id). A row that is never
    // written here makes every log insert for that exercise fail, so callers
    // must persist the exercise before writing logs against it.
    unwrap(await supabase.from('exercises').upsert(exercise), `save exercise ${exercise.id}`)
  }
  return exercise
}

export async function deleteExercise(id) {
  if (supabase) {
    // Remote first, so a rejection leaves no local trace. exercise_logs.exercise_id
    // is NO ACTION, so removing an exercise that past sessions still reference is
    // rejected — surface that instead of pretending it worked.
    unwrap(await supabase.from('exercises').delete().eq('id', id), `delete exercise ${id}`)
  }
  localSet(KEYS.exercises, localGet(KEYS.exercises).filter(e => e.id !== id))
}

/* ─── Sessions ─── */
export async function getSessions() {
  if (supabase) {
    const { data, error } = await supabase
      .from('workout_sessions')
      .select('*, exercise_logs(*, set_entries(*))')
      .order('date', { ascending: false })
    if (!error && data) {
      const sessions = data.map(s => ({ ...s, exercise_logs: sortLogs(s.exercise_logs) }))
      localSet(KEYS.sessions, sessions)
      return sessions
    }
  }
  return localGet(KEYS.sessions)
    .map(s => ({ ...s, exercise_logs: sortLogs(s.exercise_logs) }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** PostgREST returns nested rows unordered; `order` is the only intended sequence. */
function sortLogs(logs) {
  return [...(logs || [])]
    .map(log => ({ ...log, set_entries: [...(log.set_entries || [])].sort((a, b) => a.set_number - b.set_number) }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export async function saveSession(session) {
  const sessions = localGet(KEYS.sessions)
  const idx = sessions.findIndex(s => s.id === session.id)
  if (idx >= 0) sessions[idx] = session
  else sessions.push(session)
  localSet(KEYS.sessions, sessions)

  if (!supabase) return session

  // 1. Session header
  unwrap(
    await supabase.from('workout_sessions').upsert({
      id: session.id,
      date: session.date,
      notes: session.notes || null,
    }),
    `save session ${session.id}`,
  )

  // 2. Drop logs removed in the editor. Deleting the log cascades to its sets,
  //    otherwise a removed exercise reappears on the next fetch.
  const keptLogIds = session.exercise_logs.map(l => l.id)
  const { data: existingLogs } = await supabase
    .from('exercise_logs')
    .select('id')
    .eq('session_id', session.id)
  const staleLogIds = (existingLogs || []).map(r => r.id).filter(id => !keptLogIds.includes(id))
  if (staleLogIds.length > 0) {
    unwrap(
      await supabase.from('exercise_logs').delete().in('id', staleLogIds),
      `prune logs of session ${session.id}`,
    )
  }

  // 3. Drop sets removed from a log that still exists. Doing this before the
  //    upserts keeps it a pure "delete what is unwanted, then write what is wanted".
  const keptSetIds = new Set(session.exercise_logs.flatMap(l => l.set_entries.map(s => s.id)))
  const { data: existingSets } = await supabase
    .from('set_entries')
    .select('id')
    .in('exercise_log_id', keptLogIds.length > 0 ? keptLogIds : ['__none__'])
  const staleSetIds = (existingSets || []).map(r => r.id).filter(id => !keptSetIds.has(id))
  if (staleSetIds.length > 0) {
    unwrap(await supabase.from('set_entries').delete().in('id', staleSetIds), `prune sets of session ${session.id}`)
  }

  // 4. Upsert logs, then every set in one batched request rather than a loop.
  if (session.exercise_logs.length > 0) {
    unwrap(
      await supabase.from('exercise_logs').upsert(
        session.exercise_logs.map(log => ({
          id: log.id,
          session_id: session.id,
          exercise_id: log.exercise_id,
          order: log.order,
        })),
      ),
      `save logs of session ${session.id}`,
    )

    const allSets = session.exercise_logs.flatMap(log => log.set_entries)
    if (allSets.length > 0) {
      unwrap(
        await supabase.from('set_entries').upsert(
          allSets.map(s => ({
            id: s.id,
            exercise_log_id: s.exercise_log_id,
            set_number: s.set_number,
            weight: toNumberOrNull(s.weight),
            reps: toNumberOrNull(s.reps),
            note: s.note || null,
          })),
        ),
        `save sets of session ${session.id}`,
      )
    }
  }

  return session
}

/** Inputs arrive as strings; numeric columns must receive numbers or null. */
function toNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export async function deleteSession(id) {
  if (supabase) {
    // Remote first, so a rejection leaves no local trace. Cascades to exercise_logs
    // and set_entries.
    unwrap(await supabase.from('workout_sessions').delete().eq('id', id), `delete session ${id}`)
  }
  localSet(KEYS.sessions, localGet(KEYS.sessions).filter(s => s.id !== id))
}

/* ─── Sync from Supabase to localStorage (call on app init when online) ─── */
export async function syncFromCloud() {
  if (!supabase) return
  await getExercises()
  await getSessions()
}
