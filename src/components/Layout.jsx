// src/components/Layout.jsx
import { useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { House, Dumbbell, CalendarDays, ChartLine, ListChecks, LogOut } from 'lucide-react'
import RestTimer from './RestTimer'
import ConfirmDialog from './ConfirmDialog'

const navItems = [
  { to: '/', icon: House, label: 'Home' },
  { to: '/log', icon: Dumbbell, label: 'Log' },
  { to: '/history', icon: CalendarDays, label: 'History' },
  { to: '/analytics', icon: ChartLine, label: 'Progress' },
  { to: '/exercises', icon: ListChecks, label: 'Exercises' },
]

export default function Layout({ onSignOut, username }) {
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)

  return (
    <div
      style={{
        maxWidth: 520,
        margin: '0 auto',
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--canvas)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 8,
          paddingLeft: 'var(--gutter)',
          paddingRight: 8,
          minHeight: 44,
        }}
      >
        <span style={{ flex: 1, fontSize: 'var(--type-fine)', color: 'var(--ink-muted)' }}>
          {username ? `Signed in as ${username}` : ''}
        </span>
        <button
          onClick={() => setConfirmingSignOut(true)}
          aria-label="Sign out"
          className="btn-icon"
          style={{ width: 36, minWidth: 36, minHeight: 36 }}
        >
          <LogOut size={17} color="var(--ink-muted)" />
        </button>
      </header>

      {/* Page content. This is the scroll container, so the body never scrolls and
          the tab bar can stay fixed without a scroll listener. */}
      <main style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <Outlet />
      </main>

      <RestTimer />

      {/* Tab bar. The spec has no bottom tab bar; this stretches
          floating-sticky-bar, which is its only bottom-anchored blurred chrome. */}
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
          borderTop: '1px solid var(--line)',
          borderRadius: 0,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className="nav-item"
            style={({ isActive }) => ({
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              minHeight: 'var(--tab-bar-height)',
              color: isActive ? 'var(--primary)' : 'var(--ink-muted)',
              textDecoration: 'none',
              fontSize: 'var(--type-nav)',
              letterSpacing: 'var(--tracking-fine)',
              fontWeight: isActive ? 600 : 400,
              transition: 'color 0.15s',
            })}
          >
            <Icon size={22} strokeWidth={2} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <ConfirmDialog
        open={confirmingSignOut}
        title="Sign out?"
        message="Your data stays synced to your account. You'll need your username and password to get back in."
        confirmLabel="Sign Out"
        onCancel={() => setConfirmingSignOut(false)}
        onConfirm={() => {
          setConfirmingSignOut(false)
          onSignOut?.()
        }}
      />
    </div>
  )
}
