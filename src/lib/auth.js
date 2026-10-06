// src/lib/auth.js
// Session handling on an opaque token, issued by public.login() in Postgres.
//
// Legacy custom authentication: 32 random bytes, stored as a SHA-256 hash.
// A public anon key is not a JWT signing secret. Both token models require proper
// server-side verification; this app resolves its opaque token inside RLS.
//
// The token lives in sessionStorage and travels in the X-Session-Token header.
// RLS resolves it, so the publishable key on its own grants nothing.

import { supabase, setSessionToken, isConfigured } from './supabaseClient'
import { clearBrowserData, removeLegacyData } from './browserSession'

const TOKEN_KEY = 'gym_token'

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/

// Cached so write paths can stamp user_id synchronously and components can read the
// display name without prop drilling through the router Outlet. Set before the first
// render that needs it, so no component observes a stale value.
let _accountId = null
let _username = null

function readStoredToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
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
 * A token can be revoked or expire, so browser storage alone is not trusted: without
 * this check the app would render signed-in chrome and then fail every query.
 */
export async function restoreSession() {
  removeLegacyData()
  const token = readStoredToken()
  if (!token || !isConfigured) {
    clearSession()
    return null
  }
  applyToken(token)
  const { data, error } = await supabase.rpc('whoami')
  if (error) throw new Error('Could not verify your session. Check your connection and reload.')
  if (!data || data.length === 0) {
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
  if (error) return { error: 'Could not sign in. Check your connection and try again.' }
  if (!data) return { error: 'Sign-in failed. Check your credentials, or wait 15 minutes after repeated attempts.' }

  try {
    sessionStorage.setItem(TOKEN_KEY, data)
  } catch {
    await supabase.rpc('logout', { p_token: data })
    return { error: 'Could not save the session in this browser.' }
  }
  applyToken(data)

  const { data: me, error: identityError } = await supabase.rpc('whoami')
  const row = Array.isArray(me) ? me[0] : me
  if (identityError || !row) {
    await supabase.rpc('logout', { p_token: data })
    clearSession()
    return { error: 'Could not verify your account. Try signing in again.' }
  }
  _accountId = row?.user_id ?? null
  _username = clean
  return { userId: _accountId, username: clean }
}

export function clearSession() {
  clearBrowserData()
  applyToken(null)
}

/**
 * Ask the server whether the stored token is still good.
 *
 * This exists because a dead token is silent. RLS resolves an expired or revoked token
 * to NULL, which makes every query return zero rows and no error — so a long-open tab
 * would show an empty dashboard that is indistinguishable from a genuine "no workouts
 * yet". Row counts cannot distinguish those two cases; only the server can.
 *
 * The three-way result matters. A network error means we do not know, and the caller
 * must not sign the user out over a dropped connection.
 *
 * @returns {Promise<'valid'|'expired'|'unknown'>}
 */
export async function verifySession() {
  if (!isConfigured || !supabase) return 'unknown'
  const { data, error } = await supabase.rpc('whoami')
  if (error) return 'unknown'
  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    // A definitive empty response: the token is expired, revoked, or was deleted when
    // the password was reset. Drop it so we are not left holding a dead credential.
    clearSession()
    return 'expired'
  }
  _accountId = row.user_id
  _username = row.username
  return 'valid'
}

export async function signOut() {
  const token = readStoredToken()
  if (token) {
    // Re-attach the token first so the RPC can identify which session row to delete.
    setSessionToken(token)
    // try/catch, not .catch(): supabase.rpc() returns a PostgrestBuilder, which is
    // thenable but is not a Promise and has no .catch method. Calling .catch() on it
    // throws a TypeError synchronously, which aborted sign-out before it cleared
    // anything — the button appeared to do nothing at all.
    const { error } = await supabase.rpc('logout', { p_token: token })
    if (error) throw new Error('Could not revoke your session. Check your connection and try signing out again.')
  }
  clearSession()
}

export async function changePassword(current, next) {
  if (next.length < 12 || new TextEncoder().encode(next).length > 72) {
    throw new Error('Use at least 12 characters and no more than 72 UTF-8 bytes.')
  }
  const { data, error } = await supabase.rpc('change_password', { p_current: current, p_new: next })
  if (error || data !== true) throw new Error('Password change failed. Check your current password, or wait after repeated attempts.')
}

export async function revokeOtherSessions() {
  const { data, error } = await supabase.rpc('revoke_other_sessions')
  if (error || data !== true) throw new Error('Could not sign out other sessions. Please try again.')
}

export function currentUserId() {
  return _accountId
}

export function currentUsername() {
  return _username
}
