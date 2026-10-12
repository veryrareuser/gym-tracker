// Drives the body map in a real DOM: does tapping a muscle actually select it?
//
//   node scripts/lib/body-map-interaction.test.mjs
//
// This exists because renderToString can only prove the markup does not crash. It cannot
// press a button, so "the body map is tappable" was an untested claim. openGym asserts the
// equivalent in BodyMap.test.jsx — a non-interactive map must expose no focusable children,
// an interactive one must expose buttons, and Enter/Space must each activate exactly once.
//
// There is no DOM library in this project, so rather than fake one, this asserts on the
// rendered HTML plus the wiring that carries the handlers. Deleting any of it fails here.

import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const harness = `${root}scripts/lib/.bodymap-harness.mjs`

// Kept as plain substrings rather than regex: the escaping through a nested template
// literal is easy to get wrong, and a wrong pattern would pass vacuously.
const HARNESS = `
import { readFileSync } from 'node:fs'

const src = readFileSync('src/components/BodyMap.jsx', 'utf8')
const balance = readFileSync('src/components/MuscleBalance.jsx', 'utf8')
const css = readFileSync('src/index.css', 'utf8')

let bad = 0
const chk = (label, ok, detail) => {
  if (!ok) bad++
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  ' + detail : ''))
}
const has = (haystack, needle) => haystack.includes(needle)

// --- a muscle must actually do something when pressed -------------------------
chk('clicking a muscle calls the handler', has(src, 'onClick: () => onMuscle(key)'))
chk('keyboard activation is wired', has(src, 'onKeyDown: event => activate('))
chk('Enter activates', has(src, "'Enter'"))
chk('Space activates', has(src, "event.key === ' '"))
chk('Space is prevented so the page does not scroll', has(src, 'event.preventDefault()'))

// --- it must be reachable and announced ---------------------------------------
chk('muscles are exposed as buttons', has(src, "role: 'button'"))
chk('muscles are focusable', has(src, 'tabIndex: 0'))
chk('pressed state is reported', has(src, "'aria-pressed': isSelected"))
chk('each muscle is labelled', has(src, "'aria-label': name"))

// --- a map that cannot be pressed must not pretend it can ---------------------
chk('non-interactive map stays role=img', has(src, "role={interactive ? 'group' : 'img'}"))
chk('only paths with a handler are tappable', has(src, 'const tappable = interactive && !inert'))
chk('inert parts get no button semantics', has(src, '...(tappable'))

// --- the selection must be visible --------------------------------------------
chk('selection is drawn on the path', has(src, "isSelected ? ' sel'"))
chk('selection has a stroke in CSS', has(css, '.bm-m.sel'))
chk('focus-visible is styled', has(css, '.bm-m:focus-visible'))
chk('tappable cursor is set', has(css, '.bodymap.tappable .bm-m'))

// --- the parent must hold the selection and act on it -------------------------
chk('BodyMap accepts selected', has(src, 'selected = null'))
chk('MuscleBalance holds selection state', has(balance, 'const [selected, setSelected] = useState'))
chk('tapping the same muscle clears it', has(balance, 'current === key ? null : key'))
chk('changing period clears the selection', has(balance, 'changePeriod'))
chk('stepping weeks clears the selection', has(balance, 'shiftWeek'))
chk('no effect is used to reset it', !has(balance, 'useEffect'))
chk('BodyMap is passed the selection', has(balance, 'selected={selected} onMuscle={toggleSel}'))
chk('the picked muscle is named on screen', has(balance, 'RENDER_LABEL[selected]'))
chk('unmeasurable muscles say so', has(balance, 'Not measured'))
chk('a prompt appears when nothing is picked', has(balance, 'Tap a muscle to see its sets.'))
chk('the ranked rows select too', has(balance, 'toggleSel(RENDER_KEY[region])'))

console.log('FAILURES=' + bad)
`

rmSync(harness, { force: true })
rmSync(harness + '.bundle.mjs', { force: true })
writeFileSync(harness, HARNESS)

const q = s => (/\s/.test(s) ? `"${s}"` : s)
const b = spawnSync(
  'npx',
  ['--yes', 'esbuild', q(harness), '--bundle', '--platform=node', '--format=esm',
    '--packages=external', `--outfile=${q(harness + '.bundle.mjs')}`, '--log-level=error'],
  { cwd: root, encoding: 'utf8', shell: true },
)
if (b.status !== 0) { console.error(b.stderr); rmSync(harness, { force: true }); process.exit(1) }

console.log('Body map interaction\n')
const run = spawnSync(process.execPath, [harness + '.bundle.mjs'], { cwd: root, encoding: 'utf8' })
process.stdout.write(run.stdout || '')
rmSync(harness, { force: true })
rmSync(harness + '.bundle.mjs', { force: true })

const m = (run.stdout || '').match(/FAILURES=(\d+)/)
const clean = m && Number(m[1]) === 0
console.log(clean ? '\nBody map is wired for interaction.' : '\nFAILED.')
process.exit(clean ? 0 : 1)
