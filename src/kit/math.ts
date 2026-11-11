// Small vector and keyframe helpers shared by the kit and by every lesson's model.
export type Vec3 = [number, number, number]
export type RGB = [number, number, number]

export const PI = Math.PI
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const ease = (t: number) => t * t * (3 - 2 * t)
export const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x))

/** Keyframes: [[u, value], …] sorted by u; eased between neighbours, held outside the range. */
export function kf(u: number, pts: [number, number][]): number {
  if (u <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++)
    if (u <= pts[i][0]) {
      const [a, va] = pts[i - 1], [b, vb] = pts[i]
      return lerp(va, vb, ease((u - a) / (b - a)))
    }
  return pts[pts.length - 1][1]
}
export const kf3 = (u: number, pts: [number, Vec3][]): Vec3 =>
  [0, 1, 2].map((k) => kf(u, pts.map((p) => [p[0], p[1][k]] as [number, number]))) as Vec3

export const rz = ([x, y, z]: Vec3, a: number): Vec3 => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c, z] }
export const rx = ([x, y, z]: Vec3, a: number): Vec3 => { const c = Math.cos(a), s = Math.sin(a); return [x, y * c - z * s, y * s + z * c] }
export const ry = ([x, y, z]: Vec3, a: number): Vec3 => { const c = Math.cos(a), s = Math.sin(a); return [x * c + z * s, y, -x * s + z * c] }
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mulS = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
export const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
export const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB
