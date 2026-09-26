// src/lib/db.js
// Abstraction layer: reads/writes localStorage, syncs to Supabase when available.
import { supabase } from './supabaseClient'
import { imageUrl, DEFAULT_EXERCISE_IMAGE_MAP } from './exerciseDb'
import { currentUserId } from './auth'

/*
 * Local cache keys are namespaced per user id. Without this, two people sharing a
 * device would read each other's cached sessions straight out of localStorage,
 * bypassing RLS entirely. The keys that used to be unprefixed are read once as a
 * legacy fallback and then dropped, since the cloud copy is authoritative.
 *
 * The rest timer is intentionally NOT namespaced: it is transient, belongs to
 * whoever is holding the phone, and dies on its own within minutes.
 */
const cacheKey = (base, userId) => (userId ? `${base}:${userId}` : base)

const LEGACY_KEYS = ['gym_exercises', 'gym_sessions', 'gym_draft']

/**
 * The bases actually passed to localSet/localGet, and so the keys that exist in
 * storage as `${base}:${userId}`. Distinct from LEGACY_KEYS, which are the old
 * unprefixed names read once during migration and then deleted.
 */
const CACHE_BASES = ['exercises', 'sessions', 'gym_draft']

/**
 * Drop a user's cached rows. Called on sign-out: namespacing already stops the next
 * person *using* this data, but without this it would sit in localStorage on a shared
 * device until that same account signed back in. Takes the id explicitly, because
 * sign-out clears the in-memory user before a caller could ask for it.
 */
export function clearLocalCache(userId) {
  if (!userId) return
  try {
    for (const base of CACHE_BASES) localStorage.removeItem(cacheKey(base, userId))
  } catch {
    /* storage unavailable, or a private-mode browser refusing writes */
  }
}

/* ─── Local helpers ─── */
function localGet(base) {
  const key = cacheKey(base, currentUserId())
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) || []
  } catch {
    return []
  }
  // Signed in, but this user has no cache yet and an unprefixed key exists. Adopt
  // it once, then remove it so it cannot leak to the next person on this device.
  const legacy = localStorage.getItem(base)
  if (legacy) {
    localStorage.removeItem(base)
    try {
      const parsed = JSON.parse(legacy) || []
      localStorage.setItem(key, JSON.stringify(parsed))
      return parsed
    } catch {
      return []
    }
  }
  return []
}

function localSet(base, value) {
  localStorage.setItem(cacheKey(base, currentUserId()), JSON.stringify(value))
}

/** Called on sign-out so the next person on the device starts from a clean slate. */
export function purgeUnscopedCaches() {
  for (const key of LEGACY_KEYS) localStorage.removeItem(key)
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

/**
 * The user id every write must carry. RLS's `with check` clause rejects a mismatch,
 * so failing here gives a clearer message than letting Postgres refuse the row.
 */
function requireUserId(action) {
  const id = currentUserId()
  if (!id) throw new Error(`Cannot ${action} while signed out.`)
  return id
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
      localSet('exercises', hydrated)
      return hydrated
    }
  }
  const local = localGet('exercises')
  if (local.length === 0) {
    localSet('exercises', DEFAULT_EXERCISES)
    return DEFAULT_EXERCISES
  }
  return withFallbackImages(local)
}

export async function saveExercise(exercise) {
  const exercises = localGet('exercises')
  const idx = exercises.findIndex(e => e.id === exercise.id)
  if (idx >= 0) exercises[idx] = exercise
  else exercises.push(exercise)
  localSet('exercises', exercises)

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
  localSet('exercises', localGet('exercises').filter(e => e.id !== id))
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
      localSet('sessions', sessions)
      return sessions
    }
  }
  return localGet('sessions')
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
  const userId = requireUserId('save a session')
  const sessions = localGet('sessions')
  const idx = sessions.findIndex(s => s.id === session.id)
  if (idx >= 0) sessions[idx] = session
  else sessions.push(session)
  localSet('sessions', sessions)

  if (!supabase) return session

  // 1. Session header
  unwrap(
    await supabase.from('workout_sessions').upsert({
      id: session.id,
      date: session.date,
      notes: session.notes || null,
      user_id: userId,
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
          user_id: userId,
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
            user_id: userId,
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
  localSet('sessions', localGet('sessions').filter(s => s.id !== id))
}

/* ─── Sync from Supabase to localStorage (call on app init when online) ─── */
export async function syncFromCloud() {
  if (!supabase) return
  await getExercises()
  await getSessions()
}
