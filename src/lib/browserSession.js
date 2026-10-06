// Keep credentials and workout caches within this tab. GitHub Pages cannot issue
// HttpOnly cookies; a dedicated backend/origin is needed for that stronger boundary.
const APP_KEY = /^(gym_token|gym_account|gym_draft(?::.*)?|gym_sessions|gym_exercises|sessions(?::.*)?|exercises(?::.*)?)$/

export function clearBrowserData() {
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const storage = window[name]
      for (const key of Object.keys(storage)) if (APP_KEY.test(key)) storage.removeItem(key)
    } catch { /* Restricted browser storage. */ }
  }
}

export function removeLegacyData() {
  try {
    for (const key of Object.keys(localStorage)) if (APP_KEY.test(key)) localStorage.removeItem(key)
  } catch { /* Restricted browser storage. */ }
}
