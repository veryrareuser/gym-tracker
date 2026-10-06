# Security remediation — 6 October 2026

## Implemented

- Live `security_hardening_20261006`: committed login-failure throttling (10 attempts per username/15 minutes; global 60/minute), one cost-10 bcrypt verification per valid-format request, hashed seven-day session tokens and bounded active sessions.
- Child/parent ownership enforced by composite foreign keys; owner-scoped RLS retained. Private auth tables have deny-by-default RLS and no direct client grants. Unnecessary table/default privileges removed for the application migration role.
- Server-side field/numeric limits, parent NOT NULL constraints, per-account row quotas and future-workout rejection. Monthly leaderboard inputs normalize to whole months; aggregate joins explicitly enforce ownership.
- Tab-scoped credentials/caches/drafts; old persistent app storage removed. Invalid sessions clear cached app data. Failed logout remains retryable. Native account-security dialog supports password changes and revoking other sessions.
- Production meta CSP, no-referrer and refusal to render inside frames. Local development removes only the meta CSP to permit Vite refresh; production builds retain it.
- Dependencies pinned and vulnerable tooling chains replaced; npm audit reports zero known advisories. Commit-pinned CI verifies audit, lint, date/storage tests and build before Pages publishing. Dependabot and GitHub secret push protection enabled.
- Unsafe executable setup SQL retired fail-closed; historical embedded-password instructions removed. HTTP verification only targets unique disposable IDs; SQL checks use transactional fixtures and rollback. Isolation checks restore original sharing consent and revoke test sessions. Backup pagination failures abort; all four counts checked before writing.
- Sensitive full application schema/account/data snapshots and a fail-closed empty-schema restore script saved locally in ignored `backups/`. Isolated transactional restore recreated tables, constraints, indexes, functions, triggers, policies and grants; all restored account/workout records matched live data. This does not reconstruct provider infrastructure, project configuration, Storage/Auth services or live sessions.

## Verification

Lint, production build, date tests and browser-storage cleanup tests pass. Rollback-only DB tests check anonymous denial, cross-owner foreign-key rejection, password changes/revocation, rate counters, seven-day expiry and normalized month inputs. Browser tests signed in with a disposable account and exercised password change and other-session revocation; the account was deleted. Existing workout counts remain unchanged: 28 exercises, 13 sessions, 116 logs, 171 sets across two accounts.

## Remaining boundaries

- The owner approved the offered Postgres 17.11.0.003 upgrade, including downtime; it was started through Supabase. Confirm live version and post-upgrade checks before considering it complete.
- GitHub branch protection must be confirmed after the first verified workflow deployment, so enabling protection cannot block publication of the workflow itself.
- GitHub Pages shares a user-wide origin and cannot set application response headers or HttpOnly authentication cookies. Meta CSP and frame refusal are mitigations, not substitutes for dedicated hosting with header-based framing/CSP protection and a server-managed session. No destination/domain was supplied; no hosting migration was attempted.
- No private off-device backup destination was supplied. Local restore verification is complete, but encrypted off-device backups/provider-level recovery remain unresolved. Sensitive dumps must never go into this public repository or Pages artifacts.
- The owner must enable/verify MFA on GitHub and Supabase provider accounts and replace the historically exposed password anywhere reused. Actual user passwords were not guessed, disclosed or changed by the audit. In-app MFA requires an authentication architecture change and user enrollment; it was not implemented.
- Throttling bounds expensive login work but does not eliminate distributed denial of service or temporary lockout. Quotas do not replace provider spending/resource controls. Public read-only knowledge of an anon key is expected and is not credential compromise.

Zero known dependency advisories does not mean zero vulnerabilities. These checks cannot prove absence of unknown bugs or prior compromise.
