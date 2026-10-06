# Gym Tracker

Mobile-first workout tracking with React, Vite and Supabase. Accounts use server-side bcrypt password verification and opaque, hashed session tokens—not a password embedded in JavaScript.

## Development

Run `npm ci`, `npm run dev`, `npm run lint`, `npm run verify:dates` and `npm run build`. The production public Supabase URL and anon key are intentionally public. Never put service-role keys, database passwords or account passwords in Vite variables or Git.

Sessions and workout caches are tab-scoped and sessions expire after seven days. Account security controls change your password and revoke other sessions. A failed remote logout remains retryable. Closing a tab clears its local session; cloud workouts remain saved. Offline caches are not a full backup.

## Database security

The retired `supabase-schema.sql` is NOT a setup script. The existing deployment's reviewed hardening migration is in `sql/security-hardening.sql`, with aggregate functions in `sql/secure-aggregates.sql`. These are upgrades to an existing schema, not a fresh-install recipe. Apply through versioned Supabase migrations after backing up and reviewing the target schema. Run `sql/verify-security.sql` for rollback-only fixture verification.

Public tables require owner-scoped RLS and explicit grants. Composite foreign keys enforce child/parent ownership. Private auth tables deny direct client access. Login limits, field bounds and row quotas are enforced server-side. Never add permissive `USING (true)` policies to app tables.

## Deployment and maintenance

GitHub Actions verifies dependencies, lint, date tests and builds before Pages deployment. Actions are commit-pinned. Dependency update PRs are scheduled by Dependabot. Branch protections and repository security settings are configured separately in GitHub.

The historical embedded password is permanently public in Git history: replace it wherever it was reused. Use unique passwords and enable MFA on GitHub and Supabase provider accounts.

GitHub Pages cannot provide custom response headers or HttpOnly authentication cookies. Meta CSP, no-referrer and frame refusal reduce exposure but do not replace a dedicated origin with header-based CSP/frame protections and a server-managed session. No security review can guarantee zero weaknesses.

## Recovery

`npm run backup` exports one authenticated account, checks every table count and aborts on pagination errors. Keep full schema/account/data backups separately; `backups/` is ignored and must never be published. The local full backups made before/after the October 2026 hardening contain sensitive password hashes. The hardened backup was restored into isolated schemas within a rolled-back transaction; all account/workout rows matched production. This is an application restore drill, not a replacement for independent provider-level recovery. Encrypted off-device backups still need a private destination.
