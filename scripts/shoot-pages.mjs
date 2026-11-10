// A one-off: screenshot every page of the built app, so the design can be looked at.
//
//   node scripts/shoot-pages.mjs
//
// Not part of the gate. It needs Chrome and a throwaway account.

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL = process.env.APP_URL || 'http://127.0.0.1:4196/gym-tracker/'
const USER = process.env.SB_USER || 'zzswatch'
const PASS = process.env.SB_PASSWORD || 'stopwatch-probe-pass-1'
const DEBUG_PORT = 4197
const OUT = process.env.OUT_DIR || 'C:/Users/carlo/AppData/Local/Temp/opencode'

function findChrome() {
  const localAppData = process.env.LOCALAPPDATA || ''
  for (const path of [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    localAppData && `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
  ].filter(Boolean)) if (existsSync(path)) return path
  return null
}

const chrome = findChrome()
const profile = mkdtempSync(join(tmpdir(), 'gym-pages-'))
let ws
let nextId = 0
const pending = new Map()

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 20000)
    pending.set(id, {
      resolve: v => { clearTimeout(timer); resolve(v) },
      reject: e => { clearTimeout(timer); reject(e) },
    })
    ws.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed')
  return r.result.value
}

const shot = async (name, full = false) => {
  const params = { format: 'png' }
  if (full) params.captureBeyondViewport = true
  const { data } = await send('Page.captureScreenshot', params)
  const file = join(OUT, `${name}.png`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  console.log('wrote', file)
}

const signIn = `(() => {
  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const inputs = document.querySelectorAll('input')
  if (inputs.length < 2) return 'no form'
  setValue(inputs[0], ${JSON.stringify(USER)}); setValue(inputs[1], ${JSON.stringify(PASS)})
  const btn = Array.from(document.querySelectorAll('button')).find(b => /sign in/i.test(b.textContent))
  if (!btn) return 'no button'
  btn.click()
  return 'submitted'
})()`

let browser
try {
  browser = spawn(chrome, [
    '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--hide-scrollbars', '--window-size=430,932', 'about:blank',
  ], { stdio: 'ignore' })

  let target = null
  for (let i = 0; i < 40 && !target; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
      if (res.ok) target = (await res.json()).find(t => t.type === 'page' && !/^chrome-extension:/.test(t.url || ''))
    } catch { /* not up */ }
    if (!target) await sleep(250)
  }
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
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
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true })
  if (process.env.SCHEME === 'dark') {
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    })
  }

  await send('Page.navigate', { url: URL })
  await sleep(4000)
  console.log('sign in:', await evaluate(signIn))
  await sleep(5000)
  await shot('nb-00-signin')

  for (const [hash, name] of [
    ['#/', 'nb-01-dashboard'],
    ['#/log', 'nb-02-log'],
    ['#/history', 'nb-03-history'],
    ['#/analytics', 'nb-04-analytics'],
    ['#/exercises', 'nb-05-exercises'],
  ]) {
    await evaluate(`location.hash = ${JSON.stringify(hash)}`)
    await sleep(3500)
    await shot(name)
  }
} catch (error) {
  console.error('failed:', error.message)
} finally {
  try { ws?.close() } catch { /* closed */ }
  try { browser?.kill() } catch { /* gone */ }
}
