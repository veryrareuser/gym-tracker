// src/lib/auth.js
// Session handling, and the username <-> email mapping.
//
// Supabase Auth signs in with an email, but this product is username-only. Rather
// than collect a real address that nobody wants to hand over, a username is mapped
// to an undeliverable synthetic one. `.invalid` is permanently unregistrable
// (RFC 2606), so mail to it can never be delivered, bounced into a real inbox, or
// used to identify anyone.
//
// The slug is derived from the project URL at runtime, so nothing about the
// project is hardcoded here.

import { supabase } from './supabaseClient'

const PROJECT_SLUG = (() => {
  const url = import.meta.env.VITE_SUPABASE_URL
  if (!url) return 'gym.invalid'
  try {
    return new URL(url).hostname.split('.')[0]
  } catch {
    return 'gym.invalid'
  }
})()

const SYNTHETIC_DOMAIN = `${PROJECT_SLUG}.invalid`

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/

/** "carlo" -> "carlo@riogpgsstcafsvhikjhg.invalid" */
export function emailForUsername(username) {
  return `${username.toLowerCase()}@${SYNTHETIC_DOMAIN}`
}

/** Inverse of emailForUsername, tolerant of a non-synthetic address. */
export function usernameFromEmail(email) {
  if (!email) return null
  const [local, domain] = String(email).split('@')
  if (!local || domain !== SYNTHETIC_DOMAIN) return local || null
  return local
}

export async function signIn(username, password) {
  if (!supabase) return { error: 'This build has no database configured.' }
  const clean = String(username || '').trim().toLowerCase()
  if (!USERNAME_RE.test(clean)) {
    return { error: 'Username must be 3-20 characters: a-z, 0-9, or underscore.' }
  }
  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailForUsername(clean),
    password,
  })
  if (error) return { error: error.message }
  return { user: data.user, username: usernameFromEmail(data.user?.email) || clean }
}

export async function signOut() {
  if (!supabase) return { error: null }
  return supabase.auth.signOut()
}

// Cached so write paths can stamp user_id synchronously. supabase.auth.getUser()
// is async and returns a promise, so it cannot be used inline in a query builder.
// The username is cached alongside it so a component that only needs the display
// name (the leaderboard's "this row is yours" highlight) can read it without prop
// drilling through the router Outlet.
let _userId = null
let _username = null

/** Current session, or null. */
export async function getSession() {
  if (!supabase) {
    _userId = null
    _username = null
    return null
  }
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.user) {
    _userId = null
    _username = null
    return null
  }
  const user = data.session.user
  _userId = user.id
  _username = usernameFromEmail(user.email)
  return { user, username: _username || user.id.slice(0, 8) }
}

/**
 * The current user id, for stamping writes. Null when signed out.
 *
 * Every write path in db.js must bail on null rather than send a null user_id —
 * the RLS `with check` clause rejects it anyway, and failing explicitly is easier
 * to diagnose than a silent no-op.
 */
export function currentUserId() {
  return _userId
}

export function currentUsername() {
  return _username
}

/**
 * Subscribe to session changes. Keeps the cache in step and notifies the app.
 * Returns an unsubscribe function.
 */
export function onAuthChange(callback) {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    _userId = session?.user?.id ?? null
    _username = usernameFromEmail(session?.user?.email) ?? null
    callback(session ? { user: session.user, username: _username } : null)
  })
  return () => data.subscription.unsubscribe()
}
