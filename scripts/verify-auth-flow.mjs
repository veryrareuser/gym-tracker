// End-to-end auth flow check: sign in, then sign out, in a real browser.
//
// This exists because the sign-out bug was invisible to every other test in the repo.
// The API side was always correct — the token really was revoked server-side — and
// lint, the build, and the RLS suite all passed. What failed was purely client-side
// state, and there were two separate faults:
//
//   1. supabase.rpc() returns a thenable PostgrestBuilder, not a Promise. Calling
//      .catch() on it throws a TypeError, which aborted sign-out before it cleared
//      anything, so the button looked inert.
//   2. Even with that fixed, nothing told React the session had ended. Supabase Auth
//      used to push a change event; the token model has none, so App.jsx has to be
//      the one that clears its own state.
//
// A unit test cannot catch either. Only driving the real DOM does.
//
// Usage:
//   $env:APP_URL   = "http://localhost:4173/gym-tracker/"   # a served build
//   $env:SB_USER   = "<a throwaway account's username>"
//   $env:SB_PASSWORD = "<its password>"
//   node scripts/verify-auth-flow.mjs
//
// Needs a real account, so do NOT point this at a real user: it signs in and out, and
// it asserts the local cache is emptied on the way out.

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_URL = process.env.APP_URL
const USER = process.env.SB_USER
const PASS = process.env.SB_PASSWORD

if (!APP_URL || !USER || !PASS) {
  console.error('Set APP_URL, SB_USER and SB_PASSWORD. See the top of this file.')
  process.exit(1)
}

function findBrowser() {
  const win = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
  return win.find(p => p && existsSync(p)) || null
}

const BROWSER = findBrowser()
if (!BROWSER) {
  console.error('No Chrome or Chromium found. Install one, or set BROWSER to its path.')
  process.exit(1)
}

const PORT = 9333
const profile = mkdtempSync(join(tmpdir(), 'gym-auth-'))
const browser = spawn(
  BROWSER,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function firstPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      if (r.ok) {
        const p = (await r.json()).find(t => t.type === 'page')
        if (p) return p
      }
    } catch {
      /* not listening yet */
    }
    await sleep(250)
  }
  throw new Error('The browser never exposed a debugging port')
}

const page = await firstPage()
const ws = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
const errors = []

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

await new Promise(r => ws.addEventListener('open', r))

ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) reject(new Error(JSON.stringify(m.error)))
    else resolve(m.result)
    return
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    errors.push(d.exception?.description || d.text)
  }
})

await send('Runtime.enable')
await send('Page.enable')

const evaluate = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed')
  return r.result.value
}

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

const snapshot = `JSON.stringify({
  text: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 140),
  token: localStorage.getItem('gym_token') ? 'present' : 'absent',
  keys: Object.keys(localStorage).join(' | '),
  hasSignIn: !!Array.from(document.querySelectorAll('button')).find(b => /sign in/i.test(b.textContent)),
  hasSignOut: !!document.querySelector('[aria-label="Sign out"]')
})`

// The sign-out control is an icon button carrying only an aria-label, so it has to be
// found by label rather than by text. It opens a confirm dialog before doing anything.
const clickSignOut = `(() => {
  const icon = document.querySelector('[aria-label="Sign out"]')
  if (!icon) return 'no sign-out control'
  icon.click()
  return 'clicked'
})()`

const confirmSignOut = `(() => {
  const dlg = document.querySelector('[role="alertdialog"]')
  if (!dlg) return 'no confirm dialog'
  const btn = Array.from(dlg.querySelectorAll('button')).find(b => /sign out/i.test(b.textContent))
  if (!btn) return 'dialog has no confirm button'
  btn.click()
  return 'confirmed'
})()`

const signIn = `(() => {
  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const inputs = document.querySelectorAll('input')
  setValue(inputs[0], ${JSON.stringify(USER)})
  setValue(inputs[1], ${JSON.stringify(PASS)})
  const btn = Array.from(document.querySelectorAll('button')).find(b => /sign in/i.test(b.textContent))
  if (!btn) return 'no sign-in button'
  btn.click()
  return 'submitted'
})()`

try {
  await send('Page.navigate', { url: APP_URL })
  await sleep(5000)

  console.log('1. starts signed out')
  let s = JSON.parse(await evaluate(snapshot))
  check('sign-in screen is showing', s.hasSignIn, s.text.slice(0, 50))
  check('no token in storage', s.token === 'absent', s.token)

  console.log('\n2. signs in')
  check('form submitted', (await evaluate(signIn)) === 'submitted')
  await sleep(5000)
  s = JSON.parse(await evaluate(snapshot))
  check('token stored', s.token === 'present', s.token)
  check('left the sign-in screen', !s.hasSignIn, s.text.slice(0, 50))
  check('shows the signed-in shell', /signed in as/i.test(s.text), s.text.slice(0, 50))
  check('sign-out control exists', s.hasSignOut, 'aria-label="Sign out"')
  console.log(`        storage: ${s.keys}`)

  console.log('\n3. signs out')
  check('clicked sign-out', (await evaluate(clickSignOut)) === 'clicked')
  await sleep(900)
  check('confirmed the dialog', (await evaluate(confirmSignOut)) === 'confirmed')
  await sleep(4000)
  s = JSON.parse(await evaluate(snapshot))
  check('token cleared', s.token === 'absent', s.token)
  check('back to the sign-in screen', s.hasSignIn, s.text.slice(0, 50))
  // Keys are `${base}:${userId}` — "sessions:<uuid>", not "gym_sessions:<uuid>". A
  // looser pattern would match nothing and pass without proving anything.
  check('this user\'s cache was cleared', !/(^|\| )(sessions|exercises):/.test(s.keys), s.keys || '(empty)')
  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  ws.close()
  browser.kill()
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
