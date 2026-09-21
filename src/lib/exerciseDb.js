// src/lib/exerciseDb.js
// Loads the free-exercise-db dataset from the public folder at runtime (lazy, on first search).
// Image CDN: raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/{id}/0.jpg

const IMAGE_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises'

export function getImageUrl(exerciseDbId) {
  if (!exerciseDbId) return null
  return `${IMAGE_BASE}/${exerciseDbId}/0.jpg`
}

let _cache = null

export async function loadExerciseDb() {
  if (_cache) return _cache
  const base = import.meta.env.BASE_URL || '/'
  const res = await fetch(`${base}exercises.json`)
  _cache = await res.json()
  return _cache
}

export async function searchExercises(query) {
  const all = await loadExerciseDb()
  if (!query.trim()) return all.slice(0, 40)
  const q = query.toLowerCase()
  return all.filter(e =>
    e.name.toLowerCase().includes(q) ||
    e.body_part.toLowerCase().includes(q) ||
    e.category.toLowerCase().includes(q) ||
    e.equipment.toLowerCase().includes(q)
  ).slice(0, 60)
}

// Mapping of your 10 pre-loaded exercises to free-exercise-db IDs
export const DEFAULT_EXERCISE_IMAGE_MAP = {
  '1': '0289', // Dumbbell Flat Bench → dumbbell bench press
  '2': '0314', // Incline Dumbbell Press → dumbbell incline bench press
  '3': '0405', // Shoulder Press → dumbbell seated shoulder press
  '4': '2330', // Lat Pull Down → cable lat pulldown full range
  '5': '0160', // Close Grip Row → cable floor seated wide-grip row
  '6': '0159', // Wide Grip Row → cable decline seated wide-grip row
  '7': '0178', // Cable Lateral Raise → cable lateral raise
  '8': '0173', // Tricep Extension → cable incline triceps extension
  '9': '1634', // Bicep Curl → cable lying bicep curl
  '10': '0165', // Hammer Curl → cable hammer curl (with rope)
}
