// Start a lesson page: the kit builds and runs it, the platform records what the learner did.
import { mount, manifest } from './kit.js'
import type { LessonDef } from './types.ts'
import { addMark, fw, getProgress, initPlatform, onProgress, setSummary } from '../platform/platform.ts'
import { summarize, type Manifest } from '../platform/progress.ts'

export function start(def: LessonDef) {
  const lesson = def.meta.slug, all = manifest(def) as Manifest
  const record = (key: string) => {
    if (!addMark(`${lesson}/${key}`)) return
    const [kind, track] = key.split('/')
    fw.track('key_action', { action: kind, lesson })
    // the aha of a lesson built for depth: the learner has been through every step of one track
    if (kind === 'seen' && all.explore.filter((k) => k.startsWith(`seen/${track}/`)).every((k) => getProgress().marks[`${lesson}/${k}`]))
      fw.conversion({ lesson, track })
  }
  const app = mount(def, document.body, { emit: record })
  const line = document.querySelector('#progressLine')
  onProgress((p) => {
    const s = summarize(p, lesson, all)
    setSummary(lesson, s)
    const part = (label: string, [done, total]: [number, number]) => (total ? `${label} ${done} z ${total}` : '')
    if (line) line.textContent = 'Tvůj postup v téhle lekci: ' + [part('prohlédnuto', s.explore), part('do hloubky', s.depth), part('najdi', s.find), part('pojmenuj', s.name), part('seřaď', s.order)].filter(Boolean).join(', ') + '.'
  })
  initPlatform()
  ;(window as unknown as { app: unknown }).app = app
  return app
}
