// src/App.jsx
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import SignIn from './components/SignIn'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import LogWorkout from './pages/LogWorkout'
import History from './pages/History'
import SessionDetail from './pages/SessionDetail'
import Exercises from './pages/Exercises'
import { syncFromCloud, clearLocalCache } from './lib/db'
import { restoreSession, signOut, verifySession } from './lib/auth'

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
  // Why the user is looking at the sign-in screen, when it is not simply their first
  // visit. An expired or revoked session should say so, rather than leaving them to
  // wonder why the app is suddenly empty.
  const [notice, setNotice] = useState(null)

  // Single place a session ends, so every path clears the same state and none of them
  // can leave the app showing signed-in chrome over a dead token.
  const endSession = useCallback(reason => {
    setSession(null)
    setReady(true)
    setNotice(reason ?? null)
  }, [])

  useEffect(() => {
    let cancelled = false
    // The token model has no cross-tab sign-in event, so this runs once per load.
    // It revalidates the stored token against the server rather than trusting
    // localStorage, since a token can be revoked or expire while still on disk.
    restoreSession().then(s => {
      if (cancelled) return
      setSession(s)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Pull the signed-in user's data down once per session. RLS scopes the query, so
  // this only ever returns the caller's own rows. Then re-validate: a token can expire
  // or be revoked between the initial restore and this sync, and the symptom would
  // otherwise be a silently empty dashboard.
  useEffect(() => {
    if (!session?.userId) return
    let cancelled = false
    ;(async () => {
      await syncFromCloud()
      if (cancelled) return
      if ((await verifySession()) === 'expired') {
        clearLocalCache(session.userId)
        endSession('Your session expired. Please sign in again.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [session?.userId, endSession])

  // Catch a session that dies while the tab is open. Reloading already handles this,
  // since restoreSession() validates on load — but a tab left open across a 30-day
  // expiry, or one whose session was revoked in another tab, would otherwise keep
  // rendering empty data. Re-checking on focus is cheap and bounds the damage to
  // however long the tab was in the background.
  useEffect(() => {
    if (!session?.userId) return
    const userId = session.userId
    const revalidate = () => {
      if (document.visibilityState === 'hidden') return
      verifySession().then(state => {
        if (state === 'expired') {
          clearLocalCache(userId)
          endSession('Your session expired. Please sign in again.')
        }
      })
    }
    document.addEventListener('visibilitychange', revalidate)
    window.addEventListener('focus', revalidate)
    return () => {
      document.removeEventListener('visibilitychange', revalidate)
      window.removeEventListener('focus', revalidate)
    }
  }, [session?.userId, endSession])

  // Supabase Auth used to push a change event here, so Layout could call sign-out
  // directly. There is no such event in the token model — sign-out is just local
  // state and a database delete — so this component has to be the one that ends the
  // session. Passing signOut straight through cleared the token but left `session`
  // set, and React kept rendering the signed-in router over an unauthenticated client.
  const handleSignOut = useCallback(async () => {
    // Read the id first: signOut() clears the in-memory user, and the cache key
    // needs it.
    const userId = session?.userId
    await signOut()
    clearLocalCache(userId)
    endSession(null)
  }, [session?.userId, endSession])

  if (!ready) return <div style={{ minHeight: '100dvh', background: 'var(--canvas)' }} />

  if (!session) {
    return (
      <SignIn
        notice={notice}
        onSignedIn={result => {
          setNotice(null)
          setSession(result)
        }}
      />
    )
  }

  return (
    <HashRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<Layout onSignOut={handleSignOut} username={session.username} />}>
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
