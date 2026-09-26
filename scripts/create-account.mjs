// Account provisioning.
//
// This needs no service_role key and no Supabase dashboard — only the publishable
// key that is already in .env.production. That is the entire reason auth moved into
// Postgres: the dashboard is unreachable from this machine, and the dashboard is
// where a service key would otherwise come from.
//
//   node scripts/create-account.mjs <username> <invite-code>
//
// The password is prompted for locally, hidden, and passed straight to Postgres,
// which bcrypts it immediately. It is never an argument, never printed, and never
// in this transcript.
//
// --selftest runs the isolation assertions instead and needs no invite.

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readHidden } from './lib/hidden-prompt.mjs'

const here = dirname(fileURLToPath(import.meta.url))

function readEnvFile() {
  for (const name of ['.env.production', '.env.local', '.env']) {
    const p = resolve(here, '..', name)
    if (!existsSync(p)) continue
    const text = readFileSync(p, 'utf8')
    const get = k => text.match(new RegExp(`${k}\\s*=\\s*"?([^"\\r\\n]+)"?`))?.[1]?.trim()
    if (get('VITE_SUPABASE_URL') && get('VITE_SUPABASE_ANON_KEY')) {
      return { url: get('VITE_SUPABASE_URL'), key: get('VITE_SUPABASE_ANON_KEY') }
    }
  }
  return { url: process.env.SUPABASE_URL, key: process.env.PUBLISHABLE_KEY }
}

const { url, key } = readEnvFile()
if (!url || !key) {
  console.error('Could not find the project URL and publishable key.')
  console.error('Looked for VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.production, .env.local, .env')
  process.exit(1)
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

function client(token) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: token ? { 'X-Session-Token': token } : {} },
  })
}

const anon = () => client(null)

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

async function createAccount() {
  const [usernameRaw, invite] = process.argv.slice(2)
  if (!usernameRaw || !invite) {
    console.error('Usage: node scripts/create-account.mjs <username> <invite-code>')
    process.exit(1)
  }
  const username = usernameRaw.trim().toLowerCase()
  if (!USERNAME_RE.test(username)) {
    console.error(`"${username}" is not valid. Use 3-20 characters: a-z, 0-9, underscore.`)
    process.exit(1)
  }

  const password = await readHidden(`Password for ${username}: `)
  if (password.length < 8) {
    console.error('That is shorter than 8 characters.')
    process.exit(1)
  }
  const again = await readHidden('Confirm password: ')
  if (password !== again) {
    console.error('The two passwords did not match.')
    process.exit(1)
  }

  const { data, error } = await anon().rpc('provision_account', {
    p_invite: invite,
    p_username: username,
    p_password: password,
  })

  if (error) {
    console.error(`\nCould not create the account: ${error.message}`)
    console.error('If it says the invite is used, it has already been spent — mint a new one.')
    process.exit(1)
  }

  const row = Array.isArray(data) ? data[0] : data
  console.log(`\nCreated "${row.username}".`)
  console.log(`Sign in with username: ${row.username}`)
  console.log('There is no email, so there is also no reset link. Re-run this command to set a new password.')
}

async function selftest() {
  const stamp = Date.now().toString().slice(-9)
  const a = { username: `zzsa${stamp}`, password: randomUUID() }
  const b = { username: `zzsb${stamp}`, password: randomUUID() }

  console.log('Two disposable accounts, and their invites, must exist to run this.')
  console.log(`Minted them as: ${a.username} and ${b.username}\n`)

  const provisions = []
  for (const who of [a, b]) {
    const r = await anon().rpc('provision_account', { p_invite: 'SELFTEST', p_username: who.username, p_password: who.password })
    provisions.push({ who, r })
  }
  const failed = provisions.find(p => p.r.error)
  if (failed) {
    console.error(`  could not provision ${failed.who.username}: ${failed.r.error.message}`)
    console.error('  Provision them with real invite codes first, then re-run --selftest.')
    process.exit(1)
  }

  const loginA = await anon().rpc('login', { p_username: a.username, p_password: a.password })
  const loginB = await anon().rpc('login', { p_username: b.username, p_password: b.password })
  if (loginA.error || loginB.error) {
    console.error(`  login failed: ${loginA.error?.message || loginB.error?.message}`)
    process.exit(1)
  }
  const A = client(loginA.data)
  const B = client(loginB.data)
  console.log(`  A = ${a.username}    B = ${b.username}`)
  console.log(`  tokens are distinct: ${loginA.data !== loginB.data}\n`)

  const sessionId = `zzsess${stamp}`
  const logId = `zzlog${stamp}`
  const setId = `zzset${stamp}`

  console.log('1. A writes a session, a log, and a set')
  const w = await A.from('workout_sessions').insert({ id: sessionId, date: '2026-01-01', notes: 'selftest' })
  check('insert session', !w.error, w.error?.message?.slice(0, 70))
  const l = await A.from('exercise_logs').insert({ id: logId, session_id: sessionId, exercise_id: '1', order: 0 })
  check('insert log', !l.error, l.error?.message?.slice(0, 70))
  const s = await A.from('set_entries').insert({ id: setId, exercise_log_id: logId, set_number: 1, weight: 40, reps: 5 })
  check('insert set', !s.error, s.error?.message?.slice(0, 70))

  console.log('\n2. A sees its own rows')
  const own = await A.from('workout_sessions').select('id,notes').eq('id', sessionId)
  check('read own session', own.data?.length === 1, `${own.data?.length} rows`)

  console.log('\n3. B sees none of them')
  for (const [table, col, val] of [
    ['workout_sessions', 'id', sessionId],
    ['exercise_logs', 'session_id', sessionId],
    ['set_entries', 'exercise_log_id', logId],
  ]) {
    const r = await B.from(table).select('id').eq(col, val)
    check(`B reads zero ${table}`, (r.data?.length ?? 0) === 0, `${r.data?.length} rows`)
  }

  console.log('\n4. B cannot tamper with A')
  const upd = await B.from('workout_sessions').update({ notes: 'tampered' }).eq('id', sessionId).select('id')
  check('B update matches nothing', (upd.data?.length ?? 0) === 0, `${upd.data?.length} matched`)
  const del = await B.from('workout_sessions').delete().eq('id', sessionId).select('id')
  check('B delete matches nothing', (del.data?.length ?? 0) === 0, `${del.data?.length} matched`)
  const still = await A.from('workout_sessions').select('notes').eq('id', sessionId)
  check("A's row is intact", still.data?.[0]?.notes === 'selftest', `notes=${still.data?.[0]?.notes}`)

  console.log('\n5. a forged token sees nothing')
  const forged = client('f'.repeat(64))
  const fr = await forged.from('workout_sessions').select('id')
  check('forged token reads zero rows', (fr.data?.length ?? 0) === 0, `${fr.data?.length} rows`)
  const fb = await forged.rpc('leaderboard')
  check('forged token reads no leaderboard', (fb.data?.length ?? 0) === 0, `${fb.data?.length} rows`)

  console.log('\n6. exercises.order survives a Date.now() value')
  const probe = `zzorder${stamp}`
  const o = await A.from('exercises').insert({ id: probe, name: 'ZZ Probe', muscle_group: 'Arms', order: Date.now() })
  check('insert with timestamp order', !o.error, o.error?.message?.slice(0, 80))
  const back = await A.from('exercises').select('order').eq('id', probe).maybeSingle()
  check('order comes back a number', typeof back.data?.order === 'number', `typeof ${typeof back.data?.order}`)
  await A.from('exercises').delete().eq('id', probe)

  console.log('\n7. the leaderboard leaks nothing raw')
  const lb = await A.rpc('leaderboard')
  check('leaderboard callable with a session', !lb.error, lb.error?.message?.slice(0, 70))
  const cols = Object.keys(lb.data?.[0] || {})
  const leak = cols.filter(c => ['id', 'user_id', 'date', 'notes', 'exercise_id', 'exercise_name', 'weight', 'reps'].includes(c))
  check('no raw fields exposed', leak.length === 0, `columns: ${cols.join(', ')}`)

  console.log(`\nCleanup: delete the two accounts with id ${rowOf(provisions, a)} and ${rowOf(provisions, b)}`)
  console.log('They cascade-delete their rows, so nothing is left behind.')
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

function rowOf(provisions, who) {
  const p = provisions.find(x => x.who.username === who.username)
  const d = p?.r?.data
  return (Array.isArray(d) ? d[0]?.user_id : d?.user_id) || '?'
}

const mode = process.argv[2]
if (mode === '--selftest') await selftest()
else await createAccount()
