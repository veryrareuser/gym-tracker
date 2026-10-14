// Keep credentials and workout caches within this tab. GitHub Pages cannot issue
// HttpOnly cookies; a dedicated backend/origin is needed for that stronger boundary.
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
