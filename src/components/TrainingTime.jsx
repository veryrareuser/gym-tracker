// src/components/TrainingTime.jsx
import { Clock } from 'lucide-react'
import { totalDurationSeconds, measuredSessionCount, averageDurationSeconds } from '../lib/stats'
import { formatHoursDecimal, formatDuration } from '../lib/utils'

/**
 * The cumulative time trained.
 *
 * The total is in decimal hours, because that is the number that answers "how much have
 * I put in" — 43.8 hours is a quantity, and 43h 48m is a clock reading. The per-session
 * figures below it are the other way round, because a session's length is a span of time
 * that people say as "1h 45m".
 *
 * Only sessions that carry a measurement are counted. A workout logged before the
 * stopwatch existed has no duration; treating that as zero would quietly understate the
 * total, and the average would be dragged down by sessions that were never timed.
 */
export default function TrainingTime({ sessions }) {
  const total = totalDurationSeconds(sessions)
  const measured = measuredSessionCount(sessions)
  const average = averageDurationSeconds(sessions)

  return (
    <section className="card" style={{ padding: 17, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Clock size={18} color="var(--primary)" />
        <h2 style={{ fontSize: 'var(--type-headline)', fontWeight: 600, margin: 0 }}>Total time</h2>
      </div>

      {measured === 0 ? (
        <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)' }}>
          No timed sessions yet.
        </p>
      ) : (
        <>
          <div className="tnum" style={{ fontSize: 'var(--type-display)', fontWeight: 600, lineHeight: 1.1 }}>
            {formatHoursDecimal(total)}
            <span style={{ fontSize: 'var(--type-subhead)', fontWeight: 400, color: 'var(--ink-muted)', marginLeft: 6 }}>
              hours
            </span>
          </div>

          <div style={{ display: 'flex', gap: 20, marginTop: 14 }}>
            <div>
              <div className="tnum" style={{ fontWeight: 600, fontSize: 'var(--type-headline)' }}>
                {formatDuration(average)}
              </div>
              <div style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>avg session</div>
            </div>
            <div>
              <div className="tnum" style={{ fontWeight: 600, fontSize: 'var(--type-headline)' }}>
                {measured}
              </div>
              <div style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>timed sessions</div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
