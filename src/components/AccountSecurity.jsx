import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { changePassword, revokeOtherSessions } from '../lib/auth'

export default function AccountSecurity({ onClose }) {
  const dialog = useRef(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { dialog.current.showModal() }, [])

  async function run(action, success) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      setCurrent('')
      setNext('')
      setConfirm('')
      setMessage(success)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  function submit(event) {
    event.preventDefault()
    if (next !== confirm) { setError('New passwords do not match.'); return }
    run(() => changePassword(current, next), 'Password changed. All other sessions have been signed out.')
  }

  return createPortal(
    <dialog ref={dialog} onClose={onClose} aria-labelledby="account-security-title"
      style={{ margin: 'auto', maxWidth: 360, width: 'calc(100% - 34px)', padding: 24, border: '1px solid var(--line)', borderRadius: 'var(--rounded-lg)', background: 'var(--surface)', color: 'var(--ink)' }}>
      <h2 id="account-security-title" style={{ fontSize: 'var(--type-headline)', marginBottom: 12 }}>Account security</h2>
      <form onSubmit={submit}>
        <label htmlFor="security-current">Current password</label>
        <input id="security-current" type="password" autoComplete="current-password" required value={current} onChange={e => setCurrent(e.target.value)} />
        <label htmlFor="security-next">New password</label>
        <input id="security-next" type="password" autoComplete="new-password" minLength={12} required value={next} onChange={e => setNext(e.target.value)} />
        <label htmlFor="security-confirm">Confirm new password</label>
        <input id="security-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} />
        <p style={{ fontSize: 'var(--type-fine)', color: 'var(--ink-muted)', margin: '8px 0 16px' }}>Use a unique password with at least 12 characters. Changing it signs out other sessions.</p>
        <button disabled={busy} className="btn-primary btn-block">Change password</button>
      </form>
      <button type="button" disabled={busy} className="btn-secondary btn-block" style={{ marginTop: 12 }}
        onClick={() => run(revokeOtherSessions, 'Other sessions signed out. This tab stays signed in.')}>
        Sign out other sessions
      </button>
      {error && <p role="alert" style={{ color: 'var(--destructive)', marginTop: 12 }}>{error}</p>}
      {message && <p role="status" style={{ marginTop: 12 }}>{message}</p>}
      <button type="button" onClick={onClose} className="btn-quiet btn-block" style={{ marginTop: 8 }}>Close</button>
    </dialog>, document.body,
  )
}
