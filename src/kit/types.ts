// The contract between a lesson and the kit. A lesson is data (tracks, steps, parts, words) plus one
// pure function, `scene`, that draws the model for a moment in time. Everything else (the page,
// the four lesson steps, numbered spots, cards, camera, narration, progress) is the kit's.
import type { RGB, Vec3 } from './math.ts'

export interface Meta {
  slug: string
  title: string
  /** Workbook chapter the lesson belongs to; lessons are grouped by it on the home page. */
  chapter: string
  /** Two sentences for the home page: what the model shows and which questions it answers. */
  blurb: string
  /** Position within the course (workbook order). */
  order: number
  /** 'premium' = listed only for members until Pavol has read it; 'public' = listed for everyone. */
  access: 'premium' | 'public'
  /** One sentence shown under generated lessons, e.g. how it was made and checked. Empty for hand-built ones. */
  provenance?: string
}

export interface Step {
  /** Name as a heading: "Metafáze". */
  name: string
  /** Label on the time strip when the name is too long for it. */
  short?: string
  /** Relative share of the time strip and of playback time (1 ≈ 4 s without narration). */
  weight: number
  /** First sight: ONE sentence saying how to recognise this step in the model. ≤ 110 characters. */
  tip: string
  /** "Co se děje": 3–5 plain sentences. Read aloud by the narration together with name and tip. */
  desc: string
  /** One question whose answer deepens the step (often answered by what comes next)… */
  q: string
  /** …and its answer, hidden until asked for. */
  a: string
  /** Where the word comes from (Greek/Latin root, who named it), one or two sentences. */
  etym: string
}

export interface Track {
  /** Stable id used in progress keys and audio file names: lowercase ascii. */
  id: string
  /** Button label when the lesson has several tracks: "Mitóza". */
  name: string
  /** Used in "…, krok 3 z 8": "Buněčný cyklus". */
  label: string
  steps: Step[]
  /** A model that does not change over time (a structure, not a process): no play button or time strip. */
  still?: boolean
}

export interface Part {
  /** The numeral shown in the model and beside the name: 1, 2, 3 … for parts, 'a', 'b' … for sub-parts. */
  n: number | string
  name: string
  /** One tap: what it is, 1–3 sentences. */
  what: string
  /** "Víc do hloubky": the level beyond the workbook (mechanism, molecule, clinical link, number). */
  deep: string
  /** Sub-part of this part: it gets a spot only once the learner has opened the parent. */
  parent?: string
  /** Ids of this part's sub-parts, in order. */
  subs?: string[]
  /** Text of the back button on a sub-part's card: "Zpět na chromozom". Required when `subs` is set. */
  back?: string
  /** Keep the whole model in view when this part is opened (membranes, planes, anything large). */
  wide?: boolean
  /** Camera distance when opened (model units; the whole model is usually about 6). Default 2.4. */
  zoom?: number
  /** An extra button on the card that turns the camera: { label: 'Podívat se od pólu', az: Math.PI / 2 }. */
  act?: { label: string; az: number }
}

export interface Layer {
  id: string
  /** "chromozomy od matky a od otce" */
  label: string
  /** Palette keys shown as colour swatches before the label. */
  swatches?: string[]
}

/** Colours and translucency parameters by name, one set per look. Values are RGB 0..1 or numbers. */
export type Palette = Record<string, RGB | number[]>

export interface SceneIn {
  track: string
  step: number
  /** Position within the step, 0..1. */
  f: number
  /** Seconds since load, for small idle motion. Stays 0 when the learner asked for reduced motion. */
  time: number
  /** Id of the opened part (or sub-part), or null. Use it to add detail and to fade the rest. */
  focus: string | null
  /** False for thumbnails: draw without focus detail. */
  lod: boolean
  /** Is this layer switched on? */
  on(layer: string): boolean
  /** The lesson's palette for the current look. */
  col: Palette
  /** Background colour of the stage, to fade things towards. */
  bg: RGB
}

/** Translucent surface parameters: [alpha facing the viewer, extra alpha at the rim, intactness 0..1 (below 1 it breaks into patches)]. */
export type GlassPar = [number, number, number]
type Col = RGB | number[]

export interface Draw {
  /** A tube through points. `rad` and `col` may be functions of the point index. */
  tube(pts: Vec3[], rad: number | ((i: number) => number), col: Col | ((i: number) => Col), sides?: number, closed?: boolean): void
  sphere(c: Vec3, r: number, col: Col): void
  /** `inner` surfaces (a nucleus) are drawn before outer ones (the cell membrane) so both stay visible. */
  glassSphere(c: Vec3, r: number, col: Col, par: GlassPar | number[], inner?: boolean): void
  /** Surface of revolution about a local x axis. X maps a local point to the model, Xd a local direction; prof(s 0..1) → [x, radius, normal-axial, normal-radial]. */
  glassRevolve(X: (p: Vec3) => Vec3, Xd: (v: Vec3) => Vec3, prof: (s: number) => [number, number, number, number], col: Col, par: GlassPar | number[], inner?: boolean): void
}

export interface SceneOut {
  /** Half-width and half-height the model needs right now (model units); the camera fits to it. */
  extent: [number, number]
  /** Where each part that is present right now gets its numbered spot. */
  hots: [id: string, at: Vec3][]
}

export interface Words {
  /** "Zpět na celou buňku" */
  back: string
  /** "Části buňky" */
  partsTitle: string
  /** "Ťukni v buňce na tečku, která k ní patří." */
  tapPart: string
  /** aria-label of an unnamed spot: "část buňky" */
  spot: string
  /** "Která fáze to je?" */
  whichStep: string
  /** "Jak jdou fáze po sobě?" */
  orderTitle: string
  /** "Posuň čas tam, kde tahle fáze probíhá, a potvrď." */
  findStep: string
  /** "Hledaná fáze je později." / "…dřív." */
  later: string
  earlier: string
  /** "Která část to je?" (naming parts, used when a track has fewer than three steps) */
  whichPart: string
}

export interface LessonDef {
  meta: Meta
  tracks: Track[]
  parts: Record<string, Part>
  layers: Layer[]
  palette: { paper: Palette; fluo: Palette }
  /** Parts the learner can be asked to find in this track (top-level ids that appear in `hots` at some moment). */
  findable(track: string): string[]
  scene(s: SceneIn, g: Draw): SceneOut
  /** The "Počty" panel: numbers that change through the process. Omit when the lesson has none. */
  numbers?(track: string, step: number, f: number): { label: string; value: string | number }[]
  numbersNote?: string
  /** Folded sections under the model: a comparison table, a summary. HTML. */
  extras?: { title: string; html: string }[]
  /** Source and history note at the foot of the page. HTML. */
  note?: string
  words?: Partial<Words>
  /** How the narration should say tokens it would misread, by exact token: { 'G₁': 'gé jedna', ATP: 'á té pé' }. */
  pronounce?: Record<string, string>
}

export const defineLesson = (d: LessonDef): LessonDef => d
