// src/lib/routines.js
//
// The arithmetic behind reordering a routine.
//
// Kept free of imports on purpose, like draft.js, so it can be loaded directly by a
// plain node test. Reordering is the one piece of this feature that is pure logic
// wrapped in a lot of pointer handling, and the pointer handling is where the bugs
// would be. So the arithmetic is here, on its own, where it can be checked exactly.

/**
 * Move one item to another position.
 *
 * The item lands *at* the target index, not "before" or "after" it — which is what
 * a drag that reorders live wants. Dragging the first row onto the third slot puts
 * it third, and the rows it passed move up to close the gap.
 *
 * @param list the items, in order
 * @param from  the index the item is at now
 * @param to    the index it should end up at
 * @returns a new list; the original is not touched
 */
export function moveItem(list, from, to) {
  if (from === to) return list
  if (from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/**
 * The order two lists have in common.
 *
 * Used when a routine's order changes underneath a session that is already open: the
 * session's cards have to follow the routine, or the thing being logged stops
 * matching the thing that was reordered.
 *
 * Items that are in only one of the lists keep their relative position at the end,
 * so an exercise that was added to the routine mid-session is not lost.
 *
 * @param wanted the order to follow, usually the routine's
 * @param current the order that exists now, usually the session's cards
 */
export function mergeOrder(wanted, current) {
  const have = new Set(current)
  const followed = wanted.filter(id => have.has(id))
  const leftover = current.filter(id => !wanted.includes(id))
  return [...followed, ...leftover]
}
