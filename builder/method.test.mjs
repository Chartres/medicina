import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { drift, pack, quoted, readLock, readSources, remember, writeLock } from './method.mjs'

function fixture() {
  const repo = mkdtempSync(path.join(tmpdir(), 'method-repo-')), home = mkdtempSync(path.join(tmpdir(), 'method-home-'))
  mkdirSync(path.join(repo, '.claude/skills/lesson'), { recursive: true }); mkdirSync(path.join(repo, 'src'), { recursive: true }); mkdirSync(path.join(home, 'std'), { recursive: true })
  writeFileSync(path.join(repo, 'src/contract.ts'), 'export interface Step { tip: string }\n')
  writeFileSync(path.join(home, 'std/taste.md'), '# Taste\nPlain words. Calm pages with a lot of quiet space around one strong thing that the reader came for today.\n')
  writeFileSync(path.join(home, 'notes.md'), 'intro\n- **Voice:** plain and direct\n- **Other:** unrelated\n')
  writeFileSync(path.join(repo, '.claude/skills/lesson/sources.json'), JSON.stringify({ sources: [
    { id: 'contract', path: 'src/contract.ts', governs: 'the contract' },
    { id: 'taste', path: '~/std/taste.md', private: true, governs: 'taste' },
    { id: 'voice', path: '~/notes.md', private: true, from: '- **Voice:**', to: '- **Other:**', governs: 'voice' },
    { id: 'absent', path: '~/nowhere.md', private: true, governs: 'not on this machine' },
  ] }))
  return { repo, home }
}

test('a changed source is drift; an unreadable one is not; locking clears it', () => {
  const { repo, home } = fixture()
  let src = readSources(repo, home)
  assert.equal(src.find((s) => s.id === 'voice').text, '- **Voice:** plain and direct\n') // only the named section
  assert.deepEqual(drift(src, readLock(repo)), ['contract', 'taste', 'voice'])
  writeLock(repo, src, '2026-11-11')
  assert.deepEqual(drift(readSources(repo, home), readLock(repo)), [])
  writeFileSync(path.join(home, 'std/taste.md'), '# Taste\nBolder.\n')
  writeFileSync(path.join(home, 'notes.md'), 'a different intro\n- **Voice:** plain and direct\n- **Other:** changed, but outside the section\n')
  assert.deepEqual(drift(readSources(repo, home), readLock(repo)), ['taste'])
  assert.ok(!readFileSync(path.join(repo, '.claude/skills/lesson/sources.lock.json'), 'utf8').includes('Plain words')) // hashes only
})

test('the pack holds every readable source, and the earlier text of the changed ones', () => {
  const { repo, home } = fixture(), out = mkdtempSync(path.join(tmpdir(), 'method-pack-')), prev = mkdtempSync(path.join(tmpdir(), 'method-prev-'))
  remember(readSources(repo, home), prev)
  writeFileSync(path.join(home, 'std/taste.md'), '# Taste\nBolder.\n')
  const index = readFileSync(pack(readSources(repo, home), out, { changed: ['taste'], prevDir: prev }), 'utf8')
  assert.equal(readFileSync(path.join(out, 'taste.md'), 'utf8'), '# Taste\nBolder.\n')
  assert.match(readFileSync(path.join(out, 'before/taste.md'), 'utf8'), /Plain words/)
  assert.match(index, /taste\.md` \(private: never quote it\): taste — CHANGED/)
  assert.ok(existsSync(path.join(out, 'contract.ts')) && !existsSync(path.join(out, 'absent.md')) && !index.includes('absent'))
})

test('a skill that copies a private passage is caught; its own words are not', () => {
  const { repo, home } = fixture(), src = readSources(repo, home)
  assert.equal(quoted('Keep pages calm and give one strong thing room.', src), null)
  assert.equal(quoted('We want: calm pages with a lot of quiet space around one strong thing that the reader came for. Yes.', src)?.source, 'taste')
  assert.equal(quoted('export interface Step { tip: string } export interface Step { tip: string }', src), null) // public sources may be quoted
})
