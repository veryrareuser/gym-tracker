// Static checks on the discard/recovery path.
//
//   node scripts/lib/discard-recovery.test.mjs
//
// The live suite (verify:recovery-db) proves the round trip against Postgres. This one
// runs in CI, without credentials, and guards the wiring that makes the round trip
// reachable from the UI: a soft delete everywhere, a restore somewhere, and a discard
// button that actually says what it does. A regression here is the incident repeating
// with a different spelling.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(root + path, 'utf8')

const db = read('src/lib/db.js')
const log = read('src/pages/LogWorkout.jsx')
const history = read('src/pages/History.jsx')
const dashboard = read('src/pages/Dashboard.jsx')
const draft = read('src/lib/draft.js')
const migration = read('sql/session-soft-delete.sql')
const view = read('sql/session-summaries.sql')
const aggregates = read('sql/secure-aggregates.sql')
const lintConfig = JSON.parse(read('.oxlintrc.json'))
const main = read('src/main.jsx')
const renderTest = read('scripts/lib/render-components.test.mjs')

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}
const count = (hay, needle) => hay.split(needle).length - 1

console.log('Discard and recovery\n')

console.log('1. the database keeps the row')
check('the migration adds deleted_at', migration.includes('add column if not exists deleted_at'))
check('a discarded-list index exists', migration.includes('idx_sessions_discarded'))
check('one live draft is enforced', migration.includes('idx_sessions_one_live_draft'))
check('the view keeps security_invoker', migration.includes('with (security_invoker = true)'))
check('the view exposes deleted_at', migration.includes('w.deleted_at'))
check('both aggregate signatures are unchanged', migration.includes('public.leaderboard(p_month_start date DEFAULT NULL::date)') &&
  migration.includes('public.friend_prs(p_username text)'))
check('leaderboard ignores discarded rows', count(migration, 'w.deleted_at is null') >= 3)
check('friend PRs ignore discarded rows', migration.includes('s.deleted_at is null'))
check('the view reference copy agrees', view.includes('w.deleted_at') && view.includes('security_invoker = true'))
check('the aggregate reference copy agrees', count(aggregates, 'w.deleted_at is null') === 3 &&
  aggregates.includes('s.deleted_at is null'))

console.log('\n2. no destructive path is a hard delete')
check('discardDraft stamps the row', db.includes('export async function discardDraft') &&
  db.includes("update({ deleted_at: new Date().toISOString() })"))
check('discardDraft returns the id for Undo', db.includes(".select('id')"))
check('deleteSession is soft', db.includes('export async function deleteSession') &&
  db.includes('is(\'deleted_at\', null)'))
check('a draft write retires the previous draft softly', db.includes(".neq('id', session.id)"))
check('a deleted row is not resurrected by a draft write', db.includes('if (current && (!current.is_draft || current.deleted_at)) return session'))
check('getDiscardedSessions reads the view', db.includes('export async function getDiscardedSessions') &&
  db.includes("not('deleted_at', 'is', null)"))
check('restoreSession clears the stamp', db.includes('export async function restoreSession') &&
  db.includes('update({ deleted_at: null })'))
check('purgeSession is the only hard delete', db.includes('export async function purgeSession') &&
  db.includes('.delete().eq(\'id\', id).not(\'deleted_at\', \'is\', null)'))
check('every live read filters deleted_at', count(db, ".is('deleted_at', null)") >= 4)
check('local fallbacks filter deleted_at', db.includes('!s.deleted_at'))

console.log('\n3. the Log page says what discard does')
check('the date is a plain chip, not a button', log.includes('<span className="chip tnum" style={{ minHeight: 36 }}>{formatDate(date)}</span>'))
check('discard is a labelled destructive button', log.includes('<Trash2 size={14} /> Discard'))
check('discard only shows in the editor', log.includes('hasDraft && !isEditMode && !picking && !editingRoutine'))
check('discard asks first', log.includes('title="Discard this workout?"') && log.includes('confirmLabel="Discard"'))
check('the confirm names what is lost', log.includes('You can restore it from History → Discarded.'))
check('discard pauses autosave before the write', log.includes('await pauseAutosave()'))
check('discard resumes autosave afterwards', log.includes('resumeAutosave()'))
check('an undo banner is shown', log.includes('Workout discarded') && log.includes('onClick={undoDiscard}'))
check('the banner lasts eight seconds', log.includes('setUndo(null), 8000'))
check('undo restores the row', log.includes('await restoreSession(item.id)'))
check('undo rehydrates without a reload', log.includes('setReloadKey(k => k + 1)'))
check('an empty mirror cannot erase a cloud draft', log.includes('mergeDraftLogs(mirror?.logs, cloud?.exercise_logs, cardHasContent)'))
check('the merge is content-based and import-free', draft.includes('export function mergeDraftLogs') &&
  draft.includes('if (filled(log) || !filled(cloudCard))'))

console.log('\n4. a discarded workout can be found')
check('History fetches discarded rows', history.includes('getDiscardedSessions()'))
check('History renders a collapsed section', history.includes('<DiscardedList') && history.includes('Discarded ('))
check('both kinds are labelled', history.includes('Unfinished workout') && history.includes('Deleted workout'))
check('a row can be restored', history.includes('confirmRestore(row)') && history.includes('await restoreSession(row.id)'))
check('a restored draft resumes in the Log tab', history.includes("navigate('/log')"))
check('delete forever asks first', history.includes('title="Delete forever?"') && history.includes('onConfirm={confirmPurge}'))
check('History says deletion is reversible', history.includes('You can restore it from there.'))
check('Dashboard surfaces an unfinished workout', dashboard.includes('getDraft().then(setDraft)') &&
  dashboard.includes('Resume workout'))

console.log('\n5. a render bug cannot strand the user')
check('undefined names fail lint', lintConfig.rules['eslint/no-undef'] === 'error')
check('render tests mount the data-dependent UI', renderTest.includes('discarded draft row') &&
  renderTest.includes('resume card with a draft') && renderTest.includes('error fallback has a way out'))
check('the app has an error boundary', main.includes('<ErrorBoundary>') && main.includes('</ErrorBoundary>'))

console.log(`\n${failures === 0 ? 'A discard is visible, labelled and reversible.' : `${failures} FAILED.`}`)
process.exit(failures === 0 ? 0 : 1)
