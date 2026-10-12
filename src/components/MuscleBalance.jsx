// src/components/MuscleBalance.jsx
import { useMemo, useState } from 'react'
import { Dumbbell, ChevronLeft, ChevronRight } from 'lucide-react'
import { REGIONS, REGION_LABEL, regionsFor } from '../lib/muscles'
import { localISODate, weekStartISO } from '../lib/utils'
import BodyMap from './BodyMap'

/**
 * How the training in a period was distributed across muscle regions.
 *
 * Sets are counted, not kilograms. Volume would make a leg press outrank a row purely
 * because of the plate size, which is not a statement about training balance.
 *
 * Every set is attributed through lib/muscles.js, where the weights for one exercise sum to
 * 1 — so the totals across regions add up to the number of sets actually logged. Nothing is
 * double-counted, and an exercise that cannot be attributed is reported as unattributed
 * rather than quietly redistributed.
 */

const PERIODS = [
  { key: 'week', label: 'Week' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: 'all', label: 'All' },
]

const SHOW_ALL = 5

/** Sessions falling inside the selected period. */
function sessionsInPeriod(sessions, period, weekOffset) {
  if (period === 'all') return sessions
  if (period === 'week') {
    const start = new Date(`${weekStartISO()}T00:00:00`)
    start.setDate(start.getDate() - 7 * weekOffset)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    const from = localISODate(start)
    const to = localISODate(end)
    return sessions.filter(s => s.date >= from && s.date < to)
  }
  const days = period === '30d' ? 30 : 90
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - (days - 1))
  const from = localISODate(cutoff)
  return sessions.filter(s => s.date >= from)
}

/** Sets per region across a period, plus anything that could not be attributed. */
function tally(sessions, exercisesById) {
  const totals = {}
  let unattributed = 0
  let totalSets = 0
  for (const session of sessions) {
    for (const log of session.exercise_logs || []) {
      const exercise = exercisesById.get(log.exercise_id)
      // Only sets that carry a weight or a rep count, matching how the rest of the app
      // decides a set exists — otherwise empty placeholder rows inflate the tally.
      const sets = (log.set_entries || []).filter(s => s.weight || s.reps)
      if (sets.length === 0) continue
      const regions = regionsFor(exercise)
      const entries = Object.entries(regions)
      if (entries.length === 0) {
        unattributed += sets.length
        totalSets += sets.length
        continue
      }
      for (const [region, weight] of entries) {
        totals[region] = (totals[region] || 0) + sets.length * weight
      }
      totalSets += sets.length
    }
  }
  return { totals, unattributed, totalSets }
}

export default function MuscleBalance({ sessions, exercises }) {
  const [period, setPeriod] = useState('30d')
  // 0 = the current week. Positive steps go back in time, never forward.
  const [weekOffset, setWeekOffset] = useState(0)

  const exercisesById = useMemo(() => new Map((exercises || []).map(e => [e.id, e])), [exercises])

  const inPeriod = useMemo(() => sessionsInPeriod(sessions, period, weekOffset), [sessions, period, weekOffset])

  const { totals, unattributed, totalSets } = useMemo(() => tally(inPeriod, exercisesById), [inPeriod, exercisesById])

  const ranked = useMemo(
    () =>
      REGIONS.filter(r => (totals[r] || 0) > 0)
        .map(r => ({ region: r, sets: totals[r] }))
        .sort((a, b) => b.sets - a.sets),
    [totals],
  )

  const max = ranked.length > 0 ? ranked[0].sets : 0
  // Restricted to REGIONS, not the artwork's full set. The body map draws muscles this app
  // cannot attribute — obliques, lower back and so on — and listing those here would claim
  // they went untrained when the honest answer is that they were never measured.
  const untrained = REGIONS.filter(r => !(totals[r] > 0))

  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? ranked : ranked.slice(0, SHOW_ALL)
  const hidden = ranked.length - shown.length

  const weekStart = useMemo(() => {
    const d = new Date(`${weekStartISO()}T00:00:00`)
    d.setDate(d.getDate() - 7 * weekOffset)
    return d
  }, [weekOffset])

  const canGoForward = weekOffset > 0

  return (
    <section className="card" style={{ padding: 17, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Dumbbell size={18} color="var(--primary)" />
        <h2 style={{ fontSize: 'var(--type-headline)', fontWeight: 600, margin: 0, flex: 1 }}>Muscle balance</h2>
      </div>

      {/* Period selector */}
      <div
        role="group"
        aria-label="Period"
        style={{
          display: 'inline-flex',
          background: 'var(--fill)',
          borderRadius: 'var(--rounded-pill)',
          padding: 2,
          marginBottom: 14,
        }}
      >
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => {
              setPeriod(p.key)
              if (p.key !== 'week') setWeekOffset(0)
            }}
            aria-pressed={period === p.key}
            style={{
              border: 0,
              background: period === p.key ? 'var(--surface)' : 'transparent',
              color: period === p.key ? 'var(--ink)' : 'var(--ink-muted)',
              fontSize: 'var(--type-fine)',
              fontWeight: period === p.key ? 'var(--weight-semibold)' : 'var(--weight-regular)',
              padding: '6px 13px',
              borderRadius: 'var(--rounded-pill)',
              cursor: 'pointer',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Week navigation, only while a week is selected. */}
      {period === 'week' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <button
            onClick={() => setWeekOffset(o => o + 1)}
            aria-label="Previous week"
            className="hit"
            style={{ background: 'transparent', border: 0, padding: 4 }}
          >
            <ChevronLeft size={18} color="var(--primary)" />
          </button>
          <span className="tnum" style={{ fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)' }}>
            Week of {localISODate(weekStart)}
          </span>
          <button
            onClick={() => setWeekOffset(o => Math.max(0, o - 1))}
            disabled={!canGoForward}
            aria-label="Next week"
            className="hit"
            style={{ background: 'transparent', border: 0, padding: 4, opacity: canGoForward ? 1 : 0.3 }}
          >
            <ChevronRight size={18} color="var(--primary)" />
          </button>
        </div>
      )}

      {totalSets === 0 ? (
        <div style={{ padding: '32px 0', textAlign: 'center' }}>
          <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)' }}>
            No workouts logged in this period.
          </p>
        </div>
      ) : (
        <>
          <BodyMap totals={totals} />

          <div className="hm-legend" style={{ justifyContent: 'center' }}>
            Less
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className={`bm-m l${i}`} style={{ width: 10, height: 10, borderRadius: 3 }} />
            ))}
            More
          </div>

          {/* Ranked regions */}
          <ul style={{ listStyle: 'none', margin: '18px 0 0', padding: 0 }}>
            {shown.map(({ region, sets }) => (
              <li key={region} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 'var(--type-subhead)' }}>{REGION_LABEL[region]}</span>
                  <span className="tnum" style={{ fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)' }}>
                    {Math.round(sets)} sets
                  </span>
                </div>
                <div style={{ height: 8, background: 'var(--fill)', borderRadius: 'var(--rounded-pill)', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${max > 0 ? Math.round((sets / max) * 100) : 0}%`,
                      height: '100%',
                      background: 'rgb(0, 140, 60)',
                      borderRadius: 'var(--rounded-pill)',
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>

          {hidden > 0 && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="btn-quiet"
              style={{ fontSize: 'var(--type-subhead)', marginTop: 4 }}
            >
              Show more ({hidden})
            </button>
          )}
          {expanded && ranked.length > SHOW_ALL && (
            <button
              onClick={() => setExpanded(false)}
              className="btn-quiet"
              style={{ fontSize: 'var(--type-subhead)', marginTop: 4 }}
            >
              Show less
            </button>
          )}

          {/* Untrained regions, stated plainly rather than left to a grey silhouette. */}
          {untrained.length > 0 && (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <p style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)', margin: '0 0 6px' }}>
                Not trained in this period
              </p>
              <p style={{ fontSize: 'var(--type-subhead)', margin: 0, color: 'var(--ink-muted)' }}>
                {untrained.map(r => REGION_LABEL[r]).join(', ')}
              </p>
            </div>
          )}

          {unattributed > 0 && (
            <p style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)', margin: '12px 0 0' }}>
              {Math.round(unattributed)} set{Math.round(unattributed) === 1 ? '' : 's'} could not be attributed to a
              muscle region and {Math.round(unattributed) === 1 ? 'is' : 'are'} excluded from the totals above.
            </p>
          )}
        </>
      )}
    </section>
  )
}
