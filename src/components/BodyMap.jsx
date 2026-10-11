// src/components/BodyMap.jsx
import GEOMETRY from '../lib/body-geometry'
import { REGIONS, REGION_LABEL } from '../lib/muscles'

/**
 * Front and back of a body, each muscle shaded by how hard it was worked.
 *
 * Geometry is adapted from openGym's body-paths.js — an anatomically proportioned
 * silhouette. My first attempt drew the regions as boxes over a stick figure, which was
 * legible as data but not as a body, and there is no reason to redraw something this shape
 * when the shape already exists.
 *
 * The shade steps are the same accent ramp the activity heatmap uses, so "more colour =
 * more training" means one thing across the page instead of two. Both are 0-4; five steps
 * across this much area reads as noise.
 *
 * Levels are relative to the hardest-worked muscle in the same load, so the map always
 * reads as a balance. That is deliberate: an absolute scale would make a light week look
 * empty even when it is well balanced.
 */

/**
 * Shade buckets 0–4 per region.
 *
 * Four visible steps above zero rather than a continuous ramp. On a 13px-tall shape a
 * continuous ramp produces colours too close to tell apart, and the reader cannot tell a
 * trained muscle from an untrained one.
 */
function levelsOf(totals) {
  const max = Math.max(0, ...REGIONS.map(r => totals?.[r] || 0))
  const out = {}
  for (const region of REGIONS) {
    const value = totals?.[region] || 0
    if (!value || !max) out[region] = 0
    else {
      const ratio = value / max
      out[region] = ratio >= 1 ? 4 : ratio >= 0.66 ? 3 : ratio >= 0.33 ? 2 : 1
    }
  }
  return out
}

function View({ view, levels, totals, side }) {
  const { vb, p, inert } = view
  return (
    <svg className="bm-v" viewBox={vb} role="img" aria-label={`${side} body, training distribution`}>
      {/* Drawn, never shaded: they carry no training load. */}
      {inert.map((part, i) => (
        <path key={`i${i}`} className="bm-sil" d={part.d} />
      ))}
      {REGIONS.map(region =>
        (p[region] || []).map((d, i) => {
          const sets = Math.round(totals?.[region] || 0)
          return (
            <path key={`${region}${i}`} className={`bm-m l${levels[region]}`} d={d}>
              {/* One interpolated string: React requires the children of a <title> to be a
                  single string, and an array here is a fatal render error rather than a
                  warning. It took the whole page down once already. */}
              <title>{`${REGION_LABEL[region]}: ${sets} set${sets === 1 ? '' : 's'}`}</title>
            </path>
          )
        }),
      )}
    </svg>
  )
}

export default function BodyMap({ totals }) {
  const levels = levelsOf(totals)
  return (
    <div className="bodymap">
      <View view={GEOMETRY.front} levels={levels} totals={totals} side="front" />
      <View view={GEOMETRY.back} levels={levels} totals={totals} side="back" />
    </div>
  )
}
