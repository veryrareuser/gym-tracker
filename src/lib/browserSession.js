// Keep credentials and workout caches within this tab. GitHub Pages cannot issue
// HttpOnly cookies; a dedicated backend/origin is needed for that stronger boundary.
//
// APP_KEY is the list of keys sign-out clears, so that the next person at the keyboard
// does not inherit a half-finished workout. Anything the app stores persistently has to
// be in it.
//
// The stopwatch is deliberately outside APP_KEY. A workout's length belongs to the
// workout, not to whoever is holding the phone, and the user asked for the clock to keep
// counting until the session is saved — "not just when visible, even when I logged out".
// Signing out must not shorten a session that is still going. It holds a timestamp and
// a session id, and it is namespaced by account, so one account's timer can never be
// resumed by another. The durable record is the draft's started_at in the database,
// which is what carries the timer to a different device.
const APP_KEY = /^(gym_token|gym_account|gym_draft(?::.*)?|gym_sessions|gym_exercises|sessions(?::.*)?|exercises(?::.*)?)$/

// Pre-namespacing cache keys, from before caches were keyed by account. These are the only
// thing the sweep below may remove from localStorage.
//
// It deliberately excludes gym_draft*. removeLegacyData() runs on every app load, so when
// this matched the whole APP_KEY set it deleted the draft mirror in localStorage before
// LogWorkout could restore it — which silently defeated the feature that exists purely to
// survive the tab being closed. A draft is live workout data and must outlive a reload.
const LEGACY_KEY = /^(gym_sessions|gym_exercises|sessions|exercises)$/

export function clearBrowserData() {
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const storage = window[name]
      for (const key of Object.keys(storage)) if (APP_KEY.test(key)) storage.removeItem(key)
    } catch { /* Restricted browser storage. */ }
  }
}

/**
 * Remove only pre-namespacing leftovers from localStorage.
 *
 * Sign-out still wipes everything, drafts included, via clearBrowserData() — that is
 * deliberate. This runs on every load, and only exists to clean up keys that a previous
 * version of the app wrote without an account prefix.
 */
export function removeLegacyData() {
  try {
    for (const key of Object.keys(localStorage)) if (LEGACY_KEY.test(key)) localStorage.removeItem(key)
  } catch { /* Restricted browser storage. */ }
}
