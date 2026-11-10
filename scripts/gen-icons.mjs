// Generates the app icons from one SVG mark.
//
//   node scripts/gen-icons.mjs
//
// The mark is a lightning bolt on a yellow square: the Neubrutalism palette's loudest
// pair, black on yellow at 15:1.
//
// It is a script rather than committed binaries because the icons have to agree with
// each other — the same bolt, the same colours, four sizes — and four hand-exported
// PNGs never agree for long. It renders through headless Chrome, which is already a
// dependency of the browser suites, so there is nothing new to install.
//
// The maskable icon is drawn with a smaller bolt: Android crops a maskable icon to a
// circle and the safe zone is the middle 80%, so a full-bleed bolt would have its
// tips cut off.

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const OUT = join(root, 'public', 'icons')

const YELLOW = '#FFEB3B'
const BLACK = '#000000'

// The bolt, from the app's existing mark. Its own bounding box is roughly
// x 1.2-46.6, y 0.5-44.9 in a 48x46 space.
const BOLT =
  'M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z'

/**
 * The mark as an SVG document.
 *
 * @param size    the canvas edge in pixels
 * @param scale   how big the bolt is drawn, as a multiple of its own 48-unit box
 * @param radius  the corner radius of the yellow square
 */
function mark(size, scale, radius) {
  const boltWidth = 45.4 * scale
  const boltHeight = 44.5 * scale
  // Centre the bolt's own box (1.2..46.6 horizontally, 0.5..44.9 vertically).
  const tx = (size - boltWidth) / 2 - 1.2 * scale
  const ty = (size - boltHeight) / 2 - 0.5 * scale
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${YELLOW}"/>
  <g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale})">
    <path fill="${BLACK}" d="${BOLT}"/>
  </g>
</svg>
`
}

// The favicon is the same mark, small enough to be a tab icon.
const FAVICON = mark(512, 6.6, 0)

/** The four PNGs, and the SVG each is rendered from. */
const TARGETS = [
  { file: 'icon-192.png', size: 192, svg: mark(192, 6.6, 0) },
  { file: 'icon-512.png', size: 512, svg: mark(512, 6.6, 0) },
  // Android crops a maskable icon to a circle and keeps the middle 80% safe, so the
  // bolt is drawn smaller here.
  { file: 'icon-maskable-512.png', size: 512, svg: mark(512, 4.6, 0) },
  // iOS puts this one on a rounded rectangle of its own and applies its own mask,
  // so it fills the whole square.
  { file: 'apple-touch-icon.png', size: 180, svg: mark(180, 6.6, 0) },
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

mkdirSync(OUT, { recursive: true })
writeFileSync(join(root, 'public', 'favicon.svg'), FAVICON)
console.log('wrote public/favicon.svg')

const work = mkdtempSync(join(tmpdir(), 'gym-icons-'))

for (const { file, size, svg } of TARGETS) {
  const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden}svg{display:block}</style>
${svg}`
  const page = join(work, `${file}.html`)
  writeFileSync(page, html)

  const out = join(OUT, file)
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
  const { statSync } = await import('node:fs')
  console.log(`wrote public/icons/${file} (${statSync(out).size} bytes)`)
}

console.log('Icons generated.')
