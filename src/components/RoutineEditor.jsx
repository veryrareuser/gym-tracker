// src/components/RoutineEditor.jsx
//
// Reordering the exercises inside a routine.
//
// The grip on the left is the whole interface: grab it and drag. The list reorders
// live under your finger, and the new order is written when you let go.
//
// The handle carries `touch-action: none` so that the page does not scroll under
// your finger while you drag — without it the browser claims the gesture for
// scrolling and the row never moves.
//
// The order is the point of a routine. "Back, chest, then shoulders" is a plan, and
// on the day you want to start with back instead, you drag it to the front.

import { GripVertical, Trash2, Plus, Check } from 'lucide-react'
import { useDragReorder } from '../lib/useDragReorder'

/**
 * @param exercises  the routine's exercises, in order
 * @param onReorder  called with the new order of exercise ids
 * @param onRemove   called with the id of an exercise to take out of the routine
 * @param onAdd      opens the library picker
 * @param onDone     leaves the editor
 */
export default function RoutineEditor({ exercises = [], onReorder, onRemove, onAdd, onDone }) {
  const ids = exercises.map(ex => ex.id)
  const { draggingId, listRef, handleProps } = useDragReorder(ids, onReorder)

  return (
    <div>
      <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)', margin: '0 0 12px' }}>
        Drag the handle to reorder. The order is the order you log them in.
      </p>

      <div ref={listRef}>
        {exercises.map(exercise => (
          <div
            key={exercise.id}
            data-reorder-item
            className="card"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: 8,
              marginBottom: 8,
              // The row being dragged is lifted off the page. A hard shadow rather
              // than a fade, because everything in this design is flat.
              boxShadow: draggingId === exercise.id ? '8px 8px 0 var(--outline)' : undefined,
              opacity: draggingId && draggingId !== exercise.id ? 0.9 : 1,
            }}
          >
            <button
              {...handleProps(exercise.id)}
              aria-label={`Reorder ${exercise.name}`}
              className="btn-icon"
              style={{
                touchAction: 'none',
                cursor: 'grab',
                background: 'var(--fill)',
                flexShrink: 0,
              }}
            >
              <GripVertical size={18} color="var(--ink-muted)" />
            </button>

            <span className="thumb" style={{ width: 36, height: 36 }}>
              {exercise.image_url ? (
                <img src={exercise.image_url} alt="" loading="lazy" decoding="async" />
              ) : null}
            </span>

            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontWeight: 700,
                fontSize: 'var(--type-subhead)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {exercise.name}
            </span>

            <button
              onClick={() => onRemove(exercise.id)}
              aria-label={`Remove ${exercise.name} from the routine`}
              className="btn-icon"
              style={{ flexShrink: 0 }}
            >
              <Trash2 size={16} color="var(--destructive)" />
            </button>
          </div>
        ))}
      </div>

      {exercises.length === 0 && (
        <div className="card" style={{ padding: 20, marginBottom: 12, textAlign: 'center' }}>
          <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)' }}>
            This routine is empty. Add the exercises you do.
          </p>
        </div>
      )}

      <button onClick={onAdd} className="btn-secondary btn-block" style={{ marginBottom: 12 }}>
        <Plus size={18} />
        Add exercise
      </button>

      <button onClick={onDone} className="btn-primary btn-block">
        <Check size={18} />
        Done
      </button>
    </div>
  )
}
