// src/components/StatCards.jsx
import { Dumbbell, CalendarDays, Flame, TrendingUp } from 'lucide-react'
import { sessionsThisMonth, volumeLast30Days, weekStreak } from '../lib/stats'

/**
 * Four compact figures above the fold on the Stats page.
 *
 * All four are derived from real sessions. There is no body-weight figure here because the
 * app has never tracked body weight, and a card that renders 0 because nothing feeds it is
 * worse than no card.
 */
export default function StatCards({ sessions }) {
  const thisMonth = sessionsThisMonth(sessions)

  // A trailing 30 days, not the calendar month — the card is labelled "30d" for that reason,
  // and a window that resets on the 1st reads as a bug when it silently halves on that date.
  const volume30 = volumeLast30Days(sessions)

  const streak = weekStreak(sessions)

  const cards = [
    { label: 'Workouts', value: sessions.length, unit: 'total', icon: Dumbbell, color: 'var(--primary)' },
    { label: 'This month', value: thisMonth, unit: 'sessions', icon: CalendarDays, color: 'var(--primary)' },
    {
      label: 'Streak',
      value: streak,
      unit: streak === 1 ? 'week' : 'weeks',
      icon: Flame,
      color: 'var(--ink)',
    },
    {
      label: 'Volume 30d',
      value: Math.round(volume30),
      unit: 'kg',
      icon: TrendingUp,
      color: 'var(--primary)',
    },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
      {cards.map(({ label, value, unit, icon: Icon, color }) => (
        <div key={label} className="card" style={{ padding: '15px 6px', textAlign: 'center' }}>
          <Icon size={17} color={color} style={{ marginBottom: 7 }} aria-hidden="true" />
          <div
            className="tnum"
            style={{
              fontWeight: 600,
              lineHeight: 1.1,
              // "12,345" has to fit a quarter-width tile on a 320px phone.
              fontSize: value >= 10000 ? 'var(--type-subhead)' : 'var(--type-headline)',
            }}
          >
            {value.toLocaleString()}
          </div>
          <div style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)', marginTop: 2 }}>{unit}</div>
          <div style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>{label}</div>
        </div>
      ))}
    </div>
  )
}
