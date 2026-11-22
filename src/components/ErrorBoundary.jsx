// src/components/ErrorBoundary.jsx
import { Component } from 'react'

/**
 * Last line of defence against a blank screen.
 *
 * A render error unmounts the whole tree unless it is caught here, and a blank screen on
 * a phone gives the user no back button, no sign-out, and no clue that their workouts are
 * still safe in the database. The boundary cannot fix the bug, but it can always offer a
 * way out. The bugs themselves are caught earlier by lint's no-undef rule and by the
 * data-dependent cases in verify:render.
 */
export function ErrorFallback({ onReload, onHistory }) {
  return (
    <div className="screen" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)' }}>
      <h1 className="screen-title">Something went wrong</h1>
      <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--type-subhead)' }}>
        This page could not be shown. Your workouts are safe.
      </p>
      <button onClick={onHistory} className="btn-primary btn-block" style={{ minHeight: 50, marginTop: 24 }}>
        Back to History
      </button>
      <button onClick={onReload} className="btn-secondary btn-block" style={{ minHeight: 50, marginTop: 8 }}>
        Reload the app
      </button>
    </div>
  )
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <ErrorFallback
        onReload={() => window.location.reload()}
        onHistory={() => {
          window.location.hash = '#/history'
          window.location.reload()
        }}
      />
    )
  }
}
