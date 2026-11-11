// The facts a learner is examined on, pinned against the model itself (2n = 4).
import { describe, expect, it } from 'vitest'
import { divState as state, SETS, stats } from './model.js'

// model.js is unchecked JS; its state object is read loosely here
const divState = state as (kind: string, u: number, set: unknown, time: number) => any

const SC = .76, DX = .9

describe('cell division model', () => {
  it('counts chromosomes, DNA molecules and ploidy the way the workbook does', () => {
    expect(stats('mit', .2)).toEqual([4, 4, '2n'])          // G1
    expect(stats('mit', .6)).toEqual([4, '4 → 8', '2n'])    // S: DNA doubles, chromosome count does not
    expect(stats('mit', 3.5)).toEqual([4, 8, '2n'])         // metaphase
    expect(stats('mit', 4.5)).toEqual([8, 8, '2n + 2n'])    // anaphase: counted by centromeres
    expect(stats('mit', 7)).toEqual([4, 4, '2n'])           // each daughter
    expect(stats('mei1', 4.5)).toEqual([4, 8, 'n + n'])     // anaphase I: whole chromosomes part
    expect(stats('mei1', 7)).toEqual([2, 4, 'n'])           // haploid, still two chromatids each
    expect(stats('mei2', 7)).toEqual([2, 2, 'n'])           // gamete
  })

  it('metaphase: every chromatid in the equatorial plane, sisters facing opposite poles', () => {
    const S = divState('mit', 3.5, SETS.mit, 0)
    for (const c of S.ch) expect(Math.abs(c.p[0])).toBeLessThan(.04)
    for (const id of [0, 1, 2, 3]) expect(S.ch.filter((c: any) => c.id === id).map((c: any) => c.side).sort()).toEqual([-1, 1])
  })

  it('anaphase I parts homologs (sisters stay together); anaphase II parts sisters', () => {
    const a1 = divState('mei1', 4.8, SETS.mei1, 0)
    for (const id of [0, 1, 2, 3]) { const [a, b] = a1.ch.filter((c: any) => c.id === id); expect(a.side).toBe(b.side) }
    expect(a1.ch.find((c: any) => c.id === 0).side).not.toBe(a1.ch.find((c: any) => c.id === 1).side) // the long pair's homologs go apart
    const a2 = divState('mei2', 4.8, SETS.mei2L, 0)
    for (const id of new Set(a2.ch.map((c: any) => c.id))) { const [a, b] = a2.ch.filter((c: any) => c.id === id); expect(a.side).toBe(-b.side) }
  })

  it('meiosis II starts exactly where meiosis I ended (no jump at the seam)', () => {
    const end = divState('mei1', 7, SETS.mei1, 0)
    for (const [set, x, th] of [[SETS.mei2L, -DX, -Math.PI / 2], [SETS.mei2R, DX, Math.PI / 2]] as const) {
      for (const c of divState('mei2', 1, set, 0).ch) {
        const w = [x + SC * (c.p[0] * Math.cos(th) - c.p[1] * Math.sin(th)), SC * (c.p[0] * Math.sin(th) + c.p[1] * Math.cos(th)), SC * c.p[2]]
        const o = end.ch.find((e: any) => e.id === c.id && e.sg === c.sg)
        expect(Math.hypot(w[0] - o.p[0], w[1] - o.p[1], w[2] - o.p[2])).toBeLessThan(.02)
        expect(Math.abs(Math.sin(c.rot + th - o.rot))).toBeLessThan(.02)
      }
    }
  })

  it('the four cells after meiosis are all genetically different', () => {
    const gametes = [SETS.mei2L, SETS.mei2R].flatMap((set) => {
      const st = divState('mei2', 7, set, 0)
      return [-1, 1].map((side) => st.ch.filter((c: any) => c.side === side).map((c: any) => c.id + c.col + (c.tip || '')).sort().join('|'))
    })
    expect(new Set(gametes).size).toBe(4)
    for (const g of gametes) expect(g.split('|').length).toBe(2) // n = 2: one long, one short
  })

  it('the spindle never passes through an intact nuclear envelope', () => {
    for (const kind of ['mit', 'mei1'] as const) for (let u = 0; u < 7; u += .02) {
      const S = divState(kind, u, SETS[kind], 0)
      expect(S.envA > .6 && S.polA > .25, `${kind} u=${u.toFixed(2)}`).toBe(false)
    }
  })
})
