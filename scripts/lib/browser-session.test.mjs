import assert from 'node:assert/strict'
import { clearBrowserData, removeLegacyData } from '../../src/lib/browserSession.js'
function storage() {
  const value = { unrelated: 'keep', gym_timer: 'keep', gym_token: 'fixture', 'sessions:fixture': 'fixture', 'exercises:fixture': 'fixture', 'gym_draft:fixture': 'fixture' }
  Object.defineProperty(value, 'removeItem', {value(key) { delete this[key] }})
  return value
}
globalThis.localStorage = storage()
globalThis.sessionStorage = storage()
globalThis.window = {localStorage, sessionStorage}
removeLegacyData()
assert.equal(localStorage.gym_token, undefined)
assert.equal(localStorage['gym_draft:fixture'], undefined)
assert.equal(sessionStorage.gym_token, 'fixture')
clearBrowserData()
for (const value of [localStorage,sessionStorage]) assert.deepEqual(Object.keys(value).sort(), ['gym_timer','unrelated'])
Object.defineProperty(window, 'localStorage', {get() { throw Error('Storage denied') }})
assert.doesNotThrow(clearBrowserData)
console.log('Browser credential/cache cleanup tests passed.')
