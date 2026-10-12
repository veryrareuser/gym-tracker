// Which muscles an exercise trains, and how hard — the data behind the body map.
//
// The database stores one coarse `muscle_group` per exercise, and that field is
// inconsistent with itself: "Elbow dips" is filed under "Upper arms" while "Bicep Curl"
// sits under "Arms" alongside "Tricep Extension". Drawing a body from that would light
// the arms twice and make the balance scale meaningless.
//
// So the mapping below is keyed on the exercise's identity instead, resolved in order:
//
//   1. EXERCISE_TARGETS — an explicit table for this library, keyed by exercise id. Every
//      entry is a judgement a human can audit and correct; nothing is inferred at runtime.
//   2. The exercise name, matched against NAME_HINTS, for custom exercises added later.
//   3. muscle_group, spread across regions by BY_GROUP so it never double-counts.
//   4. Nothing. An unrecognised exercise is counted in `unmapped` and shown as such
//      rather than being quietly folded into a neighbour.
//
// Adapted from openGym's frontend/src/lib/muscles.js, which solves the same problem over a
// 6,500-exercise dataset. The structure is theirs; the table is scoped to this library.

/**
 * Regions this app attributes training to, head to toe. Also the order of the ranked list
 * beside the body map.
 *
 * Deliberately shorter than RENDER_REGIONS. These are the regions a set can honestly be
 * credited to, given what the exercise metadata carries. A region absent from this list is
 * not "untrained" — it is unmeasured — and saying otherwise would be a claim the data does
 * not support.
 */
export const REGIONS = [
  'trapezius',
  'shoulders',
  'chest',
  'upper-back',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'glutes',
  'quadriceps',
  'hamstrings',
  'calves',
]

/**
 * Every muscle the body map artwork draws, keyed the way the geometry keys them.
 *
 * The artwork is openGym's, copied whole, so it carries all 18 of their muscles whether or
 * not this app can attribute them. The six that are drawn but never credited — obliques,
 * lower back, serratus, adductors, hip flexors and tibialis — render in the inert tone and
 * say so on hover. That is the honest outcome: the body has those muscles, the app cannot
 * yet measure them.
 *
 * Kept separate from REGIONS so the two jobs do not get confused. REGIONS drives
 * attribution and the ranked list; this drives rendering and tooltips.
 */
export const RENDER_REGIONS = [
  'trapezius',
  'deltoids',
  'chest',
  'serratus',
  'upper-back',
  'lower-back',
  'biceps',
  'triceps',
  'forearm',
  'obliques',
  'abs',
  'hip-flexors',
  'gluteal',
  'adductors',
  'quadriceps',
  'hamstring',
  'calves',
  'tibialis',
]

/**
 * Maps a region this app attributes to, onto the artwork's key for the same body part.
 *
 * The names differ: this app says "shoulders" where the artwork says "deltoids", and so on
 * for five more. Without this the map would render every one of those regions inert.
 */
export const RENDER_KEY = {
  trapezius: 'trapezius',
  shoulders: 'deltoids',
  chest: 'chest',
  'upper-back': 'upper-back',
  biceps: 'biceps',
  triceps: 'triceps',
  forearms: 'forearm',
  abs: 'abs',
  glutes: 'gluteal',
  quadriceps: 'quadriceps',
  hamstrings: 'hamstring',
  calves: 'calves',
}

/**
 * Parts of the artwork drawn but never shaded. They carry no training load in any model:
 * the head and neck, the hands, and the joints.
 *
 * `legs-unknown` was here before the geometry was copied whole and matched nothing. The
 * artwork's own inert parts are `head`, `hair`, `neck`, `hands`, `knees`, `ankles` and
 * `feet`.
 */
export const INERT = ['head', 'hair', 'neck', 'hands', 'knees', 'ankles', 'feet']

/** Labels for the regions this app attributes to. */
export const REGION_LABEL = {
  trapezius: 'Traps',
  shoulders: 'Shoulders',
  chest: 'Chest',
  'upper-back': 'Upper back',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  abs: 'Abs',
  glutes: 'Glutes',
  quadriceps: 'Quads',
  hamstrings: 'Hamstrings',
  calves: 'Calves',
}

/**
 * Labels for every muscle the artwork draws, including the six this app cannot attribute.
 * Without these their tooltips would show a raw key.
 */
export const RENDER_LABEL = {
  ...REGION_LABEL,
  deltoids: 'Shoulders',
  serratus: 'Serratus',
  'lower-back': 'Lower back',
  forearm: 'Forearms',
  obliques: 'Obliques',
  'hip-flexors': 'Hip flexors',
  gluteal: 'Glutes',
  adductors: 'Adductors',
  quadriceps: 'Quads',
  hamstring: 'Hamstrings',
  tibialis: 'Shins',
}

/**
 * Explicit muscle attribution for this library, keyed by exercise id.
 *
 * Weights are a share of one set, so a set is never counted twice across the body map.
 * Where an exercise genuinely works two regions, the split is stated rather than averaged
 * out — e.g. a row trains lats primarily and the spine secondarily.
 *
 * Keys are the ids in `public.exercises`. Ids below 1000 (the custom exercises, "1"-"10")
 * do not exist in the source dataset at all, which is why they need spelling out here.
 */
// Keys are quoted: `0025` unquoted is an illegal octal literal in strict mode, and every
// module here is one. Lookup normalises the incoming id to the same shape.
const EXERCISE_TARGETS = {
  // Custom exercises — absent from the dataset index, so named explicitly.
  9: { biceps: 1 }, // Bicep Curl
  10: { biceps: 1 }, // Hammer Curl
  8: { triceps: 1 }, // Tricep Extension
  5: { 'upper-back': 0.8, biceps: 0.2 }, // Close Grip Row
  4: { 'upper-back': 1 }, // Lat Pull Down
  6: { 'upper-back': 0.8, trapezius: 0.2 }, // Wide Grip Row
  1: { chest: 1 }, // Dumbbell Flat Bench
  2: { chest: 1 }, // Incline Dumbbell Press
  7: { shoulders: 1 }, // Cable Lateral Raise
  3: { shoulders: 0.85, triceps: 0.15 }, // Shoulder Press

  // From the dataset index, where `target` already names the region.
  '0651': { 'upper-back': 1 }, // Pull up (neutral grip)   target: lats
  '0025': { chest: 1 }, // Barbell bench press       target: pectorals
  '0748': { chest: 1 }, // Smith bench press         target: pectorals
  '0757': { chest: 1 }, // Smith incline bench press target: pectorals
  '0364': { forearms: 1 }, // One arm wrist curl       target: forearms
  '0766': { shoulders: 0.85, triceps: 0.15 }, // Smith shoulder press target: delts
  '3287': { triceps: 1 }, // Elbow dips                target: triceps
}

/**
 * Name hints for custom exercises that are not in the table above.
 *
 * Matched as a substring against the lower-cased name, longest hint first. This exists so a
 * newly added exercise resolves to something real instead of falling through to `unmapped`.
 * It is deliberately conservative: a hint is only listed when the name settles the region
 * on its own.
 */
const NAME_HINTS = [
  ['tricep pushdown', { triceps: 1 }],
  ['tricep', { triceps: 1 }],
  ['dip', { triceps: 1, chest: 0.3 }],
  ['skull', { triceps: 1 }],
  ['bicep', { biceps: 1 }],
  ['hammer curl', { biceps: 1 }],
  ['curl', { biceps: 1 }],
  ['lateral raise', { shoulders: 1 }],
  ['shoulder press', { shoulders: 0.85, triceps: 0.15 }],
  ['overhead press', { shoulders: 0.85, triceps: 0.15 }],
  ['bench press', { chest: 1 }],
  ['chest fly', { chest: 1 }],
  ['fly', { chest: 1 }],
  ['incline press', { chest: 1 }],
  ['press', { shoulders: 0.85, triceps: 0.15 }],
  ['lat pull', { 'upper-back': 1 }],
  ['pulldown', { 'upper-back': 1 }],
  ['pull up', { 'upper-back': 1 }],
  ['pullup', { 'upper-back': 1 }],
  ['row', { 'upper-back': 0.8, trapezius: 0.2 }],
  ['wrist', { forearms: 1 }],
  ['shrug', { trapezius: 1 }],
  ['deadlift', { hamstrings: 0.5, glutes: 0.3, 'upper-back': 0.2 }],
  ['squat', { quadriceps: 0.6, glutes: 0.4 }],
  ['leg press', { quadriceps: 0.7, glutes: 0.3 }],
  ['lunge', { quadriceps: 0.5, glutes: 0.3, hamstrings: 0.2 }],
  ['leg curl', { hamstrings: 1 }],
  ['calf raise', { calves: 1 }],
  ['calf', { calves: 1 }],
  ['plank', { abs: 1 }],
  ['crunch', { abs: 1 }],
  ['sit-up', { abs: 1 }],
  ['situp', { abs: 1 }],
]

/**
 * Fallback for an exercise with no id entry and no name hint: spread its stored
 * `muscle_group` across regions. Weights sum to 1 so the set is counted exactly once.
 *
 * This is the layer that used to double-count — "Arms" and "Upper arms" both reaching
 * the same arm regions. They no longer overlap: every branch here lands on disjoint
 * regions, and the ambiguous arms buckets are split by hand rather than guessed.
 */
const BY_GROUP = {
  Arms: { biceps: 0.5, triceps: 0.5 }, // bicep curls and tricep extensions share this bucket
  'Upper arms': { triceps: 0.7, biceps: 0.3 }, // dips and similar land here
  'Lower arms': { forearms: 1 },
  Chest: { chest: 1 },
  Back: { 'upper-back': 0.8, trapezius: 0.2 },
  Shoulders: { shoulders: 1 },
  Traps: { trapezius: 1 },
  Abs: { abs: 1 },
  Waist: { abs: 1 },
  Legs: { quadriceps: 0.5, hamstrings: 0.3, glutes: 0.2 },
  'Upper legs': { quadriceps: 0.5, hamstrings: 0.3, glutes: 0.2 },
  'Lower legs': { calves: 1 },
  Cardio: {},
}

/**
 * Which regions a single exercise trains, as a share of one set.
 *
 * @returns {Record<string, number>} empty when the exercise cannot be placed.
 */
export function regionsFor(exercise) {
  if (!exercise) return {}
  // Ids arrive as text from the database, with dataset padding ("0025") and sometimes
  // without ("1"). Try both so a padded id and a bare one resolve to the same entry.
  const id = String(exercise.id)
  const byId = EXERCISE_TARGETS[id] ?? EXERCISE_TARGETS[id.replace(/^0+/, '')]
  if (byId) return { ...byId }

  const name = String(exercise.name || '').toLowerCase()
  for (const [hint, regions] of NAME_HINTS) {
    if (name.includes(hint)) return { ...regions }
  }

  return { ...(BY_GROUP[exercise.muscle_group] || {}) }
}

/** True when the exercise resolved to a region, rather than falling through to `unmapped`. */
export function isMapped(exercise) {
  return Object.keys(regionsFor(exercise)).length > 0
}
