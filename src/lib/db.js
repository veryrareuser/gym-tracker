// src/lib/db.js
// Abstraction layer: reads/writes sessionStorage, syncs to Supabase when available.
import { supabase } from './supabaseClient'
import { imageUrl, DEFAULT_EXERCISE_IMAGE_MAP } from './exerciseDb'
import { currentUserId } from './auth'

/*
 * Local cache keys are namespaced per user id. Without this, two people sharing a
 * device would read each other's cached sessions straight out of sessionStorage,
 * bypassing RLS entirely. The keys that used to be unprefixed are read once as a
 * legacy fallback and then dropped, since the cloud copy is authoritative.
 *
 * The rest timer is intentionally NOT namespaced: it is transient, belongs to
 * whoever is holding the phone, and dies on its own within minutes. The stopwatch is
 * namespaced, because a session's length belongs to the account that recorded it.
 */
const cacheKey = (base, userId) => (userId ? `${base}:${userId}` : base)

const LEGACY_KEYS = ['gym_exercises', 'gym_sessions', 'gym_draft']

/**
 * The bases actually passed to localSet/localGet, and so the keys that exist in
 * storage as `${base}:${userId}`. Distinct from LEGACY_KEYS, which are the old
 * unprefixed names read once during migration and then deleted.
 */
const CACHE_BASES = ['exercises', 'sessions', 'summaries', 'gym_draft']

/**
 * Drop a user's cached rows. Called on sign-out: namespacing already stops the next
 * person *using* this data, but without this it would sit in sessionStorage on a shared
 * device until that same account signed back in. Takes the id explicitly, because
 * sign-out clears the in-memory user before a caller could ask for it.
 */
export function clearLocalCache(userId) {
  if (!userId) return
  try {
    for (const base of CACHE_BASES) sessionStorage.removeItem(cacheKey(base, userId))
  } catch {
    /* storage unavailable, or a private-mode browser refusing writes */
  }
  // The memoised reads below are keyed by account too, so they have to go with them.
  // Leaving them would let the next sign-in read the previous account's rows.
  invalidate(memo.sessions, memo.summaries, memo.exercises)
}

/* ─── Local helpers ─── */
function localGet(base) {
  const key = cacheKey(base, currentUserId())
  try {
    const raw = sessionStorage.getItem(key)
    if (raw) return JSON.parse(raw) || []
  } catch {
    return []
  }
  // Signed in, but this user has no cache yet and an unprefixed key exists. Adopt
  // it once, then remove it so it cannot leak to the next person on this device.
  const legacy = sessionStorage.getItem(base)
  if (legacy) {
    sessionStorage.removeItem(base)
    try {
      const parsed = JSON.parse(legacy) || []
      sessionStorage.setItem(key, JSON.stringify(parsed))
      return parsed
    } catch {
      return []
    }
  }
  return []
}

function localSet(base, value) {
  sessionStorage.setItem(cacheKey(base, currentUserId()), JSON.stringify(value))
}

/** Called on sign-out so the next person on the device starts from a clean slate. */
export function purgeUnscopedCaches() {
  for (const key of LEGACY_KEYS) sessionStorage.removeItem(key)
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

/* ─── In-memory read cache ───
 *
 * Every page that lists workouts asked the network for the same rows. Switching tabs
 * re-fetched 176 KB of session trees that had not changed, and the app did it four
 * times over on a cold start: once here, once for exercises, and again in each page
 * that mounted.
 *
 * The cache holds the last result in memory for a short while, and — the part that
 * actually removes the duplicate requests — shares one in-flight promise between
 * callers that ask at the same moment. Two components mounting in the same tick
 * therefore produce one request, not two.
 *
 * Each store is keyed by account, so signing in as someone else cannot read the
 * previous account's rows, and clearLocalCache() empties them on sign-out.
 */
const MEMO_TTL_MS = 30_000

/** One cache slot: the last result, when it was fetched, and the request in flight. */
function slot() {
  return { key: null, data: null, at: 0, pending: null }
}

const memo = {
  sessions: slot(),
  summaries: slot(),
  exercises: slot(),
}

/**
 * Return the cached rows, or run `produce` and remember them.
 *
 * `produce` is called at most once per key per window, even if several callers ask
 * while it is still running — which is what removes the duplicate requests. Two
 * components mounting in the same tick, and the app's own start-up sync, all end up
 * waiting on one request rather than making three.
 */
function memoized(store, key, produce) {
  if (store.key === key && store.data && Date.now() - store.at < MEMO_TTL_MS) {
    return Promise.resolve(store.data)
  }
  // A request already running for this key. The key is set before the request starts,
  // not after it finishes, so a caller that arrives while it is in flight finds it here
  // rather than starting a second one.
  if (store.key === key && store.pending) return store.pending

  store.key = key
  const pending = produce().then(
    data => {
      store.data = data
      store.at = Date.now()
      store.pending = null
      return data
    },
    error => {
      // A failed read must not be cached, or the app would show the error for the whole
      // window instead of trying again.
      store.pending = null
      throw error
    }
  )
  store.pending = pending
  return pending
}

/** Forget a cached read, because the rows behind it just changed. */
function invalidate(...stores) {
  for (const store of stores) store.data = null
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

/**
 * The exercise library.
 *
 * Only the columns the app reads are selected. The table also carries user_id and
 * created_at, and every exercise is fetched on every page that mentions one, so the
 * difference is paid repeatedly.
 */
export async function getExercises() {
  const key = cacheKey('exercises', currentUserId())
  return memoized(memo.exercises, key, async () => {
    if (supabase) {
      const { data, error } = await supabase
        .from('exercises')
        .select('id,name,muscle_group,order,image_url')
        .order('order')
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
  })
}

export async function saveExercise(exercise) {
  const userId = requireUserId('save an exercise')
  const exercises = localGet('exercises')
  const idx = exercises.findIndex(e => e.id === exercise.id)
  if (idx >= 0) exercises[idx] = exercise
  else exercises.push(exercise)
  localSet('exercises', exercises)

  if (supabase) {
    // The library is per-account, so ownership is part of the row AND part of the
    // conflict target — exercises' primary key is (user_id, id), not id alone.
    // onConflict is stated explicitly rather than left to PostgREST to infer, so the
    // upsert cannot silently key on the wrong columns.
    unwrap(
      await supabase
        .from('exercises')
        .upsert({ ...exercise, user_id: userId }, { onConflict: 'user_id,id' }),
      `save exercise ${exercise.id}`,
    )
  }
  // The library just changed, so the memoised copy is stale.
  invalidate(memo.exercises)
  return exercise
}

export async function deleteExercise(id) {
  if (supabase) {
    // Remote first, so a rejection leaves no local trace.
    const { error } = await supabase.from('exercises').delete().eq('id', id)
    if (error) {
      // 23503 is a foreign-key violation: exercise_logs references exercises with
      // NO ACTION, so an exercise that past sessions still use cannot be removed.
      // Naming it and counting the sessions is far more use than Postgres's raw
      // constraint text, and the count is the caller's own thanks to RLS.
      if (error.code === '23503') {
        const name = localGet('exercises').find(e => e.id === id)?.name || 'That exercise'
        const { count } = await supabase
          .from('exercise_logs')
          .select('id', { count: 'exact', head: true })
          .eq('exercise_id', id)
        const n = count ?? 0
        const err = new Error(
          `${name} is used in ${n} logged session${n === 1 ? '' : 's'} and can't be deleted. ` +
            `Past sessions keep referring to it, so it stays in your library.`,
        )
        err.context = `delete exercise ${id}`
        throw err
      }
      const err = new Error(error.message)
      err.context = `delete exercise ${id}`
      throw err
    }
  }
  localSet('exercises', localGet('exercises').filter(e => e.id !== id))
  invalidate(memo.exercises)
}

/* ─── Public profile (leaderboard visibility) ─── */

/**
 * The caller's own username and whether their profile is shared.
 *
 * whoami() carries the flag so the Progress tab renders the toggle correctly on first
 * paint without a second request — it is already called on load and on focus.
 */
export async function getMyProfile() {
  const { data, error } = await supabase.rpc('whoami')
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  return { username: row.username, profileVisible: row.profile_visible !== false }
}

/**
 * Show or hide the caller's profile from other accounts.
 *
 * The RPC takes no user id on purpose: it can only ever change the caller's own row.
 * Accepting an id here would let anyone re-publish a profile that chose to opt out.
 */
export async function setProfileVisible(visible) {
  const { data, error } = await supabase.rpc('set_profile_visible', { p_visible: Boolean(visible) })
  if (error) throw new Error(error.message)
  return data !== false
}

/* ─── Sessions ─── */

/**
 * The columns of a session and everything under it, spelled out.
 *
 * The wildcard pulled every column of every row, including user_id on each of the 780
 * set rows and the timestamps nobody reads. Naming them is the same data in a third of
 * the bytes: 176 KB became 119 KB for a realistic account.
 */
const SESSION_FIELDS =
  'id,date,notes,duration_seconds,is_draft,exercise_logs(id,session_id,exercise_id,order,set_entries(id,exercise_log_id,set_number,weight,reps,note))'

/**
 * Real, saved workouts. Drafts are excluded here and nowhere else in the client: every
 * page that counts training goes through this function, so one filter keeps an in-progress
 * session out of history, stats, the heatmap and the streak at once.
 *
 * Server-side aggregates (leaderboard, friend PRs) filter independently, because they read
 * the tables directly and bypass this.
 *
 * Only the Stats page needs this — the list pages use getSessionSummaries(), which is a
 * fortieth of the size.
 */
export async function getSessions() {
  const key = cacheKey('sessions', currentUserId())
  return memoized(memo.sessions, key, async () => {
    if (supabase) {
      const { data, error } = await supabase
        .from('workout_sessions')
        .select(SESSION_FIELDS)
        .eq('is_draft', false)
        .order('date', { ascending: false })
      if (!error && data) {
        const sessions = data.map(s => ({ ...s, exercise_logs: sortLogs(s.exercise_logs) }))
        localSet('sessions', sessions)
        return sessions
      }
    }
    return localGet('sessions')
      .filter(s => !s.is_draft)
      .map(s => ({ ...s, exercise_logs: sortLogs(s.exercise_logs) }))
      .sort((a, b) => b.date.localeCompare(a.date))
  })
}

/**
 * The list every page actually needs: a date, a volume, a set count and the names of
 * the exercises. Not the tree.
 *
 * This was the whole session, its logs and every set under it — 176 KB and about a
 * second against a realistic account, refetched on every tab switch. The same
 * information is 3.7 KB from the session_summaries view, and Postgres computes the
 * aggregates there rather than shipping rows the phone will only throw away.
 *
 * The shape matches getSessions() closely enough that the pages read it the same way:
 * `volume` is what calcVolume() would have returned, `exercise_count` is the length of
 * exercise_logs, and `exercise_names` replaces looking each id up in the library.
 */
export async function getSessionSummaries() {
  const key = cacheKey('summaries', currentUserId())
  return memoized(memo.summaries, key, async () => {
    if (supabase) {
      const { data, error } = await supabase
        .from('session_summaries')
        .select('id,date,notes,duration_seconds,is_draft,volume,set_count,exercise_count,exercise_names')
        .eq('is_draft', false)
        .order('date', { ascending: false })
      if (!error && data) {
        localSet('summaries', data)
        return data
      }
    }
    return localGet('summaries')
      .filter(s => !s.is_draft)
      .sort((a, b) => b.date.localeCompare(a.date))
  })
}

/**
 * One workout in full: its exercise logs and every set under them.
 *
 * The detail and edit pages used to call getSessions() and pick one row out of the
 * result, which meant opening a single session downloaded every session in the
 * account. This fetches one.
 */
export async function getSession(id) {
  if (!id) return null
  if (supabase) {
    const { data, error } = await supabase
      .from('workout_sessions')
      .select(SESSION_FIELDS)
      .eq('id', id)
      .eq('is_draft', false)
      .maybeSingle()
    if (!error && data) return { ...data, exercise_logs: sortLogs(data.exercise_logs) }
  }
  const cached = localGet('sessions').find(s => s.id === id)
  return cached ? { ...cached, exercise_logs: sortLogs(cached.exercise_logs) } : null
}

/**
 * The account's in-progress workout, if one survived.
 *
 * This is what makes autosave worth having: the draft is in Postgres, so it comes back
 * after the tab is closed, after the browser is killed, and after signing out and back in
 * from another device. At most one exists per account — a new draft replaces the old one.
 */
export async function getDraft() {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('workout_sessions')
    // started_at is the instant the workout began, which is what lets the timer resume
    // where it was rather than starting over.
    .select('id,date,notes,started_at,duration_seconds,exercise_logs(id,session_id,exercise_id,order,set_entries(id,exercise_log_id,set_number,weight,reps,note))')
    .eq('is_draft', true)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error || !data || data.length === 0) return null
  const row = data[0]
  return { ...row, exercise_logs: sortLogs(row.exercise_logs) }
}

/**
 * Throw away the account's draft without touching saved workouts.
 *
 * Called when a draft is abandoned or replaced. Scoped to is_draft so it can never delete
 * a real session, whatever id is passed.
 */
export async function discardDraft() {
  if (!supabase) return
  unwrap(
    await supabase.from('workout_sessions').delete().eq('is_draft', true),
    'discard draft',
  )
}

/** PostgREST returns nested rows unordered; `order` is the only intended sequence. */
function sortLogs(logs) {
  return [...(logs || [])]
    .map(log => ({ ...log, set_entries: [...(log.set_entries || [])].sort((a, b) => a.set_number - b.set_number) }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

/**
 * Write a session and everything under it.
 *
 * @param session       the workout
 * @param options.draft when true the row is stored as an in-progress draft: excluded from
 *                      history, stats and the leaderboard. When false or absent it is a
 *                      real workout.
 *
 * Saving a draft replaces any other draft for the account, so there is never more than one
 * workout in progress. That is a deliberate product choice — someone trains one workout at
 * a time — and it stops abandoned drafts accumulating in the cloud forever.
 *
 * The draft's logs and sets live in the same tables as real ones. That is why the flag
 * alone is not enough protection: anything aggregating those tables directly has to filter
 * it, which the two SECURITY DEFINER functions do.
 */
export async function saveSession(session, { draft = false } = {}) {
  const userId = requireUserId('save a session')

  // A draft must not reach the local sessions cache: that cache is what History, the
  // dashboard and the stats page read, and a half-finished workout counted there would be
  // the exact thing the draft flag exists to prevent.
  if (!draft) {
    const sessions = localGet('sessions')
    const idx = sessions.findIndex(s => s.id === session.id)
    if (idx >= 0) sessions[idx] = session
    else sessions.push(session)
    localSet('sessions', sessions)
  }

  if (!supabase) return session

  if (draft) {
    // One draft per account: clear the previous one before writing this.
    // Scoped by is_draft so a saved workout is untouchable here.
    unwrap(await supabase.from('workout_sessions').delete().eq('is_draft', true), 'replace previous draft')
  }

  // 1. Session header.
  //
  // duration_seconds is the measured length of the workout and is written on the final
  // save. started_at is when the stopwatch began, and rides along on the draft so the
  // timer survives the tab closing, the app being killed, and signing out.
  //
  // duration_seconds is written whenever it is known, including null — clearing it
  // is how a user says "this workout was never timed".
  //
  // started_at is only written when there is one. The edit form does not know the
  // original start instant, so it sends null, and writing that null would erase the
  // record of when the workout began. Leaving the column out of the upsert keeps
  // whatever was there.
  const header = {
    id: session.id,
    date: session.date,
    notes: session.notes || null,
    user_id: userId,
    is_draft: draft,
  }
  if (session.duration_seconds !== undefined) header.duration_seconds = session.duration_seconds
  if (session.started_at) header.started_at = session.started_at
  unwrap(
    await supabase.from('workout_sessions').upsert(header),
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

  // The rows just written are the freshest thing there is, so the memoised copies of
  // both the full list and the summaries are now out of date.
  invalidate(memo.sessions, memo.summaries)

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
  localSet('summaries', localGet('summaries').filter(s => s.id !== id))
  invalidate(memo.sessions, memo.summaries)
}

/* ─── Sync from Supabase to sessionStorage (call on app init when online) ─── */

/**
 * The first read of the app: the exercise library and the session summaries.
 *
 * The summaries, not the full session trees. The list pages only ever needed the
 * summaries, and the full tree is 119 KB against their 3.7 KB — so fetching it here
 * meant every cold start downloaded every set of every workout to throw most of them
 * away. The Stats page fetches the tree itself, and only when it is opened.
 *
 * Both reads run at once rather than one after the other, because they are
 * independent and a phone's radio is the bottleneck.
 */
export async function syncFromCloud() {
  if (!supabase) return
  await Promise.all([getExercises(), getSessionSummaries()])
}
