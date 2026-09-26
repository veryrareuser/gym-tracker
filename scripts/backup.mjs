// Dumps every table to a timestamped JSON file.
//
// Why this exists: the free plan has no automated backups, so a mistaken DELETE is
// unrecoverable. Run it before any schema or policy change.
//
// Usage:
//   node scripts/backup.mjs            # needs SB_TOKEN, or SB_USER + SB_PASSWORD
//
// A session token is required now that the RLS lockdown has landed. The publishable
// key on its own correctly sees zero rows, which would produce an empty file that
// looks like a successful backup. That is the failure mode this script guards
// against most carefully: an all-empty dump is treated as an error, never a backup.

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readHidden } from './lib/hidden-prompt.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../backups')

const base = process.env.SB_URL
const key = process.env.SB_KEY

if (!base || !key) {
  console.error('Set SB_URL and SB_KEY first. Example:')
  console.error('  $env:SB_URL  = "https://<project>.supabase.co"')
  console.error('  $env:SB_KEY  = "<publishable key>"')
  process.exit(1)
}

// Prefer a token that is already in hand. Otherwise sign in, so the script works
// without the user having to copy a token out of the browser.
async function resolveToken() {
  if (process.env.SB_TOKEN) return process.env.SB_TOKEN.trim()
  const user = process.env.SB_USER
  const pass = process.env.SB_PASSWORD
  if (!user) {
    console.error('\nThis backup needs a signed-in session, because anon now correctly')
    console.error('sees zero rows. Provide either:')
    console.error('  $env:SB_TOKEN = "<a session token>"')
    console.error('  $env:SB_USER = "carlo"; $env:SB_PASSWORD = "<password>"')
    console.error('\nA token from a signed-in session: devtools > Application > Local Storage > gym_token')
    process.exit(1)
  }
  const password = pass || (await readHidden(`Password for ${user}: `))
  const res = await fetch(`${base}/rest/v1/rpc/login`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_username: user, p_password: password }),
  })
  if (!res.ok) {
    console.error(`Sign-in failed (${res.status}). Check the username and password.`)
    process.exit(1)
  }
  return res.json()
}

const token = await resolveToken()
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'X-Session-Token': token }

async function fetchTable(table, query = '') {
  const url = `${base}/rest/v1/${table}${query}`
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${table} failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const rows = await res.json()
  // PostgREST caps at 1000 rows by default. Paginate so the dump is complete.
  if (rows.length < 1000) return rows
  const collected = [...rows]
  let offset = collected.length
  for (;;) {
    const sep = url.includes('?') ? '&' : '?'
    const page = await fetch(`${url}${sep}&offset=${offset}&limit=1000`, { headers })
    if (!page.ok) break
    const batch = await page.json()
    if (batch.length === 0) break
    collected.push(...batch)
    if (batch.length < 1000) break
    offset = collected.length
  }
  return collected
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')

let failures = 0
const counts = {}

const targets = [
  ['exercises', '?select=*&order=id'],
  ['workout_sessions', '?select=*&order=date'],
  ['exercise_logs', '?select=*&order=id'],
  ['set_entries', '?select=*&order=id'],
]

for (const [table, query] of targets) {
  try {
    const rows = await fetchTable(table, query)
    counts[table] = rows.length
    console.log(`  ${table.padEnd(18)} ${String(rows.length).padStart(4)} rows`)
  } catch (err) {
    failures++
    counts[table] = null
    console.error(`  ${table.padEnd(18)} FAILED: ${err.message}`)
  }
}

// The dangerous case: a wrong or missing token makes every read return zero rows.
// That is indistinguishable from "success" if you only check for errors, and it
// would quietly replace a real backup with an empty one. Refuse to write it.
const allEmpty = Object.values(counts).every((n) => n === 0)
if (allEmpty) {
  console.error('\nEvery table came back empty. That is almost certainly a bad or missing')
  console.error('session token rather than an empty database, and RLS returns zero rows')
  console.error('instead of an error — so this would look like a clean run.')
  console.error('Refusing to write a backup file. Check the token, then retry.')
  process.exit(1)
}

const partial = Object.entries(counts).filter(([, n]) => n === 0).map(([t]) => t)
if (partial.length > 0) {
  console.error(`\nWarning: ${partial.join(', ')} came back empty.`)
}

const backup = {
  taken_at: new Date().toISOString(),
  note: 'Full dump of the public schema, one signed-in account. Restore with the id fields preserved.',
  row_counts: counts,
  tables: {},
}

for (const [table, query] of targets) {
  if (failures > 0 && counts[table] === null) {
    backup.tables[table] = { error: 'fetch failed' }
    continue
  }
  backup.tables[table] = await fetchTable(table, query)
}

mkdirSync(outDir, { recursive: true })
const file = resolve(outDir, `gym-tracker-${stamp}.json`)
writeFileSync(file, JSON.stringify(backup, null, 2))

const bytes = JSON.stringify(backup).length
console.log(`\nWrote ${file}`)
console.log(`Size: ${(bytes / 1024).toFixed(1)} KB`)

if (failures > 0) {
  console.error(`\n${failures} table(s) failed. This backup is NOT complete.`)
  process.exit(1)
}

// Cross-check the dump against the live count, so a truncated write is caught. The
// count query is scoped by RLS to the same account, so the two are comparable.
const live = await fetch(`${base}/rest/v1/exercise_logs?select=id`, {
  headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
})
const contentRange = live.headers.get('content-range') || ''
const total = Number(contentRange.split('/')[1] || 0)
const dumped = backup.tables.exercise_logs?.length ?? 0
console.log(`\nCross-check: exercise_logs live=${total} dumped=${dumped} ${total === dumped ? 'MATCH' : 'MISMATCH'}`)
if (total !== dumped) process.exit(1)
