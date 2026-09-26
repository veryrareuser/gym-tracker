// A password prompt that does not echo, and does not lie about length.
//
// Why this exists rather than using node:readline: the obvious implementation is
//
//   const rl = createInterface({ input: process.stdin, terminal: true })
//   process.stdin.on('data', chunk => { if (chunk is Enter) resolve(rl.line) })
//
// and it is broken. readline attaches its own 'data' listener first, and on Enter it
// emits 'line' and resets `rl.line` to ''. Our listener runs afterwards and reads the
// already-cleared buffer, so the password always resolves to an empty string. The
// symptom is a validation error claiming an 18-character password is too short.
//
// So this accumulates characters straight off the stream and never trusts readline's
// internal state. It works the same whether input is a TTY (raw mode, nothing echoed)
// or a pipe, which also makes it testable with a fake stream.

/**
 * @param {string} question  text to print before reading
 * @param {object} [io]      injectable streams, for tests
 * @returns {Promise<string|null>} the typed text, or null if interrupted
 */
export function readHidden(question = '', { input = process.stdin, output = process.stdout } = {}) {
  return new Promise(resolve => {
    output.write(question)
    const wasRaw = Boolean(input.isRaw)
    let typed = ''

    const finish = value => {
      input.removeListener('data', onData)
      input.removeListener('end', onEnd)
      if (input.isTTY) input.setRawMode(wasRaw)
      input.pause()
      output.write('\n')
      resolve(value)
    }

    function onEnd() {
      // Piped input may arrive with no trailing newline. Take what we got rather
      // than hanging forever.
      finish(typed)
    }

    function onData(chunk) {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\x03') {
          // Ctrl+C. Exit rather than resolve, so this is never mistaken for an empty
          // password the user then has to debug.
          finish(null)
          process.exit(130)
        }
        if (ch === '\r' || ch === '\n') {
          finish(typed)
          return
        }
        if (ch === '\x7f' || ch === '\b') {
          typed = typed.slice(0, -1)
          continue
        }
        // Printable ASCII only. Drops remaining control characters, and also guards
        // against a multi-byte UTF-8 sequence being split across chunks.
        if (ch >= ' ' && ch <= '~') typed += ch
      }
    }

    if (input.isTTY) input.setRawMode(true)
    input.resume()
    input.on('data', onData)
    input.on('end', onEnd)
  })
}
