import assert from 'node:assert/strict'
import { clearBrowserData, removeLegacyData } from '../../src/lib/browserSession.js'

function storage() {
  const value = {
    unrelated: 'keep',
    gym_timer: 'keep',
    gym_token: 'fixture',
    // Pre-namespacing leftovers, which the sweep exists to remove.
    sessions: 'fixture',
    exercises: 'fixture',
    gym_sessions: 'fixture',
    gym_exercises: 'fixture',
    // Namespaced keys, which it must leave alone.
    'sessions:fixture': 'fixture',
    'exercises:fixture': 'fixture',
    'gym_draft:fixture': 'fixture',
    'gym_draft:backup:fixture': 'fixture',
  }
  Object.defineProperty(value, 'removeItem', { value(key) { delete this[key] } })
  return value
}

globalThis.localStorage = storage()
globalThis.sessionStorage = storage()
globalThis.window = { localStorage, sessionStorage }

// Runs on every app load, via restoreSession().
removeLegacyData()

// A draft must survive a reload. This assertion is the reason removeLegacyData() is
// scoped to LEGACY_KEY: it used to match the whole APP_KEY set, so it deleted the draft
// mirror in localStorage on every load and the feature that exists to survive a closed
// window could never restore anything.
assert.equal(localStorage['gym_draft:fixture'], 'fixture', 'a draft survives a reload')
assert.equal(localStorage['gym_draft:backup:fixture'], 'fixture', 'the localStorage mirror survives a reload')

// Its purpose is unchanged: pre-namespacing keys are cleaned up.
assert.equal(localStorage.sessions, undefined, 'legacy sessions key is removed')
assert.equal(localStorage.exercises, undefined, 'legacy exercises key is removed')
assert.equal(localStorage.gym_sessions, undefined, 'legacy gym_sessions key is removed')
assert.equal(localStorage.gym_exercises, undefined, 'legacy gym_exercises key is removed')

// Namespaced caches and the rest timer are not legacy and must survive a reload.
assert.equal(localStorage['sessions:fixture'], 'fixture', 'a namespaced session cache survives')
assert.equal(localStorage['exercises:fixture'], 'fixture', 'a namespaced exercise cache survives')
assert.equal(localStorage.gym_timer, 'keep', 'the rest timer survives')
assert.equal(localStorage.unrelated, 'keep', 'unrelated keys survive')
assert.equal(sessionStorage.gym_token, 'fixture', 'the sweep touches localStorage only')

// Sign-out is different: it wipes everything, drafts included, so the next person at the
// keyboard does not inherit a half-finished workout.
clearBrowserData()
for (const value of [localStorage, sessionStorage]) {
  assert.deepEqual(
    Object.keys(value).sort(),
    ['gym_timer', 'unrelated'],
    'sign-out clears every app key from both stores',
  )
}

Object.defineProperty(window, 'localStorage', { get() { throw Error('Storage denied') } })
assert.doesNotThrow(clearBrowserData)

console.log('Browser credential/cache cleanup tests passed.')
