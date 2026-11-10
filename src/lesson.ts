// Gives a lesson page sign-in and progress. The lesson itself is plain HTML + script and reports
// what the learner did as `lesson:mark` events; anything it reported before this module loaded is
// in `app.emitted`.
import { addMark, fw, getProgress, initPlatform, onProgress, setSummary } from './platform/platform'
import { summarize, type Manifest } from './platform/progress'

const lesson = location.pathname.split('/').filter(Boolean)[0]
const app = (window as unknown as { app: { manifest(): Manifest; emitted: string[] } }).app
const manifest = app.manifest()
const line = document.querySelector('#progressLine')

function record(key: string) {
  if (!addMark(`${lesson}/${key}`)) return
  const [kind, mode] = key.split('/')
  fw.track('key_action', { action: kind, lesson })
  // the aha of a lesson built for depth: the learner has been through every step of one division
  if (kind === 'seen' && manifest.explore.filter((k) => k.startsWith(`seen/${mode}/`)).every((k) => getProgress().marks[`${lesson}/${k}`]))
    fw.conversion({ lesson, mode })
}

onProgress((p) => {
  const s = summarize(p, lesson, manifest)
  setSummary(lesson, s)
  if (line) line.textContent = `Tvůj postup v téhle lekci: prohlédnuto ${s.explore[0]} z ${s.explore[1]}, do hloubky ${s.depth[0]} z ${s.depth[1]}, najdi ${s.find[0]} z ${s.find[1]}, pojmenuj ${s.name[0]} z ${s.name[1]}, seřaď ${s.order[0]} z ${s.order[1]}.`
})
app.emitted.forEach(record)
document.addEventListener('lesson:mark', (e) => record((e as CustomEvent<string>).detail))
initPlatform()
