// Checks that the Log tab comes back to the screen you left it on.
//
//   $env:SB_USER = "zzroutine"        # a throwaway account
//   $env:SB_PASSWORD = "..."
//   node scripts/verify-routine-return.mjs
//
// The account is a throwaway, and it is made with the SQL in PROJECT_UNDERSTANDING.md
// §14.2 (the dashboard and the SQL editor are unreachable from here, so the row is
// inserted through the Supabase MCP):
//
//   insert into private.accounts (username, password_hash)
//   values ('zzroutine', extensions.crypt('routine-test-pw-123', extensions.gen_salt('bf', 10)));
//
//   insert into public.exercises (id, name, muscle_group, "order", image_url, user_id)
//   select e.id, e.name, e.muscle_group, e."order", e.image_url, t.id
//   from public.exercises e
//   cross join (select id from private.accounts where username = 'zzroutine') t
//   where e.user_id = (select id from private.accounts where username = 'carlos')
//   on conflict (user_id, id) do nothing;
//
// The run creates and deletes its own routines, and it clears the draft at the end.
// Delete the account when the work is done — user_id cascades, so everything it
// touched goes with it.
//
// The claim being checked is behavioural, and it is the one that was broken:
//
//   1. The Log tab opens on the routine list.
//   2. Picking a routine opens that routine.
//   3. Tapping "Routines" goes back to the list — and the Log tab comes back to the
//      list too, after a trip through another tab.
//   4. A draft that was not dismissed still resumes into its routine, because that is
//      what resuming means.
//   5. Nothing that was logged is thrown away on the way.
//
// Point 3 is the bug this guards. The draft remembered which routine it belonged to
// and nothing else, so the restore always reopened that routine — including after
// the user had walked out of it. Leaving the Log tab on the list and coming back to
// a routine is an app arguing with you about where you wanted to be.
//
// Point 5 is the other one. Picking a routine dropped every card that was in both
// the previous cards and the new routine, so re-picking the routine you were
// logging emptied the workout, and "log without a routine" emptied it too.
//
// The browser is driven over CDP with real mouse and keyboard input, because the
// bug is about what the screen shows when you come back to it.

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const PORT = 4198
const DEBUG_PORT = 4199
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

const profile = mkdtempSync(join(tmpdir(), 'gym-return-'))
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

/** The page's text, collapsed to one line. */
const bodyText = `(() => (document.body.innerText || '').replace(/\\s+/g, ' ').trim())()`

/** Is the routine list showing? */
const onRoutineList = `(() => /Pick a routine to log/.test(document.body.innerText || ''))()`

/** Is the workout editor showing? */
const onEditor = `(() => /Add Exercise/.test(document.body.innerText || ''))()`

/** The exercise cards in the editor, top to bottom. */
const cardNames = `(() => {
  const names = Array.from(document.querySelectorAll('section.card'))
    .map(s => (s.innerText || '').trim().split('\\n')[0])
  return JSON.stringify(names)
})()`

/** The weight that is in the first card's first set, or null. */
const firstWeight = `(() => {
  const input = document.querySelector('input[aria-label^="Set 1 weight"]')
  return input ? input.value : null
})()`

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

/** Click a routine in the list, by its name. */
const clickRoutine = name => `(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim().startsWith(${JSON.stringify(name)}))
  if (!btn) return 'no routine button'
  btn.click()
  return 'clicked'
})()`

/** Click the "Routines" chip that goes back to the list. */
const clickRoutinesChip = `(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => /Routines/.test(b.innerText || ''))
  if (!btn) return 'no Routines chip'
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

const auth = token => ({
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'X-Session-Token': token,
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

  const tokenValue = await evaluate(`sessionStorage.getItem('gym_token')`)
  token = tokenValue
  check('signed in', Boolean(token), token ? '' : 'no token — the account may be throttled')
  if (!token) throw new Error('sign-in failed')

  // The routines the run needs: one with two exercises, one empty. Written straight
  // to the database, because the app's own create-and-pick flow is checked by
  // verify-routines.mjs and this run is about what happens afterwards.
  const who = await (await fetch(`${SB_URL}/rest/v1/rpc/whoami`, { method: 'POST', headers: auth(token), body: '{}' })).json()
  const userId = Array.isArray(who) ? who[0]?.user_id : who?.user_id
  check('the account was resolved', Boolean(userId), String(userId))

  const exRes = await fetch(`${SB_URL}/rest/v1/exercises?select=id&order=order&limit=2`, { headers: auth(token) })
  const exercises = await exRes.json()
  check('the library has exercises', Array.isArray(exercises) && exercises.length === 2, JSON.stringify(exercises))
  if (!userId || !Array.isArray(exercises) || exercises.length < 2) throw new Error('the account is not set up')

  await fetch(`${SB_URL}/rest/v1/routine_exercises?id=neq.__none__`, { method: 'DELETE', headers: auth(token) })
  await fetch(`${SB_URL}/rest/v1/routines?id=neq.__none__`, { method: 'DELETE', headers: auth(token) })
  await fetch(`${SB_URL}/rest/v1/routines`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify([
      { id: 'zzr-upper', name: 'Upper', order: 1, user_id: userId },
      { id: 'zzr-testing', name: 'testing', order: 2, user_id: userId },
    ]),
  })
  await fetch(`${SB_URL}/rest/v1/routine_exercises`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify([
      { id: 'zzre-1', routine_id: 'zzr-upper', exercise_id: exercises[0].id, order: 0, user_id: userId },
      { id: 'zzre-2', routine_id: 'zzr-upper', exercise_id: exercises[1].id, order: 1, user_id: userId },
    ]),
  })
  // No draft to start from: the run creates the one it needs.
  await fetch(`${SB_URL}/rest/v1/workout_sessions?is_draft=eq.true`, { method: 'DELETE', headers: auth(token) })

  console.log('\n2. the Log tab opens on the routine list')
  await evaluate(`location.hash = '#/log'`)
  await sleep(3000)
  check('the list is showing', await evaluate(onRoutineList))
  check('and the editor is not', !(await evaluate(onEditor)))
  const text = await evaluate(bodyText)
  check('both routines are listed', /Upper/.test(text) && /testing/.test(text), text.slice(0, 120))

  console.log('\n3. picking a routine opens it')
  check('"Upper" was clicked', (await evaluate(clickRoutine('Upper'))) === 'clicked')
  await sleep(1500)
  check('the editor is showing', await evaluate(onEditor))
  let cards = JSON.parse(await evaluate(cardNames))
  check('the routine\'s two exercises are the cards', cards.length === 2, JSON.stringify(cards))

  console.log('\n4. something is logged, so there is a draft to restore')
  check('a set was entered', (await evaluate(fillFirstSet)) === 'filled')
  await sleep(4500) // the autosave debounce
  const draftRes = await fetch(`${SB_URL}/rest/v1/workout_sessions?select=id,routine_id&is_draft=eq.true`, { headers: auth(token) })
  const drafts = await draftRes.json()
  check('a cloud draft exists', Array.isArray(drafts) && drafts.length === 1, JSON.stringify(drafts))
  check('and it remembers the routine', drafts?.[0]?.routine_id === 'zzr-upper', String(drafts?.[0]?.routine_id))

  console.log('\n5. the Routines chip goes back to the list')
  check('the chip was clicked', (await evaluate(clickRoutinesChip)) === 'clicked')
  await sleep(1200)
  check('the list is showing', await evaluate(onRoutineList))
  check('and the editor is not', !(await evaluate(onEditor)))

  console.log('\n6. leaving the tab and coming back lands on the list')
  await evaluate(`location.hash = '#/history'`)
  await sleep(1500)
  await evaluate(`location.hash = '#/log'`)
  await sleep(3000)
  check('the list is showing again', await evaluate(onRoutineList))
  check('and the routine was not reopened', !(await evaluate(onEditor)))
  const after = await evaluate(bodyText)
  check('the title says Log Workout', /Log Workout/.test(after), after.slice(0, 120))

  console.log('\n7. nothing that was logged was thrown away')
  check('"Upper" was picked again', (await evaluate(clickRoutine('Upper'))) === 'clicked')
  await sleep(1500)
  const weight = await evaluate(firstWeight)
  check('the set is still there', weight === '40', String(weight))
  cards = JSON.parse(await evaluate(cardNames))
  check('and the routine still has two cards', cards.length === 2, JSON.stringify(cards))

  console.log('\n8. a draft that was not dismissed still resumes into its routine')
  await evaluate(`location.hash = '#/history'`)
  await sleep(1500)
  await evaluate(`location.hash = '#/log'`)
  await sleep(3000)
  check('the editor is showing', await evaluate(onEditor))
  check('and the routine was reopened', await evaluate(`(() => /Upper/.test(document.body.innerText || ''))()`))
} catch (error) {
  check('the browser run completed', false, error.message)
} finally {
  try { ws?.close() } catch { /* closed */ }
  try { browser?.kill() } catch { /* gone */ }
  server.kill()
  // The draft is cleared after the browser is gone, not before: the app is still open
  // at that point, and its autosave would write the draft straight back. A draft left
  // behind is not a harmless leftover — it is what the next run finds, and it opens
  // the Log tab in the editor instead of on the routine list.
  if (token) {
    await fetch(`${SB_URL}/rest/v1/workout_sessions?is_draft=eq.true`, { method: 'DELETE', headers: auth(token) })
  }
}

console.log(`\n${failures === 0 ? 'The Log tab comes back where you left it.' : `${failures} FAILED.`}`)
process.exit(failures === 0 ? 0 : 1)
