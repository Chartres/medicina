// Inside the lesson's frame. This document has an origin of its own (the frame is sandboxed), so the
// lesson and the kit run here without any access to the site's storage or sign-in. What the learner
// does is reported to the page outside as messages; what comes back is plain text to show.
import { mount, manifest } from './kit.js'
import type { LessonDef } from './types.ts'

const slug = new URLSearchParams(location.search).get('l') ?? ''
const lessons = import.meta.glob<{ default: LessonDef }>('../lessons/*/lesson.ts')
const load = lessons[`../lessons/${slug}/lesson.ts`]
const up = (m: unknown) => parent.postMessage(m, '*')

if (!load) document.body.textContent = 'Tahle lekce neexistuje.'
else {
  const def = (await load()).default
  const app = mount(def, document.body, { emit: (key: string) => up({ type: 'mark', key }), onTheme: (value: string) => up({ type: 'theme', value }) })
  ;(window as unknown as { app: unknown }).app = app
  addEventListener('message', (e) => {
    if (e.source !== parent || !e.data || typeof e.data !== 'object') return
    const m = e.data as { type?: string; text?: unknown; yes?: unknown }
    if (m.type === 'progress') document.querySelector('#progressLine')!.textContent = String(m.text).slice(0, 300)
    if (m.type === 'member') {
      // members can ask for a change to this lesson; the page outside opens the form
      const tools = document.querySelector<HTMLElement>('#lessonTools')!
      tools.innerHTML = m.yes ? '<button class="quiet" id="reviseBtn">Navrhnout úpravu téhle lekce</button>' : ''
      tools.querySelector('button')?.addEventListener('click', () => up({ type: 'revise' }))
    }
  })
  // a link cannot leave a sandboxed frame; the page outside follows it if it stays on this site
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest?.('a[href]')
    if (a) { e.preventDefault(); up({ type: 'open', href: a.getAttribute('href') }) }
  })
  up({ type: 'ready', manifest: manifest(def) })
}
