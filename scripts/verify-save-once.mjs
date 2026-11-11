// Checks that saving a workout once is enough.
//
//   $env:SB_USER = "zzroutine"        # a throwaway account
//   $env:SB_PASSWORD = "..."
//   node scripts/verify-save-once.mjs
//
// The claim: one tap on Save leaves the workout in History. Not "in the database" —
// in History, which is where you land and where you look.
//
// The bug it guards against: the workout was saved, the app went to History, and
// History did not have it. The workaround was to go back and press Save again.
//
// A throwaway account is needed; the SQL is in the header of
// scripts/verify-routine-return.mjs.
//
// The browser is driven over CDP, because the bug is about what the screen shows
// after the save, and only a real browser shows that.

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const PORT = 4197
const DEBUG_PORT = 4196
const BASE = '/gym-tracker/'
const ORIGIN = `http://127.0.0.1:${PORT}`
const USER = process.env.SB_USER
const PASS = process.env.SB_PASSWORD
const SB_URL = process.env.SB_URL
const SB_KEY = process.env.SB_KEY

if (!USER || !PASS || !SB_URL || !SB_KEY) {
  console.error('Set SB_USER, SB_PASSWORD, SB_URL and SB_KEY in this shell.')
  process.exit(1)
}

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

function findChrome() {
  const localAppData = process.env.LOCALAPPDATA || ''
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    localAppData && `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
    localAppData && `${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean)
  for (const path of candidates) if (existsSync(path)) return path
  return null
}

const chrome = findChrome()
if (!chrome) {
  console.error('No Chrome found.')
  process.exit(1)
}

const server = spawn(process.execPath, [join(root, 'scripts', 'serve-dist.mjs'), String(PORT)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stderr.on('data', chunk => process.stderr.write(`[server] ${chunk}`))

const profile = mkdtempSync(join(tmpdir(), 'gym-save-'))
let ws
let browser
let token = null
let nextId = 0
const pending = new Map()

const send = (method, params = {}, timeoutMs = 20000) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`${method} timed out`))
    }, timeoutMs)
    pending.set(id, {
      resolve: v => { clearTimeout(timer); resolve(v) },
      reject: e => { clearTimeout(timer); reject(e) },
    })
    ws.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'evaluate failed')
  }
  return r.result.value
}

const bodyText = `(() => (document.body.innerText || '').replace(/\\s+/g, ' ').trim())()`

const signIn = `(() => {
  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const inputs = document.querySelectorAll('input')
  if (inputs.length < 2) return 'no form'
  setValue(inputs[0], ${JSON.stringify(USER)})
  setValue(inputs[1], ${JSON.stringify(PASS)})
  const btn = Array.from(document.querySelectorAll('button')).find(b => /sign in/i.test(b.textContent))
  if (!btn) return 'no sign-in button'
  btn.click()
  return 'submitted'
})()`

/** Click the "Log without a routine" escape hatch. */
const clickWithoutRoutine = `(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => /Log without a routine/.test(b.innerText || ''))
  if (!btn) return 'no button'
  btn.click()
  return 'clicked'
})()`

/** Fill in the first set of the first card. */
const fillFirstSet = `(() => {
  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const weight = document.querySelector('input[aria-label^="Set 1 weight"]')
  const reps = document.querySelector('input[aria-label^="Set 1 reps"]')
  if (!weight || !reps) return 'no inputs'
  setValue(weight, '40'); setValue(reps, '10')
  return 'filled'
})()`

const clickSave = `(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => /Save Session/.test(b.innerText || ''))
  if (!btn) return 'no save button'
  if (btn.disabled) return 'save is disabled'
  btn.click()
  return 'clicked'
})()`

/**
 * The workout rows History is showing.
 *
 * Each row has a delete button labelled with the session's date, which is a stable
 * hook: the date is what matters here, and the row's own text is a block of numbers
 * and names.
 */
const historyRows = `(() => {
  const rows = Array.from(document.querySelectorAll('button[aria-label^="Delete session from"]'))
    .map(b => b.getAttribute('aria-label').replace('Delete session from ', ''))
  return JSON.stringify(rows)
})()`

const auth = t => ({
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'X-Session-Token': t,
  'Content-Type': 'application/json',
})

try {
  await sleep(700)

  browser = spawn(chrome, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=430,932',
    'about:blank',
  ], { stdio: 'ignore' })

  let target = null
  for (let i = 0; i < 40 && !target; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
      if (res.ok) {
        const list = await res.json()
        target = list.find(t => t.type === 'page' && !/^chrome-extension:/.test(t.url || ''))
      }
    } catch { /* not up yet */ }
    if (!target) await sleep(250)
  }
  if (!target) throw new Error('Chrome did not expose a debugging target')

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      if (m.error) reject(new Error(JSON.stringify(m.error)))
      else resolve(m.result)
    }
  })
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 430,
    height: 932,
    deviceScaleFactor: 1,
    mobile: true,
  })

  console.log('1. signs in')
  await send('Page.navigate', { url: `${ORIGIN}${BASE}` })
  await sleep(3000)
  check('the sign-in form was submitted', (await evaluate(signIn)) === 'submitted')
  await sleep(4500)
  token = await evaluate(`sessionStorage.getItem('gym_token')`)
  check('signed in', Boolean(token), token ? '' : 'no token — the account may be throttled')
  if (!token) throw new Error('sign-in failed')

  // A clean account, so what History shows is what this run wrote.
  await fetch(`${SB_URL}/rest/v1/exercise_logs?session_id=neq.__none__`, { method: 'DELETE', headers: auth(token) })
  await fetch(`${SB_URL}/rest/v1/workout_sessions?id=neq.__none__`, { method: 'DELETE', headers: auth(token) })

  console.log('\n2. logs a set')
  await evaluate(`location.hash = '#/log'`)
  await sleep(3000)
  check('the routine list is showing', await evaluate(`(() => /Pick a routine to log/.test(document.body.innerText || ''))()`))
  check('"Log without a routine" was clicked', (await evaluate(clickWithoutRoutine)) === 'clicked')
  await sleep(1500)
  check('a set was entered', (await evaluate(fillFirstSet)) === 'filled')
  await sleep(1200)

  console.log('\n3. presses Save once')
  check('Save was clicked', (await evaluate(clickSave)) === 'clicked')
  await sleep(5000)
  const text = await evaluate(bodyText)
  check('it went to History', /History|Logged|Workout/i.test(text) && !/Pick a routine to log/.test(text), text.slice(0, 120))

  console.log('\n4. the workout is in History')
  const rows = JSON.parse(await evaluate(historyRows))
  check('History shows a workout', rows.length > 0, JSON.stringify(rows))
  const today = await evaluate(`(() => {
    const d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  })()`)
  const listed = rows.includes(today)
  check('and it is today\'s', listed, `looking for ${today}, rows: ${JSON.stringify(rows)}`)

  console.log('\n5. and the row in the database says so')
  const res = await fetch(`${SB_URL}/rest/v1/workout_sessions?select=id,date,is_draft,routine_id&order=created_at.desc&limit=3`, { headers: auth(token) })
  const sessions = await res.json()
  check('one row was written', Array.isArray(sessions) && sessions.length === 1, JSON.stringify(sessions))
  if (Array.isArray(sessions) && sessions.length) {
    check('and it is a saved workout, not a draft', sessions[0].is_draft === false, `is_draft=${sessions[0].is_draft}`)
    check('dated today', sessions[0].date === today, `${sessions[0].date} vs ${today}`)
  }
} catch (error) {
  check('the browser run completed', false, error.message)
} finally {
  try { ws?.close() } catch { /* closed */ }
  try { browser?.kill() } catch { /* gone */ }
  server.kill()
  if (token) {
    await fetch(`${SB_URL}/rest/v1/workout_sessions?is_draft=eq.true`, { method: 'DELETE', headers: auth(token) })
  }
}

console.log(`\n${failures === 0 ? 'One save is enough.' : `${failures} FAILED.`}`)
process.exit(failures === 0 ? 0 : 1)
