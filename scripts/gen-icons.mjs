// Generates the app icons from one SVG mark.
//
//   npm run gen:icons
//
// The mark is a dumbbell on a yellow square: black on yellow at 15:1, and it says
// "gym" at 40 pixels on a home screen. The previous mark was a lightning bolt,
// which is the logo of some other app entirely.
//
// It is a script rather than committed binaries because the icons have to agree with
// each other — the same mark, the same colours, four sizes — and four hand-exported
// PNGs never agree for long. It renders through headless Chrome, which is already a
// dependency of the browser suites, so there is nothing new to install.
//
// ── Why the filenames carry a hash ─────────────────────────────────────────────
// A phone caches the home-screen icon by URL, and it caches it hard: iOS will keep
// showing the icon it fetched when the app was added, even after the bytes behind
// that URL have changed. So a restyle that keeps the same filename is a restyle
// that never reaches anyone's phone.
//
// Every icon therefore carries a short hash of the mark in its name. Change the mark
// and the names change, so the URL changes, so the phone asks again. The generator
// owns the manifest and the two icon links in index.html, because those three have
// to agree with the files on disk or the phone is back to a stale icon.
//
// The maskable icon is drawn smaller: Android crops a maskable icon to a circle and
// the safe zone is the middle 80%, so a full-width mark would have its plates cut
// off.

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../', import.meta.url))
const ICONS = join(root, 'public', 'icons')

const YELLOW = '#FFEB3B'
const BLACK = '#000000'

/**
 * The mark, in a 512-unit box.
 *
 * A dumbbell seen side on: a heavy plate at each end, a lighter plate inboard of
 * it, and the handle between. The silhouette steps down 216 → 120 → 48 and back up,
 * which is what makes it read as a dumbbell rather than as a row of blocks. Every
 * rectangle is symmetric about the centre (256).
 */
const PLATES = [
  // [x, y, width, height]
  [76, 148, 68, 216], // outer left
  [144, 196, 40, 120], // inner left
  [144, 232, 224, 48], // handle
  [328, 196, 40, 120], // inner right
  [368, 148, 68, 216], // outer right
]

/**
 * The mark as an SVG document.
 *
 * @param size   the canvas edge in pixels
 * @param scale  how big the mark is drawn, as a multiple of its own 512-unit box
 */
function mark(size, scale) {
  const drawn = 512 * scale
  const offset = (size - drawn) / 2
  const plates = PLATES
    .map(([x, y, w, h]) => `    <rect x="${x}" y="${y}" width="${w}" height="${h}"/>`)
    .join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${YELLOW}"/>
  <g transform="translate(${offset.toFixed(2)} ${offset.toFixed(2)}) scale(${scale})" fill="${BLACK}">
${plates}
  </g>
</svg>
`
}

// The favicon is the same mark.
const FAVICON = mark(512, 1)

// One hash for the whole set: it identifies the mark, not the size.
const VERSION = createHash('sha256')
  .update(PLATES.map(p => p.join(',')).join('|') + YELLOW + BLACK)
  .digest('hex')
  .slice(0, 8)

/** The four PNGs, and the SVG each is rendered from. */
const TARGETS = [
  { file: `icon-192-${VERSION}.png`, size: 192, svg: mark(192, 1) },
  { file: `icon-512-${VERSION}.png`, size: 512, svg: mark(512, 1) },
  // Android crops a maskable icon to a circle and keeps the middle 80% safe, so the
  // mark is drawn at 62% here.
  { file: `icon-maskable-512-${VERSION}.png`, size: 512, svg: mark(512, 0.62) },
  // iOS puts this one on a rounded rectangle of its own and applies its own mask,
  // so it fills the whole square.
  { file: `apple-touch-icon-${VERSION}.png`, size: 180, svg: mark(180, 1) },
]

function findChrome() {
  const localAppData = process.env.LOCALAPPDATA || ''
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    localAppData && `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
    localAppData && `${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean)
  for (const path of candidates) if (existsSync(path)) return path
  return null
}

const chrome = findChrome()
if (!chrome) {
  console.error('No Chrome found. Set CHROME_PATH to the browser binary.')
  process.exit(1)
}

mkdirSync(ICONS, { recursive: true })
writeFileSync(join(root, 'public', `favicon-${VERSION}.svg`), FAVICON)

const work = mkdtempSync(join(tmpdir(), 'gym-icons-'))

for (const { file, size, svg } of TARGETS) {
  const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden}svg{display:block}</style>
${svg}`
  const page = join(work, `${file}.html`)
  writeFileSync(page, html)

  const out = join(ICONS, file)
  const profile = mkdtempSync(join(tmpdir(), 'gym-icons-profile-'))
  const browser = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--user-data-dir=${profile}`,
    `--window-size=${size},${size}`,
    '--force-device-scale-factor=1',
    `--screenshot=${out}`,
    `file:///${page.replace(/\\/g, '/')}`,
  ], { stdio: 'ignore' })

  // Chrome exits on its own after the screenshot.
  for (let i = 0; i < 60; i++) {
    await sleep(250)
    if (browser.exitCode !== null) break
    if (existsSync(out)) break
  }
  browser.kill()
  await sleep(150)

  if (!existsSync(out)) {
    console.error(`failed to render ${file}`)
    process.exit(1)
  }
  console.log(`wrote public/icons/${file}`)
}

// The old icons are removed: leaving them on disk means a phone could still be
// pointed at one of them by a cached manifest, and they are dead weight.
for (const name of readdirSync(ICONS)) {
  if (name.endsWith('.png') && !TARGETS.some(t => t.file === name)) {
    rmSync(join(ICONS, name))
    console.log(`removed public/icons/${name}`)
  }
}
for (const name of readdirSync(join(root, 'public'))) {
  // Both the hashed names and the legacy un-hashed `favicon.svg`, which is the one
  // this script replaced.
  const isFavicon = /^favicon.*\.svg$/.test(name)
  if (isFavicon && name !== `favicon-${VERSION}.svg`) {
    rmSync(join(root, 'public', name))
    console.log(`removed public/${name}`)
  }
}

/* ── The manifest and the two links in index.html ──
 *
 * These three have to name the same files that are on disk. Writing them here rather
 * than by hand is the only way they cannot drift, and a drifted icon path is exactly
 * the bug this script exists to prevent.
 */

const manifestPath = join(root, 'public', 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.icons = [
  { src: `/gym-tracker/icons/icon-192-${VERSION}.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: `/gym-tracker/icons/icon-512-${VERSION}.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: `/gym-tracker/icons/icon-maskable-512-${VERSION}.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log('wrote public/manifest.json')

const indexPath = join(root, 'index.html')
let index = readFileSync(indexPath, 'utf8')
index = index.replace(
  /(<link rel="icon" type="image\/svg\+xml" href=")[^"]*(")/,
  `$1/gym-tracker/favicon-${VERSION}.svg$2`,
)
index = index.replace(
  /(<link rel="apple-touch-icon" sizes="180x180" href=")[^"]*(")/,
  `$1/gym-tracker/icons/apple-touch-icon-${VERSION}.png$2`,
)
writeFileSync(indexPath, index)
console.log('updated index.html')

console.log(`\nIcons generated. Version ${VERSION}.`)
