// Writes voice/narration/<slug>.json from the lesson's own text, so audio and page cannot drift apart.
//   node voice/dump.mjs <slug>          (Node ≥ 23 reads the .ts lesson directly)
import { mkdirSync, writeFileSync } from 'node:fs'
const slug = process.argv[2]
if (!slug) { console.error('usage: node voice/dump.mjs <slug>'); process.exit(2) }
const root = new URL('..', import.meta.url).pathname
const def = (await import(`${root}src/lessons/${slug}/lesson.ts`)).default
const out = { slug, pronounce: def.pronounce ?? {}, tracks: Object.fromEntries(def.tracks.map((t) => [t.id, t.steps.map((s) => [s.name, s.tip, s.desc])])) }
mkdirSync(root + 'voice/narration', { recursive: true })
writeFileSync(`${root}voice/narration/${slug}.json`, JSON.stringify(out, null, 1))
console.log(Object.values(out.tracks).flat().length, 'clips')
