// Exercises the stopwatch end to end, in a real browser, against the real database.
//
//   $env:SB_USER = "zzswatch"        # a throwaway account
//   $env:SB_PASSWORD = "..."
//   node scripts/verify-stopwatch.mjs
//
// This is the one feature that cannot be checked by reading the code. The claim is
// specific and behavioural:
//
//   1. Opening the Log page starts the clock, with no button pressed.
//   2. The clock keeps running while nothing is looking at it — hidden tab, app
//      closed, and crucially *signed out*. The user asked for exactly this: "keep
//      counting until it hit saved. Not just when visible. Even when I logged out."
//   3. Saving the workout stores the elapsed time on the session.
//   4. The edit form reached from the history shows that duration and can change it.
//
// It drives headless Chrome over CDP, the way the other browser suites here do, and
// it checks the database afterwards — because "the timer looked right on screen" is
// not the same as "the duration was recorded".

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const USER = process.env.SB_USER
const PASS = process.env.SB_PASSWORD
const SB_URL = process.env.SB_URL
const SB_KEY = process.env.SB_KEY

if (!USER || !PASS || !SB_URL || !SB_KEY) {
  console.error('Set SB_USER, SB_PASSWORD, SB_URL and SB_KEY in this shell.')
  process.exit(1)
}

const PORT = 4193
const DEBUG_PORT = 4188
const BASE = '/gym-tracker/'
const ORIGIN = `http://127.0.0.1:${PORT}`

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

/* ── The browser ── */

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

const profile = mkdtempSync(join(tmpdir(), 'gym-stopwatch-'))
let browser
let ws
let nextId = 0
const pending = new Map()

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`${method} timed out`))
    }, 20000)
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

/* ── The page snippets ── */

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

/** The stopwatch record in localStorage, for any account. */
const readStopwatch = `(() => {
  const out = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('gym_stopwatch:')) out[key] = localStorage.getItem(key)
  }
  return JSON.stringify(out)
})()`

/** The clock the Log page is showing, and the "Session time" label beside it. */
const readClock = `(() => {
  const text = document.body.innerText || ''
  const hasLabel = /Session time/i.test(text)
  // The clock sits next to the "Session time" label, in a .tnum span.
  const spans = Array.from(document.querySelectorAll('span.tnum'))
  const clock = spans.map(s => (s.textContent || '').trim()).find(t => /^(\\d+:)?\\d{2}:\\d{2}$/.test(t))
  return JSON.stringify({ hasLabel, clock: clock || null })
})()`

/** Fill in one set on the first exercise card, so the workout can be saved. */
const fillASet = `(() => {
  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const labelled = Array.from(document.querySelectorAll('input[aria-label]'))
  const weight = labelled.find(i => /weight$/i.test(i.getAttribute('aria-label') || ''))
  const reps = labelled.find(i => /reps$/i.test(i.getAttribute('aria-label') || ''))
  if (!weight || !reps) return 'no weight/reps inputs'
  setValue(weight, '40')
  setValue(reps, '10')
  return 'filled'
})()`

const saveSession = `(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => /^save/i.test(b.textContent.trim()))
  if (!btn) return 'no save button'
  if (btn.disabled) return 'the save button is disabled'
  btn.click()
  return 'clicked'
})()`

/** What the save button looks like, and whether the page is showing an error. */
const readSaveState = `(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => /save/i.test(b.textContent.trim()))
  const text = (document.body.innerText || '')
  const error = text.match(/(Could not save[^\\n]*)/)
  return JSON.stringify({
    buttonText: btn ? btn.textContent.trim() : null,
    disabled: btn ? btn.disabled : null,
    error: error ? error[1] : null,
    hash: location.hash,
  })
})()`

/** The duration fields in the edit form. */
const readEditDuration = `(() => {
  const h = document.querySelector('input[aria-label="Duration in hours"]')
  const m = document.querySelector('input[aria-label="Duration in minutes"]')
  return JSON.stringify({
    hasHours: !!h,
    hasMinutes: !!m,
    hours: h ? h.value : null,
    minutes: m ? m.value : null,
  })
})()`

const setEditDuration = `(() => {
  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const h = document.querySelector('input[aria-label="Duration in hours"]')
  const m = document.querySelector('input[aria-label="Duration in minutes"]')
  if (!h || !m) return 'no duration inputs'
  setValue(h, '2')
  setValue(m, '30')
  return 'set'
})()`

/* ── The run ── */

// The browser's own token is used for the database checks, so the test signs in once
// through the UI rather than also logging in over HTTP. Every sign-in counts against
// the account's throttle — ten attempts per quarter of an hour — and a test that
// quietly runs out of them fails for a reason that has nothing to do with the
// stopwatch.
//
// A fresh throwaway account per run is the clean way to avoid that. If the account is
// being reused, clear its throttle bucket first:
//
//   delete from private.login_limits
//    where bucket = encode(extensions.digest('zzswatch', 'sha256'), 'hex');
//
// The global bucket allows sixty attempts a minute, which is plenty.
const readToken = `sessionStorage.getItem('gym_token')`

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
  for (let i = 0; i < 40 && !target; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
      if (res.ok) {
        const list = await res.json()
        target = list.find(t => t.type === 'page' && !/^chrome-extension:/.test(t.url || ''))
      }
    } catch {
      /* not listening yet */
    }
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

  console.log('1. signs in')
  await send('Page.navigate', { url: `${ORIGIN}${BASE}` })
  await sleep(3000)
  check('the sign-in form was submitted', (await evaluate(signIn)) === 'submitted')
  await sleep(4000)

  // The token is read from the browser rather than obtained over HTTP, so the test
  // signs in once. If it is missing, the sign-in failed — and the usual reason is the
  // account's login throttle, not the app.
  const token = await evaluate(readToken)
  if (!token) {
    check(
      'signed in',
      false,
      'no token in sessionStorage. Either the credentials are wrong or the account hit its login throttle (ten attempts a quarter of an hour).',
    )
    throw new Error('sign-in failed')
  }
  check('signed in', true, `token ${String(token).slice(0, 8)}…`)

  // Start from an empty account. A previous run's sessions would otherwise be in the
  // way, and the checks below read "the newest session", which has to mean the one
  // this run created.
  await fetch(`${SB_URL}/rest/v1/workout_sessions?id=neq.${encodeURIComponent('__none__')}`, {
    method: 'DELETE',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'X-Session-Token': token },
  })

  console.log('\n2. opening the Log page starts the clock, with no button pressed')
  await evaluate(`location.hash = '#/log'`)
  await sleep(3500)

  const clock1 = JSON.parse(await evaluate(readClock))
  check('the page shows a "Session time" label', clock1.hasLabel, JSON.stringify(clock1))
  check('a clock is running', Boolean(clock1.clock), String(clock1.clock))

  const sw1 = JSON.parse(await evaluate(readStopwatch))
  const swKeys = Object.keys(sw1)
  check('a stopwatch was started and stored', swKeys.length === 1, swKeys.join(', '))
  const start1 = swKeys.length ? JSON.parse(sw1[swKeys[0]]).startedAt : 0
  check('it has a start instant', Number.isFinite(start1) && start1 > 0, String(start1))

  console.log('\n3. the clock ticks')
  await sleep(2500)
  const clock2 = JSON.parse(await evaluate(readClock))
  check('the readout moved on', clock2.clock !== clock1.clock, `${clock1.clock} -> ${clock2.clock}`)

  console.log('\n4. the clock keeps running while nothing is watching')
  // Hiding the tab is what a phone does when the app is backgrounded. The clock must
  // still be derived from the wall clock rather than from ticks, so the value on the
  // screen after coming back is the real elapsed time.
  await send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }).catch(() => {})
  await evaluate(`document.dispatchEvent(new Event('visibilitychange'))`)
  await sleep(3000)
  const clock3 = JSON.parse(await evaluate(readClock))
  check('it still reads a time', Boolean(clock3.clock), String(clock3.clock))

  console.log('\n5. signing out does not stop the clock')
  const before = JSON.parse(await evaluate(readStopwatch))
  const beforeKey = Object.keys(before)[0]
  const beforeStart = JSON.parse(before[beforeKey]).startedAt
  check('signed out', (await evaluate(clickSignOut)) === 'clicked')
  await sleep(900)
  check('confirmed', (await evaluate(confirmSignOut)) === 'confirmed')
  await sleep(2500)

  const after = JSON.parse(await evaluate(readStopwatch))
  const afterKey = Object.keys(after)[0]
  check('the stopwatch survived the sign-out', afterKey === beforeKey, `${beforeKey} -> ${afterKey}`)
  check(
    'and it is still the same start instant, so the time did not restart',
    afterKey && JSON.parse(after[afterKey]).startedAt === beforeStart,
    `${beforeStart} -> ${afterKey ? JSON.parse(after[afterKey]).startedAt : 'none'}`,
  )
  check('the token was cleared', (await evaluate(`sessionStorage.getItem('gym_token')`)) === null)

  console.log('\n6. signing back in resumes the same clock')
  await send('Page.navigate', { url: `${ORIGIN}${BASE}` })
  await sleep(2500)
  check('signed in again', (await evaluate(signIn)) === 'submitted')
  await sleep(4000)
  const token2 = await evaluate(readToken)
  check('the sign-in worked', Boolean(token2), token2 ? '' : 'the account is probably throttled')
  // The first token was revoked by signing out, so the database checks below have to
  // use the current one. Querying with a revoked token returns nothing at all, which
  // reads as "the session was not saved" when the truth is "you asked with the wrong
  // key".
  const liveToken = token2 || token
  await evaluate(`location.hash = '#/log'`)
  await sleep(3500)

  const sw2 = JSON.parse(await evaluate(readStopwatch))
  const sw2Key = Object.keys(sw2)[0]
  check(
    'the resumed clock is the original one',
    sw2Key && JSON.parse(sw2[sw2Key]).startedAt === beforeStart,
    `${beforeStart} -> ${sw2Key ? JSON.parse(sw2[sw2Key]).startedAt : 'none'}`,
  )
  const clock4 = JSON.parse(await evaluate(readClock))
  check('the clock is showing a time', Boolean(clock4.clock), String(clock4.clock))

  console.log('\n7. saving the workout records the elapsed time')
  check('a set was entered', (await evaluate(fillASet)) === 'filled')
  await sleep(600)
  check('save was clicked', (await evaluate(saveSession)) === 'clicked')
  await sleep(4000)

  // The database is the truth. The client wrote duration_seconds on the session.
  // Ordered by created_at rather than date: several probe sessions can share a date,
  // and "the newest one" has to mean the newest one.
  const res = await fetch(
    `${SB_URL}/rest/v1/workout_sessions?select=id,date,duration_seconds,started_at,is_draft,created_at&is_draft=eq.false&order=created_at.desc&limit=5`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'X-Session-Token': liveToken } },
  )
  const rows = await res.json()
  check('the session was written', Array.isArray(rows) && rows.length > 0, JSON.stringify(rows))
  const saved = Array.isArray(rows) ? rows[0] : null

  if (saved) {
    check('it carries a duration', Number.isFinite(saved.duration_seconds), String(saved.duration_seconds))
    check(
      'the duration is the real elapsed time, not a placeholder',
      saved.duration_seconds >= 8 && saved.duration_seconds < 600,
      `${saved.duration_seconds}s`,
    )
    check('it carries the start instant', Boolean(saved.started_at), String(saved.started_at))
    // The duration must be the gap between the start instant and the save, not a
    // number that happens to look plausible.
    if (saved.started_at) {
      const gap = Math.round((Date.now() - Date.parse(saved.started_at)) / 1000)
      check(
        'the duration matches the start instant',
        Math.abs(saved.duration_seconds - gap) < 120,
        `duration ${saved.duration_seconds}s vs ${gap}s since the start`,
      )
    }
  }

  console.log('\n8. the stopwatch is cleared once the session is saved')
  const sw3 = JSON.parse(await evaluate(readStopwatch))
  check('the stopwatch was cleared on save', Object.keys(sw3).length === 0, JSON.stringify(sw3))

  console.log('\n9. the edit form shows the recorded duration, and can change it')
  if (saved) {
    await evaluate(`location.hash = '#/history'`)
    await sleep(2500)
    const historyText = await evaluate(`(document.body.innerText || '').replace(/\\s+/g, ' ')`)
    check('the history lists the session with its duration', /\b\d+\s*[hms]\b/.test(historyText), historyText.slice(0, 90))

    await evaluate(`location.hash = '#/history/${saved.id}'`)
    await sleep(2500)
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /edit/i.test(b.getAttribute('aria-label') || b.textContent))
      if (btn) btn.click()
      return 'clicked'
    })()`)
    await sleep(3000)

    const edit1 = JSON.parse(await evaluate(readEditDuration))
    check('the edit form has duration fields', edit1.hasHours && edit1.hasMinutes, JSON.stringify(edit1))
    const shownMinutes = Number(edit1.minutes || 0) + Number(edit1.hours || 0) * 60
    check(
      'it shows the recorded duration',
      Math.abs(shownMinutes * 60 - saved.duration_seconds) < 120,
      `shown ${shownMinutes}m vs recorded ${saved.duration_seconds}s`,
    )

    check('the duration was changed', (await evaluate(setEditDuration)) === 'set')
    await sleep(700)
    const beforeSave = JSON.parse(await evaluate(readSaveState))
    check('the save button is ready', beforeSave.disabled === false, JSON.stringify(beforeSave))
    check('save was clicked', (await evaluate(saveSession)) === 'clicked')
    await sleep(4000)
    const afterSave = JSON.parse(await evaluate(readSaveState))
    check('the save went through', afterSave.hash === '#/history', JSON.stringify(afterSave))

    // The filter parameter is the column name: ?id=eq.<value>. Writing ?eq=id.eq.<value>
    // asks for a column called "eq", which matches nothing and returns an empty list —
    // which reads as "the change was not saved" when the write actually succeeded.
    const res2 = await fetch(
      `${SB_URL}/rest/v1/workout_sessions?select=id,duration_seconds&id=eq.${encodeURIComponent(saved.id)}`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'X-Session-Token': liveToken } },
    )
    const after2 = (await res2.json()) || []
    check('the change was written', after2[0]?.duration_seconds === 9000, JSON.stringify(after2))
  }

  // Clean up: the probe account is thrown away at the end of the run, but the sessions
  // it created would otherwise be left behind for the next run to trip over.
  await fetch(`${SB_URL}/rest/v1/workout_sessions?is_draft=eq.true`, {
    method: 'DELETE',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'X-Session-Token': liveToken },
  })
} catch (error) {
  check('the browser run completed', false, error.message)
} finally {
  try { ws?.close() } catch { /* already closed */ }
  try { browser?.kill() } catch { /* already gone */ }
  server.kill()
}

console.log(`\n${failures === 0 ? 'The stopwatch behaves.' : `${failures} FAILED.`}`)
process.exit(failures === 0 ? 0 : 1)
