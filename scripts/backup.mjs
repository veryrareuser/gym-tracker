// Dumps every table to a timestamped JSON file.
//
// Why this exists: the free plan has no automated backups, so a mistaken DELETE is
// unrecoverable. Run it before any schema or policy change.
//
// Usage:
//   node scripts/backup.mjs            # reads SB_URL + SB_KEY from the environment
//
// The key needs read access. Right now the publishable anon key is enough, because
// every table is still world-readable. Once the RLS lockdown lands you will need
// either a service_role key or an access token for a signed-in user, since anon
// will correctly have no grants at all.

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../backups')

const base = process.env.SB_URL
const key = process.env.SB_KEY

if (!base || !key) {
  console.error('Set SB_URL and SB_KEY first. Example:')
  console.error('  $env:SB_URL  = "https://<project>.supabase.co"')
  console.error('  $env:SB_KEY  = "<publishable or service_role key>"')
  process.exit(1)
}

const headers = { apikey: key, Authorization: `Bearer ${key}` }

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
const backup = {
  taken_at: new Date().toISOString(),
  note: 'Full dump of the public schema. Restore with the id fields preserved.',
  tables: {},
}

const targets = [
  ['exercises', '?select=*&order=id'],
  ['workout_sessions', '?select=*&order=date'],
  ['exercise_logs', '?select=*&order=id'],
  ['set_entries', '?select=*&order=id'],
]

let failures = 0
for (const [table, query] of targets) {
  try {
    const rows = await fetchTable(table, query)
    backup.tables[table] = rows
    console.log(`  ${table.padEnd(18)} ${String(rows.length).padStart(4)} rows`)
  } catch (err) {
    backup.tables[table] = { error: err.message }
    failures++
    console.error(`  ${table.padEnd(18)} FAILED: ${err.message}`)
  }
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

// A dump that silently lost a table is worse than no dump, so verify the counts
// against the live database before calling it good.
const live = await fetch(`${base}/rest/v1/exercise_logs?select=id`, { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } })
const contentRange = live.headers.get('content-range') || ''
const total = Number(contentRange.split('/')[1] || 0)
const dumped = backup.tables.exercise_logs?.length ?? 0
console.log(`\nCross-check: exercise_logs live=${total} dumped=${dumped} ${total === dumped ? 'MATCH' : 'MISMATCH'}`)
if (total !== dumped) process.exit(1)
