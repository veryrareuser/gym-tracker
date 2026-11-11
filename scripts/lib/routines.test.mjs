// Tests the arithmetic behind reordering a routine.
//
//   node scripts/lib/routines.test.mjs
//
// Two things are easy to get wrong here, and both fail silently.
//
// The first is moveItem. Dragging the top row to the bottom has to leave the list in
// the order the fingers said it should be, with every other row shifted up to close
// the gap — not the dragged row duplicated, and not a row lost.
//
// The second is mergeOrder. When a routine is reordered while a session is open, the
// session's cards have to follow the routine, or the thing being logged stops
// matching the thing that was reordered. But a card that the routine does not contain
// must keep its sets and stay on screen: switching routines halfway through a workout
// cannot quietly throw the work away.

import { moveItem, mergeOrder, mergeRoutineCards, cardHasContent } from '../../src/lib/routines.js'

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

console.log('Moving one item\n')

check('moving the first to the last', same(moveItem(['a', 'b', 'c', 'd'], 0, 3), ['b', 'c', 'd', 'a']))
check('moving the last to the first', same(moveItem(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c']))
check('moving one down', same(moveItem(['a', 'b', 'c', 'd'], 1, 2), ['a', 'c', 'b', 'd']))
check('moving one up', same(moveItem(['a', 'b', 'c', 'd'], 2, 1), ['a', 'c', 'b', 'd']))

check('moving to the same place changes nothing', same(moveItem(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c']))
check('moving out of range changes nothing', same(moveItem(['a', 'b', 'c'], 9, 0), ['a', 'b', 'c']))
check('moving from out of range changes nothing', same(moveItem(['a', 'b', 'c'], -1, 0), ['a', 'b', 'c']))
check('moving to out of range changes nothing', same(moveItem(['a', 'b', 'c'], 0, 7), ['a', 'b', 'c']))

{
  const original = ['a', 'b', 'c']
  const moved = moveItem(original, 0, 2)
  check('the original list is not touched', same(original, ['a', 'b', 'c']))
  check('and the result is a different list', moved !== original)
}

{
  // The order a drag produces: the item lands AT the target, and the ones it passed
  // shift up to close the gap.
  const list = ['back', 'chest', 'legs']
  check('a row dragged past two lands after them', same(moveItem(list, 0, 2), ['chest', 'legs', 'back']))
  check('a row dragged onto itself stays put', same(moveItem(list, 1, 1), list))
}

console.log('\nFollowing a routine\'s order\n')

check(
  'the routine decides the order',
  same(mergeOrder(['b', 'a'], ['a', 'b']), ['b', 'a']),
  mergeOrder(['b', 'a'], ['a', 'b']).join(','),
)
check(
  'a card the routine does not have keeps its sets and goes last',
  same(mergeOrder(['b', 'a'], ['a', 'b', 'extra']), ['b', 'a', 'extra']),
  mergeOrder(['b', 'a'], ['a', 'b', 'extra']).join(','),
)
check(
  'a routine entry with no card yet is not invented',
  same(mergeOrder(['a', 'b', 'c'], ['a', 'c']), ['a', 'c']),
  mergeOrder(['a', 'b', 'c'], ['a', 'c']).join(','),
)
check('an empty routine leaves the order alone', same(mergeOrder([], ['a', 'b']), ['a', 'b']))
check('an empty session leaves nothing', same(mergeOrder(['a', 'b'], []), []))
check('nothing at all is nothing', same(mergeOrder([], []), []))

{
  // The case that matters: reordering a routine while a session is open.
  const routine = ['back', 'chest', 'shoulders']
  const cards = ['chest', 'back', 'shoulders']
  const merged = mergeOrder(routine, cards)
  check('the cards follow the routine', same(merged, ['back', 'chest', 'shoulders']), merged.join(','))
}

{
  // Switching routines mid-workout: the new routine's exercises come first, in its
  // order, and the exercise the new routine does not have keeps its sets at the end.
  const wanted = ['squat', 'lunge', 'press']
  const current = ['press', 'squat', 'curl']
  const merged = mergeOrder(wanted, current)
  check(
    'the new routine leads and the old extra trails',
    same(merged, ['squat', 'press', 'curl']),
    merged.join(','),
  )
}

console.log(`\n${failures === 0 ? 'Reordering is right.' : `${failures} FAILED.`}`)

// ── Picking a routine ──
//
// The cards of the session, after a routine is picked. Everything here is about one
// thing: picking a routine must never throw away a set that was already logged.
//
// The bug it guards against dropped cards. A card that was in both the previous cards
// and the new routine was in neither the "kept" list nor the "fresh" one, so it
// vanished — and so did its sets. Re-picking the routine you were logging emptied the
// workout, and "log without a routine" emptied it as well.

console.log('\nPicking a routine\n')

const lib = [
  { id: 'bench', name: 'Bench Press', image_url: null },
  { id: 'press', name: 'Shoulder Press', image_url: null },
  { id: 'curl', name: 'Curl', image_url: null },
]

const emptyCard = exercise_id => ({
  id: `log-${exercise_id}`,
  exercise_id,
  order: 0,
  set_entries: [{ id: `set-${exercise_id}`, set_number: 1, weight: '', reps: '' }],
})
const filledCard = exercise_id => ({
  id: `log-${exercise_id}`,
  exercise_id,
  order: 0,
  set_entries: [{ id: `set-${exercise_id}`, set_number: 1, weight: '60', reps: '8' }],
})
const makeCard = (exercise, order) => ({
  id: `new-${exercise.id}`,
  exercise_id: exercise.id,
  order,
  set_entries: [{ id: `newset-${exercise.id}`, set_number: 1, weight: '', reps: '' }],
})
const ids = cards => cards.map(c => c.exercise_id)
const setsOf = (cards, exercise_id) =>
  (cards.find(c => c.exercise_id === exercise_id)?.set_entries || []).filter(s => s.weight || s.reps)

{
  // Picking the routine you are already logging. The card was in both lists, and it
  // used to be in neither.
  const merged = mergeRoutineCards([filledCard('bench')], lib.slice(0, 2), ['bench', 'press'], makeCard)
  check('the routine\'s own card keeps its sets', setsOf(merged, 'bench').length === 1, `${setsOf(merged, 'bench').length} sets`)
  check('and the routine\'s other exercise is added', ids(merged).includes('press'), ids(merged).join(','))
  check('nothing was dropped', merged.length === 2, `${merged.length} cards`)
}

{
  // "Log without a routine" is the same operation with the whole library as the
  // source. It used to empty the workout completely.
  const merged = mergeRoutineCards([filledCard('bench')], lib, lib.map(e => e.id), makeCard)
  check('logging without a routine keeps what was logged', setsOf(merged, 'bench').length === 1)
  check('and the rest of the library is there', merged.length === 3, `${merged.length} cards`)
}

{
  // Switching routines halfway through: what the new routine does not have is
  // carried over, with its sets, at the end.
  const merged = mergeRoutineCards([filledCard('curl')], lib.slice(0, 2), ['bench', 'press'], makeCard)
  check('the new routine leads', ids(merged).slice(0, 2).join(',') === 'bench,press', ids(merged).join(','))
  check('the old extra trails', ids(merged)[2] === 'curl', ids(merged).join(','))
  check('and it keeps its sets', setsOf(merged, 'curl').length === 1)
}

{
  // An empty card is a placeholder, not a workout. Carrying those over is how a
  // routine of six exercises turns back into the whole library.
  const merged = mergeRoutineCards([emptyCard('press'), emptyCard('curl')], lib.slice(0, 2), ['bench', 'press'], makeCard)
  check('an empty card is not carried over', ids(merged).join(',') === 'bench,press', ids(merged).join(','))
}

{
  // The routine's order wins over the order the cards were in.
  const merged = mergeRoutineCards([filledCard('press'), filledCard('bench')], lib.slice(0, 2), ['bench', 'press'], makeCard)
  check('the cards follow the routine', ids(merged).join(',') === 'bench,press', ids(merged).join(','))
  check('and they keep their sets', setsOf(merged, 'bench').length === 1 && setsOf(merged, 'press').length === 1)
}

{
  // A routine naming an exercise the library no longer has must not crash the page.
  const merged = mergeRoutineCards([filledCard('bench')], lib, ['bench', 'ghost'], makeCard)
  check('an exercise the library lost is skipped', ids(merged).join(',') === 'bench', ids(merged).join(','))
  check('and the rest of the workout survives', setsOf(merged, 'bench').length === 1)
}

{
  // Nothing in, nothing out.
  check('no cards and no routine', mergeRoutineCards([], [], [], makeCard).length === 0)
}

check('an empty card is not content', !cardHasContent(emptyCard('bench')))
check('a card with a set is content', cardHasContent(filledCard('bench')))
check('a card with a weight only is content', cardHasContent({
  id: 'x', exercise_id: 'bench', set_entries: [{ id: 's', set_number: 1, weight: '40', reps: '' }],
}))
check('no card is not content', !cardHasContent(null))

console.log(`\n${failures === 0 ? 'Picking a routine is right.' : `${failures} FAILED.`}`)
process.exit(failures === 0 ? 0 : 1)
