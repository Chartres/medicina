// What a learner has done, as a set of dated marks. A mark is never taken away, so two devices
// merge by union and the order of syncing does not matter.
//
// Mark keys are `<lesson>/<kind>/<what>`, e.g. `deleni-bunky/deep/kin`. Each lesson declares which
// keys exist per group (its manifest); a summary is counted from that, never stored as truth.

export const VERSION = 1
export const GROUPS = ['explore', 'depth', 'find', 'name', 'order'] as const
export type Group = (typeof GROUPS)[number]
export type Manifest = Record<Group, string[]>
export type Summary = Record<Group, [done: number, total: number]>

export interface Progress {
  version: typeof VERSION
  marks: Record<string, string> // key -> ISO time first done
  summary: Record<string, Summary> // lesson -> counts, kept so the home page needs no lesson code
}

export const empty = (): Progress => ({ version: VERSION, marks: {}, summary: {} })

export function parse(raw: unknown): Progress {
  const p = raw as Partial<Progress> | null
  if (!p || p.version !== VERSION || typeof p.marks !== 'object' || !p.marks) return empty()
  return { version: VERSION, marks: { ...p.marks }, summary: { ...(p.summary ?? {}) } }
}

/** Add a mark. Returns false when it was already there (nothing to save or report). */
export function mark(p: Progress, key: string, now: string): boolean {
  if (p.marks[key]) return false
  p.marks[key] = now
  return true
}

export function summarize(p: Progress, lesson: string, manifest: Manifest): Summary {
  const count = (keys: string[]): [number, number] => [keys.filter((k) => p.marks[`${lesson}/${k}`]).length, keys.length]
  return Object.fromEntries(GROUPS.map((g) => [g, count(manifest[g])])) as Summary
}

/** Union of marks (earliest time wins); per lesson and group the larger count, since counts only grow. */
export function merge(a: Progress, b: Progress): Progress {
  const out = empty()
  for (const src of [a, b])
    for (const [k, t] of Object.entries(src.marks)) if (!out.marks[k] || t < out.marks[k]) out.marks[k] = t
  for (const lesson of new Set([...Object.keys(a.summary), ...Object.keys(b.summary)])) {
    const x = a.summary[lesson], y = b.summary[lesson]
    out.summary[lesson] = Object.fromEntries(
      GROUPS.map((g) => [g, [Math.max(x?.[g]?.[0] ?? 0, y?.[g]?.[0] ?? 0), Math.max(x?.[g]?.[1] ?? 0, y?.[g]?.[1] ?? 0)]]),
    ) as Summary
  }
  return out
}

export const same = (a: Progress, b: Progress) => Object.keys(a.marks).length === Object.keys(b.marks).length
