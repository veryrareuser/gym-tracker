import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TEMPLATE = fileURLToPath(new URL('./scripts/service-worker.template.js', import.meta.url))

/**
 * Writes the service worker with the list of built assets inlined.
 *
 * The asset filenames are content-hashed, so they are not known until the bundle
 * exists — a service worker checked into the repository would precache filenames that
 * stopped existing at the next build. Generating it here means the precache list is
 * always the truth about what was just built.
 *
 * The app shell is merged with the built assets, so one cache holds everything the app
 * needs to start. The API is deliberately absent from it: an API response is signed-in
 * training data and must not be served from a cache.
 */
function gymServiceWorker() {
  let outDir = 'dist'
  let base = '/'
  const template = readFileSync(TEMPLATE, 'utf8')

  return {
    name: 'gym-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
      base = config.base || '/'
    },
    closeBundle() {
      // The shell: the files that must be there for the app to boot at all.
      const shell = [
        `${base}`,
        `${base}manifest.json`,
        `${base}favicon.svg`,
        `${base}icons/icon-192.png`,
        `${base}icons/icon-512.png`,
        `${base}icons/icon-maskable-512.png`,
        `${base}icons/apple-touch-icon.png`,
        // The exercise index, so the picker works offline. It is the largest static
        // file in the app and the first thing a returning user reaches for.
        `${base}exercises-index.json`,
      ]

      // The built assets: the JavaScript and CSS the shell loads.
      const assets = [
        ...readAssetNames(outDir, 'assets', /\.(js|css)$/),
      ].map(name => `${base}${name}`)

      const precache = [...new Set([...shell, ...assets])]

      // The version names the cache, and it carries the build time so the cache names
      // sort by age. The service worker keeps the previous build's cache around
      // rather than deleting it on activate, and it needs to know which one that is —
      // a browser can hold a stale index.html for ten minutes after a deploy, and
      // that HTML points at the assets the previous build produced.
      //
      // The hash is there so two builds in the same millisecond cannot collide, and
      // so it is obvious at a glance which build a cache belongs to.
      const hash = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12)
      const version = `${Date.now()}-${hash}`

      const source = template
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache, null, 2))

      writeFileSync(`${outDir}/sw.js`, source)
      console.log(`\n  service worker: ${precache.length} files precached (${version})`)
    },
  }
}

/** The names of the built files under a directory, matching a pattern. */
function readAssetNames(outDir, dir, pattern) {
  const full = `${outDir}/${dir}`
  if (!existsSync(full)) return []
  return readdirSync(full)
    .filter(name => pattern.test(name))
    .sort()
    .map(name => `${dir}/${name}`)
}

export default defineConfig({
  base: '/gym-tracker/',
  plugins: [
    {
      name: 'production-csp',
      transformIndexHtml(html, context) {
        // Vite's development refresh uses inline scripts and WebSockets. Never
        // weaken the production policy to accommodate a local development server.
        return context.server ? html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '') : html
      },
    },
    react(),
    tailwindcss(),
    gymServiceWorker(),
  ],
})
