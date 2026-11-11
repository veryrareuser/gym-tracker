# Gym Tracker

A mobile-first workout tracker, shipped as an installable PWA, for two people who train
at the same gym.

**Live:** <https://veryrareuser.github.io/gym-tracker/>

Log a workout, keep the plan that produced it, and see what the last three months
actually add up to. Everything works offline, every write syncs to Postgres, and the
database refuses to let one account see another account's training.

---

## What it is

The short version: a phone app that replaces the notes app, for workouts.

The long version is a set of decisions, each of which exists because the obvious
alternative lost data or lied to the user at some point.

- **The Log tab opens on your routines, not on the exercise library.** A library is
  dozens of rows and a routine is the six things you are actually doing today.
- **The clock is started by hand.** Opening the Log page does not start a timer,
  because simply looking at the app must not record time nobody spent training.
- **The clock keeps counting while the app is closed.** The elapsed time comes from a
  stored instant, never from counting ticks — a tick counter stops when the tab is
  hidden or the phone is killed, which is exactly the case the feature exists for.
- **An unfinished workout survives.** It is written to the database on a debounce and
  restored when you come back, on this device or another one.
- **Nothing is counted twice.** A workout in progress is a draft, and drafts are
  excluded from history, stats, the streak, the heatmap and the leaderboard.
- **The dates are yours.** A workout belongs to the calendar day you trained on, in
  your timezone, not to whatever UTC thought it was.
- **The data belongs to you.** Row-level security on the database, not a password
  check in the browser.

---

## The five screens

| Tab | What it is for |
| --- | --- |
| **Home** | Streak, sessions this month, last session's volume, time trained, and a big button that starts a workout. |
| **Log** | The routine list, then the workout: sets, weight, reps, notes, and a clock that follows you down the page. |
| **History** | A month calendar with the days you trained, and every workout listed underneath. |
| **Progress** | Weight progression, volume by week, month or session, personal records, a six-month activity heatmap, a muscle-balance body map, and the leaderboard. |
| **Exercises** | Your own exercise library: rename an exercise, delete one, or add from the 1,324-exercise catalogue. |

---

## Features

### Routines

A routine is a named, ordered list of exercises. "Upper Body" and "Leg Day" are two
short lists instead of one long one, and adding a leg exercise to one leaves the other
alone.

Routines **reference** the exercise library, they do not copy it. One exercise can sit
in several routines, and renaming it in the library renames it everywhere.

The order is the point — "back, chest, then shoulders" is a plan, and on the day you
want to start with back instead, you drag the grip handle. The handle is the whole
interface: grab it and the list moves under your finger, and the new order is written
when you let go. It is built on pointer events rather than the HTML drag-and-drop API,
because HTML5 drag-and-drop does not work with a finger.

Picking a routine never throws away a set that was already logged. A card the routine
has keeps its sets, a card it does not have is carried over with its sets, and a card
with nothing in it is dropped — an empty card is a placeholder, not a workout.

### The stopwatch

Four controls — Start, Pause, Resume, Stop — and a "Start over" once stopped. Pause
and Stop do the same arithmetic but mean different things: a paused measurement can be
resumed, a stopped one is final.

A pausable stopwatch is two numbers, not one. The record holds `accumulatedMs` (the
time already counted) and `runningSince` (when the current segment began). The elapsed
time is the two added together, derived from the wall clock rather than from counting
ticks, so it keeps running while the tab is hidden, the phone is locked, the app is
killed, or you are signed out.

The measurement lives in `localStorage` on purpose — it is deliberately *outside* the
normal sign-out cleanup, because a workout's length belongs to the workout and not to
whoever is holding the phone. It is also carried in the cloud draft, split across two
columns, so a workout can be timed on one device and finished on another.

The duration is stored as `duration_seconds` (the time already counted) plus
`started_at` (the start of the current segment). `NULL` means "never measured", which
is different from a zero-length workout.

It stays in view. The clock is pinned under the header while you scroll the exercise
cards, because the set you are typing is at the bottom of a long page and a clock at
the top means scrolling up to read the time and back down to type the next set.

### Drafts

An unfinished workout is written to the database as you go — on a three-second debounce,
and again when the app is backgrounded, which is the one lifecycle event a phone
reliably delivers before it is killed.

The Log tab comes back to the screen you left it on. A draft you walked out of stays
walked out of; a draft you did not dismiss resumes into its routine.

### The exercise library

1,324 exercises with artwork, searchable by name, body part and equipment, projected
down to a 194 KB index that loads in one request. Picking an exercise adds it to your
own library first, because a log row may only cite an exercise that exists.

An exercise used by a saved workout cannot be deleted — the database refuses, and the
app says how many workouts use it.

### Progress

- **Weight progression** per exercise, over the sessions you logged it in.
- **Volume per week, per month or per session**, whichever way you like to read it.
- **Personal records**, the heaviest set ever logged for each exercise.
- **An activity heatmap**, six months of training days, switchable between sessions and
  volume.
- **A muscle-balance body map**: front and back, shaded by how much work each region
  has had. Twelve regions can be credited from the exercise metadata; the six the
  artwork draws but the data cannot honestly measure are shown inert rather than
  quietly folded into a neighbour.
- **The leaderboard**: this month against the other account. One switch decides whether
  you are ranked at all, and it is below the table on purpose — a privacy control that
  is hard to find is not a privacy control.

### Offline and installable

The service worker is generated at build time. Navigations are network-first, hashed
assets are cache-first, everything else is stale-while-revalidate, and the Supabase API
is **never** cached — a cached response is signed-in training data scoped to one
session, and serving it to whoever opens the app next would show the wrong person's
workouts.

---

## Design

The visual system is **Neubrutalism**: square corners, thick black outlines, hard
offset shadows with no blur, flat fills, and one accent colour. Space Grotesk,
self-hosted, weights 400 and 700 only. Black text on every fill; white only on black.

The layout is a phone layout that does not reflow — the content is capped at 520px and
centred, and `<main>` is the scroll container so the body never scrolls, the tab bar
stays put without a scroll listener, and a sticky element inside it stays put.
Appearance follows the system setting; there is no in-app theme toggle.

---

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| UI | React 19 | — |
| Build | Vite 8 | Static output, one `index.html` |
| Routing | react-router-dom 7, **hash mode** | GitHub Pages serves a single HTML file |
| Database | Supabase Postgres 17.11 | Row-level security, no server to run |
| Client | `@supabase/postgrest-js` | The app only calls `.rpc()` and `.from()`. The full `supabase-js` bundle drags in auth, realtime, storage and Redux — about 215 KB the app never runs. |
| Charts | recharts | Lazy-loaded; most of the second chunk |
| Icons | lucide-react | — |
| Styling | CSS custom properties | Tailwind is imported for its reset only; no utility classes in the markup |
| Lint | oxlint | — |
| Deploy | GitHub Actions → GitHub Pages | Push to `main` publishes |

The production bundle is about 1.05 MB in total: 358 KB of app, 397 KB of charts
(loaded only on the Progress tab), 41 KB of body geometry, 40 KB of fonts, 21 KB of
CSS and the 194 KB exercise index.

---

## Architecture

### Local-first

Every write lands in browser storage first and is synced afterwards, so the app works
with no network and never blocks on one. Reads try the database, fall back to the
stored copy, and cache the result for thirty seconds. Concurrent callers share one
in-flight request, so a cold start makes one request rather than three.

Storage keys are namespaced per account. Two people sharing a device must not read
each other's cached workouts, and a cache key that outlives a sign-out is a leak. One
module owns every key and both clearing operations.

### Auth

No Supabase Auth, no email, no sign-up. Sign-in calls a database function that
verifies a bcrypt hash, mints a random 32-byte token, and returns it once. The
database stores only the token's SHA-256 hash; the token lives in `sessionStorage` and
travels as `X-Session-Token`.

The token is opaque on purpose. A publishable key is not a JWT signing secret, so a
self-describing token would be forgeable. Sessions last seven days and are revalidated
server-side on every load, on every focus, and whenever the tab becomes visible — a
session that dies while the tab is open ends the session with a message, not an empty
dashboard.

Failed logins are throttled server-side: ten attempts per username per fifteen
minutes, and sixty per minute globally. Unknown usernames and wrong passwords are
indistinguishable, in the response and in the work done.

### Dates

A session date is a plain calendar day, stored as a `date` and derived from the
device's own clock. `new Date().toISOString()` is UTC and files workouts under
yesterday for seven hours a day in UTC+7, which broke the streak counter, the "logged
today" check and the calendar highlight before it was fixed. The helpers in
`src/lib/utils.js` are the only sanctioned way to get a calendar day.

### The service worker

Generated at build time by a Vite plugin, because the precache manifest has to name
the content-hashed assets and those are not known until the bundle exists. It waits for
open tabs to close before activating and deleting the previous build's cache, so a tab
still running the old build keeps the chunks it needs.

---

## The database

Only the `public` schema is reachable from the browser.

| Table | What it holds |
| --- | --- |
| `exercises` | Your library. Primary key `(user_id, id)`. |
| `workout_sessions` | One workout: date, notes, duration, which routine it came from, and the draft flag. |
| `exercise_logs` | One exercise inside a workout, in order. |
| `set_entries` | One set: number, weight, reps, note. |
| `routines` / `routine_exercises` | The plans, and the ordered exercises in them. |

`session_summaries` is a `security_invoker` view over `workout_sessions` with the
volume, set count, exercise count and exercise names precomputed. It is 3.7 KB against
the 176 KB of the full tree, and the list pages read it instead of downloading every
workout on every tab switch. `security_invoker = true` is the whole point: a view
runs with its owner's rights by default, which would ignore the policies underneath.

Three tables in a `private` schema hold the credentials — accounts, sessions and login
throttle counters. They have row-level security enabled and **no policies at all**,
which makes them deny-by-default, and the browser has no grant on them at all.

### Functions

Eight public functions, all `SECURITY DEFINER` because they need to reach the private
schema: `login`, `logout`, `whoami`, `leaderboard`, `friend_prs`,
`set_profile_visible`, `change_password` and `revoke_other_sessions`.

The cross-account ones re-check the caller inside the body, because `SECURITY
DEFINER` bypasses row-level security. `set_profile_visible` takes no account id at
all — deliberately, since a parameter would let anyone re-publish a profile that opted
out.

Changing a function's signature means dropping the old one first. `CREATE OR REPLACE`
cannot change an argument list, so it quietly creates a second overload, the old one
stays live, and PostgREST answers an unparameterised call with HTTP 300.

### Row-level security

Sixteen policies on the four original tables and eight more on the routine tables, all
predicated on `(select private.current_account()) = user_id`. There is not one
`using (true)` policy in the database.

Composite foreign keys enforce child/parent ownership: a log can only cite a session
its own owner holds, and a set can only cite a log its own owner holds. Row-level
security decides whose rows you can see; the foreign keys decide whether a row points
at its owner's parent.

Server-side constraints and a trigger do the rest: field lengths, weight and rep
bounds, per-account row quotas, and a guard against future-dated workouts.

### Migrations

`sql/` holds reviewed **upgrades** to the existing database, not a fresh-install
recipe. There is no supported way to build this schema from empty.

`supabase-schema.sql` raises an exception on purpose. It is retired, it fails closed,
and it must not be restored. `supabase-rls-fix.sql` is a reference copy of the policy
set; the live database is authoritative, and that file has drifted before.

---

## Security

What is in place:

- Server-side bcrypt verification, one comparison per attempt, with a throttle on
  failure. Opaque, hashed, seven-day session tokens; the newest ten per account.
- Owner-scoped row-level security on every public table; deny-by-default private
  tables with no client grants; composite ownership foreign keys.
- Field bounds, row quotas and a future-date guard, all enforced by the database
  rather than by the client.
- A strict production Content-Security-Policy, `no-referrer`, and a refusal to render
  inside a frame. The app refuses to render in an iframe; that is a client-side check
  and it is a mitigation, not a substitute for header-based protection.
- Tab-scoped credentials and caches. Signing out clears them — except the stopwatch,
  deliberately.
- The published anon key grants nothing without a valid session token. That is
  expected and is not credential compromise.

What is still open, and is not fixed by any of the above:

- **GitHub Pages shares a user-wide origin** and cannot set response headers or
  HttpOnly cookies. The meta CSP and the frame refusal reduce exposure; they do not
  replace a dedicated origin with header-based protection and a server-managed session.
- **MFA is not implemented in the app**, and MFA on the GitHub and Supabase provider
  accounts is the owner's to enable.
- **The throttling bounds expensive login work**; it does not eliminate distributed
  denial of service or a temporary lockout.
- **Encrypted off-device backups have no private destination yet.** The local restore
  drill is complete, and it is not provider-level recovery.
- **The historical embedded password is permanently public in this repository's
  history.** Replace it anywhere it was reused.
- Zero known dependency advisories does not mean zero vulnerabilities.

The Supabase advisor flags the deliberately deny-all private tables and the
intentionally callable `SECURITY DEFINER` functions. Those warnings are expected by
design; do not add permissive policies or remove authentication checks to silence
them.

---

## Development

```bash
npm ci
npm run dev        # Vite dev server
npm run build      # dist/
npm run preview    # serve the build at /gym-tracker/
npm run lint       # oxlint
```

There is **no `npm test`**. The suites are run individually, and each one proves
something the others cannot.

### Credential-free suites

These are the CI gate, in this order:

```
verify:dates  verify:storage  verify:duration  verify:routines
verify:stopwatch-unit  verify:cache  verify:render  verify:geometry
verify:bodymap  verify:drafts  verify:restore  verify:buckets
build  verify:pwa  verify:sw
```

`verify:render` mounts every page and component with `renderToString`; run it after
any change to a page, because it catches the blank-page crashes that lint and the
build miss. `verify:dates` spawns one process per timezone — a UTC offset inside an
ISO literal does not test a timezone, so the `TZ` variable has to be set.

### Live-database suites

These need credentials and a real browser, and are run by hand:

| Suite | Needs | Checks |
| --- | --- | --- |
| `verify:lockdown` | `SB_URL`, `SB_KEY` | A tokenless caller reads and writes nothing; a forged token is no better; no public function is ambiguous. |
| `verify:duration-db` | `SB_URL`, `SB_KEY` | The duration column, its bounds, and that the summaries view is filtered by policy. |
| `verify:isolation` | `SB_URL`, `SB_KEY`, two accounts | Cross-account isolation in both directions. The only regression test for the policy set. |
| `verify:auth`, `verify:expiry` | a served build, `SB_USER`, `SB_PASSWORD` | Signing in and out; a session that dies mid-tab. |
| `verify:date-default` | a served build | The Log page opens on today, and opening it alone leaves no draft. |
| `verify:stopwatch` | the four variables | The whole clock lifecycle, against the live database. |
| `verify:save-once` | the four variables | That one tap on Save leaves the workout in History. |
| `verify:routines-browser` | the four variables | Creating a routine, adding exercises, and a **real mouse drag** on the grip handle. |
| `verify:routine-return` | the four variables | That the Log tab comes back to the screen you left it on, and that picking a routine never loses a set. |

The browser suites drive headless Chrome over CDP rather than Playwright, and serve
`dist/` with `scripts/serve-dist.mjs`. Their ports must differ from each other and
from the app server. The suites that sign in need a throwaway account; the login
throttle is ten attempts a quarter of an hour, so clear its bucket between runs:

```sql
delete from private.login_limits
 where bucket = encode(extensions.digest('<username>', 'sha256'), 'hex');
```

### The exercise catalogue

`public/exercises-index.json` is generated from the upstream dataset and committed.

```bash
npm run gen:exercises   # rebuild the index from exercises-dataset/
npm run gen:icons       # rebuild the PWA icons and the manifest from one SVG mark
```

The source dataset is not in this repository. The index keeps only six fields per
exercise — id, name, body part, equipment, target and image — because the upstream
file carries instructions in ten languages and weighs 17 MB.

---

## Deployment

Pushing to `main` **is** the deploy. GitHub Actions verifies dependencies, lint, the
twelve credential-free suites, the build, the PWA assets and the service worker before
publishing to GitHub Pages. Every action is pinned to a commit SHA, because a tag can
be repointed and a SHA cannot. Dependabot opens the dependency updates.

The branch is protected: changes go through a pull request and the `verify` check has
to be green.

Two things to expect after a deploy:

- **GitHub Pages can serve a blank page for up to ten minutes.** It caches
  `index.html` with a long max-age while the deploy deletes the previous build's
  hashed assets, so the cached HTML asks for a file that is gone. A hard refresh fixes
  it. This is why navigations are network-first in the service worker: caching the
  shell would make the trap permanent.
- **Check the deploy landed** by comparing the live bundle hash with a fresh local
  build. They must match.

---

## Recovery

`npm run backup` exports one authenticated account, checks the count of every table
and aborts on a pagination error rather than writing a partial dump.

Keep full schema and account snapshots separately, encrypted, off this machine. The
`backups/` directory is ignored and must never be published — the local snapshots
taken around the October 2026 hardening contain password hashes.

---

## Third-party notices

The body-map geometry, the exercise catalogue and the icons are not this project's
work. See [NOTICE-THIRD-PARTY.md](NOTICE-THIRD-PARTY.md) for the attributions and the
licences, which are reproduced there in full.

---

## Scope

This is deliberately a two-person app. It does not have sign-up, password recovery,
session refresh, username changes, or a leaderboard month picker, and it is not going
to grow them without being asked.
