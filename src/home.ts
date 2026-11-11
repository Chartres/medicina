import { initPlatform, onProgress } from './platform/platform'
import { LESSONS } from './lessons'
import { GROUPS, type Group } from './platform/progress'
import './home.css'
import { mountRequests } from './requests'

const LABEL: Record<Group, string> = { explore: 'Prohlédnuto', depth: 'Do hloubky', find: 'Najdi', name: 'Pojmenuj', order: 'Seřaď' }
const list = document.querySelector<HTMLElement>('#lessons')!

onProgress((p) => {
  let chapter = ''
  list.innerHTML = LESSONS.map((l) => {
    const s = p.summary[l.slug]
    const head = l.chapter === chapter ? '' : `<h2>${(chapter = l.chapter)}</h2>`
    const rows = s
      ? `<dl class="prog">${GROUPS.map((g) => `<div><dt>${LABEL[g]}</dt><dd>${s[g][0]} z ${s[g][1]}</dd></div>`).join('')}</dl>`
      : `<p class="start">Ještě neotevřeno</p>`
    return `${head}<a class="lesson" href="/${l.slug}/"><img src="${l.image}" alt="" width="320" height="240" loading="lazy"><span><strong>${l.title}</strong><span>${l.blurb}</span>${rows}</span></a>`
  }).join('')
})
mountRequests(document.querySelector<HTMLElement>('#requests')!)
initPlatform()
