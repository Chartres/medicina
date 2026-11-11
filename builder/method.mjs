// The lesson skill's sources of truth: read them, notice when one changed, hand them to a session.
//
// The skill (.claude/skills/lesson/SKILL.md) is derived from the files listed in sources.json: the kit's
// contract and rules in this repo, the course's signature, and Pavol's central standards outside it.
// Two things keep it honest without anyone remembering to:
//   pack()  — every build gets the current text of all sources next to its request, and is told they win;
//   drift() — when a source differs from sources.lock.json, the builder runs a session that edits the
//             skill to match (builder/skill-sync.md) and re-locks.
// Private sources never enter the repository: only their hashes do, and quoted() refuses a skill that
// copies a passage from one.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const SKILL_DIR = '.claude/skills/lesson'
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)

/** Every source with its current text ('' when the file is missing, e.g. on a machine without the central repos). */
export function readSources(repo, home = homedir()) {
  const manifest = path.join(repo, SKILL_DIR, 'sources.json')
  if (!existsSync(manifest)) return [] // a checkout from before the skill had declared sources
  const { sources } = JSON.parse(readFileSync(manifest, 'utf8'))
  return sources.map((s) => {
    const file = s.path.startsWith('~/') ? path.join(home, s.path.slice(2)) : path.join(repo, s.path)
    let text = existsSync(file) ? readFileSync(file, 'utf8') : ''
    if (text && s.from) { // only the part of a larger file that concerns lessons
      const a = text.indexOf(s.from), b = s.to ? text.indexOf(s.to, a + 1) : -1
      text = a < 0 ? '' : text.slice(a, b < 0 ? undefined : b)
    }
    return { ...s, file, text, hash: text ? sha(text) : null }
  })
}

export const readLock = (repo) => { const f = path.join(repo, SKILL_DIR, 'sources.lock.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { hashes: {} } }
export function writeLock(repo, sources, today) {
  const hashes = Object.fromEntries(sources.filter((s) => s.hash).map((s) => [s.id, s.hash]))
  writeFileSync(path.join(repo, SKILL_DIR, 'sources.lock.json'), JSON.stringify({ synced: today, hashes }, null, 2) + '\n')
}

/** Ids of sources whose text differs from the lock. A source that cannot be read here is not drift. */
export const drift = (sources, lock) => sources.filter((s) => s.hash && lock.hashes[s.id] !== s.hash).map((s) => s.id)

/**
 * Write the current text of every source into `dir` for a session to read, plus `before/` copies of what
 * the skill was last aligned with (kept in `prevDir`, outside any repository) for the ones that changed.
 * Returns the index file's path.
 */
export function pack(sources, dir, { changed = [], prevDir = null, build = false } = {}) {
  if (build) sources = sources.filter((s) => s.build) // a lesson build gets only the sources cleared for it
  mkdirSync(path.join(dir, 'before'), { recursive: true })
  const lines = ['# Sources of truth for building a lesson', '', 'Read these. Where one of them and the lesson skill disagree, the source is right.', '']
  for (const s of sources) {
    if (!s.text) continue
    const name = `${s.id}${path.extname(s.file) || '.md'}`
    writeFileSync(path.join(dir, name), s.text)
    let note = ''
    if (changed.includes(s.id)) {
      const prev = prevDir && path.join(prevDir, name)
      if (prev && existsSync(prev)) { writeFileSync(path.join(dir, 'before', name), readFileSync(prev)); note = ` — CHANGED; the earlier text is before/${name}` } else note = ' — CHANGED (no earlier copy kept; review it whole)'
    }
    lines.push(`- \`${name}\`${s.private ? ' (private: never quote it)' : ''}: ${s.governs}${note}`)
  }
  const index = path.join(dir, 'INDEX.md')
  writeFileSync(index, lines.join('\n') + '\n')
  return index
}
/** Remember what the skill is now aligned with, so the next change can be shown as before/after. */
export function remember(sources, prevDir) {
  mkdirSync(prevDir, { recursive: true })
  for (const s of sources) if (s.text) writeFileSync(path.join(prevDir, `${s.id}${path.extname(s.file) || '.md'}`), s.text)
}

/** A passage of `n` or more consecutive words that `text` shares with a private source, or null. */
export function quoted(text, sources, n = 12) {
  const words = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  const mine = words(text), grams = new Map()
  for (let i = 0; i + n <= mine.length; i++) grams.set(mine.slice(i, i + n).join(' '), i)
  for (const s of sources.filter((x) => x.private && x.text)) {
    const w = words(s.text)
    for (let i = 0; i + n <= w.length; i++) { const g = w.slice(i, i + n).join(' '); if (grams.has(g)) return { source: s.id, passage: g } }
  }
  return null
}
