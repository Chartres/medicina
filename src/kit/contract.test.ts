// Every lesson, checked against the contract and the house rules, without a browser. This is the gate a
// generated lesson has to pass before anyone looks at it: a rule that matters belongs here, not in prose.
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createDraw } from './gl.js'
import type { LessonDef, SceneIn } from './types.ts'

const mods = import.meta.glob<LessonDef>('../lessons/*/lesson.ts', { eager: true, import: 'default' })
const lessons = Object.entries(mods).map(([path, def]) => ({ folder: path.split('/')[2], def }))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const draw = createDraw() as any
const FS = [0, .25, .5, .75, 1]
const sentences = (s: string) => s.split(/(?<=[.?])\s+/).filter(Boolean).length
const words = (s: string) => s.split(/\s+/).filter(Boolean)

function sample(def: LessonDef, track: string, step: number, f: number, focus: string | null = null) {
  draw.begin()
  const s: SceneIn = { track, step, f, time: 0, focus, lod: true, on: () => true, col: def.palette.paper, bg: [.92, .9, .83] }
  const out = def.scene(s, draw)
  return { out, verts: draw.vn / 9 + draw.gn / 6, finite: draw.finite(), room: draw.vn < draw.VB.length * .8 && draw.gn < draw.GB.length * .8 }
}

it('finds the lessons', () => expect(lessons.length).toBeGreaterThan(0))

describe.each(lessons)('lesson $folder', ({ folder, def }) => {
  const texts = [
    def.meta.title, def.meta.blurb,
    ...def.tracks.flatMap((t) => t.steps.flatMap((s) => [s.name, s.tip, s.desc, s.q, s.a, s.etym])),
    ...Object.values(def.parts).flatMap((p) => [p.name, p.what, p.deep]),
  ]

  it('has a card and a page', () => {
    expect(def.meta.slug).toBe(folder)
    expect(def.meta.slug).toMatch(/^[a-z0-9-]{3,40}$/)
    for (const v of [def.meta.title, def.meta.chapter, def.meta.blurb]) expect(v.trim().length).toBeGreaterThan(3)
    expect(def.meta.blurb.length).toBeLessThanOrEqual(240)
    expect(Number.isFinite(def.meta.order)).toBe(true)
    expect(existsSync(`${folder}/index.html`), `${folder}/index.html (the page stub) is missing`).toBe(true)
    expect(readFileSync(`${folder}/index.html`, 'utf8')).toContain(`/src/lessons/${folder}/lesson.ts`)
    expect(existsSync(`public/${folder}/nahled.png`), `public/${folder}/nahled.png (home thumbnail) is missing`).toBe(true)
  })

  it('first sight is one sentence; every step carries all three depths', () => {
    expect(def.tracks.length).toBeGreaterThan(0)
    expect(new Set(def.tracks.map((t) => t.id)).size).toBe(def.tracks.length)
    for (const t of def.tracks) {
      expect(t.id).toMatch(/^[a-z0-9]+$/)
      expect(t.steps.length).toBeGreaterThan(0)
      for (const s of t.steps) {
        const at = `${t.id} / ${s.name}`
        expect(s.weight, at).toBeGreaterThan(0)
        expect(s.tip.length, `${at}: tip is the first-sight line, keep it to one short sentence`).toBeLessThanOrEqual(110)
        expect(sentences(s.tip), `${at}: tip must be ONE sentence`).toBe(1)
        expect(sentences(s.desc), `${at}: desc needs 2–6 sentences`).toBeGreaterThanOrEqual(2)
        expect(sentences(s.desc), `${at}: desc needs 2–6 sentences`).toBeLessThanOrEqual(6)
        expect(s.desc.length, `${at}: desc too long to take in`).toBeLessThanOrEqual(520)
        expect(s.q.trim().endsWith('?'), `${at}: q must be a question`).toBe(true)
        expect(s.a.trim().length, at).toBeGreaterThan(10)
        expect(s.etym.trim().length, at).toBeGreaterThan(10)
        expect((s.short ?? s.name).length, `${at}: give a short label for the time strip`).toBeLessThanOrEqual(14)
      }
    }
  })

  it('parts are numbered once, explained at two depths, and wired to their sub-parts', () => {
    const top = Object.entries(def.parts).filter(([, p]) => !p.parent)
    expect(top.length).toBeGreaterThanOrEqual(3)
    expect(top.map(([, p]) => p.n).sort((a, b) => +a - +b)).toEqual(top.map((_, i) => i + 1)) // 1…n, no gaps
    for (const [id, p] of Object.entries(def.parts)) {
      expect(id).toMatch(/^[a-z0-9]+$/)
      expect(p.name.trim().length, id).toBeGreaterThan(2)
      expect(sentences(p.what), `${id}: what is 1–3 sentences`).toBeLessThanOrEqual(3)
      expect(p.what.length, id).toBeGreaterThan(30)
      expect(p.deep.length, `${id}: deep must add something beyond what`).toBeGreaterThan(40)
      if (p.parent) { expect(def.parts[p.parent], `${id}: parent`).toBeDefined(); expect(def.parts[p.parent].subs, id).toContain(id) }
      for (const sub of p.subs ?? []) expect(def.parts[sub]?.parent, `${id} → ${sub}`).toBe(id)
      if (p.subs?.length) expect(p.back, `${id}: a part with sub-parts needs the back-button text`).toBeTruthy()
    }
    for (const t of def.tracks) for (const id of def.findable(t.id)) { expect(def.parts[id], `findable ${id}`).toBeDefined(); expect(def.parts[id].parent, `findable ${id} must be top-level`).toBeUndefined() }
  })

  it('both looks define the same colours, and every swatch exists', () => {
    expect(Object.keys(def.palette.fluo).sort()).toEqual(Object.keys(def.palette.paper).sort())
    for (const l of def.layers) for (const k of l.swatches ?? []) expect(def.palette.paper[k], `swatch ${k}`).toBeDefined()
  })

  it('the model draws at every moment: finite, inside the buffers, with its parts where the text says', () => {
    const seen = new Set<string>()
    for (const t of def.tracks) {
      const here = new Set<string>()
      t.steps.forEach((_, i) => {
        for (const f of FS) {
          const { out, verts, finite, room } = sample(def, t.id, i, f)
          const at = `${t.id} step ${i} f=${f}`
          expect(finite, `${at}: a coordinate is NaN or infinite`).toBe(true)
          expect(room, `${at}: too much geometry for the buffers`).toBe(true)
          expect(verts, `${at}: nothing drawn`).toBeGreaterThan(0)
          expect(out.extent.every((v) => Number.isFinite(v) && v > 0 && v < 20), `${at}: extent ${out.extent}`).toBe(true)
          for (const [id, p] of out.hots) {
            expect(def.parts[id], `${at}: spot for unknown part ${id}`).toBeDefined()
            expect(p.every(Number.isFinite), `${at}: spot ${id} position`).toBe(true)
            expect(Math.hypot(...p), `${at}: spot ${id} is far outside the model`).toBeLessThan(out.extent[0] + out.extent[1] + 1)
            here.add(id); seen.add(id)
          }
          expect(new Set(out.hots.map((h) => h[0])).size, `${at}: a part has two spots`).toBe(out.hots.length)
        }
      })
      for (const id of def.findable(t.id)) expect(here.has(id), `${id} is findable in ${t.id} but never gets a spot there`).toBe(true)
    }
    for (const [id, p] of Object.entries(def.parts)) {
      if (!p.parent) { expect(seen.has(id), `part ${id} never appears in the model`).toBe(true); continue }
      // a sub-part shows once its parent is opened, at some moment
      const shows = def.tracks.some((t) => t.steps.some((_, i) => FS.some((f) => sample(def, t.id, i, f, p.parent!).out.hots.some((h) => h[0] === id))))
      expect(shows, `sub-part ${id} never appears when ${p.parent} is opened`).toBe(true)
    }
  })

  it('reads plainly: no exclamation marks, no emoji, no learner gender, no hype', () => {
    for (const s of texts) {
      expect(s, 'exclamation mark').not.toMatch(/!/)
      expect(s, 'emoji').not.toMatch(/\p{Extended_Pictographic}/u)
      expect(s, 'gendered past tense about the learner').not.toMatch(/\b(jsi|bys|ses|sis)\s+\p{L}+l[ao]?\b|\b\p{L}+l[ao]?\s+(jsi|bys|ses|sis)\b/u)
      expect(s, 'hype word').not.toMatch(/\b(úžasn|fascinuj|neuvěřiteln|zázra|magick|geniáln|super\b)/i)
    }
  })

  it('narration, when present, was built from the current text', () => {
    const file = `public/${folder}/audio/timings.json`
    if (!existsSync(file)) return
    const timings = JSON.parse(readFileSync(file, 'utf8'))
    for (const t of def.tracks) {
      expect(timings[t.id]?.length, `${t.id}: one clip per step — re-run the narration build`).toBe(t.steps.length)
      t.steps.forEach((s, i) => {
        const n = [s.name, s.tip, s.desc].flatMap(words).length
        expect(timings[t.id][i].w.length, `${t.id}-${i}: text changed since the narration was built — re-run it`).toBe(n)
        expect(existsSync(`public/${folder}/audio/${t.id}-${i}.m4a`), `${t.id}-${i}.m4a`).toBe(true)
      })
    }
  })
})
