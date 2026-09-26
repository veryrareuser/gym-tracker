// src/lib/auth.js
// Session handling on an opaque token, issued by public.login() in Postgres.
//
// Why not Supabase Auth: this project cannot reach the Supabase dashboard, and
// every provisioning path through GoTrue needs it. The token model needs nothing
// external — no dashboard, no email, no SMTP quota — and the credential cannot be
// forged, because it is 32 random bytes compared as a SHA-256 hash in the
// database rather than a self-describing token anyone could mint.
//
// The token lives in localStorage and travels in the X-Session-Token header.
// RLS resolves it, so the publishable key on its own grants nothing.

import { supabase, setSessionToken, isConfigured } from './supabaseClient'

const TOKEN_KEY = 'gym_token'

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/

// Cached so write paths can stamp user_id synchronously and components can read the
// display name without prop drilling through the router Outlet. Set before the first
// render that needs it, so no component observes a stale value.
let _accountId = null
let _username = null

function readStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

/** Rebuild the Supabase client around a token, or clear it. */
function applyToken(token) {
  setSessionToken(token)
  if (!token) {
    _accountId = null
    _username = null
  }
}

/**
 * Restore a session on load and confirm the token is still valid server-side.
 * A token can be revoked or expire, so localStorage alone is not trusted: without
 * this check the app would render signed-in chrome and then fail every query.
 */
export async function restoreSession() {
  const token = readStoredToken()
  if (!token || !isConfigured) return null
  applyToken(token)
  const { data, error } = await supabase.rpc('whoami')
  if (error || !data || data.length === 0) {
    clearSession()
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  _accountId = row.user_id
  _username = row.username
  return { userId: row.user_id, username: row.username }
}

export async function signIn(username, password) {
  if (!isConfigured) return { error: 'This build has no database configured.' }
  const clean = String(username || '').trim().toLowerCase()
  if (!USERNAME_RE.test(clean)) {
    return { error: 'Username must be 3-20 characters: a-z, 0-9, or underscore.' }
  }
  applyToken(null)
  const { data, error } = await supabase.rpc('login', { p_username: clean, p_password: password })
  if (error) return { error: 'Invalid username or password.' }
  if (!data) return { error: 'Sign-in failed.' }

  try {
    localStorage.setItem(TOKEN_KEY, data)
  } catch {
    return { error: 'Could not save the session in this browser.' }
  }
  applyToken(data)

  const { data: me } = await supabase.rpc('whoami')
  const row = Array.isArray(me) ? me[0] : me
  _accountId = row?.user_id ?? null
  _username = clean
  return { userId: _accountId, username: clean }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable; the in-memory session is still cleared below */
  }
  applyToken(null)
}

export async function signOut() {
  const token = readStoredToken()
  if (token) {
    // Re-attach the token first so the RPC can identify which session row to
    // delete, then tear the session down locally.
    setSessionToken(token)
    await supabase.rpc('logout', { p_token: token }).catch(() => {})
  }
  // Best effort: the local token is gone either way, so a failure here only leaves
  // a row in private.sessions that expires on its own.
  clearSession()
}

export function currentUserId() {
  return _accountId
}

export function currentUsername() {
  return _username
}
