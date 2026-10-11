// src/components/BodyMap.jsx
import { REGION_LABEL } from '../lib/muscles'

/**
 * A front and back silhouette, shaded by how much each region was trained.
 *
 * Original artwork, drawn as simple shapes rather than anatomy: the underlying exercise
 * metadata is a coarse body-part string, so a detailed figure would imply a precision the
 * data cannot support. What each shape *can* honestly show is how the training was
 * distributed, which is what the card is for.
 *
 * The lower body is drawn in the inert tone. This library has never logged a leg session,
 * and hiding those regions would turn an honest "never trained" into an invisible gap — the
 * card would look balanced when the reality is an upper-body-only routine.
 */

const INERT_FILL = 'var(--fill)'
const OUTLINE = 'var(--line)'

/**
 * Path data for one region, in a 100x200 viewBox. Front unless noted.
 *
 * Every region in REGIONS has an entry here. A region with no path would silently render
 * as nothing at all, so a newly trained leg day would leave the body map unchanged — the
 * failure would look like a data bug rather than a missing shape.
 */
const SHAPES = {
  // front
  shoulders: { d: 'M32 52 Q50 44 68 52 L64 62 Q50 58 36 62 Z' },
  chest: { d: 'M36 63 Q50 59 64 63 L63 80 Q50 84 37 80 Z' },
  biceps: { d: 'M31 63 L36 64 L34 88 L29 86 Z' },
  triceps: { d: 'M64 64 L69 63 L71 86 L66 88 Z' },
  forearms: { d: 'M28 89 L33 90 L32 112 L27 111 Z' },
  abs: { d: 'M42 84 L58 84 L57 108 L43 108 Z' },
  quadriceps: { d: 'M41 112 L49 112 L48 145 L41 145 Z' },
  calves: { d: 'M41 149 L48 149 L47 172 L41 172 Z' },
  // back
  trapezius: { d: 'M33 51 Q50 45 67 51 L62 60 Q50 55 38 60 Z' },
  'upper-back': { d: 'M35 62 Q50 57 65 62 L64 82 Q50 87 36 82 Z' },
  glutes: { d: 'M41 108 L59 108 L58 124 L42 124 Z' },
  hamstrings: { d: 'M41 126 L49 126 L48 156 L41 156 Z' },
}

const VIEW = '0 0 100 200'

function Region({ name, value, max, side }) {
  const shape = SHAPES[name]
  if (!shape) return null
  const ratio = max > 0 ? value / max : 0
  // Four visible steps above zero. A continuous ramp on a 13px-tall shape reads as noise.
  const fill = value === 0 ? INERT_FILL : `rgba(0, 140, 60, ${0.2 + ratio * 0.75})`
  return (
    <path
      d={shape.d}
      fill={fill}
      stroke={OUTLINE}
      strokeWidth="0.4"
      data-region={name}
      data-side={shape.side || side}
    >
      <title>
        {REGION_LABEL[name]}: {Math.round(value)} set{Math.round(value) === 1 ? '' : 's'}
      </title>
    </path>
  )
}

/** The uninvolved silhouette: head, neck, hands, feet. Drawn, never shaded. */
function Base({ side }) {
  const mirror = side === 'back'
  return (
    <g>
      {/* head */}
      <ellipse cx="50" cy="26" rx="13" ry="15" fill={INERT_FILL} stroke={OUTLINE} strokeWidth="0.4" />
      {/* neck */}
      <path d="M44 39 L56 39 L56 48 L44 48 Z" fill={INERT_FILL} stroke={OUTLINE} strokeWidth="0.4" />
      {/* torso outline, behind the shaded regions */}
      <path
        d="M33 50 Q50 42 67 50 L70 86 L66 110 L60 112 L59 128 L41 128 L40 112 L34 110 L30 86 Z"
        fill="none"
        stroke={OUTLINE}
        strokeWidth="0.6"
      />
      {/* arms */}
      <path
        d="M30 55 L24 70 L22 96 L26 98 L28 74 L34 60 Z M70 55 L76 70 L78 96 L74 98 L72 74 L66 60 Z"
        fill="none"
        stroke={OUTLINE}
        strokeWidth="0.6"
      />
      {/* legs */}
      <path
        d="M41 130 L39 160 L40 180 L47 180 L48 130 M59 130 L61 160 L60 180 L53 180 L52 130"
        fill="none"
        stroke={OUTLINE}
        strokeWidth="0.6"
      />
      {mirror ? null : null}
    </g>
  )
}

/**
 * Regions that must be drawn on the given figure.
 *
 * Both halves together cover every region in REGIONS exactly once: front draws what a person
 * faces you with, back draws the rest. A region in neither list, or in both, is a bug — the
 * exercise above explains why an unlisted one fails silently.
 */
const FRONT_REGIONS = ['shoulders', 'chest', 'biceps', 'triceps', 'forearms', 'abs', 'quadriceps', 'calves']
const BACK_REGIONS = ['trapezius', 'upper-back', 'glutes', 'hamstrings']

if (import.meta.env?.DEV) {
  const drawn = [...FRONT_REGIONS, ...BACK_REGIONS]
  const missingShape = REGIONS.filter(r => !SHAPES[r])
  const unplaced = REGIONS.filter(r => !drawn.includes(r))
  const duplicated = drawn.filter((r, i) => drawn.indexOf(r) !== i)
  if (missingShape.length || unplaced.length || duplicated.length) {
    console.error(
      '[BodyMap] region coverage problem',
      { missingShape, notDrawn: unplaced, drawnTwice: [...new Set(duplicated)] },
    )
  }
}

export default function BodyMap({ totals }) {
  const max = Math.max(0, ...Object.values(totals || {}))
  const render = (regions, side) => (
    <svg viewBox={VIEW} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={`${side} body, training distribution`}>
      <Base side={side} />
      {/* Every region on this figure is drawn, trained or not. An untrained one falls back
          to the inert tone inside Region, which is what makes a gap visible rather than
          absent — so there is no separate "untrained" pass here. */}
      {regions.map(name => (
        <Region key={`${side}-${name}`} name={name} value={totals?.[name] || 0} max={max} side={side} />
      ))}
    </svg>
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div>
        {render(FRONT_REGIONS, 'front')}
        <p style={{ textAlign: 'center', fontSize: 'var(--type-fine)', color: 'var(--ink-muted)', margin: '6px 0 0' }}>
          Front
        </p>
      </div>
      <div>
        {render(BACK_REGIONS, 'back')}
        <p style={{ textAlign: 'center', fontSize: 'var(--type-fine)', color: 'var(--ink-muted)', margin: '6px 0 0' }}>
          Back
        </p>
      </div>
    </div>
  )
}

export function BodyMapLegend() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>
      <span>Less</span>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: INERT_FILL }} />
      {[0.3, 0.5, 0.7, 0.95].map(a => (
        <span key={a} style={{ width: 12, height: 12, borderRadius: 3, background: `rgba(0, 140, 60, ${a})` }} />
      ))}
      <span>More</span>
    </div>
  )
}
