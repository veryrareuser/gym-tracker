// src/components/ExercisePicker.jsx
import { useState, useEffect, useRef } from 'react'
import { X, Search, Dumbbell } from 'lucide-react'
import { searchExercises, getImageUrl } from '../lib/exerciseDb'

const BODY_PART_COLORS = {
  chest: '#ff6b6b',
  back: '#4dabf7',
  shoulders: '#a9e34b',
  'upper arms': '#ffd43b',
  'lower arms': '#ffc9c9',
  legs: '#74c0fc',
  waist: '#f783ac',
  cardio: '#69db7c',
}

function tagColor(bodyPart) {
  return BODY_PART_COLORS[bodyPart?.toLowerCase()] || 'var(--color-muted)'
}

export default function ExercisePicker({ open, onClose, onSelect, usedIds = [] }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setLoading(true)
    searchExercises('').then(r => { setResults(r); setLoading(false) })
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  function handleSearch(value) {
    setQuery(value)
    clearTimeout(debounceRef.current)
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      const r = await searchExercises(value)
      setResults(r)
      setLoading(false)
    }, 200)
  }

  if (!open) return null

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 300,
      background: 'var(--color-bg)',
      display: 'flex',
      flexDirection: 'column',
      maxWidth: 480,
      left: '50%',
      transform: 'translateX(-50%)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 16px',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--color-muted)', padding: 0, flexShrink: 0 }}
        >
          <X size={22} />
        </button>
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--color-surface2)',
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          padding: '8px 12px',
        }}>
          <Search size={15} color="var(--color-muted)" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search exercises..."
            value={query}
            onChange={e => handleSearch(e.target.value)}
            style={{
              background: 'none',
              border: 'none',
              outline: 'none',
              flex: 1,
              fontSize: 15,
              color: 'var(--color-text)',
              padding: 0,
              width: '100%',
            }}
          />
        </div>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-muted)', fontSize: 14 }}>
            Loading...
          </div>
        )}

        {!loading && results.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-muted)', fontSize: 14 }}>
            No exercises found for "{query}"
          </div>
        )}

        {!loading && results.map(ex => {
          const imageUrl = getImageUrl(ex.id)
          const alreadyAdded = usedIds.includes(ex.id)

          return (
            <div
              key={ex.id}
              onClick={() => !alreadyAdded && onSelect({
                id: ex.id,
                name: ex.name,
                muscle_group: ex.body_part,
                image_url: imageUrl,
                order: Date.now(),
              })}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 8px',
                borderRadius: 12,
                marginBottom: 4,
                cursor: alreadyAdded ? 'default' : 'pointer',
                opacity: alreadyAdded ? 0.4 : 1,
                background: 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (!alreadyAdded) e.currentTarget.style.background = 'var(--color-surface)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              {/* Image */}
              <div style={{
                width: 56,
                height: 56,
                borderRadius: 10,
                overflow: 'hidden',
                background: 'var(--color-surface2)',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid var(--color-border)',
              }}>
                <img
                  src={imageUrl}
                  alt={ex.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  loading="lazy"
                  onError={e => {
                    e.target.style.display = 'none'
                    e.target.parentElement.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-border)" stroke-width="2"><path d="M6.5 6.5h.01M17.5 6.5h.01M6.5 17.5h.01M17.5 17.5h.01M3 12h1m16 0h1M12 3v1m0 16v1M18.364 5.636l-.707.707M6.343 17.657l-.707.707M18.364 18.364l-.707-.707M6.343 6.343l-.707-.707"/></svg>'
                  }}
                />
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 600,
                  fontSize: 14,
                  marginBottom: 4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textTransform: 'capitalize',
                }}>
                  {ex.name}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 11,
                    padding: '2px 7px',
                    borderRadius: 20,
                    background: `${tagColor(ex.body_part)}22`,
                    color: tagColor(ex.body_part),
                    fontWeight: 600,
                    textTransform: 'capitalize',
                  }}>
                    {ex.body_part}
                  </span>
                  <span style={{
                    fontSize: 11,
                    padding: '2px 7px',
                    borderRadius: 20,
                    background: 'var(--color-surface2)',
                    color: 'var(--color-muted)',
                    textTransform: 'capitalize',
                  }}>
                    {ex.equipment}
                  </span>
                </div>
              </div>

              {alreadyAdded && (
                <span style={{ fontSize: 11, color: 'var(--color-muted)', flexShrink: 0 }}>Added</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
