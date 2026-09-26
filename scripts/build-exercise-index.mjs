// scripts/build-exercise-index.mjs
// Generates public/exercises-index.json — a slim projection of the source dataset.
//
// The source exercises-dataset/data/exercises.json is ~17.5 MB because every record
// carries step-by-step instructions in 10 languages. The app only needs identity,
// searchable labels, and an image path, so we project away everything else (~199 KB).
//
// Run: node scripts/build-exercise-index.mjs
// The output is committed, so a fresh clone can build without the source dataset present.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '../../exercises-dataset/data/exercises.json')
const target = resolve(here, '../public/exercises-index.json')

if (!existsSync(source)) {
  console.error(`Source dataset not found: ${source}`)
  console.error('Clone https://github.com/hasaneyldrm/exercises-dataset next to this repo, or restore public/exercises-index.json from git.')
  process.exit(1)
}

const raw = JSON.parse(readFileSync(source, 'utf8'))
if (!Array.isArray(raw)) {
  console.error('Source dataset is not an array.')
  process.exit(1)
}

const seen = new Set()
const index = []

for (const ex of raw) {
  // Ids are the exercises table primary key, so a duplicate would silently break saves.
  if (seen.has(ex.id)) {
    console.error(`Duplicate id in source dataset: ${ex.id}`)
    process.exit(1)
  }
  seen.add(ex.id)

  if (!ex.image) {
    console.warn(`Skipping ${ex.id} (${ex.name}) — no image`)
    continue
  }

  index.push({
    id: ex.id,
    name: ex.name,
    body_part: ex.body_part,
    equipment: ex.equipment,
    target: ex.target,
    image: ex.image,
  })
}

index.sort((a, b) => a.name.localeCompare(b.name))

mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, JSON.stringify(index))

const bodyParts = [...new Set(index.map(e => e.body_part))].sort()
console.log(`Wrote ${index.length} exercises to ${target}`)
console.log(`Size: ${(JSON.stringify(index).length / 1024).toFixed(0)} KB`)
console.log(`Body parts: ${bodyParts.join(', ')}`)
