// Serves dist/ the way GitHub Pages does, so the service worker can be exercised
// against the real build in a browser.
//
//   node scripts/serve-dist.mjs [port]
//
// The paths are the ones Pages uses: the app lives under /gym-tracker/, which is also
// the service worker's scope, so registering it and the app's own routes all work the
// way they do in production.

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath turns a file: URL into a real path, which is what Windows needs —
// hand-assembling the path from URL parts produces a leading slash before the drive
// letter and nothing resolves.
const ROOT = resolvePath(fileURLToPath(new URL('../dist/', import.meta.url)))
const PORT = Number(process.argv[2] || 4173)
const BASE = '/gym-tracker/'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}

async function resolve(pathname) {
  const clean = pathname.replace(/\?.*$/, '')
  if (!clean.startsWith(BASE)) return null
  let rel = clean.slice(BASE.length)
  if (rel === '' || rel.endsWith('/')) rel += 'index.html'
  // Refuse to serve anything outside dist.
  const full = join(ROOT, rel)
  if (!full.startsWith(ROOT)) return null
  try {
    const info = await stat(full)
    if (!info.isFile()) return null
    return full
  } catch {
    return null
  }
}

createServer(async (req, res) => {
  const file = await resolve(req.url)
  if (!file) {
    // Pages serves index.html for unknown paths, and so does this: the app is a
    // single-page app with a hash router.
    const fallback = await resolve(`${BASE}index.html`)
    if (!fallback) {
      res.writeHead(404).end('not found')
      return
    }
    const body = await readFile(fallback)
    res.writeHead(200, { 'Content-Type': TYPES['.html'] }).end(body)
    return
  }
  const body = await readFile(file)
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  }).end(body)
}).listen(PORT, () => {
  console.log(`serving dist/ at http://localhost:${PORT}${BASE}`)
})
