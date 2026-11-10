// Exercises the service worker in a real browser.
//
//   node scripts/verify-sw.mjs
//
// The service worker's whole job is to behave correctly at the edges, and every one of
// those edges is invisible to a unit test: whether it registers at all, whether the
// second load comes from the cache, whether a page load survives the network being
// gone, and — the important one — whether it ever hands the API a cached response.
//
// The last one is a correctness question, not a performance one. A cached API response
// is signed-in training data, and serving it to a different session would show the
// wrong person's workouts. So this test asserts the API is never cached, by asking the
// browser what is actually in the cache.
//
// It drives headless Chrome over CDP, the same way the other browser suites here do.

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const PORT = 4179
// A port of its own, well away from the app server's and from anything else the
// other browser suites use. Chrome's debugging port is what this one is for, and
// pointing a fetch at the wrong port returns the app's HTML instead of the target
// list, which is a confusing way to fail.
const DEBUG_PORT = 4187
const BASE = '/gym-tracker/'
// 127.0.0.1 rather than localhost: the browser's debugging port binds to the IPv4
// loopback only, and "localhost" can resolve to ::1 on a dual-stack machine.
const ORIGIN = `http://127.0.0.1:${PORT}`

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

/* ── A minimal CDP client over the DevTools WebSocket ── */

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    return new Cdp(ws)
  }

  /**
   * Send a command and wait for its answer.
   *
   * The timeout is not optional. A browser that never answers — a service worker that
   * never becomes ready, a page that never finishes evaluating — would otherwise hang
   * the suite forever instead of failing it.
   */
  send(method, params = {}, timeoutMs = 15000) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: v => { clearTimeout(timer); resolve(v) },
        reject: e => { clearTimeout(timer); reject(e) },
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async eval(expression, timeoutMs = 15000) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs)
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || 'evaluate failed')
    }
    return res.result.value
  }
}

/* ── Chrome ── */

function findChrome() {
  const localAppData = process.env.LOCALAPPDATA || ''
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    // The per-user install, which is where Chrome lands on a machine set up without
    // administrator rights.
    localAppData && `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
    localAppData && `${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  for (const path of candidates) if (existsSync(path)) return path
  return null
}

const chrome = findChrome()
if (!chrome) {
  console.error('No Chrome found. Set CHROME_PATH to the browser binary.')
  process.exit(1)
}

/* ── The server and the browser ── */

const server = spawn(process.execPath, [join(root, 'scripts', 'serve-dist.mjs'), String(PORT)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
})
// Surfaced rather than ignored, so a server that fails to start says why instead of
// leaving the browser to time out against a port nobody is listening on.
server.stderr.on('data', chunk => process.stderr.write(`[server] ${chunk}`))

const profile = mkdtempSync(join(tmpdir(), 'gym-sw-'))
let cdp
let browser

try {
  await sleep(700)

  browser = spawn(chrome, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ], { stdio: 'ignore' })

  let target = null
  let lastError = null
  for (let i = 0; i < 40 && !target; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
      if (res.ok) {
        const list = await res.json()
        // A page target, and not one of the extension pages Chrome starts with.
        target = list.find(t => t.type === 'page' && !/^chrome-extension:/.test(t.url || ''))
      }
    } catch (err) {
      lastError = err.message
    }
    if (!target) await sleep(250)
  }
  if (!target) throw new Error(`Chrome did not expose a debugging target (${lastError || 'no page target'})`)

  cdp = await Cdp.connect(target.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Network.enable')

  console.log('Service worker\n')

  // --- 1. the page loads and the worker registers ---
  await cdp.send('Page.navigate', { url: `${ORIGIN}${BASE}` })
  await sleep(3000)

  const registered = await cdp.eval(`(async () => {
    const regs = await navigator.serviceWorker.getRegistrations()
    return regs.map(r => r.scope)
  })()`)
  check('the service worker registers', Array.isArray(registered) && registered.length > 0, (registered || []).join(', '))

  // --- 2. the cache holds the app shell and the built assets ---
  const cached = await cdp.eval(`(async () => {
    const names = await caches.keys()
    const out = {}
    for (const name of names) {
      const cache = await caches.open(name)
      const keys = await cache.keys()
      out[name] = keys.map(r => new URL(r.url).pathname)
    }
    return out
  })()`)
  const cacheNames = Object.keys(cached || {})
  check('a cache exists', cacheNames.length > 0, cacheNames.join(', '))

  const everything = Object.values(cached || {}).flat()
  check('the app shell is cached',
    everything.includes(BASE) || everything.includes(`${BASE}index.html`),
    `${everything.length} entries`)
  check('the built javascript is cached',
    everything.some(p => p.endsWith('.js') && p.includes('/assets/')),
    everything.filter(p => p.endsWith('.js')).join(', '))
  check('the exercise index is cached', everything.includes(`${BASE}exercises-index.json`))

  // --- 3. the API is never cached ---
  const apiCached = everything.filter(p => /supabase|rest\/v1|\/rpc\//.test(p))
  check('no API response is cached', apiCached.length === 0, apiCached.join(', '))

  // --- 3a. the cache name carries the build time ---
  // The worker keeps the previous build's cache so a browser holding a stale
  // index.html can still fetch the assets it points at. That needs the cache names
  // to sort by age, which means the name has to start with a timestamp.
  check(
    'the cache name is timestamp-prefixed, so caches sort by age',
    cacheNames.every(name => /^gym-tracker-\d{13}-/.test(name)),
    cacheNames.join(', '),
  )

  // --- 3b. the previous build's assets are still served ---
  // GitHub Pages serves index.html with a ten-minute cache, so a browser can hold the
  // OLD index.html after a deploy — and that HTML points at the assets the previous
  // build produced, which the deploy deleted. The worker keeps the previous build's
  // cache for exactly this, and serves from it.
  //
  // Planted here rather than simulated with two deploys: an older-named cache with a
  // file the current build does not have. Requesting that file must be answered from
  // the older cache rather than 404.
  const older = await cdp.eval(`(async () => {
    const old = 'gym-tracker-1000000000000-planted'
    const c = await caches.open(old)
    await c.put('${BASE}assets/planted-old-build.js', new Response('// an old build'))
    const res = await fetch('${BASE}assets/planted-old-build.js')
    return { status: res.status, body: await res.text() }
  })()`)
  check(
    'an asset from the previous build is still served',
    older && older.status === 200 && older.body.includes('an old build'),
    JSON.stringify(older),
  )

  // --- 4. a cached file is served ---
  const served = await cdp.eval(`(async () => {
    const res = await fetch('${BASE}exercises-index.json')
    return { status: res.status, len: (await res.text()).length }
  })()`)
  check('the exercise index is served', served && served.status === 200 && served.len > 1000, JSON.stringify(served))

  // --- 5. the app still works with the network gone ---
  await cdp.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  })
  const offline = await cdp.eval(`(async () => {
    try {
      const res = await fetch('${BASE}exercises-index.json')
      return { status: res.status, len: (await res.text()).length }
    } catch (e) { return { error: String(e) } }
  })()`)
  check('a cached file is still served offline', offline && offline.status === 200 && offline.len > 1000, JSON.stringify(offline))

  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
} catch (error) {
  check('the browser run completed', false, error.message)
} finally {
  try { if (cdp) cdp.ws.close() } catch { /* already closed */ }
  try { if (browser) browser.kill() } catch { /* already gone */ }
  server.kill()
}

console.log(`\n${failures === 0 ? 'The service worker behaves.' : `${failures} FAILED.`}`)
process.exit(failures === 0 ? 0 : 1)
