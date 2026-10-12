// src/components/BodyMap.jsx
import { useEffect, useMemo, useState } from 'react'
import { RENDER_REGIONS, RENDER_KEY, RENDER_LABEL } from '../lib/muscles'

/**
 * Front and back of a body, each muscle shaded by how hard it was worked.
 *
 * Geometry is openGym's `male` figure, copied whole from body-paths.js — every region,
 * every path, no filtering. The female figure is not included; it would nearly double the
 * payload to ~93 KB and the app has no setting to choose it.
 *
 * It is loaded on first render rather than imported, which keeps ~42 KB out of the chunk
 * that carries the rest of this page. Until it arrives the component renders nothing but
 * keeps its height, so nothing below it jumps.
 *
 * The shade steps are the same accent ramp the activity heatmap uses, so "more colour =
 * more training" means one thing across the page. Both are 0-4; five steps across this
 * much area reads as noise.
 *
 * Levels are relative to the hardest-worked muscle in the same load, so the map always
 * reads as a balance. That is deliberate: an absolute scale would make a light week look
 * empty even when it is well balanced.
 */

let CACHE = null          // shared across every mounted map
let PENDING = null

function useBodyPaths() {
  const [paths, setPaths] = useState(CACHE)
  useEffect(() => {
    if (CACHE) return
    let alive = true
    PENDING = PENDING || import('../lib/body-geometry').then(m => (CACHE = m.default))
    PENDING.then(p => {
      if (alive) setPaths(p)
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return paths
}

/**
 * Shade buckets 0–4 per region, keyed the way the artwork keys them.
 *
 * Four visible steps above zero rather than a continuous ramp. On a shape this small a
 * continuous ramp produces colours too close to tell apart, and the reader cannot tell a
 * trained muscle from an untrained one.
 */
function levelsOf(totals) {
  const load = {}
  for (const [region, renderKey] of Object.entries(RENDER_KEY)) {
    load[renderKey] = totals?.[region] || 0
  }
  // Muscles the artwork draws but this app cannot attribute are zero by construction, so
  // they take the inert tone and read as "not measured" rather than "not trained".
  for (const key of RENDER_REGIONS) if (!(key in load)) load[key] = 0

  const max = Math.max(0, ...RENDER_REGIONS.map(r => load[r] || 0))
  const levels = {}
  for (const key of RENDER_REGIONS) {
    const value = load[key] || 0
    if (!value || !max) levels[key] = 0
    else {
      const ratio = value / max
      levels[key] = ratio >= 1 ? 4 : ratio >= 0.66 ? 3 : ratio >= 0.33 ? 2 : 1
    }
  }
  return { levels, load }
}

/** Enter and Space activate a muscle; Space is swallowed so the page does not scroll. */
function activate(event, key, onMuscle) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  if (event.key === ' ') event.preventDefault()
  onMuscle(key)
}

function View({ view, levels, load, selected, onMuscle }) {
  const paths = view?.p
  if (!paths) return null

  // Everything the artwork carries that is neither a shaded muscle nor an inert part —
  // currently nothing, but a future artwork revision could add regions, and silently
  // dropping them would recreate the bug this file already had once.
  const known = new Set([...RENDER_REGIONS, 'head', 'hair', 'neck', 'hands', 'knees', 'ankles', 'feet'])

  // A map nobody can interact with stays a picture. Exposing 60 paths as buttons to a
  // keyboard or screen reader would be a trap, not a feature.
  const interactive = Boolean(onMuscle)

  return (
    <svg
      className="bm-v"
      viewBox={view.vb}
      role={interactive ? 'group' : 'img'}
      aria-label="Body, training distribution"
    >
      {Object.entries(paths).map(([key, list]) =>
        list.map((d, i) => {
          const inert = !RENDER_REGIONS.includes(key)
          const sets = Math.round(load?.[key] || 0)
          // One interpolated string: React requires the children of a <title> to be a
          // single string, and an array here is a fatal render error rather than a
          // warning. It took the whole page down once already.
          const name = RENDER_LABEL[key] || key
          const label = inert ? name : `${name}: ${sets} set${sets === 1 ? '' : 's'}`
          const isSelected = selected === key
          // Inert parts (head, hands, knees) are not muscles and have nothing to report.
          const tappable = interactive && !inert
          return (
            <path
              key={`${key}${i}`}
              className={
                inert
                  ? 'bm-sil'
                  : `bm-m l${levels[key] || 0}${isSelected ? ' sel' : ''}`
              }
              d={d}
              data-region={known.has(key) ? undefined : key}
              {...(tappable
                ? {
                    role: 'button',
                    tabIndex: 0,
                    'aria-label': name,
                    'aria-pressed': isSelected,
                    onClick: () => onMuscle(key),
                    onKeyDown: event => activate(event, key, onMuscle),
                  }
                : {})}
            >
              <title>{label}</title>
            </path>
          )
        }),
      )}
    </svg>
  )
}

/**
 * @param totals    sets per region, keyed as REGIONS
 * @param selected  a render key, or null
 * @param onMuscle  called with a render key. Omit it and the map is a plain image.
 */
export default function BodyMap({ totals, selected = null, onMuscle }) {
  const paths = useBodyPaths()
  const { levels, load } = useMemo(() => levelsOf(totals), [totals])

  return (
    <div className={onMuscle ? 'bodymap tappable' : 'bodymap'}>
      {paths ? (
        <>
          <View view={paths.front} levels={levels} load={load} selected={selected} onMuscle={onMuscle} />
          <View view={paths.back} levels={levels} load={load} selected={selected} onMuscle={onMuscle} />
        </>
      ) : (
        // Reserve the height so the card beneath does not jump when the geometry lands.
        <div className="bm-ph" aria-hidden="true" />
      )}
    </div>
  )
}
