// src/components/ActivityHeatmap.jsx
import { useMemo, useState } from 'react'
import { useColorScheme } from '../lib/useColorScheme'
import { dailyActivity, daysInMonths, heatLevel } from '../lib/stats'
import { formatDate, localISODate, monthLabel } from '../lib/utils'

/**
 * A GitHub-style activity grid over a trailing window.
 *
 * Six months rather than a year. The reference is a year, but this library has six weeks of
 * history, and a 12-month grid would be roughly 95% empty cells — a wall of grey that reads
 * as a broken widget. Six months is honest about the present and grows naturally;
 * HEATMAP_MONTHS is the single number to change once the history justifies more.
 *
 * Columns are weeks, rows are weekdays (Monday first). Every date here is derived on the
 * device clock — see the UTC note on localISODate in utils.js — because a UTC-derived grid
 * shifts a whole column near midnight and files Sunday's workout into the wrong week.
 */
export const HEATMAP_MONTHS = 6

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const CELL = 13
const GAP = 3
const PITCH = CELL + GAP

/** Green ramp per intensity level, light and dark. Level 0 is the empty-cell neutral. */
const LIGHT = ['var(--fill)', '#c8e6c9', '#81c784', '#4caf50', '#2e7d32', '#1b5e20']
const DARK = ['var(--fill)', '#1b4332', '#2d6a4f', '#40916c', '#52b788', '#74c69d']

export default function ActivityHeatmap({ sessions }) {
  const scheme = useColorScheme()
  const ramp = scheme === 'dark' ? DARK : LIGHT
  const [mode, setMode] = useState('sessions')
  const [hovered, setHovered] = useState(null)

  const days = useMemo(() => dailyActivity(sessions, daysInMonths(HEATMAP_MONTHS)), [sessions])

  const max = useMemo(() => Math.max(0, ...days.map(d => (mode === 'volume' ? d.volume : d.sessions))), [days, mode])

  /**
   * Pad the start so the first column begins on a Monday and the end so the last runs to
   * Sunday. Padding cells render as nothing at all and carry no tooltip — they are calendar
   * geometry, not data.
   */
  const weeks = useMemo(() => {
    if (days.length === 0) return []
    const first = new Date(`${days[0].date}T00:00:00`)
    const lead = (first.getDay() + 6) % 7
    const padded = [...Array.from({ length: lead }, () => null), ...days]
    while (padded.length % 7 !== 0) padded.push(null)
    const out = []
    for (let i = 0; i < padded.length; i += 7) out.push(padded.slice(i, i + 7))
    return out
  }, [days])

  /** Month labels above the first column that opens a new month. */
  const monthMarks = useMemo(() => {
    const marks = []
    let lastMonth = null
    weeks.forEach((week, i) => {
      const firstReal = week.find(Boolean)
      if (!firstReal) return
      const d = new Date(`${firstReal.date}T00:00:00`)
      if (d.getMonth() !== lastMonth) {
        marks.push({ index: i, label: monthLabel(d).slice(0, 3) })
        lastMonth = d.getMonth()
      }
    })
    return marks
  }, [weeks])

  const todayISO = localISODate()
  const totalSessions = days.reduce((n, d) => n + d.sessions, 0)
  const totalVolume = Math.round(days.reduce((n, d) => n + d.volume, 0))

  return (
    <section className="card" style={{ padding: 17, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
        <h2 style={{ fontSize: 'var(--type-headline)', fontWeight: 600, margin: 0 }}>Activity</h2>
        <div
          role="group"
          aria-label="Heatmap metric"
          style={{ display: 'inline-flex', background: 'var(--fill)', borderRadius: 'var(--rounded-pill)', padding: 2 }}
        >
          {['sessions', 'volume'].map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              style={{
                border: 0,
                background: mode === m ? 'var(--surface)' : 'transparent',
                color: mode === m ? 'var(--ink)' : 'var(--ink-muted)',
                fontSize: 'var(--type-fine)',
                fontWeight: mode === m ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                padding: '5px 11px',
                borderRadius: 'var(--rounded-pill)',
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Horizontally scrollable on narrow screens; the negative margin lets the grid bleed to
          the card edge so the scrollbar is not inset, while the padding keeps it aligned. */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', margin: '0 -17px', padding: '0 17px' }}>
        <div style={{ width: 'max-content', minWidth: '100%' }}>
          <div style={{ display: 'flex', marginLeft: 26, marginBottom: 4, height: 12, position: 'relative' }}>
            {monthMarks.map(m => (
              <span
                key={`${m.index}-${m.label}`}
                style={{
                  position: 'absolute',
                  left: m.index * PITCH,
                  fontSize: 'var(--type-fine)',
                  color: 'var(--ink-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                {m.label}
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ display: 'grid', gridTemplateRows: `repeat(7, ${CELL}px)`, gap: GAP, width: 20 }}>
              {WEEKDAYS.map((d, i) => (
                <span
                  key={d}
                  style={{
                    fontSize: 9,
                    color: 'var(--ink-muted)',
                    lineHeight: `${CELL}px`,
                    // Every other label, or seven of them crowd a 13px row.
                    visibility: i % 2 === 0 ? 'visible' : 'hidden',
                  }}
                >
                  {d}
                </span>
              ))}
            </div>

            <div style={{ display: 'flex', gap: GAP }}>
              {weeks.map((week, wi) => (
                <div key={wi} style={{ display: 'grid', gridTemplateRows: `repeat(7, ${CELL}px)`, gap: GAP }}>
                  {week.map((day, di) => {
                    if (!day) return <span key={di} style={{ width: CELL, height: CELL }} aria-hidden="true" />
                    const value = mode === 'volume' ? day.volume : day.sessions
                    const isToday = day.date === todayISO
                    return (
                      <span
                        key={day.date}
                        title={`${formatDate(day.date)} — ${day.sessions} session${day.sessions === 1 ? '' : 's'}, ${Math.round(day.volume)} kg`}
                        onMouseEnter={() => setHovered(day)}
                        onMouseLeave={() => setHovered(null)}
                        style={{
                          width: CELL,
                          height: CELL,
                          borderRadius: 3,
                          background: ramp[heatLevel(value, max)],
                          cursor: 'pointer',
                          // An outline rather than a fill: an untrained today is the same
                          // neutral as every other empty day and would otherwise vanish.
                          outline: isToday ? '2px solid var(--primary)' : 'none',
                          outlineOffset: '-1px',
                        }}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginTop: 12,
          fontSize: 'var(--type-fine)',
          color: 'var(--ink-muted)',
          minHeight: 18,
        }}
      >
        <span>
          {hovered
            ? `${formatDate(hovered.date)} · ${hovered.sessions} session${hovered.sessions === 1 ? '' : 's'} · ${Math.round(hovered.volume)} kg`
            : `${totalSessions} session${totalSessions === 1 ? '' : 's'} · ${totalVolume.toLocaleString()} kg in ${HEATMAP_MONTHS} months`}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          Less
          {ramp.map((c, i) => (
            <span key={i} style={{ width: 11, height: 11, borderRadius: 2, background: c }} />
          ))}
          More
        </span>
      </div>
    </section>
  )
}
