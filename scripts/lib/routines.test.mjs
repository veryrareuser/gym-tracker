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

import { moveItem, mergeOrder } from '../../src/lib/routines.js'

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
process.exit(failures === 0 ? 0 : 1)
