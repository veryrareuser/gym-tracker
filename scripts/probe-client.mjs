// Compares the current @supabase/supabase-js client against a bare
// @supabase/postgrest-js client, against the live database, using a throwaway
// account so the authenticated paths are actually exercised.
//
// Run: node scripts/probe-client.mjs
import { createClient } from '@supabase/supabase-js'
import { PostgrestClient } from '@supabase/postgrest-js'

const URL = 'https://riogpgsstcafsvhikjhg.supabase.co'
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpb2dwZ3NzdGNhZnN2aGlramhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4MjcyOTMsImV4cCI6MjEwNTQwMzI5M30.5S8oIHDXp9vhBqhOISffPsrMWU-IHff7WBWksceznNg'

function supabaseClient(token) {
  return createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { schema: 'public' },
    global: { headers: token ? { 'X-Session-Token': token } : {} },
  })
}

function bareClient(token) {
  return new PostgrestClient(`${URL}/rest/v1`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      ...(token ? { 'X-Session-Token': token } : {}),
    },
    schema: 'public',
  })
}

const shape = v => JSON.stringify(v, (k, val) => (val === undefined ? '<undefined>' : val))

async function compare(label, fn) {
  const a = await fn(supabaseClient(null))
  const b = await fn(bareClient(null))
  const same = shape(a) === shape(b)
  console.log(`${same ? 'MATCH  ' : 'DIFFER '} ${label}`)
  if (!same) {
    console.log('   supabase-js :', shape(a))
    console.log('   postgrest-js:', shape(b))
  }
  return same
}

let allSame = true

// --- unauthenticated -------------------------------------------------------
allSame &= await compare('rpc whoami (no token)', async c => {
  const { data, error } = await c.rpc('whoami')
  return { data, error: error && error.message }
})
allSame &= await compare('from workout_sessions select (no token)', async c => {
  const { data, error } = await c.from('workout_sessions').select('*')
  return { rows: Array.isArray(data) ? data.length : data, error: error && error.message }
})
allSame &= await compare('rpc login (bad password)', async c => {
  const { data, error } = await c.rpc('login', { p_username: 'carlos', p_password: 'definitely-wrong' })
  return { data, error: error && error.message }
})
allSame &= await compare('rpc leaderboard (no token)', async c => {
  const { data, error } = await c.rpc('leaderboard', {})
  return { rows: Array.isArray(data) ? data.length : data, error: error && error.message }
})
allSame &= await compare('insert (no token) is rejected', async c => {
  const { data, error } = await c
    .from('workout_sessions')
    .insert({ id: `zz-probe-${Date.now()}`, date: '2026-01-01', notes: 'probe' })
  return { data, error: error && error.message }
})

// --- authenticated with a throwaway account --------------------------------
const USER = 'zzprobe'
const PASS = 'probe-password-123'

async function withToken(fn) {
  const { data, error } = await bareClient(null).rpc('login', { p_username: USER, p_password: PASS })
  if (!data) throw new Error(`login failed: ${error && error.message}`)
  const token = data
  const a = await fn(supabaseClient(token))
  const b = await fn(bareClient(token))
  const same = shape(a) === shape(b)
  console.log(`${same ? 'MATCH  ' : 'DIFFER '} ${labelAuth}`)
  if (!same) {
    console.log('   supabase-js :', shape(a))
    console.log('   postgrest-js:', shape(b))
  }
  return same
}

let labelAuth = 'rpc whoami (token)'
allSame &= await withToken(async c => {
  const { data, error } = await c.rpc('whoami')
  return {
    isArray: Array.isArray(data),
    username: Array.isArray(data) ? data[0] && data[0].username : data && data.username,
    error: error && error.message,
  }
})

labelAuth = 'from workout_sessions select (token)'
allSame &= await withToken(async c => {
  const { data, error } = await c.from('workout_sessions').select('*').eq('is_draft', false).order('date')
  return { rows: Array.isArray(data) ? data.length : data, error: error && error.message }
})

labelAuth = 'narrow select with nested set_entries (token)'
allSame &= await withToken(async c => {
  const { data, error } = await c
    .from('workout_sessions')
    .select('id,date,notes,is_draft,duration_seconds,exercise_logs(id,exercise_id,order,set_entries(id,set_number,weight,reps,note))')
    .eq('is_draft', false)
    .order('date')
  return { rows: Array.isArray(data) ? data.length : data, error: error && error.message }
})

labelAuth = 'count exact head (token)'
allSame &= await withToken(async c => {
  const { count, error } = await c.from('exercise_logs').select('id', { count: 'exact', head: true })
  return { count, error: error && error.message }
})

labelAuth = 'rpc friend_prs (token)'
allSame &= await withToken(async c => {
  const { data, error } = await c.rpc('friend_prs', { p_username: 'carlos' })
  return { rows: Array.isArray(data) ? data.length : data, error: error && error.message }
})

labelAuth = 'rpc set_profile_visible (token)'
allSame &= await withToken(async c => {
  const { data, error } = await c.rpc('set_profile_visible', { p_visible: true })
  return { data, error: error && error.message }
})

labelAuth = 'upsert onConflict (token)'
allSame &= await withToken(async c => {
  const id = `zz-probe-ex-${Date.now()}`
  const { error } = await c
    .from('exercises')
    .upsert({ id, name: 'Probe Exercise', muscle_group: 'Chest', order: 1, user_id: 'x' }, { onConflict: 'user_id,id' })
  // user_id is forced below by the caller, so expect an RLS rejection here; we only
  // compare that the two clients agree on the outcome.
  return { error: error && error.message }
})

labelAuth = 'logout (token)'
allSame &= await withToken(async c => {
  const { data, error } = await c.rpc('logout', { p_token: 'not-a-real-token' })
  return { data, error: error && error.message }
})

console.log(allSame ? '\nBoth clients behave identically.' : '\nTHE CLIENTS DIFFER.')
process.exit(allSame ? 0 : 1)
