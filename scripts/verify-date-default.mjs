// Regression test for the reported date bug: a workout logged on one day was filed under
// an earlier date, silently.
//
// Two defects combined. The default date came from toISOString(), which is UTC, so it
// named the previous day between local midnight and 07:00 at UTC+7. And the draft was
// written on every render including the one caused by merely opening the page, so visiting
// Log on one day and logging on another adopted the first day's date. The header showed a
// bare "Discard" chip that said nothing about a date.
//
// To reproduce the second half deterministically, the test freezes the clock rather than
// waiting a day: it fakes a local date, opens Log, then moves the fake clock forward and
// opens Log again on the same profile. If the date carries over, the bug is present.
//
//   $env:APP_URL = "http://localhost:4195/gym-tracker/"
//   node scripts/verify-date-default.mjs

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Users\\carlo\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
const APP = process.env.APP_URL
const PORT = 9488
const profile = mkdtempSync(join(tmpdir(), 'gym-date-'))

if (!APP) {
  console.error('Set APP_URL to a served build.')
  process.exit(1)
}

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
  } catch { /* not up */ }
  if (!page) await sleep(250)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})
await new Promise(r => ws.addEventListener('open', r))
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      if (m.error) reject(new Error(JSON.stringify(m.error)))
      else resolve(m.result)
    }
  })
await send('Runtime.enable')
await send('Page.enable')

const ev = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed')
  return r.result.value
}

let failures = 0
const check = (l, ok, d = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? `  (${d})` : ''}`)
}

// Overrides Date so the app reads a chosen local day. Constructed from explicit
// year/month/day/hour so it is that day in whatever zone the browser is running in.
//
// Installed with addScriptToEvaluateOnNewDocument rather than a bare evaluate, because a
// plain evaluate is wiped by any navigation — an earlier draft froze the clock and then
// reloaded, which quietly threw the freeze away and made the app read the real date.
const FREEZE = iso => `(() => {
  const [d, t] = ${JSON.stringify(iso)}.split('T');
  const [Y, M, D] = d.split('-').map(Number);
  const [h, m] = t.split(':').map(Number);
  const fixed = new Date(Y, M - 1, D, h, m, 0, 0);
  const RealDate = Date;
  function FakeDate(...args) {
    if (args.length === 0) return new RealDate(fixed.getTime());
    return new RealDate(...args);
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => fixed.getTime();
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  globalThis.Date = FakeDate;
})()`

let clockScript = null
async function setClock(iso) {
  if (clockScript) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clockScript })
  const r = await send('Page.addScriptToEvaluateOnNewDocument', { source: FREEZE(iso) })
  clockScript = r.identifier
  return iso
}

const dateField = `(() => {
  const input = document.querySelector('input[type="date"]')
  return JSON.stringify({
    value: input?.value,
    max: input?.getAttribute('max'),
    today: input?.max,
    badge: Array.from(document.querySelectorAll('span'))
      .map(s => s.textContent.trim())
      .find(t => t === 'Today' || t === 'Not today') || null,
  })
})()`

try {
  // Freeze before the first load, so the app's very first render sees the chosen day.
  await setClock('2026-09-28T01:30')
  await send('Page.navigate', { url: APP })
  await sleep(5000)

  const USER = process.env.SB_USER
  const PASS = process.env.SB_PASSWORD
  if (!USER || !PASS) {
    console.error('  SB_USER and SB_PASSWORD are required to reach the Log page.')
    process.exit(1)
  }
  await ev(`(() => {
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const i = document.querySelectorAll('input')
    set(i[0], ${JSON.stringify(USER)}); set(i[1], ${JSON.stringify(PASS)})
    Array.from(document.querySelectorAll('button')).find(b => /sign in/i.test(b.textContent)).click()
    return true
  })()`)
  await sleep(5000)

  await ev(`location.hash = '#/log'; true`)
  await sleep(4000)

  console.log('1. a session opened at 01:30 local on 28 September — inside the old UTC bug window')
  let d = JSON.parse(await ev(dateField))
  check('the date field opens on the 28th', d.value === '2026-09-28', d.value)
  check('it is labelled Today', d.badge === 'Today', d.badge)
  check('the picker is capped at today', d.max === '2026-09-28', d.max)

  console.log('\n2. re-open on a later day, same profile (the reported stale-draft bug)')
  await setClock('2026-09-30T09:15')
  // Page.reload, not a hash navigation: navigating to a URL that differs only by its hash
  // does not create a new document, so the newly injected clock never ran and the app
  // was still reading the old frozen day.
  await send('Page.reload')
  await sleep(6000)
  d = JSON.parse(await ev(dateField))
  check('the date follows the current day, not the earlier visit', d.value === '2026-09-30', d.value)
  check('and is labelled Today again', d.badge === 'Today', d.badge)

  console.log('\n3. merely opening Log must not leave a draft behind')
  const stored = await ev(`Object.keys(sessionStorage).filter(k => k.includes('draft')).join(',') || '(none)'`)
  check('no draft is written by opening the page', stored === '(none)', stored)

  console.log('\n4. a draft that does carry a real date says which one')
  await ev(`(() => {
    const w = document.querySelector('input[type="number"]');
    if (!w) return 'no weight input';
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(w), 'value').set.call(w, '40');
    w.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`)
  await sleep(2000)
  const chip = await ev(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => /\\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)\\b/i.test(x.textContent));
    return b ? b.textContent.trim() : null;
  })()`)
  // "sept?" rather than "sep": en-GB renders September as "Sept", so the chip reads
  // "Wed, 30 Sept 2026" and a \bsep\b pattern silently never matches. That trap cost a
  // whole round of debugging before the chip was confirmed working.
  check('the draft chip names its date', /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)\b/i.test(chip || ''), JSON.stringify(chip))
  check('it is not a bare "Discard"', !/^discard$/i.test((chip || '').trim()), JSON.stringify(chip))
  check('a draft was stored once the set had content', (await ev(`Object.keys(sessionStorage).filter(k => k.includes('draft')).length`)) === 1)
} finally {
  ws.close()
  chrome.kill()
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* best effort */ }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
