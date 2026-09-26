// src/App.jsx
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState, lazy, Suspense } from 'react'
import PasswordGate from './components/PasswordGate'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import LogWorkout from './pages/LogWorkout'
import History from './pages/History'
import SessionDetail from './pages/SessionDetail'
import Exercises from './pages/Exercises'
import { syncFromCloud } from './lib/db'

// Recharts is the bulk of the bundle and only Progress needs it.
const Analytics = lazy(() => import('./pages/Analytics'))

const PASSWORD = '200740'
const AUTH_KEY = 'gym_auth'

function PageFallback() {
  return (
    <div style={{ padding: '80px 24px', textAlign: 'center', color: 'var(--ink-muted)' }}>Loading…</div>
  )
}

export default function App() {
  const [authed, setAuthed] = useState(() => localStorage.getItem(AUTH_KEY) === 'true')

  useEffect(() => {
    if (authed) syncFromCloud()
  }, [authed])

  function handleLogin(pw) {
    if (pw === PASSWORD) {
      localStorage.setItem(AUTH_KEY, 'true')
      setAuthed(true)
      return true
    }
    return false
  }

  if (!authed) return <PasswordGate onLogin={handleLogin} />

  return (
    <HashRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<Layout />}>
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
