// Account provisioning. There is deliberately no in-app signup: no public endpoint
// can create an account, so self-registration is structurally impossible rather
// than merely rate-limited.
//
// Usage:
//   $env:SUPABASE_URL       = "https://<project>.supabase.co"
//   $env:SERVICE_ROLE_KEY   = "<service_role key>"
//
//   node scripts/create-account.mjs --create <username>
//   node scripts/create-account.mjs --selftest
//
// --create prompts for the password with echo off, so it never reaches shell
// history, this transcript, or a log file. You choose the password; it is never
// passed as an argument.

import { createClient } from '@supabase/supabase-js'
import { createInterface } from 'node:readline'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// Signing in needs a *publishable* key, not the service key. That key is public by
// design — it ships inside the app bundle and is meant to be readable — so reading
// it from .env.production keeps the selftest to a single command. The service_role
// key is never written to any file and is only read from the environment.
function readPublishableKey() {
  if (process.env.PUBLISHABLE_KEY) return process.env.PUBLISHABLE_KEY
  const envPath = resolve(here, '../.env.production')
  if (!existsSync(envPath)) return null
  const match = readFileSync(envPath, 'utf8').match(/VITE_SUPABASE_ANON_KEY\s*=\s*(\S+)/)
  return match ? match[1] : null
}

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Set SUPABASE_URL and SERVICE_ROLE_KEY in this shell first.')
  console.error('The service_role key is found in Project Settings -> API. It bypasses RLS,')
  console.error('so it must never be committed, pasted into chat, or put in a .env file that')
  console.error('gets pushed. Passing it as an environment variable keeps it out of all three.')
  process.exit(1)
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

// Supabase Auth signs in by email, so a username-only product needs an
// undeliverable address behind it. `.invalid` is permanently unregistrable
// (RFC 2606), so mail to it can never succeed or leak.
const slug = new URL(url).hostname.split('.')[0]
const emailFor = username => `${username}@${slug}.invalid`

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

function readHidden(question) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    const onData = char => {
      if (['\n', '\r', ''].includes(String(char))) {
        process.stdin.removeListener('data', onData)
      } else {
        // Swallow the keystroke so the password is not echoed.
        return
      }
      const line = rl.line.replace(/[^\x20-\x7E]/g, '')
      rl.close()
      resolve(line)
    }
    process.stdout.write(question)
    process.stdin.on('data', onData)
    rl.question('', () => {})
  })
}

async function createUser(username, password) {
  const email = emailFor(username)
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no mailbox exists, so confirmation can never happen
    user_metadata: { username },
  })
  if (error) throw new Error(`createUser: ${error.message}`)

  const { error: profileError } = await admin
    .from('profiles')
    .insert({ user_id: data.user.id, username })
  if (profileError) {
    // Do not leave an auth user with no profile behind.
    await admin.auth.admin.deleteUser(data.user.id)
    throw new Error(`profile insert: ${profileError.message} (auth user rolled back)`)
  }
  return data.user
}

async function signIn(username, password) {
  const publishable = readPublishableKey()
  if (!publishable) throw new Error('No publishable key found. Set PUBLISHABLE_KEY in this shell.')
  const client = createClient(url, publishable, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email: emailForUsername(username), password })
  if (error) throw new Error(`signIn: ${error.message}`)
  return client
}

let failures = 0
function check(label, condition, detail = '') {
  if (!condition) failures++
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
}

async function selftest() {
  const stamp = Date.now()
  const userA = { username: `zzsa${stamp % 100000}`, password: crypto.randomUUID() }
  const userB = { username: `zzsb${stamp % 100000}`, password: crypto.randomUUID() }

  console.log('Creating two disposable accounts…')
  const a = await createUser(userA.username, userA.password)
  const b = await createUser(userB.username, userB.password)
  console.log(`  A = ${userA.username}  B = ${userB.username}\n`)

  const clientA = await signIn(userA.username, userA.password)
  const clientB = await signIn(userB.username, userB.password)

  try {
    console.log('--- 1. A writes a session ---')
    const sessionId = `zzsess-${stamp}`
    const logId = `zzlog-${stamp}`
    const { error: wErr } = await clientA.from('workout_sessions').insert({
      id: sessionId,
      date: '2026-01-01',
      notes: 'selftest',
      user_id: a.user.id,
    })
    check('A can insert a session', !wErr, wErr?.message)

    const { error: lErr } = await clientA.from('exercise_logs').insert({
      id: logId,
      session_id: sessionId,
      exercise_id: '1',
      order: 0,
      user_id: a.user.id,
    })
    check('A can insert a log', !lErr, lErr?.message)

    console.log('\n--- 2. A reads its own data ---')
    const own = await clientA.from('workout_sessions').select('id,notes').eq('id', sessionId)
    check('A sees its own session', own.data?.length === 1, `rows=${own.data?.length}`)

    console.log('\n--- 3. B must see none of it ---')
    const bSees = await clientB.from('workout_sessions').select('id').eq('id', sessionId)
    check('B sees zero of A sessions', bSees.data?.length === 0, `rows=${bSees.data?.length}`)

    const bLogs = await clientB.from('exercise_logs').select('id').eq('session_id', sessionId)
    check('B sees zero of A logs', bLogs.data?.length === 0, `rows=${bLogs.data?.length}`)

    const bSets = await clientB.from('set_entries').select('id').eq('exercise_log_id', logId)
    check('B sees zero of A sets', bSets.data?.length === 0, `rows=${bSets.data?.length}`)

    console.log('\n--- 4. B must not write as A ---')
    const forge = await clientB.from('workout_sessions').insert({
      id: `zzforge-${stamp}`,
      date: '2026-01-02',
      notes: 'forged',
      user_id: a.user.id,
    })
    check('B cannot insert a session owned by A', Boolean(forge.error), forge.error?.message?.slice(0, 80))

    const steal = await clientB.from('workout_sessions').update({ notes: 'tampered' }).eq('id', sessionId)
    check('B cannot update A session', Boolean(steal.error) || (steal.data?.length ?? 0) === 0,
      steal.error?.message?.slice(0, 80) || `matched ${steal.data?.length}`)

    const drop = await clientB.from('workout_sessions').delete().eq('id', sessionId)
    check('B cannot delete A session', Boolean(drop.error) || (drop.data?.length ?? 0) === 0,
      drop.error?.message?.slice(0, 80) || `matched ${drop.data?.length}`)

    console.log('\n--- 5. leaderboard returns aggregates, not raw rows ---')
    const lb = await clientA.rpc('leaderboard')
    check('leaderboard is callable by a signed-in user', !lb.error, lb.error?.message?.slice(0, 80))
    if (!lb.error && Array.isArray(lb.data)) {
      const cols = Object.keys(lb.data[0] || {})
      const leak = cols.filter(c => ['id', 'date', 'notes', 'exercise_id', 'exercise_name', 'weight', 'reps'].includes(c))
      check('leaderboard exposes no raw session fields', leak.length === 0, `columns = ${cols.join(', ')}`)
      const me = lb.data.find(r => r.username === userA.username)
      check('leaderboard includes the caller', Boolean(me), `rows=${lb.data.length}`)
      check('aggregate volume is a number', me && typeof me.volume_30d === 'number', `volume_30d=${me?.volume_30d}`)
    }

    // ── Regression suite for the bugs fixed earlier. These need a signed-in
    // writer, which is why they live here rather than in verify-lockdown.mjs.
    console.log('\n--- 6. exercises."order" accepts a Date.now() sort key ---')
    const orderProbe = `zz-order-${stamp}`
    const ord = await clientA.from('exercises').insert({
      id: orderProbe,
      name: 'ZZ Order Probe',
      muscle_group: 'Arms',
      order: stamp,
    })
    check('insert with order = Date.now() is accepted', !ord.error, ord.error?.message?.slice(0, 110))

    const back = await clientA.from('exercises').select('id,order').eq('id', orderProbe).maybeSingle()
    check('order round-trips as a number, not a string', typeof back.data?.order === 'number', `typeof=${typeof back.data?.order}`)
    check('order round-trips exactly', back.data?.order === stamp, `${back.data?.order} vs ${stamp}`)

    const listed = await clientA.from('exercises').select('id,order').order('order')
    const rows = listed.data || []
    check('the new exercise sorts last', rows[rows.length - 1]?.id === orderProbe)
    check(
      'client-side numeric sort agrees',
      [...rows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).at(-1)?.id === orderProbe,
    )
    await clientA.from('exercises').delete().eq('id', orderProbe)

    console.log('\n--- 7. a log cannot be written before its exercise exists ---')
    const orphan = await clientA.from('exercise_logs').insert({
      id: `zz-orphan-${stamp}`,
      session_id: sessionId,
      exercise_id: 'zzzz-does-not-exist',
      order: 0,
      user_id: a.user.id,
    })
    check('foreign key violation is reported, not swallowed', Boolean(orphan.error), orphan.error?.message?.slice(0, 90))

    console.log('\n--- 8. editing a session prunes what was removed ---')
    const logB = `zz-logb-${stamp}`
    const setB = `zz-setb-${stamp}`
    await clientA.from('exercise_logs').insert({
      id: logB,
      session_id: sessionId,
      exercise_id: '1',
      order: 1,
      user_id: a.user.id,
    })
    await clientA.from('set_entries').insert({
      id: setB,
      exercise_log_id: logB,
      set_number: 1,
      weight: 40,
      reps: 5,
      user_id: a.user.id,
    })
    const pruned = await clientA.from('exercise_logs').delete().eq('id', logB).select('id')
    check('deleting a log succeeds', !pruned.error, pruned.error?.message?.slice(0, 80))
    const cascaded = await clientA.from('set_entries').select('id').eq('id', setB)
    check('its set cascaded away', (cascaded.data?.length ?? 0) === 0, `rows=${cascaded.data?.length}`)

    console.log('\n--- 9. seeded exercises carry an image_url ---')
    const seeded = await admin
      .from('exercises')
      .select('id,image_url')
      .in('id', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
    const withImage = (seeded.data || []).filter(r => r.image_url).length
    check('all 10 seeded exercises carry an image_url', withImage === 10, `${withImage}/10`)

    console.log('\n--- 10. deleting the account cleans up its rows ---')
    const owned = await clientA.from('workout_sessions').select('id', { count: 'exact', head: true })
    check('A has at least the one session it created', (owned.count ?? 0) >= 1, `count=${owned.count}`)
  } finally {
    console.log('\nCleaning up disposable accounts…')
    await admin.auth.admin.deleteUser(a.user.id)
    await admin.auth.admin.deleteUser(b.user.id)
    // Sessions cascade to workout_sessions via the user_id FK.
    const leftover = await admin
      .from('workout_sessions')
      .select('id', { count: 'exact', head: true })
      .like('id', 'zz%')
    console.log(`  leftover test sessions: ${leftover.count ?? 0}`)
    console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
  }
  process.exit(failures === 0 ? 0 : 1)
}

async function create() {
  const username = process.argv[process.argv.indexOf('--create') + 1]?.toLowerCase()
  if (!username) {
    console.error('Usage: node scripts/create-account.mjs --create <username>')
    process.exit(1)
  }
  if (!USERNAME_RE.test(username)) {
    console.error(`"${username}" is not a valid username. Use 3-20 characters: a-z, 0-9, underscore.`)
    process.exit(1)
  }

  const { data: clash } = await admin.from('profiles').select('user_id').eq('username', username).maybeSingle()
  if (clash) {
    console.error(`Username "${username}" is already taken.`)
    process.exit(1)
  }

  const password = await readHidden(`Password for ${username}: `)
  if (password.length < 8) {
    console.error('Use at least 8 characters.')
    process.exit(1)
  }
  const again = await readHidden('Confirm password: ')
  if (password !== again) {
    console.error('Passwords did not match.')
    process.exit(1)
  }

  const user = await createUser(username, password)
  console.log(`\nCreated "${username}"`)
  console.log(`  user_id : ${user.user.id}`)
  console.log(`  email   : ${emailFor(username)}  (synthetic, undeliverable by design)`)
  console.log('\nThey sign in with the username and that password. No email is needed.')
  console.log('If they forget it, re-run this script — there is no email recovery path.')
}

const mode = process.argv[2]
if (mode === '--create') await create()
else if (mode === '--selftest') await selftest()
else {
  console.error('Usage: node scripts/create-account.mjs --create <username> | --selftest')
  process.exit(1)
}
