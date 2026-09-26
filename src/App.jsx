// src/App.jsx
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState, lazy, Suspense } from 'react'
import SignIn from './components/SignIn'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import LogWorkout from './pages/LogWorkout'
import History from './pages/History'
import SessionDetail from './pages/SessionDetail'
import Exercises from './pages/Exercises'
import { syncFromCloud } from './lib/db'
import { getSession, onAuthChange, signOut } from './lib/auth'

// Recharts is the bulk of the bundle and only Progress needs it.
const Analytics = lazy(() => import('./pages/Analytics'))

function PageFallback() {
  return <div style={{ padding: '80px 24px', textAlign: 'center', color: 'var(--ink-muted)' }}>Loading…</div>
}

export default function App() {
  // null means "not resolved yet", which is distinct from "resolved as signed out".
  // Rendering the sign-in screen during that gap would flash it on every reload.
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    getSession().then(s => {
      if (cancelled) return
      setSession(s)
      setReady(true)
    })
    const unsubscribe = onAuthChange(s => {
      setSession(s)
      setReady(true)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  // Pull the signed-in user's data down once per session. RLS scopes the query, so
  // this only ever returns the caller's own rows.
  useEffect(() => {
    if (session?.user?.id) syncFromCloud()
  }, [session?.user?.id])

  if (!ready) return <div style={{ minHeight: '100dvh', background: 'var(--canvas)' }} />

  if (!session) {
    return (
      <SignIn
        onSignedIn={result => {
          setSession({ user: result.user, username: result.username })
        }}
      />
    )
  }

  return (
    <HashRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<Layout onSignOut={signOut} username={session.username} />}>
            <Route index element={<Dashboard />} />
            <Route path="log" element={<LogWorkout />} />
            <Route path="log/:sessionId" element={<LogWorkout />} />
            <Route path="history" element={<History />} />
            <Route path="history/:sessionId" element={<SessionDetail />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="exercises" element={<Exercises />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  )
}
