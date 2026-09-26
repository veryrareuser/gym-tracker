// src/components/ExercisePicker.jsx
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, Dumbbell, Check, ChevronDown } from 'lucide-react'
import { searchExercises, getExerciseFacets, imageUrl } from '../lib/exerciseDb'

/**
 * Full-screen exercise search presented as a sheet.
 *
 * Mounted only while open, so state starts clean without a reset effect.
 *
 * Height is driven by window.visualViewport rather than `position: fixed; inset: 0`.
 * A fixed overlay resolves against the layout viewport, which does not shrink for
 * the on-screen keyboard on iOS — the bottom half of the result list ended up hidden
 * behind the keyboard. The visual viewport does shrink, and offsetTop tracks the
 * pan, so the sheet stays fully visible while typing.
 */
function useVisualViewport() {
  const [vp, setVp] = useState(() => ({
    height: window.visualViewport?.height ?? window.innerHeight,
    offsetTop: window.visualViewport?.offsetTop ?? 0,
  }))

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onChange = () => setVp({ height: vv.height, offsetTop: vv.offsetTop })
    vv.addEventListener('resize', onChange)
    vv.addEventListener('scroll', onChange)
    onChange()
    return () => {
      vv.removeEventListener('resize', onChange)
      vv.removeEventListener('scroll', onChange)
    }
  }, [])

  return vp
}

function titleCase(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : ''
}

export default function ExercisePicker({ onClose, onSelect, usedIds = [] }) {
  const [query, setQuery] = useState('')
  const [bodyPart, setBodyPart] = useState('')
  const [showEquipment, setShowEquipment] = useState(false)
  const [equipment, setEquipment] = useState('')
  const [facets, setFacets] = useState({ bodyParts: [], equipment: [] })
  // Holds the results for one specific filter combination plus the key they belong
  // to, so "loading" is derived from whether the current key has been answered
  // rather than tracked with a separate state update on every keystroke.
  const [resolved, setResolved] = useState({ key: '', results: [] })
  const inputRef = useRef(null)
  const viewport = useVisualViewport()

  const currentKey = `${query}|${bodyPart}|${equipment}`
  const isAnswered = resolved.key === currentKey
  const results = isAnswered ? resolved.results : []
  const status = isAnswered ? 'ready' : 'loading'

  // Load facets and the first page, and lock background scroll while open.
  useEffect(() => {
    let cancelled = false
    document.body.style.overflow = 'hidden'

    getExerciseFacets().then(f => {
      if (!cancelled) setFacets(f)
    })
    // The index is ~194 KB, so results are ready immediately — no debounce needed.
    searchExercises('', {}).then(r => {
      if (!cancelled) setResolved({ key: '||', results: r })
    })

    const focusTimer = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 120)
    return () => {
      cancelled = true
      clearTimeout(focusTimer)
      document.body.style.overflow = ''
    }
  }, [])

  // The untouched filter combination is skipped because the mount effect above
  // already answered it.
  useEffect(() => {
    if (currentKey === '||') return
    let cancelled = false
    searchExercises(query, { bodyPart, equipment }).then(r => {
      if (!cancelled) setResolved({ key: currentKey, results: r })
    })
    return () => {
      cancelled = true
    }
  }, [query, bodyPart, equipment, currentKey])

  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const used = new Set(usedIds)
  const hasFilters = Boolean(bodyPart || equipment)

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add exercise"
      style={{
        position: 'fixed',
        top: viewport.offsetTop,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 520,
        height: viewport.height,
        zIndex: 300,
        background: 'var(--color-bg)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header: cancel, title, done-style confirm affordance */}
      <div
        className="glass"
        style={{
          flexShrink: 0,
          paddingTop: 'env(safe-area-inset-top)',
          borderBottom: '1px solid var(--color-border)',
          borderRadius: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 6px' }}>
          <button onClick={onClose} className="hit" style={{ color: 'var(--color-accent-text)', fontSize: 'var(--type-body)' }}>
            Cancel
          </button>
          <div style={{ flex: 1, textAlign: 'center', fontWeight: 600, fontSize: 'var(--type-headline)' }}>
            Add Exercise
          </div>
          {/* Balances the Cancel button so the title stays optically centred. */}
          <div style={{ width: 62 }} />
        </div>

        {/* Search field */}
        <div style={{ padding: '0 12px 10px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--color-fill)',
              borderRadius: 'var(--radius-sm)',
              padding: '0 10px',
              height: 'var(--hit-min)',
            }}
          >
            <Search size={17} color="var(--color-muted)" style={{ flexShrink: 0 }} />
            <input
              ref={inputRef}
              type="search"
              enterKeyHint="search"
              placeholder="Search 1,324 exercises"
              aria-label="Search exercises"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                height: '100%',
                fontSize: 'var(--type-callout)',
                minWidth: 0,
              }}
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search" className="hit" style={{ width: 32, minHeight: 32 }}>
                <X size={16} color="var(--color-muted)" />
              </button>
            )}
          </div>
        </div>

        {/* Body-part filter chips */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            padding: '0 12px 10px',
            scrollbarWidth: 'none',
          }}
        >
          {facets.bodyParts.map(part => (
            <button
              key={part}
              className="chip"
              data-selected={bodyPart === part}
              aria-pressed={bodyPart === part}
              onClick={() => setBodyPart(bodyPart === part ? '' : part)}
            >
              {titleCase(part)}
            </button>
          ))}
          <button
            className="chip"
            data-selected={showEquipment}
            aria-expanded={showEquipment}
            onClick={() => setShowEquipment(v => !v)}
          >
            Equipment <ChevronDown size={13} style={{ transform: showEquipment ? 'rotate(180deg)' : 'none' }} />
          </button>
        </div>

        {showEquipment && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              overflowX: 'auto',
              padding: '0 12px 10px',
              scrollbarWidth: 'none',
            }}
          >
            {facets.equipment.map(item => (
              <button
                key={item}
                className="chip"
                data-selected={equipment === item}
                aria-pressed={equipment === item}
                onClick={() => setEquipment(equipment === item ? '' : item)}
              >
                {titleCase(item)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Result count keeps the list from feeling arbitrary when it is truncated. */}
      <div
        style={{
          padding: '8px 16px 4px',
          fontSize: 'var(--type-footnote)',
          color: 'var(--color-muted)',
          flexShrink: 0,
        }}
      >
        {status === 'loading'
          ? 'Loading exercises…'
          : results.length === 0
            ? 'No matches'
            : hasFilters || query
              ? `${results.length}${results.length === 60 ? '+' : ''} result${results.length === 1 ? '' : 's'}`
              : `${results.length} of 1,324 — search or filter to narrow down`}
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 16px', overscrollBehavior: 'contain' }}>
        {status === 'ready' && results.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '48px 24px',
              color: 'var(--color-muted)',
            }}
          >
            <Dumbbell size={36} style={{ opacity: 0.3, marginBottom: 12 }} />
            <p style={{ margin: '0 0 4px', fontWeight: 600, color: 'var(--color-text)' }}>No exercises found</p>
            <p style={{ margin: 0, fontSize: 'var(--type-subhead)' }}>
              {query ? `Nothing matches “${query}”.` : 'Try a different filter.'}
            </p>
          </div>
        )}

        {results.map(ex => {
          const alreadyAdded = used.has(ex.id)
          return (
            <button
              key={ex.id}
              onClick={() => !alreadyAdded && onSelect(ex)}
              disabled={alreadyAdded}
              aria-label={alreadyAdded ? `${ex.name}, already added` : `Add ${ex.name}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                textAlign: 'left',
                padding: '10px 8px',
                borderRadius: 'var(--radius-md)',
                marginBottom: 2,
                opacity: alreadyAdded ? 0.45 : 1,
                cursor: alreadyAdded ? 'default' : 'pointer',
              }}
            >
              <span className="thumb" style={{ width: 52, height: 52 }}>
                <img src={imageUrl(ex.image)} alt="" loading="lazy" decoding="async" />
              </span>

              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontWeight: 600,
                    fontSize: 'var(--type-subhead)',
                    marginBottom: 5,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    textTransform: 'capitalize',
                  }}
                >
                  {ex.name}
                </span>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className="chip" style={{ minHeight: 22, fontSize: 'var(--type-min)' }}>
                    {titleCase(ex.body_part)}
                  </span>
                  <span
                    className="chip"
                    style={{ minHeight: 22, fontSize: 'var(--type-min)', textTransform: 'capitalize' }}
                  >
                    {ex.equipment}
                  </span>
                </span>
              </span>

              {alreadyAdded && <Check size={18} color="var(--color-muted)" style={{ flexShrink: 0 }} />}
            </button>
          )
        })}
      </div>
    </div>,
    document.body,
  )
}
