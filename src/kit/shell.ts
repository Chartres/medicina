// The page around a lesson. A lesson may have been built without a person reading its code, so it runs
// in a sandboxed frame (an origin of its own: no access to this site's storage, sign-in or address bar)
// and this page, which holds the sign-in and the progress record, listens to it through messages and
// believes none of them further than their shape: a mark is a short key under this lesson's name, a
// link may only lead somewhere on this site.
import { addMark, fw, getProgress, initPlatform, onProgress, setSummary } from '../platform/platform.ts'
import { GROUPS, summarize, type Manifest } from '../platform/progress.ts'
import { onMember } from '../platform/members.ts'
import { openRequestDialog } from '../requests.ts'
import { LESSONS } from '../lessons/index.ts'
import './shell.css'

const slug = location.pathname.split('/').filter(Boolean)[0] ?? ''
const meta = LESSONS.find((l) => l.slug === slug)
const frame = document.querySelector<HTMLIFrameElement>('#lesson')!
const MARK = /^(seen|part|deep|ans|found|named|ordered)\/[a-z0-9:_/-]{1,60}$/
const MAX_MARKS = 800 // per lesson; far above what any lesson declares

if (!meta) location.replace('/')
else {
  document.title = `${meta.title} – Na medicínu`
  frame.title = meta.title
  frame.src = `/model.html?l=${encodeURIComponent(slug)}`
  let manifest: Manifest | null = null, member = false
  const tell = (m: unknown) => frame.contentWindow?.postMessage(m, '*')
  const cleanManifest = (m: unknown): Manifest =>
    Object.fromEntries(GROUPS.map((g) => [g, (Array.isArray((m as Record<string, unknown>)?.[g]) ? ((m as Record<string, unknown[]>)[g]) : []).filter((k): k is string => typeof k === 'string' && MARK.test(k)).slice(0, 400)])) as Manifest
  const showProgress = () => {
    if (!manifest) return
    const s = summarize(getProgress(), slug, manifest)
    setSummary(slug, s)
    const part = (label: string, [done, total]: [number, number]) => (total ? `${label} ${done} z ${total}` : '')
    tell({ type: 'progress', text: 'Tvůj postup v téhle lekci: ' + [part('prohlédnuto', s.explore), part('do hloubky', s.depth), part('najdi', s.find), part('pojmenuj', s.name), part('seřaď', s.order)].filter(Boolean).join(', ') + '.' })
  }
  const record = (key: string) => {
    const mine = Object.keys(getProgress().marks).filter((k) => k.startsWith(slug + '/')).length
    if (mine >= MAX_MARKS || !addMark(`${slug}/${key}`)) return
    const [kind, track] = key.split('/')
    fw.track('key_action', { action: kind, lesson: slug })
    // the aha of a lesson built for depth: the learner has been through every step of one track
    if (kind === 'seen' && manifest && manifest.explore.filter((k) => k.startsWith(`seen/${track}/`)).every((k) => getProgress().marks[`${slug}/${k}`]))
      fw.conversion({ lesson: slug, track })
  }
  addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow || !e.data || typeof e.data !== 'object') return
    const m = e.data as { type?: unknown; key?: unknown; href?: unknown; value?: unknown; manifest?: unknown }
    if (m.type === 'ready') { manifest = cleanManifest(m.manifest); showProgress(); tell({ type: 'member', yes: member }) }
    else if (m.type === 'mark' && typeof m.key === 'string' && MARK.test(m.key)) record(m.key)
    else if (m.type === 'revise' && member) openRequestDialog({ kind: 'revise', lessonSlug: slug, lessonTitle: meta.title })
    else if (m.type === 'theme' && (m.value === 'paper' || m.value === 'fluo')) document.body.dataset.theme = m.value
    else if (m.type === 'open' && typeof m.href === 'string') {
      // a link inside the lesson: followed only when it stays on this site
      try { const u = new URL(m.href, location.href); if (u.origin === location.origin) location.href = u.href } catch { /* not a link */ }
    }
  })
  onProgress(showProgress)
  onMember((u) => { member = !!u; tell({ type: 'member', yes: member }) })
  initPlatform()
}
