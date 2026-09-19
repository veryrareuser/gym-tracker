// src/lib/db.js
// Abstraction layer: reads/writes localStorage, syncs to Supabase when available.
import { supabase } from './supabaseClient'

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

/* ─── Default exercises ─── */
export const DEFAULT_EXERCISES = [
  { id: '1', name: 'Dumbbell Flat Bench', muscle_group: 'Chest', order: 1 },
  { id: '2', name: 'Incline Dumbbell Press', muscle_group: 'Chest', order: 2 },
  { id: '3', name: 'Shoulder Press', muscle_group: 'Shoulders', order: 3 },
  { id: '4', name: 'Lat Pull Down', muscle_group: 'Back', order: 4 },
  { id: '5', name: 'Close Grip Row', muscle_group: 'Back', order: 5 },
  { id: '6', name: 'Wide Grip Row', muscle_group: 'Back', order: 6 },
  { id: '7', name: 'Cable Lateral Raise', muscle_group: 'Shoulders', order: 7 },
  { id: '8', name: 'Tricep Extension', muscle_group: 'Arms', order: 8 },
  { id: '9', name: 'Bicep Curl', muscle_group: 'Arms', order: 9 },
  { id: '10', name: 'Hammer Curl', muscle_group: 'Arms', order: 10 },
]

/* ─── Exercises ─── */
export async function getExercises() {
  if (supabase) {
    const { data, error } = await supabase.from('exercises').select('*').order('order')
    if (!error && data) {
      localSet(KEYS.exercises, data)
      return data
    }
  }
  const local = localGet(KEYS.exercises)
  if (local.length === 0) {
    localSet(KEYS.exercises, DEFAULT_EXERCISES)
    return DEFAULT_EXERCISES
  }
  return local
}

export async function saveExercise(exercise) {
  const exercises = localGet(KEYS.exercises)
  const idx = exercises.findIndex(e => e.id === exercise.id)
  if (idx >= 0) exercises[idx] = exercise
  else exercises.push(exercise)
  localSet(KEYS.exercises, exercises)

  if (supabase) {
    await supabase.from('exercises').upsert(exercise)
  }
  return exercise
}

export async function deleteExercise(id) {
  const exercises = localGet(KEYS.exercises).filter(e => e.id !== id)
  localSet(KEYS.exercises, exercises)
  if (supabase) {
    await supabase.from('exercises').delete().eq('id', id)
  }
}

/* ─── Sessions ─── */
export async function getSessions() {
  if (supabase) {
    const { data, error } = await supabase
      .from('workout_sessions')
      .select('*, exercise_logs(*, set_entries(*))')
      .order('date', { ascending: false })
    if (!error && data) {
      localSet(KEYS.sessions, data)
      return data
    }
  }
  return localGet(KEYS.sessions).sort((a, b) => b.date.localeCompare(a.date))
}

export async function saveSession(session) {
  const sessions = localGet(KEYS.sessions)
  const idx = sessions.findIndex(s => s.id === session.id)
  if (idx >= 0) sessions[idx] = session
  else sessions.push(session)
  localSet(KEYS.sessions, sessions)

  if (supabase) {
    // Upsert session header
    await supabase.from('workout_sessions').upsert({
      id: session.id,
      date: session.date,
      notes: session.notes || null,
    })
    // Upsert exercise logs + sets
    for (const log of session.exercise_logs) {
      await supabase.from('exercise_logs').upsert({
        id: log.id,
        session_id: session.id,
        exercise_id: log.exercise_id,
        order: log.order,
      })
      for (const set of log.set_entries) {
        await supabase.from('set_entries').upsert(set)
      }
    }
  }
  return session
}

export async function deleteSession(id) {
  const sessions = localGet(KEYS.sessions).filter(s => s.id !== id)
  localSet(KEYS.sessions, sessions)
  if (supabase) {
    await supabase.from('workout_sessions').delete().eq('id', id)
  }
}

/* ─── Sync from Supabase to localStorage (call on app init when online) ─── */
export async function syncFromCloud() {
  if (!supabase) return
  await getExercises()
  await getSessions()
}
