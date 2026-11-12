// The facts a learner is examined on, pinned against the fork model itself.
import { describe, expect, it } from 'vitest'
import { createDraw } from '../../kit/gl.js'
import type { Draw } from '../../kit/types.ts'
import lesson from './lesson.ts'
import { B, L, PL, R, NICKS, T_PRIM, TEMPLATE_5, counts, drawFork, geom, state } from './model.ts'

describe('replication fork model', () => {
  it('the leading strand grows continuously towards the fork and never passes it', () => {
    let prev = -Infinity
    for (let u = 3; u <= 8; u += .02) {
      const S = state(u)
      expect(S.leadEnd).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(S.leadEnd).toBeLessThanOrEqual(Math.min(S.xf, L) + 1e-9)
      prev = S.leadEnd
    }
  })

  it('every Okazaki fragment starts with an RNA primer laid behind the fork and grows away from it', () => {
    for (let i = 0; i < 4; i++) {
      const laid = state(T_PRIM[i + 1] + .3)
      expect(laid.xf).toBeGreaterThan(B[i + 1])            // the template there is already unwound
      expect(laid.prem[i]).toBeCloseTo(PL, 6)              // the primer is complete…
      expect(laid.e3[i]).toBeCloseTo(B[i + 1] - PL, 6)     // …and no DNA has been added to it yet
      let prev = Infinity
      for (let u = T_PRIM[i + 1]; u <= 8; u += .02) { const e = state(u).e3[i]; expect(e).toBeLessThanOrEqual(prev + 1e-9); prev = e }
    }
    for (let i = 1; i < 4; i++) expect(T_PRIM[i + 1]).toBeGreaterThan(T_PRIM[i]) // fragments are laid in fork order
  })

  it('new strands are antiparallel to their templates: each 3′ end moves towards the template\'s 5′ end', () => {
    const a = state(3.5), b = state(3.9)
    expect(Math.sign(b.leadEnd - a.leadEnd)).toBe(Math.sign(TEMPLATE_5[1] - a.leadEnd))
    const c = state(4.2), d = state(4.4)
    expect(Math.sign(d.e3[0] - c.e3[0])).toBe(Math.sign(TEMPLATE_5[-1] - c.e3[0]))
  })

  it('new DNA exists only behind the fork, never ahead of the helicase', () => {
    for (let u = 0; u <= 8; u += .05) for (const p of state(u).pieces) expect(p.hi, `u=${u.toFixed(2)}`).toBeLessThanOrEqual(Math.max(state(u).xf, L) + 1e-9)
  })

  it('counts the way the workbook does: primers, Okazaki fragments, double helices', () => {
    expect(counts(state(.5))).toEqual([0, 0, 1])    // closed helix
    expect(counts(state(2.95))).toEqual([2, 0, 1])  // one primer on each template
    expect(counts(state(5))).toEqual([3, 2, 1])     // two fragments under way, three primers still RNA
    expect(counts(state(8))).toEqual([0, 4, 2])     // product: no RNA, four fragments made, two molecules
  })

  it('the product has no RNA and no nick, and each daughter is one old strand wound with one new one', () => {
    const S = state(8), G = geom(S)
    expect(S.sealed.every((v) => v === 1)).toBe(true)
    expect(S.prem.every((p) => p === 0) && S.primL - S.leadRep <= 1e-9).toBe(true)
    for (const side of [1, -1] as const) {
      const ps = S.pieces.filter((p) => p.side === side).sort((a, b) => a.lo - b.lo)
      expect(ps[0].lo).toBeCloseTo(-L, 6); expect(ps[ps.length - 1].hi).toBeCloseTo(L, 6)
      for (let k = 1; k < ps.length; k++) expect(ps[k].lo - ps[k - 1].hi).toBeLessThan(1e-6)
      for (const x of [-.8, 0, .8]) {
        const o = G.posOld(x, side), n = G.posNew(x, side), a = G.axis(x, side)
        expect(Math.hypot(o[0] - n[0], o[1] - n[1], o[2] - n[2])).toBeCloseTo(2 * R, 3) // opposite sides of the same axis
        expect(Math.hypot(o[1] - a[1], o[2] - a[2])).toBeCloseTo(R, 3)
      }
    }
  })

  it('the helicase rides single-stranded template at the fork; the polymerase sits at the growing 3′ end', () => {
    for (const u of [2, 3.5, 4.5, 5.5]) {
      const S = state(u), G = geom(S)
      expect(G.bare(S.hel.x, -1), `u=${u}`).toBeGreaterThan(.5)
      if (S.polL.a > .5) expect(S.polL.x).toBe(S.leadEnd)
    }
    expect(state(4.3).polG.x).toBeCloseTo(state(4.3).e3[0], 9)
  })

  it('the ligase seals each nick where the model has one, in fork order', () => {
    for (let k = 0; k < NICKS.length; k++) {
      const n = NICKS[k], S = state(n.t + .07)
      expect(S.ligOn).toBe(k); expect(S.lig.x).toBe(n.x)
      if (k > 0) expect(NICKS[k - 1].t).toBeLessThan(n.t)
      if (n.side < 0 && k < 4) expect(S.prem[k - 1]).toBe(0) // the primer there is already replaced
    }
    expect(state(6).sealed.every((v) => v === 0)).toBe(true)
  })

  it('no two numbered spots ever sit on top of each other (a tap on one must not land on another, on a phone too)', () => {
    const draw = createDraw() as unknown as Draw
    for (let u = 0; u <= 8; u += .02) {
      const step = Math.min(7, Math.floor(u))
      const { hots } = drawFork(u, { track: 'vidlicka', step, f: u - step, time: 0, focus: null, lod: true, on: () => true, col: lesson.palette.paper, bg: [.92, .9, .83] }, draw)
      for (let i = 0; i < hots.length; i++) for (let j = i + 1; j < hots.length; j++) {
        const a = hots[i][1], b = hots[j][1], d = Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] - b[2]) * .3)
        expect(d, `${hots[i][0]} and ${hots[j][0]} at u=${u.toFixed(2)}`).toBeGreaterThanOrEqual(.3)
      }
    }
  })

  it('no jump at the seams of the piecewise schedule', () => {
    for (const u of [3.2, 4, 6, 6.1, 7]) {
      const a = state(u - 1e-6), b = state(u + 1e-6)
      expect(Math.abs(a.leadEnd - b.leadEnd)).toBeLessThan(1e-3)
      expect(Math.abs(a.xf - b.xf)).toBeLessThan(1e-3)
      expect(Math.abs(a.prm.x - b.prm.x) + Math.abs(a.polG.x - b.polG.x) + Math.abs(a.lig.x - b.lig.x)).toBeLessThan(1e-2)
    }
  })
})
