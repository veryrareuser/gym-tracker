// Checks the assets a phone needs before it will offer to install the app.
//
//   npm run build && npm run verify:pwa
//
// Installability is easy to break silently. A manifest that points at the wrong base path, an
// icon whose filename says 512 but whose pixels are 256, or a missing rel=manifest all look
// fine in the repository and all prevent installation. This suite checks the source assets
// and, when dist/ exists, the built copies the browser will actually fetch.
//
// The PNG dimensions are read from the IHDR chunk rather than trusted from the filename. That
// is the point: the metadata and the image have to agree.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

function pngSize(file) {
  if (!existsSync(file)) return null
  const bytes = readFileSync(file)
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function checkIcon(rootLabel, dir, icon) {
  const src = icon.src
  const relative = src.replace(/^\/gym-tracker\//, '')
  const file = join(dir, relative)
  const size = pngSize(file)
  const expected = icon.sizes.split('x').map(Number)
  check(
    `${rootLabel}: ${icon.src} is a ${icon.sizes} PNG`,
    Boolean(size) && size.width === expected[0] && size.height === expected[1],
    size ? `${size.width}x${size.height}` : 'missing or not a PNG',
  )
}

function checkIndex(rootLabel, file, manifest) {
  if (!existsSync(file)) {
    check(`${rootLabel}: index.html exists`, false, file)
    return
  }
  const html = readFileSync(file, 'utf8')

  const manifestLink = /<link[^>]+rel="manifest"[^>]*>/i.exec(html)?.[0] || ''
  check(
    `${rootLabel}: manifest is linked`,
    /href="\/gym-tracker\/manifest\.json"/.test(manifestLink),
    manifestLink || 'missing',
  )

  const appleLink = /<link[^>]+rel="apple-touch-icon"[^>]*>/i.exec(html)?.[0] || ''
  check(
    `${rootLabel}: 180px Apple touch icon is linked`,
    /href="\/gym-tracker\/icons\/apple-touch-icon\.png"/.test(appleLink) && /sizes="180x180"/.test(appleLink),
    appleLink || 'missing',
  )

  const meta = name =>
    new RegExp(`<meta[^>]+name="${name}"[^>]*content="([^"]*)"`, 'i').exec(html)?.[1] || ''
  check(`${rootLabel}: mobile-web-app-capable is yes`, meta('mobile-web-app-capable') === 'yes')
  check(`${rootLabel}: apple-mobile-web-app-capable is yes`, meta('apple-mobile-web-app-capable') === 'yes')
  check(`${rootLabel}: Apple home-screen title is set`, meta('apple-mobile-web-app-title') === 'Gym Tracker')
  check(`${rootLabel}: status bar style is readable on a light canvas`, meta('apple-mobile-web-app-status-bar-style') === 'default')

  const lightTheme = /<meta[^>]+name="theme-color"[^>]+content="([^"]+)"[^>]+media="\(prefers-color-scheme: light\)"/i.exec(html)?.[1]
  check(
    `${rootLabel}: light theme colour matches the manifest`,
    lightTheme === manifest.theme_color,
    `${lightTheme} vs ${manifest.theme_color}`,
  )
}

console.log('PWA install assets\n')

const manifestFile = join(root, 'public/manifest.json')
check('public/manifest.json exists', existsSync(manifestFile))

let manifest = null
try {
  manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  check('manifest is valid JSON', true)
} catch (error) {
  check('manifest is valid JSON', false, error.message)
}

if (manifest) {
  check('name is set', manifest.name === 'Gym Tracker', manifest.name)
  check('short_name is set', manifest.short_name === 'Gym Tracker', manifest.short_name)
  check('id is stable', manifest.id === '/gym-tracker/', manifest.id)
  check('start_url is the deployed app root', manifest.start_url === '/gym-tracker/', manifest.start_url)
  check('scope covers the deployed app', manifest.scope === '/gym-tracker/', manifest.scope)
  check('display is standalone', manifest.display === 'standalone', manifest.display)
  // The canvas colour is read from the design tokens rather than written out here.
  // A restyle changes --nb-paper, and a manifest left on the old value is a splash
  // screen in the wrong colour — which is exactly the kind of drift this file exists
  // to catch, so the two must not be able to disagree by accident.
  const paper = /--nb-paper:\s*(#[0-9a-f]{6})/i.exec(readFileSync(join(root, 'src/index.css'), 'utf8'))?.[1]
  check(
    'background colour matches the canvas',
    paper && manifest.background_color?.toLowerCase() === paper.toLowerCase(),
    `${manifest.background_color} vs ${paper}`,
  )
  check('related apps are not preferred', manifest.prefer_related_applications !== true)

  const icons = Array.isArray(manifest.icons) ? manifest.icons : []
  check('manifest has icons', icons.length >= 3, `${icons.length} icons`)

  const required = [
    { sizes: '192x192', purpose: 'any' },
    { sizes: '512x512', purpose: 'any' },
    { sizes: '512x512', purpose: 'maskable' },
  ]
  for (const wanted of required) {
    const icon = icons.find(
      i => i.sizes === wanted.sizes && (i.purpose || 'any').split(/\s+/).includes(wanted.purpose),
    )
    check(
      `manifest has a ${wanted.sizes} ${wanted.purpose} icon`,
      Boolean(icon) && icon.type === 'image/png' && icon.src.startsWith('/gym-tracker/'),
      icon ? icon.src : 'missing',
    )
    if (icon) checkIcon('public', join(root, 'public'), icon)
  }

  check(
    'every manifest icon stays inside /gym-tracker/',
    icons.every(i => i.src.startsWith('/gym-tracker/') && !i.src.includes('..')),
  )
}

check('Apple touch icon is 180x180', (() => {
  const size = pngSize(join(root, 'public/icons/apple-touch-icon.png'))
  return Boolean(size) && size.width === 180 && size.height === 180
})())

checkIndex('source', join(root, 'index.html'), manifest || {})

// Check the built copies too, when a build is present. These are what GitHub Pages serves,
// and Vite's base-path handling is exactly the kind of thing that can differ from source.
const dist = join(root, 'dist')
if (existsSync(dist)) {
  console.log('\nBuilt output\n')
  const distManifestFile = join(dist, 'manifest.json')
  check('dist/manifest.json exists', existsSync(distManifestFile))
  if (existsSync(distManifestFile)) {
    try {
      const built = JSON.parse(readFileSync(distManifestFile, 'utf8'))
      check('built manifest is valid JSON', true)
      check('built start_url is unchanged', built.start_url === manifest?.start_url, built.start_url)
      for (const icon of built.icons || []) checkIcon('dist', dist, icon)
      check(
        'built Apple touch icon is 180x180',
        (() => {
          const size = pngSize(join(dist, 'icons/apple-touch-icon.png'))
          return Boolean(size) && size.width === 180 && size.height === 180
        })(),
      )
      checkIndex('built', join(dist, 'index.html'), built)
    } catch (error) {
      check('built manifest is valid JSON', false, error.message)
    }
  }

  // The service worker is generated at build time with the list of built assets, so its
  // presence in dist/ is the thing to check here. Its behaviour is checked in a real
  // browser by verify:sw.
  console.log('\nService worker\n')
  const swFile = join(dist, 'sw.js')
  check('dist/sw.js exists', existsSync(swFile))
  if (existsSync(swFile)) {
    const sw = readFileSync(swFile, 'utf8')
    check('the worker installs and activates', /addEventListener\('install'/.test(sw) && /addEventListener\('activate'/.test(sw))
    // The precache list must name the built assets, which is only knowable at build
    // time — a hand-written worker would list filenames that no longer exist.
    const builtJs = readdirSync(join(dist, 'assets')).filter(name => name.endsWith('.js'))
    check(
      'the precache list names the built javascript',
      builtJs.length > 0 && builtJs.every(name => sw.includes(name)),
      builtJs.join(', '),
    )
    // The API must never be cached: a cached response is signed-in training data and
    // would be served to whoever opened the app next.
    check('the worker never caches the API', !/supabase|rest\/v1/.test(sw))
  }
} else {
  console.log('\n(no dist/ build found; source assets were checked)')
}

console.log(`\n${failures === 0 ? 'The app has everything a phone needs to install it.' : `${failures} FAILED.`}`)
process.exit(failures === 0 ? 0 : 1)
