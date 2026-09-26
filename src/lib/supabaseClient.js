// src/lib/supabaseClient.js
import { createClient } from '@supabase/supabase-js'

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
    ? createClient(base.url, base.key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        db: { schema: 'public' },
        global: {
          headers: currentToken ? { 'X-Session-Token': currentToken } : {},
        },
      })
    : null
}

export const isConfigured = Boolean(base)

setSessionToken(null)
