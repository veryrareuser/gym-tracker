// src/lib/useDragReorder.js
//
// Drag-to-reorder for a list.
//
// Why not the HTML drag-and-drop API: it does not work on touch. A phone is the
// main device this app is used on, and `draggable="true"` rows are simply not
// draggable with a finger on iOS or Android. So this is built on pointer events,
// which behave the same for a mouse and for a fingertip.
//
// The handle is the only part you grab. The handle carries `touch-action: none`,
// which is what stops the page from scrolling under your finger while you drag —
// without it the browser claims the gesture for scrolling and the drag never
// happens.
//
// The list reorders *live* while you drag: the row you are holding moves to the
// position your finger is over, and the rows it passes shuffle up to close the gap.
// That is what makes it feel like moving a thing rather than filling in a form.
//
// The order is committed when you let go. Committing on every pointer move would
// mean a database write per frame.

import { useCallback, useEffect, useRef, useState } from 'react'
import { moveItem } from './routines'

/**
 * @param items    the items, in order — their ids
 * @param onChange called with the new order whenever the list changes
 * @returns the props to spread onto the list and its handles
 */
export function useDragReorder(items, onChange) {
  const [draggingId, setDraggingId] = useState(null)
  const listRef = useRef(null)
  const itemsRef = useRef(items)

  // Written in an effect rather than during render: assigning a ref while rendering
  // is a side effect React is free to discard, and the value the pointer handler
  // reads would then depend on whether that render happened to commit.
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const onPointerDown = useCallback((id, event) => {
    // Only the primary button starts a drag, so a right-click does not.
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault()
    // Capturing the pointer keeps the events coming to the handle even when the
    // finger leaves it, which it will as soon as the row moves.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* a pointer that is already gone cannot be captured; the drag still works */
    }
    setDraggingId(id)
  }, [])

  const onPointerMove = useCallback(
    event => {
      const id = draggingId
      if (!id || !listRef.current) return
      const rows = Array.from(listRef.current.querySelectorAll('[data-reorder-item]'))
      if (rows.length === 0) return

      // Which slot is the pointer over? The top half of a row means "before it",
      // the bottom half means "after it".
      let target = rows.length - 1
      for (let i = 0; i < rows.length; i++) {
        const box = rows[i].getBoundingClientRect()
        if (event.clientY < box.top + box.height / 2) {
          target = i
          break
        }
      }

      const current = itemsRef.current
      const from = current.indexOf(id)
      if (from < 0 || from === target) return
      onChange(moveItem(current, from, target))
    },
    [draggingId, onChange],
  )

  const onPointerUp = useCallback(() => setDraggingId(null), [])

  // A pointer that leaves the window entirely never sends pointerup, and the row
  // would stay stuck to the finger. Ending the drag on blur or cancel covers that.
  useEffect(() => {
    if (!draggingId) return undefined
    const stop = () => setDraggingId(null)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('blur', stop)
    return () => {
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)
    }
  }, [draggingId])

  return {
    draggingId,
    listRef,
    handleProps: id => ({
      onPointerDown: event => onPointerDown(id, event),
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    }),
  }
}
