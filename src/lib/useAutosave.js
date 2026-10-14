// src/lib/useAutosave.js
import { useCallback, useEffect, useRef, useState } from 'react'
import { saveSession } from './db'

/**
 * Keeps an in-progress workout in Postgres while you type.
 *
 * Saving manually is the wrong default for this app. The failure it is meant to prevent is
 * closing the app mid-set, and on a phone that is not a user decision — the OS kills a
 * backgrounded tab, iOS reclaims memory, a swipe dismisses the app. `beforeunload` does
 * not fire in any of those cases, so a prompt cannot be relied on. Writing the data out is
 * the only thing that survives.
 *
 * Three triggers, because each covers a case the others miss:
 *
 *   - a debounce after typing stops, so the common case is not a request per keystroke
 *   - visibilitychange -> hidden, which is the one lifecycle event a phone reliably
 *     delivers before an app is backgrounded or killed
 *   - pagehide, the back/forward and tab-close path on desktop
 *
 * Failures are swallowed deliberately. Autosave is a safety net; if the network is down,
 * the local draft mirror is still there and the next trigger will try again. Surfacing an
 * error the user cannot act on — mid-workout, mid-set — would be worse than silence.
 */

/** Quiet period after the last edit before a draft is written. */
const DEBOUNCE_MS = 3000

/**
 * @param session  the workout to persist, or null when there is nothing worth saving
 * @param options.enabled  false disables autosave entirely
 * @returns {{ saving: boolean, lastSavedAt: number|null, failed: boolean }}
 */
export default function useAutosave(session, { enabled = true } = {}) {
  // 'saving' | 'saved' | 'failed' | null. Distinct from `saving: boolean` because the UI
  // must not claim success while the request is in flight.
  const [state, setState] = useState(null)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [error, setError] = useState(null)

  const timerRef = useRef(null)
  const inFlightRef = useRef(false)
  // Read inside the handlers below, which are installed once. Holding the session in a ref
  // keeps the debounce from being torn down and rebuilt on every keystroke, which would
  // otherwise restart the countdown and never fire.
  //
  // Written in an effect rather than during render: assigning a ref while rendering is a
  // side effect React is free to discard, and the value the handlers read would then
  // depend on whether this render happened to commit.
  const sessionRef = useRef(session)
  useEffect(() => {
    sessionRef.current = session
  }, [session])

  const flush = useCallback(async () => {
    const current = sessionRef.current
    if (!enabled || !current || inFlightRef.current) return
    // A draft with no logged set and no note is not a workout yet. Same rule the local
    // mirror uses, so opening the page alone never creates a cloud draft.
    const hasContent =
      current.exercise_logs.some(l => l.set_entries.some(s => s.weight || s.reps)) ||
      (current.notes || '').trim().length > 0
    if (!hasContent) return

    inFlightRef.current = true
    setState('saving')
    try {
      await saveSession(current, { draft: true })
      setLastSavedAt(Date.now())
      setError(null)
      setState('saved')
    } catch (err) {
      // The failure is recorded and shown as "Not saved" rather than swallowed. Swallowing
      // it is how this shipped broken: the chip read "Saved" because it showed during the
      // attempt, so a write that never landed looked identical to one that did.
      setError(err)
      setState('failed')
    } finally {
      inFlightRef.current = false
    }
  }, [enabled])

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, DEBOUNCE_MS)
  }, [flush])

  // The debounce target changes whenever the caller hands us a new session object, which
  // is every edit. Re-arming here is the whole trigger.
  useEffect(() => {
    if (enabled && session) schedule()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [session, enabled, schedule])

  // The phone case. `hidden` is delivered when the app is backgrounded, which on iOS can
  // be the last moment the page is allowed to run.
  useEffect(() => {
    if (!enabled) return undefined
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        if (timerRef.current) clearTimeout(timerRef.current)
        flush()
      }
    }
    const onPageHide = () => flush()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [enabled, flush])

  return { state, saving: state === 'saving', saved: state === 'saved', failed: state === 'failed', lastSavedAt, error }
}
