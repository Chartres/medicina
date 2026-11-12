// Replikace DNA — the model: one replication fork travelling left to right along a DNA duplex, as a
// function of a continuous time u (0…8, one unit per lesson step), and how to draw it.
// Pure: no DOM, no GL. facts.test.ts pins the facts a learner is examined on.
//
// Geometry: the parental duplex lies on the x axis (−L…L). The fork is at xf; right of it the two old
// strands wind round the x axis, left of it they part into an upper arm (template of the leading
// strand, running 3′→5′ in +x) and a lower arm (template of the lagging strand, 5′→3′ in +x). A new
// strand winds round its template's arm axis wherever it has been made; single-stranded stretches are
// straight, with SSB beads. Primers are RNA (violet); fragments grow away from the fork; nicks are
// small gaps in the new strand that the ligase closes.
import { PI, lerp, ease, clamp, kf, mix3, add, sub, mulS, type Vec3 } from '../../kit/math.ts'
import type { Draw, SceneIn, SceneOut } from '../../kit/types.ts'

export const L = 1.1, R = .11, PL = .12, ARM = .42, PITCH = .36, BP = .036
/** Okazaki fragment boundaries on the lagging template; fragment i spans [B[i], B[i+1]], its primer sits at the right end. */
export const B = [-L, -.55, 0, .55, L]
/** Where each template's 5′ end lies: the upper template (1) runs 3′→5′ in +x, the lower (−1) 5′→3′. A new strand's 3′ end moves towards its template's 5′ end. */
export const TEMPLATE_5: Record<1 | -1, number> = { 1: L, [-1]: -L }
const WF = .14, WARM = .45, WT = .06, DX = .012
const sm = (t: number) => ease(clamp(t))
const inside = (x: number, lo: number, hi: number) => sm((x - lo) / WT + .5) * sm((hi - x) / WT + .5) // soft indicator of [lo, hi]

/** When the primers are laid: leading, then fragments 1…4 (each takes .3). */
export const T_PRIM = [2.2, 2.55, 4.25, 5.1, 6.0]
/** 3′ end of fragment i over time: synthesis away from the fork, then on through the previous primer. */
/** When each primase comes to lay a primer: leading, then fragments 1…4. */
const PRIM_ACTS: [number, number][] = T_PRIM.map((t) => [t, t + .3])
const E3: [number, number][][] = [
  [[4.15, B[1] - PL], [4.5, B[0]]],
  [[4.65, B[2] - PL], [5.0, B[1]], [5.3, B[1] - PL]],
  [[5.65, B[3] - PL], [5.95, B[2]], [6.1, B[2] - PL]],
  [[6.4, B[4] - PL], [6.62, B[3]], [6.75, B[3] - PL]],
]
/** Nicks the ligase seals, in order: after the leading primer, then after each lagging primer. */
export const NICKS: { x: number; side: 1 | -1; t: number }[] = [
  { x: -L + PL, side: 1, t: 6.05 }, { x: B[1] - PL, side: -1, t: 6.25 }, { x: B[2] - PL, side: -1, t: 6.45 }, { x: B[3] - PL, side: -1, t: 6.8 }, { x: B[4] - PL, side: -1, t: 7.0 },
]

/** A stretch of new strand on one arm; [primLo, primHi] of it is RNA. */
export interface Piece { lo: number; hi: number; side: 1 | -1; primLo: number; primHi: number }
/** An enzyme: presence 0..1, position along x, and which arm it sits on (−1 lower, 1 upper, between while flying). */
export interface Enz { a: number; x: number; side: number; on?: number }
export interface St {
  u: number; xf: number; rel: number; dz: number
  leadEnd: number; primL: number; leadRep: number
  e3: number[]; prim: number[]; prem: number[]; rep4: number; sealed: number[]
  pieces: Piece[]
  hel: Enz; topo: Enz; prm: Enz; polL: Enz; polG: Enz; polP: Enz; polQ: Enz; lig: Enz; ligOn: number
}

type Act = [t0: number, t1: number, x: (u: number) => number, side: 1 | -1]
/** Position of an enzyme that does one thing after another: at `x(u)` during an act, flying between acts. */
function acts(u: number, list: Act[]): { x: number; side: number; on: number } {
  for (let i = 0; i < list.length; i++) {
    const [t0, t1, x, side] = list[i]
    if (u < t0) {
      if (i === 0) return { x: x(t0), side, on: -1 }
      const [, p1, px, pside] = list[i - 1], k = sm((u - p1) / (t0 - p1))
      return { x: lerp(px(p1), x(t0), k), side: lerp(pside, side, k), on: -1 }
    }
    if (u <= t1) return { x: x(u), side, on: i }
  }
  const [, t1, x, side] = list[list.length - 1]
  return { x: x(t1), side, on: -1 }
}

export function state(u: number): St {
  // the fork front starts a little off the left end, so the helix is wound to its tip until the helicase arrives
  const xf = kf(u, [[1.15, -L - WF], [2, -.45], [3, -.3], [4, .12], [5, .67], [5.6, 1], [6, 1.2]])
  const rel = kf(u, [[6.1, 0], [6.9, 1]]), dz = kf(u, [[7, 0], [7.7, 1]])
  const primL = PL * sm((u - T_PRIM[0]) / .3)
  const leadEnd = u < 3.2 ? -L + primL : u < 4 ? lerp(-L + PL, xf - .2, sm((u - 3.2) / .8)) : xf - .2 + .1 * sm((u - 6) / .3)
  const leadRep = PL * sm((u - 5.4) / .3)
  const prim = [1, 2, 3, 4].map((k) => PL * sm((u - T_PRIM[k]) / .3))
  const e3 = E3.map((p) => kf(u, p))
  const rep4 = PL * sm((u - 6.65) / .2)
  const prem = [0, 1, 2, 3].map((i) => Math.min(prim[i], i < 3 ? clamp(e3[i + 1] - (B[i + 1] - PL), 0, PL) : PL - rep4))
  const sealed = NICKS.map((n) => sm((u - n.t) / .15))
  const g = (n: number) => .012 * (1 - sealed[n])

  const pieces: Piece[] = []
  if (leadRep > 0) pieces.push({ lo: -L, hi: -L + leadRep - g(0), side: 1, primLo: 9, primHi: 9 })
  if (primL > 0) pieces.push({ lo: -L + leadRep + (leadRep > 0 ? g(0) : 0), hi: leadEnd, side: 1, primLo: -L, primHi: -L + PL })
  for (let i = 0; i < 4; i++) if (prim[i] > 0) pieces.push({ lo: e3[i] + (i ? g(i) : 0), hi: B[i + 1] - PL + prem[i] - g(i + 1), side: -1, primLo: B[i + 1] - PL, primHi: B[i + 1] })
  if (rep4 > 0) pieces.push({ lo: L - rep4 + g(4), hi: L, side: -1, primLo: 9, primHi: 9 })

  const lay = (k: number) => (uu: number) => (k ? B[k] - PL * sm((uu - T_PRIM[k]) / .3) : -L + PL * sm((uu - T_PRIM[0]) / .3))
  const prm = acts(u, [[2.2, 2.5, lay(0), 1], [2.55, 2.85, lay(1), -1], [4.25, 4.55, lay(2), -1], [5.1, 5.4, lay(3), -1], [6.0, 6.3, lay(4), -1]])
  const polG = acts(u, [[4.15, 4.5, (uu) => kf(uu, E3[0]), -1], [4.65, 5.3, (uu) => kf(uu, E3[1]), -1], [5.65, 6.1, (uu) => kf(uu, E3[2]), -1], [6.4, 6.75, (uu) => kf(uu, E3[3]), -1]])
  const lig = acts(u, NICKS.map((n): Act => [n.t, n.t + .15, () => n.x, n.side]))
  return {
    u, xf, rel, dz, leadEnd, primL, leadRep, e3, prim, prem, rep4, sealed, pieces,
    hel: { a: kf(u, [[1, 0], [1.15, 1], [5.8, 1], [6.05, 0]]), x: Math.max(xf - .1, -L), side: -1 },
    topo: { a: kf(u, [[1.2, 0], [1.45, 1], [5.1, 1], [5.3, 0]]), x: Math.min(xf + .45, .8), side: 0 },
    // a primase comes for each primer and leaves again, so it never drifts into the helicase or the polymerase
    prm: { a: Math.max(...PRIM_ACTS.map(([t0, t1]) => kf(u, [[t0 - .1, 0], [t0, 1], [t1, 1], [t1 + .06, 0]]))), ...prm },
    polL: { a: kf(u, [[3, 0], [3.2, 1], [6.3, 1], [6.5, 0]]), x: leadEnd, side: 1 },
    polG: { a: kf(u, [[4, 0], [4.15, 1], [6.75, 1], [6.8, 0]]), ...polG },
    polP: { a: kf(u, [[5.25, 0], [5.4, 1], [5.7, 1], [5.85, 0]]), x: -L + leadRep, side: 1 },
    polQ: { a: kf(u, [[6.55, 0], [6.65, 1], [6.85, 1], [7, 0]]), x: L - rep4, side: -1 },
    lig: { a: kf(u, [[5.95, 0], [6.05, 1], [7.15, 1], [7.3, 0]]), ...lig }, ligOn: lig.on,
  }
}

/** The "Počty" panel: primers present, Okazaki fragments begun, double helices. */
export function counts(S: St): [number, number, number] {
  const primers = (S.primL - S.leadRep > .02 ? 1 : 0) + S.prem.filter((p) => p > .02).length
  const frags = S.e3.filter((e, i) => e < B[i + 1] - PL - .005).length
  return [primers, frags, S.rel > 0 ? 2 : 1]
}

/** Where everything is, given a state: arm axes, winding radii, strand positions. */
export function geom(S: St) {
  const arm = (x: number) => ARM * Math.max(sm((S.xf + WF * .5 - x) / WARM), S.rel)
  const par = (x: number) => sm((x - S.xf) / WF)
  const covA = (x: number) => sm((S.leadEnd - x) / WT + .5) * sm((S.leadEnd + L) / .05)
  const lower = S.pieces.filter((p) => p.side < 0)
  const covB = (x: number) => clamp(lower.reduce((a, p) => a + inside(x, p.lo, p.hi), 0))
  const cov = (x: number, side: number) => (side > 0 ? covA(x) : covB(x))
  const axis = (x: number, side: number): Vec3 => [x, side * arm(x), side * .22 * S.dz]
  const th = (x: number) => 2 * PI * x / PITCH
  const rOld = (x: number, side: number) => R * Math.max(par(x), cov(x, side))
  const posOld = (x: number, side: number): Vec3 => { const t = th(x), r = rOld(x, side) * side, a = axis(x, side); return [a[0], a[1] + r * Math.cos(t), a[2] + r * Math.sin(t)] }
  const posNewAt = (x: number, side: number, r: number): Vec3 => { const t = th(x), a = axis(x, side); return [a[0], a[1] - r * side * Math.cos(t), a[2] - r * side * Math.sin(t)] }
  const posNew = (x: number, side: number): Vec3 => posNewAt(x, side, R * cov(x, side))
  // single-stranded: no partner and no longer wound; `single` also asks for a clear distance behind the point where the helix opens (for the SSB beads)
  const bare = (x: number, side: number) => (1 - cov(x, side)) * (1 - par(x))
  const single = (x: number, side: number) => bare(x, side) * sm((S.xf - WF - x) / .04)
  return { arm, par, cov, axis, rOld, posOld, posNew, posNewAt, bare, single }
}

const FAM: Record<string, string[]> = {
  dna: ['old'], e5: ['old'], e3: ['old'], bp: ['old'], topo: ['topo'], hel: ['hel'], fork: ['hel', 'old'], ssb: ['ssb'], prim: ['prim', 'primer'],
  primer: ['primer'], pol: ['pol', 'new'], oh: ['pol', 'new'], ntp: ['pol', 'new'], ppi: ['pol', 'new'], lead: ['new'], lag: ['new'], oka: ['new'], lig: ['lig', 'new'],
}
const POL_FAMILY = ['pol', 'oh', 'ntp', 'ppi'], DNA_FAMILY = ['dna', 'e5', 'e3', 'bp']

/** Draw the fork at time u. Returns the kit's SceneOut. */
export function drawFork(u: number, s: SceneIn, g: Draw): SceneOut {
  const S = state(u), G = geom(S), C = s.col, time = s.time, on = s.on
  const keep = s.lod && s.focus ? FAM[s.focus] ?? [] : null
  const col = (key: string, c: number[]) => (keep && !keep.includes(key) ? mix3(c as Vec3, s.bg, .6) : (c as Vec3))
  const hots: [string, Vec3][] = []
  const out = (p: Vec3, a: Vec3, k: number): Vec3 => add(p, mulS(sub(p, a), k))
  const rungs: number[] = []; for (let x = -L + BP / 2; x < L; x += BP) rungs.push(x)
  const xs = (lo: number, hi: number) => { const o: number[] = []; for (let x = lo; x < hi; x += DX) o.push(x); o.push(hi); return o }

  // ---- old strands, with half-rungs: a base paired to the axis, or a stub pointing at where its partner would be
  if (on('old')) {
    const oc = col('old', C.old), rc = col('old', mix3(C.old as Vec3, s.bg, .35))
    for (const side of [1, -1]) {
      const pts = xs(-L, L).map((x) => G.posOld(x, side))
      g.tube(pts, .022, oc, 6); g.sphere(pts[0], .022, oc); g.sphere(pts[pts.length - 1], .022, oc)
      for (const x of rungs) {
        const p = G.posOld(x, side), a = G.axis(x, side), r = G.rOld(x, side) / R, arm = G.arm(x)
        const stub: Vec3 = [x, side * (arm - clamp(arm, .015, R)), a[2]]
        g.tube([p, mix3(stub, a, r)], .011, rc, 5)
      }
    }
    // backbone beads where the learner is looking at the base pairs
    if (keep && DNA_FAMILY.includes(s.focus!)) {
      const xc = bpX(S)
      for (const side of [1, -1]) for (const x of rungs) if (Math.abs(x - xc) < .4) g.sphere(G.posOld(x, side), .016, C.ink)
    }
  }
  // ---- new strands: DNA carmine, RNA primers violet; each piece ends where a nick or a free end is
  if (on('new')) {
    for (const p of S.pieces) {
      let { lo, hi } = p
      if (!on('primer')) { if (p.side > 0) lo = Math.max(lo, p.primHi); else hi = Math.min(hi, p.primLo) }
      if (hi - lo < .004) continue
      const isPrim = (x: number) => x > p.primLo - 1e-9 && x < p.primHi + 1e-9
      const cN = col('new', C.new), cP = col('primer', C.primer), rN = col('new', mix3(C.new as Vec3, s.bg, .35)), rP = col('primer', mix3(C.primer as Vec3, s.bg, .35))
      const X = xs(lo, hi), pts = X.map((x) => G.posNew(x, p.side))
      g.tube(pts, .022, (i) => (isPrim(X[i]) ? cP : cN), 6)
      g.sphere(pts[0], .022, isPrim(X[0]) ? cP : cN); g.sphere(pts[pts.length - 1], .022, isPrim(hi) ? cP : cN)
      for (const x of rungs) if (x > lo && x < hi) g.tube([G.posNew(x, p.side), G.axis(x, p.side)], .011, isPrim(x) ? rP : rN, 5)
    }
  }
  // the primer that carries the spot: the newest full one, unless it sits right behind the helicase (then the one before it)
  const live: { rem: number; x: number; side: 1 | -1 }[] = []
  const remL = S.primL - S.leadRep; if (remL > PL * .5) live.push({ rem: remL, x: -L + S.leadRep + remL / 2, side: 1 })
  S.prem.forEach((p, i) => { if (p > PL * .5) live.push({ rem: p, x: B[i + 1] - PL + p / 2, side: -1 }) })
  const bestPrimer = [...live].reverse().find((q) => !(S.hel.a > .5 && q.side < 0 && Math.abs(q.x - S.hel.x) < .35)) ?? null
  // ---- proteins
  if (on('prot')) {
    const enz = col('hel', C.enz)
    // SSB beads on single-stranded stretches
    let ssbSpot: Vec3 | null = null
    for (const side of [-1, 1]) for (let b = 30; b >= 0; b--) {
      const x = -L + .07 * (b + .5), e = sm((G.single(x, side) - .5) / .4)
      if (e < .02) continue
      const p = add(G.posOld(x, side), [0, side * .012, .006 * Math.sin(time * 2 + b)])
      g.sphere(p, .03 * e, col('ssb', C.ssb))
      // the SSB spot keeps clear of any enzyme spot on the same arm
      const near = [S.prm, { ...S.polG, x: S.polG.x - .12 }, S.polL].some((z) => z.a > .5 && Math.abs(z.x - x) < .32 && Math.sign(z.side) === side)
        || live.some((q) => Math.abs(q.x - x) < .32 && q.side === side)
      if (!ssbSpot && e > .8 && !near) ssbSpot = add(p, [0, side * .08, .05])
    }
    if (ssbSpot) hots.push(['ssb', ssbSpot])
    // topoisomerase: two lobes clasping the duplex ahead of the fork
    if (S.topo.a > .01) {
      const t = S.topo, c = col('topo', C.enz)
      for (const sd of [1, -1]) g.ellipsoid([t.x, sd * .14, .04], [.075 * t.a, 0, 0], [0, .06 * t.a, 0], [0, 0, .06 * t.a], c)
      if (t.a > .5) hots.push(['topo', [t.x, .3, .1]])
    }
    // helicase: a ring on the lagging template, right behind the fork point
    if (S.hel.a > .01) {
      const h = S.hel, c = G.axis(h.x, -1), ring: Vec3[] = []
      for (let k = 0; k < 24; k++) { const f = k / 24 * 2 * PI; ring.push(add(c, [0, .075 * Math.cos(f), .075 * Math.sin(f)])) }
      g.tube(ring, .035 * h.a, enz, 8, true)
      if (S.xf > -L) g.sphere([S.xf, 0, 0], .02 * h.a, C.act)
      // the helicase spot sits between the arms, the fork spot on the duplex just ahead: apart from each other and from the primase below
      if (h.a > .5) { hots.push(['hel', add(c, [0, .13, .06])]); if (S.xf > -L + .15 && S.xf < .58) hots.push(['fork', [S.xf + .22, 0, .2]]) }
    }
    // primase: a small sphere on the strand it is priming
    if (S.prm.a > .01) {
      const p = S.prm, c = add(G.axis(p.x, p.side), [0, p.side * .03, 0])
      g.sphere(c, .07 * p.a, col('prim', C.enz))
      if (p.a > .5 && (p.on ?? -1) >= 0) hots.push(['prim', add(c, [0, p.side * .1, .06])])
    }
    // polymerases: the leading one, the lagging one, and the two that replace end primers
    // the lagging polymerase gets its spot while it works, not while it flies to the next primer
    const active = S.polL.a > .5 ? S.polL : S.polG.a > .5 && (S.polG.on ?? -1) >= 0 ? S.polG : null
    const zoomed = !!(keep && POL_FAMILY.includes(s.focus!) && active)
    for (const p of [S.polL, S.polG, S.polP, S.polQ]) {
      if (p.a < .01) continue
      const c = G.axis(p.x, p.side)
      if (zoomed && p === active) g.glassSphere(c, .2 * p.a, C.polG, [...(C.polGP as number[]), 1], true)
      else g.ellipsoid(c, [.16 * p.a, 0, 0], [0, .15 * p.a, 0], [0, 0, .15 * p.a], col('pol', C.enz))
    }
    // the lagging polymerase's spot sits on its leading side, away from the fragment it is making
    if (active) hots.push(['pol', add(G.axis(active.x - (active === S.polG ? .12 : 0), active.side), [0, active.side * .28, .06])])
    else if (S.polP.a > .5) hots.push(['pol', add(G.axis(S.polP.x, 1), [0, .2, .06])])
    else if (S.polQ.a > .5) hots.push(['pol', add(G.axis(S.polQ.x, -1), [0, -.2, .06])])
    if (zoomed && active) {
      // inside the polymerase: the growing 3′ end, the incoming dNTP with its three phosphates, the pyrophosphate leaving
      const x = active.x, sd = active.side as 1 | -1, a = G.axis(x, sd)
      const oh = G.posNewAt(x, sd, R); g.sphere(oh, .03, C.act); hots.push(['oh', out(oh, a, .45)])
      const xn = x + sd * BP, base = G.posNewAt(xn, sd, R), dir = mulS(sub(base, G.axis(xn, sd)), 1 / R), jig = .012 * Math.sin(time * 3)
      const nb = add(base, mulS(dir, .05 + jig)); g.ellipsoid(nb, mulS(dir, .03), [.02, 0, 0], [0, dir[2] * .02, -dir[1] * .02], C.new)
      for (let k = 1; k <= 3; k++) g.sphere(add(nb, mulS(dir, .035 * k)), .014, C.act)
      hots.push(['ntp', add(nb, mulS(dir, .2))])
      const xp = x - sd * BP * 1.5, pb = G.posNewAt(xp, sd, R), pd = mulS(sub(pb, G.axis(xp, sd)), 1 / R), drift = .1 + .03 * Math.sin(time * 1.5)
      for (const k of [0, .035]) g.sphere(add(pb, mulS(pd, drift + k)), .014, C.act)
      hots.push(['ppi', add(pb, mulS(pd, drift + .12))])
    }
    // ligase: a clasp round the daughter duplex at the nick
    if (S.lig.a > .01) {
      const l = S.lig, c = G.axis(l.x, l.side), arc: Vec3[] = []
      for (let k = 0; k <= 20; k++) { const f = PI * .5 + (k / 20 - .5) * PI * 1.4; arc.push(add(c, [0, .15 * Math.cos(f) * l.side, .15 * Math.sin(f)])) }
      g.tube(arc, .032 * l.a, col('lig', C.enz), 8)
      if (S.ligOn >= 0) g.sphere(G.posNew(l.x, l.side as 1 | -1), .026, C.act)
      if (l.a > .5 && S.ligOn >= 0) hots.push(['lig', add(c, [0, l.side * .22, .06])])
    }
  }
  // ---- spots on the strands
  if (on('old')) {
    // the mother-DNA spot: under the parental duplex while there is one, then above the old strand of the upper daughter
    const xd = dnaX(S)
    hots.push(['dna', add(G.axis(xd, 1), S.xf < .6 ? [0, -.2, .08] : [0, .2, .08])])
    if (keep && DNA_FAMILY.includes(s.focus!)) {
      hots.push(['e5', add(G.posOld(L, 1), [.08, 0, 0])], ['e3', add(G.posOld(L, -1), [.08, 0, 0])])
      const xb = bpX(S); hots.push(['bp', mix3(G.posOld(xb, 1), G.axis(xb, 1), .5)])
    }
  }
  if (on('new')) {
    // strand spots sit on the inner side of their arm; the fragment spot just past the fragment's 3′ end, clear of the primer and the polymerase
    if (S.leadEnd > -.48) { const x = (-L + PL + S.leadEnd) / 2; hots.push(['lead', add(G.axis(x, 1), [0, -.2, .08])]) }
    // the fragment spot: the newest fragment with enough DNA made that its middle is clear of the polymerase
    const k = S.e3.map((e, i) => B[i + 1] - PL - Math.max(e, B[i]) >= .36).lastIndexOf(true)
    if (k >= 0) { const x = Math.max(S.e3[k], B[k]) + .12; hots.push(['oka', add(G.axis(x, -1), [0, .2, .08])]) }
    if (k >= 1) hots.push(['lag', add(G.axis(-.95, -1), [0, .2, .08])])
    if (on('primer')) {
      const best = bestPrimer
      // the primer spot sits on the inner side of its arm, away from the polymerase (below) and the fragment spots (on the strand)
      if (best) { const b = best as { x: number; side: 1 | -1 }; hots.push(['primer', add(G.axis(b.x, b.side), [0, -b.side * .22, .05])]) }
    }
  }
  return { extent: [L + .12, ARM + R + .18], hots }
}

/** Where the mother-DNA spot sits: in the middle of the parental duplex while there is one, then back on the old strand of the upper daughter. */
function dnaX(S: St) { return S.xf < .6 ? L - .08 : S.xf - .5 }
/** Where the base-pair detail sits: a little further along the same old strand. */
function bpX(S: St) { return dnaX(S) - .3 }
