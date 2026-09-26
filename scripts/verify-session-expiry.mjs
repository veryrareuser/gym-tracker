// Verifies that a session which dies while the tab is open produces a clear
// "session expired" message instead of a silently empty dashboard.
//
// A dead token is silent. RLS resolves an expired or revoked token to NULL, so every
// query returns zero rows and no error — an open tab would render an empty dashboard
// that is indistinguishable from a genuine "no workouts yet". Row counts cannot tell
// those apart, so the app asks the server via whoami() and shows a notice instead.
//
// Rather than expiring the session with a database update mid-run — which needs the
// browser and the database driven from separate processes at exactly the right moment —
// this intercepts the whoami response and returns []. That is what PostgREST returns for
// a token that no longer resolves, and it makes the test deterministic.
//
// Usage:
//   $env:APP_URL     = "http://localhost:4182/gym-tracker/"   # a served build
//   $env:SB_USER     = "<any real account>"
//   $env:SB_PASSWORD = "<its password>"
//   npm run verify:expiry
//
// Signs in and out on a throwaway browser profile, so it does not disturb a real
// session. It does create session rows, which expire on their own.
//
// Also asserts the inverse: a healthy session must survive the same re-validation, so a
// dropped connection can never be mistaken for an expiry and sign someone out.

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP = process.env.APP_URL
const USER = process.env.SB_USER
const PASS = process.env.SB_PASSWORD

if (!APP || !USER || !PASS) {
  console.error('Set APP_URL, SB_USER and SB_PASSWORD. See the top of this file.')
  process.exit(1)
}

const CHROME = 'C:\\Users\\carlo\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9455
const profile = mkdtempSync(join(tmpdir(), 'gym-exp-'))

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' })

const sleep = ms => new Promise(r => setTimeout(r, ms))
let page
for (let i = 0; i < 40 && !page; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
    if (r.ok) page = (await r.json()).find(t => t.type === 'page')
  } catch { /* not up yet */ }
  if (!page) await sleep(250)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
const errors = []
let hijack = false

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})

await new Promise(r => ws.addEventListener('open', r))
ws.addEventListener('message', async ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) reject(new Error(JSON.stringify(m.error)))
    else resolve(m.result)
    return
  }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails.exception?.description || '')
  }
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params
    if (hijack && /rpc\/whoami/.test(request.url)) {
      // Exactly what PostgREST returns for a token that no longer resolves: 200, [].
      await send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'content-type', value: 'application/json' },
          { name: 'access-control-allow-origin', value: '*' },
        ],
        body: Buffer.from('[]').toString('base64'),
      })
      return
    }
    await send('Fetch.continueRequest', { requestId })
  }
})

await send('Runtime.enable')
await send('Page.enable')
// Deliberately NOT enabling Fetch yet. Broad request interception from page load
// interfered with the sign-in POST itself, so it is armed only once signed in.

const evaluate = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed')
  return r.result.value
}

const snap = `JSON.stringify({
  text: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 220),
  token: localStorage.getItem('gym_token') ? 'present' : 'absent',
  status: (document.querySelector('[role="status"]')?.innerText || '').trim(),
  alerts: (document.querySelector('[role="alert"]')?.innerText || '').trim()
})`

let failures = 0
const check = (l, ok, d = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? `  (${d})` : ''}`)
}

await send('Page.navigate', { url: APP })
await sleep(5000)

console.log('1. sign in normally')
await evaluate(`(() => {
  const set = (el, v) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const i = document.querySelectorAll('input')
  set(i[0], ${JSON.stringify(USER)}); set(i[1], ${JSON.stringify(PASS)})
  Array.from(document.querySelectorAll('button')).find(b => /sign in/i.test(b.textContent)).click()
  return true
})()`)
await sleep(6000)
let s = JSON.parse(await evaluate(snap))
check('signed in', s.token === 'present', s.token === 'present' ? '' : s.text.slice(0, 80))
check('no notice on a healthy session', s.status === '', `status=${JSON.stringify(s.status)}`)

console.log('\n2. the server starts reporting the token as unknown…')
// Armed only now, and only for whoami, so nothing else is affected.
await send('Fetch.enable', { patterns: [{ urlPattern: '*/rest/v1/rpc/whoami*' }] })
hijack = true

console.log('3. user returns to the tab')
await evaluate(`window.dispatchEvent(new Event('focus')); true`)
await sleep(5000)
s = JSON.parse(await evaluate(snap))
check('token cleared from storage', s.token === 'absent', s.token)
check('returned to the sign-in screen', /sign in to your account/i.test(s.text), s.text.slice(0, 55))
check('an explanatory notice is shown', /session expired/i.test(s.status), `status=${JSON.stringify(s.status)}`)
check('presented as information, not an error', s.alerts === '', `alerts=${JSON.stringify(s.alerts)}`)
check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
console.log(`\n  final screen: ${s.text.slice(0, 130)}`)

console.log('\n4. a healthy session is NOT signed out by the same check')
// Guards the 'unknown' branch: a network error must never look like an expiry, or a
// wifi blip would sign the user out.
hijack = false
await send('Fetch.disable')
await evaluate(`(() => {
  const set = (el, v) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const i = document.querySelectorAll('input')
  set(i[0], ${JSON.stringify(USER)}); set(i[1], ${JSON.stringify(PASS)})
  Array.from(document.querySelectorAll('button')).find(b => /sign in/i.test(b.textContent)).click()
  return true
})()`)
await sleep(6000)
await evaluate(`window.dispatchEvent(new Event('focus')); true`)
await sleep(4000)
s = JSON.parse(await evaluate(snap))
check('still signed in after re-validation', s.token === 'present', s.token)
check('still on the signed-in shell', /signed in as/i.test(s.text), s.text.slice(0, 45))

ws.close()
chrome.kill()
try { rmSync(profile, { recursive: true, force: true }) } catch { /* best effort */ }
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
