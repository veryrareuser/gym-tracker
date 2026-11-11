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

/**
 * Does this card hold anything that was actually logged?
 *
 * An empty card is not workout data. It is a placeholder for an exercise the editor
 * shows so you can type into it, and carrying those around is how a short routine
 * turns back into the whole library.
 */
export function cardHasContent(card) {
  return Boolean(card && card.set_entries && card.set_entries.some(s => s.weight || s.reps))
}

/**
 * The cards of a session, after a routine is picked.
 *
 * Picking a routine must never throw away what has already been logged. Three rules,
 * and each one is there because breaking it loses a set:
 *
 *   1. A card the routine has keeps its sets. Picking the routine you are already
 *      logging must not empty it.
 *   2. A card the routine does not have is carried over, with its sets, and goes to
 *      the end. Switching routines halfway through a workout does not throw the work
 *      away.
 *   3. A card with nothing in it is dropped rather than carried over, because it is
 *      a placeholder and not a workout. Picking a routine out of the whole-library
 *      editor leaves the routine's short list instead of the whole library.
 *
 * The bug this replaced dropped rule 1 and rule 3 together. A card that was in both
 * the previous cards and the new routine was in neither list — it was not "kept"
 * (it was in the routine) and it was not "fresh" (it was already there) — so it
 * vanished, and its sets went with it. Re-picking the routine you were logging
 * emptied the workout. "Log without a routine" emptied it too, because every card
 * was in the library and therefore in neither list.
 *
 * @param cards    the cards on screen now
 * @param source   the library entries of the routine being picked, or the whole library
 * @param wanted   the exercise ids of that routine, in order
 * @param makeCard builds an empty card for a library entry
 */
export function mergeRoutineCards(cards, source, wanted, makeCard) {
  const byExercise = new Map((cards || []).map(card => [card.exercise_id, card]))
  const merged = []

  for (const id of wanted) {
    const existing = byExercise.get(id)
    if (existing) {
      // Rule 1: the routine's own exercise, with whatever was already logged in it.
      merged.push(existing)
      byExercise.delete(id)
      continue
    }
    const exercise = (source || []).find(ex => ex.id === id)
    // An exercise the routine names but the library no longer has cannot be shown.
    if (!exercise) continue
    merged.push(makeCard(exercise, merged.length))
  }

  for (const card of byExercise.values()) {
    // Rule 2 and rule 3: what was logged comes with us, what was not does not.
    if (!cardHasContent(card)) continue
    merged.push(card)
  }

  return merged.map((card, i) => ({ ...card, order: i }))
}
