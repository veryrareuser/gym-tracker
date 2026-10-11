// src/components/ActivityHeatmap.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { dailyActivity, daysInMonths } from '../lib/stats'
import { localISODate } from '../lib/utils'

/**
 * A GitHub-style activity grid, shaded by sessions or volume.
 *
 * Structure, cell size and shading follow openGym's Heatmap.jsx. Three things were wrong
 * with my first version and are worth recording, because each looked fine in isolation:
 *
 *   1. Cells were 13px. At 11px the whole six months fits a phone with room to spare, and
 *      13px forced a scroll that the visible scrollbar then clipped against the Sunday
 *      row. openGym hides the scrollbar entirely with `scrollbar-width: none`.
 *   2. Levels were `value / max`. With one 21-session day in the window, every other day
 *      landed in the bottom bucket and the grid read as almost empty. openGym takes
 *      quartiles of the values that are actually present, so the shape of the data
 *      survives an outlier.
 *   3. Five shade steps. Four reads cleanly; five is noise at this size.
 *
 * It opens scrolled to the right, because the interesting end of a heatmap is today.
 */
export const HEATMAP_MONTHS = 6

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function ActivityHeatmap({ sessions }) {
  const [mode, setMode] = useState('sessions')
  const wrapRef = useRef(null)

  const days = useMemo(() => dailyActivity(sessions, daysInMonths(HEATMAP_MONTHS)), [sessions])

  /**
   * Quartile thresholds over the days that actually have activity.
   *
   * Scaling to the maximum instead makes the grid a single bright cell among empties
   * whenever one day is much busier than the rest. Quantiles describe the distribution, so
   * the usual Tuesday still reads as "some" and a four-session Sunday reads as "most".
   */
  const thresholds = useMemo(() => {
    const values = days.map(d => (mode === 'volume' ? d.volume : d.sessions)).filter(v => v > 0).sort((a, b) => a - b)
    if (!values.length) return [0, 0, 0]
    const q = p => values[Math.min(values.length - 1, Math.floor(p * values.length))]
    return [q(0.25), q(0.5), q(0.75)]
  }, [days, mode])

  const levelOf = value => {
    if (!value) return 0
    const [t1, t2, t3] = thresholds
    if (value >= t3) return 4
    if (value >= t2) return 3
    if (value >= t1) return 2
    return 1
  }

  /**
   * Columns of seven, padded so the first column opens on a Monday and the last ends on a
   * Sunday. Padding cells are blank spacers with no tooltip — calendar geometry, not data.
   */
  const { columns, months } = useMemo(() => {
    if (!days.length) return { columns: [], months: [] }
    const lead = (new Date(`${days[0].date}T00:00:00`).getDay() + 6) % 7
    const padded = [...Array.from({ length: lead }, () => null), ...days]
    while (padded.length % 7 !== 0) padded.push(null)

    const cols = []
    const labels = []
    let lastMonth = -1
    for (let i = 0; i < padded.length; i += 7) {
      const week = padded.slice(i, i + 7)
      const firstReal = week.find(Boolean)
      // Label the column where a month begins, but only in the first week of it, so labels
      // never collide on a short month.
      const d = new Date(`${firstReal.date}T00:00:00`)
      const showMonth = d.getMonth() !== lastMonth && d.getDate() <= 7
      if (d.getDate() <= 7) lastMonth = d.getMonth()
      labels.push(<span key={i}>{showMonth ? MONTH_ABBR[d.getMonth()] : ''}</span>)
      cols.push(week)
    }
    return { columns: cols, months: labels }
  }, [days])

  // Open at the right-hand end, where today is.
  useEffect(() => {
    if (wrapRef.current) wrapRef.current.scrollLeft = wrapRef.current.scrollWidth
  }, [columns.length])

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

      <div className="hm-wrap" ref={wrapRef}>
        <div className="hm-months" style={{ marginInlineStart: 30 }}>{months}</div>
        <div className="hm-body">
          <div className="hm-days">
            {['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((label, i) => (
              <span key={i}>{label}</span>
            ))}
          </div>
          <div className="hm-grid">
            {columns.map((week, wi) => (
              <div key={wi} className="hm-col">
                {week.map((day, di) => {
                  if (!day) return <div key={di} className="hm-c" style={{ opacity: 0 }} />
                  const value = mode === 'volume' ? day.volume : day.sessions
                  const isFuture = day.date > todayISO
                  const cls =
                    `hm-c l${levelOf(value)}` +
                    (day.date === todayISO ? ' today' : '') +
                    (isFuture ? ' future' : '')
                  const label = isFuture
                    ? day.date
                    : `${day.date} · ${day.sessions} session${day.sessions === 1 ? '' : 's'} · ${Math.round(day.volume)} kg`
                  return <div key={day.date} className={cls} title={label} />
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="hm-legend">
        {`${totalSessions} session${totalSessions === 1 ? '' : 's'} · ${totalVolume.toLocaleString()} kg in ${HEATMAP_MONTHS} months`}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginInlineStart: 'auto' }}>
          Less
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className={`hm-c l${i}`} />
          ))}
          More
        </span>
      </div>
    </section>
  )
}
