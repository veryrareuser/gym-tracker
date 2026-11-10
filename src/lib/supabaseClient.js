// src/lib/supabaseClient.js
import { PostgrestClient } from '@supabase/postgrest-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const base = supabaseUrl && supabaseAnonKey ? { url: supabaseUrl, key: supabaseAnonKey } : null

/**
 * Rebuilt whenever the session token changes, because the token travels in a
 * request header and the client captures headers at construction.
 *
 * `supabase` is exported with `let` on purpose: ES module exports are live
 * bindings, so every importer sees the reassigned client without re-importing.
 */
export let supabase = null

let currentToken = null

export function setSessionToken(token) {
  currentToken = token || null
  supabase = base
    ? new PostgrestClient(`${base.url}/rest/v1`, {
        headers: {
          // The publishable key identifies the project and the role. The role is what
          // the RLS policies are written against, so it has to be sent as a bearer
          // token exactly as supabase-js sent it.
          apikey: base.key,
          Authorization: `Bearer ${base.key}`,
          // The session token. This is the whole of the app's authentication: RLS
          // resolves it inside private.current_account().
          ...(currentToken ? { 'X-Session-Token': currentToken } : {}),
        },
        schema: 'public',
      })
    : null
}

export const isConfigured = Boolean(base)

setSessionToken(null)
