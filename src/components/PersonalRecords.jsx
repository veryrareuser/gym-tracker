// src/components/PersonalRecords.jsx
import { Award } from 'lucide-react'

/**
 * One row per exercise: the heaviest set ever logged for it, with the reps achieved
 * at that weight and the date.
 *
 * Extracted so a friend's records render through exactly the same markup as your own.
 * The privacy difference is in the query, not the presentation — this component has no
 * idea whether the data came from your own sessions or someone else's, which is the
 * point. If the two ever drift apart visually, the comparison stops being honest.
 *
 * @param {Array<{key: string, name: string, weight: number, reps: number, date: string}>} records
 */
export default function PersonalRecords({ records, emptyText = 'No records yet.' }) {
  return (
    <section className="card" style={{ padding: 17, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Award size={18} color="var(--primary)" />
        <h2 style={{ fontSize: 'var(--type-headline)', fontWeight: 600, margin: 0 }}>Personal Records</h2>
      </div>
      {records.length === 0 ? (
        <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)', margin: 0 }}>{emptyText}</p>
      ) : (
        records.map((pr, i) => (
          <div
            key={pr.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 0',
              borderTop: i === 0 ? 'none' : '1px solid var(--line)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 400, fontSize: 'var(--type-subhead)' }}>{pr.name}</div>
              <div style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>{pr.date}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div className="tnum" style={{ fontWeight: 600, fontSize: 'var(--type-headline)', color: 'var(--ink)' }}>
                {pr.weight} kg
              </div>
              <div className="tnum" style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>
                {pr.reps} reps
              </div>
            </div>
          </div>
        ))
      )}
    </section>
  )
}
