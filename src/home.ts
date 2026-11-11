import { getProgress, initPlatform, onProgress } from './platform/platform'
import { onMember } from './platform/members'
import { LESSONS } from './lessons/index.ts'
import { GROUPS, type Group } from './platform/progress'
import './home.css'
import { mountRequests } from './requests'

const LABEL: Record<Group, string> = { explore: 'Prohlédnuto', depth: 'Do hloubky', find: 'Najdi', name: 'Pojmenuj', order: 'Seřaď' }
const list = document.querySelector<HTMLElement>('#lessons')!
// lessons Pavol has not read yet are listed for members only
let member = false

function render() {
  const p = getProgress()
  let chapter = ''
  list.innerHTML = LESSONS.filter((l) => l.access === 'public' || member).map((l) => {
    const s = p.summary[l.slug]
    const head = l.chapter === chapter ? '' : `<h2>${(chapter = l.chapter)}</h2>`
    const rows = s
      ? `<dl class="prog">${GROUPS.filter((g) => s[g][1]).map((g) => `<div><dt>${LABEL[g]}</dt><dd>${s[g][0]} z ${s[g][1]}</dd></div>`).join('')}</dl>`
      : `<p class="start">Ještě neotevřeno</p>`
    const fresh = l.access === 'premium' ? `<span class="fresh">Nová, zatím jen pro tebe</span>` : ''
    return `${head}<a class="lesson" href="/${l.slug}/"><img src="/${l.slug}/nahled.png" alt="" width="320" height="240" loading="lazy"><span>${fresh}<strong>${l.title}</strong><span>${l.blurb}</span>${rows}</span></a>`
  }).join('')
}
onProgress(render)
onMember((m) => { member = !!m; render() })
mountRequests(document.querySelector<HTMLElement>('#requests')!)
initPlatform()
