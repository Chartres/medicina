// Model colours, by name, for both looks. Lessons pick pigments by name, so a change of the course's
// palette here reaches every lesson. Paper: mineral pigments of a stained preparation on warm paper.
// Fluo: the same roles as fluorescent dyes on a dark field.
import { hex, type RGB } from './math.ts'
import type { Palette } from './types.ts'

export const PIGMENTS = {
  carmine: ['#b3263c', '#ff5fa2'], // warm red: the first of two contrasted sets (maternal)
  prussian: ['#2a4b9b', '#4cc9ff'], // blue: the second set (paternal)
  sepia: ['#7a6a2a', '#86f28f'], // fibres, cytoskeleton
  ochre: ['#c9781a', '#ffb347'], // the accent: where something is happening right now
  verdigris: ['#3f7d6b', '#5df2c8'], // a third set, enzymes
  violet: ['#6d4c8f', '#c59bff'], // a fourth set, signals
  umber: ['#2c2a20', '#d9ffe0'], // small dense bodies
  ink: ['#1c2230', '#ffffff'], // points of attachment, outlines of small things
  mauve: ['#8f86a8', '#aab4e0'], // soft inner bodies
  slate: ['#565b68', '#a0a8c2'], // guides, imagined planes
} as const
export type Pigment = keyof typeof PIGMENTS

/** Translucent surfaces: [colour, alpha facing the viewer, extra alpha at the rim] per look. */
export const GLASS = {
  membrane: { paper: [[.2, .3, .45], .012, .6], fluo: [[.62, .7, 1], .012, .7] },
  envelope: { paper: [[.33, .27, .5], .03, .6], fluo: [[.7, .76, 1], .03, .6] },
} as const

/** A lesson's palette for both looks from pigment names: pigments({ m: 'carmine', tub: 'sepia' }). Extra entries (glass) are merged in per look. */
export function pigments<K extends string>(roles: Record<K, Pigment>, extra: { paper?: Palette; fluo?: Palette } = {}): { paper: Palette; fluo: Palette } {
  const look = (i: 0 | 1) => Object.fromEntries(Object.entries<Pigment>(roles).map(([k, p]) => [k, hex(PIGMENTS[p][i]) as RGB]))
  return { paper: { ...look(0), ...extra.paper }, fluo: { ...look(1), ...extra.fluo } }
}
/** Glass entries for a palette: glass('mem', 'membrane') → { paper: { mem, memP }, fluo: { mem, memP } }. */
export function glass(key: string, kind: keyof typeof GLASS): { paper: Palette; fluo: Palette } {
  const one = (l: 'paper' | 'fluo'): Palette => ({ [key]: [...GLASS[kind][l][0]], [key + 'P']: [GLASS[kind][l][1], GLASS[kind][l][2]] })
  return { paper: one('paper'), fluo: one('fluo') }
}
