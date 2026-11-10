// The service worker.
//
// Generated at build time by the gym-service-worker plugin in vite.config.js, which
// writes the list of built assets into the precache manifest. That is why this file is
// not a static copy in public/: the asset filenames are content-hashed, so they are not
// known until the bundle exists.
//
// What it caches, and why
// ----------------------
// The app shell — index.html, the manifest, the icons — and the built JavaScript and
// CSS. Those are what the app needs to start, and caching them is what makes a repeat
// launch instant and the app work with no signal at all.
//
// It does NOT cache the Supabase API. That is not an oversight: an API response is
// someone's training data, it is scoped to whoever was signed in when it was fetched,
// and serving one to a different session would show the wrong person's workouts. The
// requests are passed straight through to the network.
//
// The images come from GitHub's CDN rather than from this origin, and the picker asks
// for sixty of them at once. They are immutable — the path contains the file's own
// identifier — so they are cached on first sight and never revalidated.
//
// The stale-index problem
// ----------------------
// GitHub Pages can serve a cached index.html for up to ten minutes after a deploy, and
// that index.html points at the hashed assets the deploy deleted. The page then loads
// the old HTML and the new assets do not exist, which is a blank screen.
//
// A service worker can make that permanent: caching index.html and serving it
// cache-first would keep handing out the old HTML, pointing at deleted files, forever.
//
// So navigation requests are network-first. The browser always gets the current
// index.html when there is a network, and the cached one only when there is not. The
// hashed assets are the opposite — cache-first, because a hashed filename means the
// content behind it never changes.
//
// The update sequence
// ------------------
// A new deploy produces a new sw.js with a new cache name. It installs and precaches
// alongside the old one, then waits for every open tab to close before activating and
// deleting the old cache. That ordering matters: a tab still running the old build
// needs the old chunks, and deleting them out from under it would break a lazy route
// that had not loaded yet.

const CACHE_PREFIX = 'gym-tracker-'
const VERSION = '__VERSION__'
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`

// The app shell and the built assets, merged. The shell is what the app needs before
// it can run at all; the assets are what it then loads.
const PRECACHE = __PRECACHE__

// The images the exercise picker shows. They come from a third-party CDN and never
// change, so they are worth keeping.
const IMAGE_HOST = 'raw.githubusercontent.com'

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      // Individually, so one failure cannot abandon the whole install.
      await Promise.all(
        PRECACHE.map(url =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      )
      // No skipWaiting: the new worker waits for the open tabs to close, so a page
      // still running the old build keeps the chunks it needs.
    })()
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // The previous build's cache is kept, and only the ones before it are deleted.
      //
      // GitHub Pages serves index.html with a ten-minute cache, so a browser can hold
      // the OLD index.html after a deploy — and that HTML points at the assets the
      // previous build produced, which the deploy deleted. If the previous build's
      // cache is still here, those requests are served from it and the app opens
      // normally instead of showing a blank page.
      //
      // The cache names carry a build timestamp, so they sort by age and "the most
      // recent other one" is the previous build rather than an arbitrary one.
      const names = (await caches.keys())
        .filter(name => name.startsWith(CACHE_PREFIX))
        .sort()
      const others = names.filter(name => name !== CACHE_NAME)
      const keep = others.length ? others[others.length - 1] : null
      await Promise.all(others.filter(name => name !== keep).map(name => caches.delete(name)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // The API is never cached. Signed-in training data, scoped to one session, must not
  // be served to another.
  if (url.origin !== self.location.origin) {
    if (url.hostname === IMAGE_HOST) {
      event.respondWith(cacheFirst(request, CACHE_NAME))
    }
    return
  }

  // A page load. Network-first, so a deploy is picked up immediately rather than
  // waiting for the browser's own cache to expire, and the cached copy is the offline
  // fallback.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, CACHE_NAME, PRECACHE.find(u => u.endsWith('/')) || '/'))
    return
  }

  // Hashed assets. The filename is the hash, so the content behind it cannot change.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(request, CACHE_NAME))
    return
  }

  // Everything else this origin serves: the manifest, the icons, the exercise index.
  event.respondWith(staleWhileRevalidate(request, CACHE_NAME))
})

/**
 * Serve from the cache when it is there, and fetch and store it when it is not.
 *
 * The current build's cache is checked first, and the previous build's cache second.
 * The second lookup is what makes keeping the previous cache worth anything: a
 * browser can hold a stale index.html for up to ten minutes after a deploy, and that
 * HTML points at the assets the previous build produced, which the deploy deleted.
 * Without this, those requests would 404 and the app would show a blank page.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit

  // The previous build's assets, if this request is for one of them.
  const previous = await matchOlderCache(request)
  if (previous) return previous

  const response = await fetch(request)
  if (response && (response.ok || response.type === 'opaque')) {
    cache.put(request, response.clone()).catch(() => {})
  }
  return response
}

/**
 * Look for a request in the older builds' caches.
 *
 * Only the older ones: the current cache is checked by the caller, and a request
 * that is not in it is not in this build either.
 */
async function matchOlderCache(request) {
  const names = (await caches.keys())
    .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
    .sort()
  for (const name of names.reverse()) {
    const cache = await caches.open(name)
    const hit = await cache.match(request)
    if (hit) return hit
  }
  return null
}

/**
 * Serve the cached copy when there is one, and update it in the background.
 *
 * The cached copy is returned immediately, which is what makes a repeat launch feel
 * instant, and the refresh keeps the next one current.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  const network = fetch(request)
    .then(response => {
      if (response && response.ok) cache.put(request, response.clone()).catch(() => {})
      return response
    })
    .catch(() => null)
  return hit || (await network) || (await matchOlderCache(request)) || Response.error()
}

/**
 * Go to the network first, and fall back to the cache when there is no network.
 *
 * Used for page loads, so that a deploy is picked up straight away rather than being
 * masked by a cached index.html.
 */
async function networkFirst(request, cacheName, fallbackPath) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response && response.ok) cache.put(request, response.clone()).catch(() => {})
    return response
  } catch {
    const hit = (await cache.match(request)) || (await cache.match(fallbackPath))
    if (hit) return hit
    // The previous build's shell, if this build's is not there.
    const older = (await matchOlderCache(request)) || (await matchOlderCache(fallbackPath))
    if (older) return older
    return Response.error()
  }
}
