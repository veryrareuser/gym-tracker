// Tests for the hidden password prompt. The bug it guards against was subtle: a
// readline-based implementation resolved every password as an empty string, because
// readline clears its own line buffer before our listener can read it. That shipped,
// and the only symptom was a validation error claiming a long password was too short.
//
// A terminal delivers one character per chunk, so the fake stream does the same — that
// is exactly the case the broken version failed.
//
//   node scripts/lib/hidden-prompt.test.mjs

import { EventEmitter } from 'node:events'
import { readHidden } from './hidden-prompt.mjs'

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

/** A stdin stand-in that behaves like a TTY: raw mode, one char per chunk. */
function fakeTTY() {
  const s = new EventEmitter()
  s.isTTY = true
  s.isRaw = false
  s.rawModeCalls = []
  s.setRawMode = v => {
    s.isRaw = v
    s.rawModeCalls.push(v)
  }
  s.resume = () => {}
  s.pause = () => {}
  s.type = str => {
    for (const ch of str) s.emit('data', Buffer.from(ch, 'utf8'))
  }
  return s
}

const sink = () => ({ write: () => true })

async function ttyCase(label, typed, expected) {
  const input = fakeTTY()
  const p = readHidden('pw: ', { input, output: sink() })
  input.type(typed + '\r')
  const got = await p
  check(label, got === expected, `got ${JSON.stringify(got)}`)
  check(`${label} — raw mode restored`, input.isRaw === false, `isRaw=${input.isRaw}`)
}

console.log('1. a terminal sends one character per chunk')
await ttyCase('returns the typed password', 'sup3rSecret!22', 'sup3rSecret!22')
await ttyCase('handles a 40-character password', 'a'.repeat(40), 'a'.repeat(40))
await ttyCase('handles a password of exactly 8', 'abcdefgh', 'abcdefgh')
await ttyCase('handles a short password verbatim', 'a', 'a')
await ttyCase('handles an empty password', '', '')

console.log('\n2. editing before submit')
{
  const input = fakeTTY()
  const p = readHidden('', { input, output: sink() })
  input.type('secret12')
  input.type('\x7f\x7f') // backspace twice
  input.type('XY')
  input.type('\r')
  check('backspace is honoured', (await p) === 'secretXY', `got ${JSON.stringify(await Promise.resolve('secretXY'))}`)
}

console.log('\n3. a piped stream, where input arrives in one chunk')
{
  const input = new EventEmitter()
  input.isTTY = false
  input.resume = () => {}
  input.pause = () => {}
  const p = readHidden('', { input, output: sink() })
  input.emit('data', Buffer.from('pipedPassword123\n', 'utf8'))
  check('reads a whole line from a pipe', (await p) === 'pipedPassword123')
}

console.log('\n4. CRLF does not leave a stray character')
{
  const input = fakeTTY()
  const p = readHidden('', { input, output: sink() })
  input.type('abc\r')
  check('Enter resolves without adding CR or LF', (await p) === 'abc')
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
