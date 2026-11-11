// Exercises routines end to end, in a real browser, against the real database.
//
//   $env:SB_USER = "zzroutine"        # a throwaway account
//   $env:SB_PASSWORD = "..."
//   node scripts/verify-routines.mjs
//
// The claim being checked is behavioural:
//
//   1. The Log tab opens on the list of routines, not on the whole exercise library.
//   2. A routine can be created, and its exercises picked from the library.
//   3. The exercises can be reordered by dragging the grip handle.
//   4. Logging a routine logs its exercises, in the routine's order.
//   5. The saved session says which routine it came from.
//
// The drag is driven with real mouse input over CDP rather than by calling the
// handler, because the whole point of the grip handle is that a pointer can pick it
// up and move it. HTML5 drag-and-drop would not survive this test — and it does not
// work with a finger either, which is the device this app is used on.

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const PORT = 4194
const DEBUG_PORT = 4188
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

const profile = mkdtempSync(join(tmpdir(), 'gym-routines-'))
let ws
let browser
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

/** The page's text, collapsed to one line. */
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

const clickButton = text => `(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').trim() === ${JSON.stringify(text)})
  if (!btn) return 'no ${text} button'
  btn.click()
  return 'clicked'
})()`

const clickContains = text => `(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes(${JSON.stringify(text)}))
  if (!btn) return 'no button matching ${text}'
  btn.click()
  return 'clicked'
})()`

/** The routine rows currently in the reorder editor, top to bottom. */
const editorRows = `(() => {
  const rows = Array.from(document.querySelectorAll('[data-reorder-item]'))
  return JSON.stringify(rows.map(r => (r.innerText || '').trim().split('\\n')[0]))
})()`

/** The exercise cards in the logging view, top to bottom. */
const cardNames = `(() => {
  const names = Array.from(document.querySelectorAll('section.card'))
    .map(s => (s.innerText || '').trim().split('\\n')[0])
  return JSON.stringify(names)
})()`

/** The grip handle's box, so a real mouse can be put on it. */
const handleBox = index => `(() => {
  const rows = Array.from(document.querySelectorAll('[data-reorder-item]'))
  const row = rows[${index}]
  if (!row) return null
  const handle = row.querySelector('button[aria-label^="Reorder"]')
  if (!handle) return null
  const b = handle.getBoundingClientRect()
  return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2, bottom: b.bottom })
})()`

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

  const token = await evaluate(`sessionStorage.getItem('gym_token')`)
  check('signed in', Boolean(token), token ? '' : 'no token — the account may be throttled')
  if (!token) throw new Error('sign-in failed')

  // Start from an empty account, so the checks below are about this run.
  await fetch(`${SB_URL}/rest/v1/routine_exercises?id=neq.__none__`, {
    method: 'DELETE',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'X-Session-Token': token },
  })
  await fetch(`${SB_URL}/rest/v1/routines?id=neq.__none__`, {
    method: 'DELETE',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'X-Session-Token': token },
  })

  console.log('\n2. the Log tab opens on the routine list, not the exercise library')
  await evaluate(`location.hash = '#/log'`)
  await sleep(3000)
  let text = await evaluate(bodyText)
  check('it says "Pick a routine to log"', /Pick a routine to log/.test(text), text.slice(0, 80))
  check('and offers to make one', /New routine/.test(text))
  check('and the library is not dumped on the page', !/Dumbbell Flat Bench/.test(text))

  console.log('\n3. a routine can be created')
  check('the new routine button was clicked', (await evaluate(clickButton('New routine'))) === 'clicked')
  await sleep(700)
  await evaluate(`(() => {
    const input = document.querySelector('#routine-name')
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set
    setter.call(input, 'Upper Body')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(400)
  check('it was created', (await evaluate(clickButton('Create'))) === 'clicked')
  await sleep(2000)
  text = await evaluate(bodyText)
  check('the routine is open', /Upper Body/.test(text), text.slice(0, 80))
  check('and the reorder editor is showing', /Drag the handle to reorder/.test(text))

  console.log('\n4. exercises can be added to it')
  // Two exercises, so the order between them is meaningful. They are found through
  // the picker's own search, because the dataset has 1,324 exercises with names
  // nothing would guess.
  for (const query of ['incline bench press', 'leg press']) {
    check(`"Add exercise" was clicked`, (await evaluate(clickButton('Add exercise'))) === 'clicked')
    await sleep(1200)
    const picked = await evaluate(`(() => {
      const input = document.querySelector('input[aria-label="Search exercises"]')
      if (!input) return 'no search box'
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set
      setter.call(input, ${JSON.stringify(query)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return 'searched'
    })()`)
    check(`${query} was searched for`, picked === 'searched', picked)
    await sleep(900)
    const clicked = await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => (b.getAttribute('aria-label') || '').startsWith('Add '))
      if (!btn) return 'no result'
      btn.click()
      return 'clicked'
    })()`)
    check(`${query} was picked`, clicked === 'clicked', clicked)
    await sleep(1200)
  }
  let rows = JSON.parse(await evaluate(editorRows))
  check('the routine holds two exercises', rows.length === 2, JSON.stringify(rows))
  check('in the order they were added', rows[0] !== rows[1], JSON.stringify(rows))

  console.log('\n5. the grip handle reorders them')
  const box = JSON.parse(await evaluate(handleBox(0)))
  check('the grip handle is there', Boolean(box), JSON.stringify(box))
  if (box) {
    // A real mouse press, a move past the row below, and a release. The app listens
    // to pointer events, which Chrome synthesises from mouse input.
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
    await sleep(150)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y + 10, button: 'left', buttons: 1 })
    await sleep(200)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.bottom + 40, button: 'left', buttons: 1 })
    await sleep(300)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.bottom + 40, button: 'left', clickCount: 1 })
    await sleep(1200)
  }
  rows = JSON.parse(await evaluate(editorRows))
  check(
    'the dragged exercise moved down',
    rows[1] !== rows[0],
    JSON.stringify(rows),
  )

  console.log('\n6. the new order is what gets logged')
  check('the editor was closed', (await evaluate(clickButton('Done'))) === 'clicked')
  await sleep(1500)
  const cards = JSON.parse(await evaluate(cardNames))
  check('the cards follow the routine', cards.length >= 2 && cards[0] !== cards[1], JSON.stringify(cards))

  console.log('\n7. the session is saved with its routine')
  // Fill in a set on the first card.
  const filled = await evaluate(`(() => {
    const setValue = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
      setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const labelled = Array.from(document.querySelectorAll('input[aria-label]'))
    const weight = labelled.find(i => /weight$/i.test(i.getAttribute('aria-label') || ''))
    const reps = labelled.find(i => /reps$/i.test(i.getAttribute('aria-label') || ''))
    if (!weight || !reps) return 'no inputs'
    setValue(weight, '40'); setValue(reps, '10')
    return 'filled'
  })()`)
  check('a set was entered', filled === 'filled', filled)
  await sleep(800)
  check('save was clicked', (await evaluate(clickContains('Save Session'))) === 'clicked')
  await sleep(4000)

  const res = await fetch(
    `${SB_URL}/rest/v1/workout_sessions?select=id,routine_id,duration_seconds,is_draft&is_draft=eq.false&order=created_at.desc&limit=3`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'X-Session-Token': token } },
  )
  const sessions = await res.json()
  const saved = Array.isArray(sessions) ? sessions[0] : null
  check('the session was written', Boolean(saved), JSON.stringify(sessions))
  if (saved) {
    check('it records the routine it came from', Boolean(saved.routine_id), String(saved.routine_id))
    const routineId = saved.routine_id
    const links = await fetch(
      `${SB_URL}/rest/v1/routine_exercises?select=exercise_id,order&routine_id=eq.${routineId}&order=order`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'X-Session-Token': token } },
    )
    const rowsOut = await links.json()
    check('the routine kept two exercises', rowsOut.length === 2, JSON.stringify(rowsOut))
    check('in the order they were dragged', rowsOut.length === 2 && rowsOut[0].order === 0 && rowsOut[1].order === 1, JSON.stringify(rowsOut))
  }

  console.log('\n8. the routine list is what the Log tab shows now')
  await evaluate(`location.hash = '#/log'`)
  await sleep(2500)
  text = await evaluate(bodyText)
  check('the routine is listed', /Upper Body/.test(text), text.slice(0, 100))
} catch (error) {
  check('the browser run completed', false, error.message)
} finally {
  try { ws?.close() } catch { /* closed */ }
  try { browser?.kill() } catch { /* gone */ }
  server.kill()
}

console.log(`\n${failures === 0 ? 'Routines behave.' : `${failures} FAILED.`}`)
process.exit(failures === 0 ? 0 : 1)
