// src/components/Layout.jsx
import { Outlet, NavLink } from 'react-router-dom'
import { House, Dumbbell, CalendarDays, ChartLine, ListChecks } from 'lucide-react'
import RestTimer from './RestTimer'

const navItems = [
  { to: '/', icon: House, label: 'Home' },
  { to: '/log', icon: Dumbbell, label: 'Log' },
  { to: '/history', icon: CalendarDays, label: 'History' },
  { to: '/analytics', icon: ChartLine, label: 'Progress' },
  { to: '/exercises', icon: ListChecks, label: 'Exercises' },
]

export default function Layout() {
  return (
    <div
      style={{
        maxWidth: 520,
        margin: '0 auto',
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg)',
      }}
    >
      {/* Page content. This is the scroll container, so the body never scrolls and
          the tab bar can stay fixed without a scroll listener. */}
      <main style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <Outlet />
      </main>

      <RestTimer />

      {/* Tab bar. Frozen material, lightly tinted, sits over content. */}
      <nav
        className="glass"
        style={{
          position: 'fixed',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          maxWidth: 520,
          zIndex: 100,
          display: 'flex',
          borderTop: '1px solid var(--color-border)',
          borderRadius: 0,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            style={({ isActive }) => ({
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              // 49pt of content plus safe area matches the iOS tab bar height.
              minHeight: 'var(--tab-bar-height)',
              paddingTop: 6,
              color: isActive ? 'var(--color-accent)' : 'var(--color-muted)',
              textDecoration: 'none',
              fontSize: 'var(--type-min)',
              fontWeight: isActive ? 600 : 500,
              transition: 'color 0.15s',
            })}
          >
            <Icon size={24} strokeWidth={2} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
