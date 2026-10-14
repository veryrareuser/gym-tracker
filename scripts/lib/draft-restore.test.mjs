// Tests that restoring a draft rebuilds the whole editor, not just the filled cards.
//
//   node scripts/lib/draft-restore.test.mjs
//
// The bug this guards: the cloud draft only stores exercises with a logged set, and the
// restore used it as the entire editor. So reopening a draft in which you had filled one
// exercise showed that one card alone — the rest of the page you left was gone, which
// reads as "my workout was lost" even though the data was intact.

import { mergeWithLibrary, blankEditor } from '../../src/lib/draft.js'

// draft.js takes its id generator as an argument precisely so it stays import-free and can
// be loaded directly here. generateId normally comes from utils; a counter is enough.
let seq = 0
const newId = () => `id-${++seq}`

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

const lib = [
  { id: '1', name: 'Dumbbell Flat Bench', image_url: 'a.png' },
  { id: '2', name: 'Incline Dumbbell Press', image_url: null },
  { id: '3', name: 'Shoulder Press', image_url: 'c.png' },
  { id: '4', name: 'Lat Pull Down', image_url: null },
]

const filled = exercise_id => ({
  id: `log-${exercise_id}`,
  exercise_id,
  order: 0,
  set_entries: [{ id: `set-${exercise_id}`, set_number: 1, weight: '60', reps: '8' }],
})

console.log('Restoring a draft\n')

// The reported case: four exercises on screen, one filled.
{
  const merged = mergeWithLibrary(lib, [filled('1')], newId)
  check('every library exercise is present', merged.length === lib.length, `${merged.length} cards`)
  check('the filled exercise kept its sets',
    merged.find(l => l.exercise_id === '1').set_entries.some(s => s.weight === '60'))
  check('the empty ones come back empty',
    merged.filter(l => l.exercise_id !== '1').every(l => l.set_entries.every(s => !s.weight && !s.reps)))
  check('names resolve', merged.every(l => l._name), merged.map(l => l._name).join(', '))
  check('order is sequential', merged.every((l, i) => l.order === i))
}

// Several filled, spread out.
{
  const merged = mergeWithLibrary(lib, [filled('1'), filled('3')], newId)
  check('two filled exercises both restore',
    merged.filter(l => ['1', '3'].includes(l.exercise_id)).every(l => l.set_entries.some(s => s.weight)))
  check('and the other two are still there', merged.length === 4)
}

// The name must come from the library, not from whatever the draft happened to store.
{
  const stale = { ...filled('1'), _name: 'Old Name', _image_url: 'old.png' }
  const merged = mergeWithLibrary(lib, [stale], newId)
  const card = merged.find(l => l.exercise_id === '1')
  check('a stale name is corrected from the library', card._name === 'Dumbbell Flat Bench', card._name)
  check('a stale image is corrected', card._image_url === 'a.png', card._image_url)
}

// An exercise in the draft that is no longer in the library must not vanish.
{
  const merged = mergeWithLibrary(lib, [filled('1'), filled('999')], newId)
  check('a draft log with no library entry is kept', merged.length === 5, `${merged.length} cards`)
  check('  and is labelled rather than blank',
    merged.find(l => l.exercise_id === '999')._name === 'Unknown')
}

// Degenerate inputs must not throw: an empty draft, no library, no logs.
{
  check('no library is fine', Array.isArray(mergeWithLibrary([], [filled('1')], newId)))
  check('no logs is fine', mergeWithLibrary(lib, [], newId).length === lib.length)
  check('undefined args are fine', Array.isArray(mergeWithLibrary(undefined, undefined, newId)))
  check('a blank editor matches a fresh session', blankEditor(lib, newId).length === lib.length)
  check('  and every card starts with one empty set',
    blankEditor(lib, newId).every(l => l.set_entries.length === 1 && !l.set_entries[0].weight))
}

// Ids must be unique, or React keys collide and the editor renders wrong.
{
  const merged = mergeWithLibrary(lib, [filled('1')], newId)
  check('card ids are unique', new Set(merged.map(l => l.id)).size === merged.length)
  check('set ids are unique',
    new Set(merged.flatMap(l => l.set_entries.map(s => s.id))).size ===
    merged.flatMap(l => l.set_entries).length)
}

// Every edit after restore must produce a distinct object, or React will not re-render.
{
  const merged = mergeWithLibrary(lib, [filled('1')], newId)
  const noSharedSets = merged.every(l => !l.set_entries.some(s => s.id === undefined))
  check('no set is left undefined', noSharedSets)
}

console.log(`\n${failures === 0 ? 'Restore rebuilds the whole editor.' : `${failures} FAILED.`}`)
process.exit(failures === 0 ? 0 : 1)
