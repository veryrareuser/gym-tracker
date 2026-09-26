// Account provisioning.
//
//   node scripts/create-account.mjs <username> <invite-code>
//
// The password is prompted for locally, hidden, and passed straight to Postgres, which
// bcrypts it immediately. It is never an argument, never printed, and never logged.
//
// ⚠  THIS SCRIPT IS CURRENTLY INERT.
//
// It calls public.provision_account, which was scaffolding for the period when the
// Supabase dashboard was unreachable and there was no service_role key to create an
// account with. Both accounts now exist, so that function — and the invites table
// behind it — were dropped in the remove_account_provisioning migration. Leaving an
// unused capability reachable from the public API is not a neutral default.
//
// To add an account later, re-apply private.create_account and
// public.provision_account from that migration, mint an invite, then run this. Keeping
// them out of the schema means adding a user is a deliberate act rather than something
// quietly available.
//
// The isolation assertions that used to live here as `--selftest` are now
// scripts/verify-isolation.mjs. They could never run from this file — they hardcoded an
// invite code of 'SELFTEST' that no invite matches — and they did not actually need to
// create accounts at all.

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
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

const [usernameRaw, invite] = process.argv.slice(2)

if (!usernameRaw || !invite) {
  console.error('Usage: node scripts/create-account.mjs <username> <invite-code>')
  console.error('')
  console.error('This will fail until public.provision_account is re-created — see the top')
  console.error('of this file. Both accounts already exist, so it is normally not needed.')
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

const { data, error } = await client(null).rpc('provision_account', {
  p_invite: invite,
  p_username: username,
  p_password: password,
})

if (error) {
  console.error(`\nCould not create the account: ${error.message}`)
  if (/invite/i.test(error.message)) {
    console.error('If it says the invite is used, it has already been spent — mint a new one.')
  }
  if (/not found|does not exist|404/i.test(error.message)) {
    console.error('provision_account has been dropped, so no account can be created this way.')
  }
  process.exit(1)
}

const row = Array.isArray(data) ? data[0] : data
console.log(`\nCreated "${row.username}".`)
console.log(`Sign in with username: ${row.username}`)
console.log('There is no email, so there is also no reset link. Re-run this command to set a new password.')
