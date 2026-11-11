// The lesson page: everything a lesson does not have to write. Given a LessonDef (types.ts) it builds
// the page, runs the model, and carries the four steps of the lesson:
//   Prohlížej (this is…) · Najdi (show me…) · Pojmenuj (what is this?) · Seřaď (put the story in order)
// No scores anywhere: a wrong answer is named or played back, and a missed item returns two turns later.
import { PI, lerp, mix3, hex } from './math.ts'
import { createRenderer } from './gl.js'
import './kit.css'

const LOOKS = {
  paper: { bg: hex('#ece5d4'), rimC: hex('#1c2230'), rimA: .5 },
  fluo: { bg: hex('#0b1226'), rimC: hex('#ffffff'), rimA: .45 },
}
const WORDS = {
  back: 'Zpět na celý model', partsTitle: 'Části modelu', tapPart: 'Ťukni v modelu na tečku, která k ní patří.', spot: 'část modelu',
  whichStep: 'Která fáze to je?', orderTitle: 'Jak jdou fáze po sobě?', findStep: 'Posuň čas tam, kde tahle fáze probíhá, a potvrď.',
  later: 'Hledaná fáze je později.', earlier: 'Hledaná fáze je dřív.', whichPart: 'Která část to je?',
}
const ZE = new Set([4, 6, 7, 14, 16, 17]) // "ze čtyř, ze šesti, ze sedmi…"
/** A heading as it reads inside a sentence: "Profáze I" → "profáze I", but "G₁ fáze" and "DNA" stay. */
export const inSentence = (s) => (s[1] && s[1] !== s[1].toUpperCase() ? s[0].toLowerCase() + s.slice(1) : s)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]] } return a }
const rgb = (c) => `rgb(${c.slice(0, 3).map((v) => Math.round(v * 255)).join(',')})`

/** Every mark a learner can earn in this lesson, by group (see platform/progress.ts). */
export function manifest(def) {
  const M = { explore: [], depth: [], find: [], name: [], order: [] }
  for (const tr of def.tracks) {
    const n = tr.steps.length
    tr.steps.forEach((_, i) => { M.explore.push(`seen/${tr.id}/${i}`); M.depth.push(`ans/${tr.id}/${i}`) })
    if (n > 1) tr.steps.forEach((_, i) => M.find.push(`found/${tr.id}/p${i}`))
    for (const id of def.findable(tr.id)) M.find.push(`found/${tr.id}/${id}`)
    if (n >= 3) tr.steps.forEach((_, i) => M.name.push(`named/${tr.id}/${i}`))
    else for (const id of def.findable(tr.id)) M.name.push(`named/${tr.id}/part:${id}`)
    if (n >= 4 && !tr.still) M.order.push(`ordered/${tr.id}`)
  }
  for (const id in def.parts) { M.explore.push('part/' + id); M.depth.push('deep/' + id) }
  return M
}

function page(def, W) {
  const m = def.meta, many = def.tracks.length > 1
  return `
<header>
  <div class="crumb"><a class="label" href="/">Na medicínu</a><h1>${esc(m.title)}</h1></div>
  <div class="seg" id="tracks" role="group" aria-label="Část lekce"${many ? '' : ' hidden'}>
    ${def.tracks.map((t) => `<button data-track="${t.id}" aria-pressed="false">${esc(t.name)}</button>`).join('')}
  </div>
  <div id="account"></div>
  <nav class="seg steps" role="tablist" aria-label="Postup učení">
    <button role="tab" data-step="explore" aria-selected="true">Prohlížej</button>
    <button role="tab" data-step="find" aria-selected="false">Najdi</button>
    <button role="tab" data-step="name" aria-selected="false">Pojmenuj</button>
    <button role="tab" data-step="order" aria-selected="false">Seřaď</button>
  </nav>
</header>
<main>
  <section>
    <div class="stage">
      <canvas id="cv" role="img" aria-label="Prostorový model: ${esc(m.title)}"></canvas>
      <div id="spots"></div>
      <p class="label hint" id="hint">Tažením model otočíš</p>
    </div>
    <div class="transport" id="transport">
      <button id="play" aria-label="Přehrát"><svg viewBox="0 0 18 18"><path id="playIcon" d="M4 2l12 7-12 7z"/></svg></button>
      <button class="quiet" id="voiceBtn" aria-pressed="false" hidden>Hlas</button>
      <div class="track" id="track">
        <input type="range" id="scrub" min="0" max="1000" value="0" aria-label="Průběh děje">
        <div class="phases" id="phases"></div>
      </div>
    </div>
  </section>

  <section class="panel" id="pExplore" aria-live="polite">
    <p class="label" id="count"></p>
    <h2 id="name"></h2>
    <p class="tip" id="tip"></p>
    <details id="dWhat"><summary>Co se děje</summary>
      <p id="desc"></p>
      <p class="q" id="ques"></p>
      <button class="reveal" id="showAns">Ukázat odpověď</button>
      <p id="ans" hidden></p>
    </details>
    <details id="dNums"${def.numbers ? '' : ' hidden'}><summary>Počty</summary>
      <dl class="nums" id="nums"></dl>
      <p>${def.numbersNote || ''}</p>
    </details>
    <details><summary>Odkud je to slovo</summary><p id="etym"></p></details>
    <details id="dParts"><summary>${esc(W.partsTitle)}</summary><ul class="parts" id="parts"></ul></details>
  </section>

  <section class="panel" id="pCard" hidden aria-live="polite">
    <button class="quiet back" id="cardBack"></button>
    <p class="label" id="cardPhase"></p>
    <div class="cardhead"><span class="num" id="cardNum"></span><h2 id="cardName"></h2></div>
    <p id="cardWhat"></p>
    <p id="cardGone" hidden>V téhle chvíli není vidět. Posuň čas a sleduj, kdy se objeví.</p>
    <button class="quiet" id="cardAct" hidden></button>
    <ul class="parts" id="cardSubs"></ul>
    <details id="cardDeepBox"><summary>Víc do hloubky</summary><p id="cardDeep"></p></details>
  </section>

  <section class="panel" id="pFind" hidden>
    <p class="label">Najdi</p>
    <h2 id="findWhat" class="h2s"></h2>
    <p id="findHow"></p>
    <p class="verdict" id="findVerdict" aria-live="polite"></p>
    <button class="slab" id="findHere">Tady je</button>
    <button class="slab" id="findNext" hidden>Další</button>
  </section>

  <section class="panel" id="pName" hidden>
    <p class="label">Pojmenuj</p>
    <h2 class="h2s" id="nameTitle"></h2>
    <div class="opts" id="opts"></div>
    <p class="verdict" id="nameVerdict" aria-live="polite"></p>
    <button class="slab" id="nameNext" hidden>Další</button>
  </section>

  <section class="panel" id="pOrder" hidden>
    <p class="label">Seřaď</p>
    <h2 class="h2s">${esc(W.orderTitle)}</h2>
    <p>Ťukej na obrázky v pořadí, v jakém děj probíhá. Pak si svoje pořadí přehraj.</p>
    <div class="cards" id="cards"></div>
    <p class="verdict" id="orderVerdict" aria-live="polite"></p>
    <button class="slab" id="orderPlay" disabled>Přehrát moje pořadí</button>
    <button class="quiet" id="orderReset">Znovu zamíchat</button>
  </section>
</main>
<section class="more">
  <details class="view">
    <summary>Zobrazení</summary>
    <div class="row" role="group" aria-label="Způsob zobrazení">
      <label class="check"><input type="radio" name="theme" value="paper" checked> Barvený preparát</label>
      <label class="check"><input type="radio" name="theme" value="fluo"> Fluorescence</label>
    </div>
    <div class="row" role="group" aria-label="Vrstvy">
      ${def.layers.map((l) => `<label class="check"><input type="checkbox" data-layer="${l.id}" checked> ${(l.swatches || []).map((k) => `<i class="sw" data-sw="${k}"></i>`).join('')} ${esc(l.label)}</label>`).join('')}
      <label class="check"><input type="checkbox" data-layer="spots" checked> čísla částí</label>
    </div>
  </details>
  ${(def.extras || []).map((x) => `<details><summary>${esc(x.title)}</summary>${x.html}</details>`).join('')}
  <p class="src" id="progressLine"></p>
  ${m.provenance ? `<p class="prov">${esc(m.provenance)}</p>` : ''}
  ${def.note ? `<p class="src">${def.note}</p>` : ''}
  <p class="src" id="lessonTools"></p>
</section>`
}

/** Build the lesson page in `root` and start it. `hooks.emit(key)` is called for everything the learner does. */
export function mount(def, root, hooks = {}) {
  const W = { ...WORDS, ...(def.words || {}) }
  root.insertAdjacentHTML('afterbegin', page(def, W))
  document.body.dataset.theme = 'paper'
  const $ = (id) => document.getElementById(id), cv = $('cv'), R = createRenderer(cv)
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  const emit = hooks.emit || (() => { })
  const P = def.parts, parentOf = (id) => id && (P[id].parent || id)

  let track = def.tracks[0], step = 'explore', theme = 'paper', t = 0, playing = false, time = 0, segIdx = -1, lastNums = '', focus = null
  const layers = Object.fromEntries([...def.layers.map((l) => [l.id, true]), ['spots', true]])
  const cam = { az: .15, el: .28, T: [0, 0, 0], D: 6, touched: false, goalAz: null }
  let hot = [], task = null, queue = [], order = null, playlist = null
  const segs = () => track.steps, total = () => segs().reduce((a, s) => a + s.weight, 0)
  function locate(tt) {
    let x = tt * total(); const S = segs()
    for (let i = 0; i < S.length; i++) { if (x <= S[i].weight || i === S.length - 1) return { i, seg: S[i], f: Math.min(1, x / S[i].weight) }; x -= S[i].weight }
  }
  const segStart = (i) => segs().slice(0, i).reduce((a, s) => a + s.weight, 0) / total()
  const segMid = (i, f = .5) => segStart(i) + segs()[i].weight / total() * f
  const on = (k) => step === 'find' || step === 'name' || layers[k] // the practice steps need every part present
  const canOrder = () => segs().length >= 4 && !track.still
  const nameByStep = () => segs().length >= 3

  // ---------- model ----------
  const sceneIn = (tt, thumb) => { const { i, f } = locate(tt); return { track: track.id, step: i, f, time, focus: thumb ? null : focus, lod: !thumb, on, col: def.palette[theme], bg: LOOKS[theme].bg } }
  function renderScene(tt, o = {}) {
    R.draw.begin()
    const out = def.scene(sceneIn(tt, o.thumb), R.draw)
    const tall = cv.height > cv.width * 1.08, tf = Math.tan(.25), asp = cv.width / cv.height, [fx, fy] = tall ? [out.extent[1], out.extent[0]] : out.extent
    const fitD = Math.max((fy + .12) / tf, (fx + .12) / (tf * asp)) * 1.06
    let c = { az: .45, el: .25, T: [0, 0, 0], D: fitD }
    if (!o.thumb) {
      const fp = focus && !P[focus].wide && out.hots.find((x) => parentOf(x[0]) === parentOf(focus))
      const gT = fp ? fp[1] : [0, 0, 0], gD = fp ? Math.min(fitD, P[parentOf(focus)].zoom ?? 2.4) : fitD, k = o.snap || still ? 1 : 1 - Math.exp(-o.dt * 5)
      cam.T = mix3(cam.T, gT, k); cam.D = lerp(cam.D, gD, k); c = cam; hot = out.hots
    }
    R.render(c, LOOKS[theme], tall)
  }
  /** Which parts have a spot at time tt (nothing is drawn to the screen). */
  function hotIdsAt(tt) { R.draw.begin(); const s = sceneIn(tt, false); s.focus = null; return def.scene(s, R.draw).hots.map((x) => x[0]) }
  function timeWith(id) { for (let k = 0; k < 120; k++) { const tt = Math.random(); if (hotIdsAt(tt).includes(id)) return tt } return t }

  // ---------- numbered spots (the numeral in the picture is the numeral in the text) ----------
  const spotEls = {}; let spotsKey = ''
  function syncSpots() {
    const ask = step === 'name' && task && task.part
    const show = on('spots') && (step === 'explore' || (step === 'find' && task && task.type === 'part') || ask), seen = new Set()
    if (show) for (const [id, p] of hot) {
      if (ask && id !== task.part) continue
      let b = spotEls[id]
      if (!b) {
        b = spotEls[id] = document.createElement('button'); b.innerHTML = '<span></span>'; b.dataset.id = id
        b.onclick = () => step === 'find' ? answerFind(id) : step === 'explore' && setFocus(focus === id ? (parentOf(id) === id ? null : parentOf(id)) : id)
        $('spots').append(b)
      }
      const [x, y] = R.project(p); b.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`
      const txt = ask ? '?' : step === 'find' ? '' : String(P[id].n); if (b.firstChild.textContent !== txt) b.firstChild.textContent = txt
      b.classList.toggle('ask', !!ask)
      b.setAttribute('aria-label', step === 'explore' ? P[id].name : W.spot); b.setAttribute('aria-pressed', focus === id); b.hidden = false; seen.add(id)
    }
    for (const id in spotEls) if (!seen.has(id)) spotEls[id].hidden = true
    const key = hot.map((x) => x[0]).join()
    if (step === 'explore' && key !== spotsKey) { spotsKey = key; renderParts(); if (focus) renderCard() }
  }
  const partBtn = (id) => `<li><button data-id="${id}"><span class="num">${P[id].n}</span>${esc(P[id].name)}</button></li>`
  function renderParts() {
    $('parts').innerHTML = hot.map((x) => x[0]).filter((id) => !P[id].parent).sort((a, b) => P[a].n - P[b].n).map(partBtn).join('')
    $('dParts').firstElementChild.textContent = `${W.partsTitle} (${$('parts').children.length})`
  }
  function renderCard() {
    const s = P[focus], here = hot.some((x) => parentOf(x[0]) === parentOf(focus))
    $('cardPhase').textContent = segs().length > 1 ? locate(t).seg.name : ''; $('cardNum').textContent = s.n; $('cardName').textContent = s.name
    $('cardWhat').textContent = s.what; $('cardDeep').textContent = s.deep; $('cardGone').hidden = here
    $('cardAct').hidden = !s.act; $('cardAct').textContent = s.act ? s.act.label : ''
    $('cardBack').textContent = s.parent ? (P[s.parent].back || W.back) : W.back
    $('cardSubs').innerHTML = (s.subs || []).map(partBtn).join('')
  }
  function setFocus(id) {
    focus = id; if (id) $('hint').hidden = true; $('pCard').hidden = !id; $('pExplore').hidden = !!id || step !== 'explore'; spotsKey = ''
    if (id) { emit('part/' + id); $('cardDeepBox').open = false; renderCard() }
  }
  root.addEventListener('click', (e) => { const b = e.target.closest('.parts button'); if (b) setFocus(b.dataset.id) })
  $('cardDeepBox').ontoggle = () => { if ($('cardDeepBox').open && focus) emit('deep/' + focus) }
  $('cardBack').onclick = () => setFocus(P[focus].parent || null)
  $('cardAct').onclick = () => { cam.goalAz = P[focus].act.az; cam.touched = true }

  // ---------- 1: explore ----------
  function syncUI() {
    const { i, seg, f } = locate(t), n = segs().length
    if (i !== segIdx) {
      segIdx = i; if (step === 'explore') emit(`seen/${track.id}/${i}`)
      $('count').textContent = n > 1 ? `${track.label}, krok ${i + 1} ${ZE.has(n) ? 'ze' : 'z'} ${n}` : track.label
      voice.words = []; voice.cur = -1; wrap($('name'), seg.name); wrap($('tip'), seg.tip); wrap($('desc'), seg.desc); $('etym').textContent = seg.etym
      $('ques').textContent = seg.q; $('ans').textContent = seg.a; $('ans').hidden = true; $('showAns').hidden = false;
      [...$('phases').children].forEach((b, k) => { b.className = k < i ? 'past' : k === i ? 'now' : ''; b.setAttribute('aria-current', k === i ? 'step' : 'false') })
      if (focus) $('cardPhase').textContent = n > 1 ? seg.name : ''
    }
    if (def.numbers) {
      const rows = def.numbers(track.id, i, f), key = rows.map((r) => r.label + r.value).join('|')
      if (key !== lastNums) {
        const old = [...$('nums').querySelectorAll('dd')].map((d) => d.textContent)
        $('nums').innerHTML = rows.map((r) => `<div><dt class="label">${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`).join('')
        if (lastNums) [...$('nums').querySelectorAll('dd')].forEach((d, k) => { if (old[k] !== undefined && old[k] !== d.textContent) { d.classList.add('flash'); setTimeout(() => d.classList.remove('flash'), 700) } })
        lastNums = key
      }
    }
    $('scrub').value = Math.round(t * 1000)
    $('playIcon').setAttribute('d', playing ? 'M3 2h4v14H3zM11 2h4v14h-4z' : 'M4 2l12 7-12 7z')
    $('play').setAttribute('aria-label', playing ? 'Zastavit' : 'Přehrát')
  }
  function setT(x, keep) { t = Math.max(0, Math.min(1, x)); if (!keep) { playing = false; playlist = null; stopVoice() } syncUI() }

  // ---------- optional narration: the clip drives the model and marks the word being spoken ----------
  const voice = { on: false, data: null, audio: new Audio(), seg: -1, words: [], cur: -1, blobs: {} }
  const clipUrl = (i) => `/${def.meta.slug}/audio/${track.id}-${i}.m4a`
  // clips are fetched whole and played from memory: the host does not answer byte-range requests, which iPhone Safari needs
  function preload() { segs().forEach((_, i) => { const k = `${track.id}-${i}`; if (!voice.blobs[k]) fetch(clipUrl(i)).then((r) => r.blob()).then((b) => voice.blobs[k] = URL.createObjectURL(b)).catch(() => { }) }) }
  fetch(`/${def.meta.slug}/audio/timings.json`).then((r) => r.ok ? r.json() : null).then((d) => { if (d) { voice.data = d; $('voiceBtn').hidden = step !== 'explore' || !d[track.id] } }).catch(() => { })
  function wrap(el, text) { el.textContent = ''; for (const w of text.split(/\s+/)) { const sp = document.createElement('span'); sp.textContent = w; el.append(sp, ' '); voice.words.push(sp) } }
  function stopVoice() { voice.audio.pause(); voice.seg = -1; voice.words[voice.cur]?.classList.remove('say'); voice.cur = -1 }
  function startClip(i) { voice.seg = i; voice.audio.src = voice.blobs[`${track.id}-${i}`] || clipUrl(i); voice.audio.play().catch(() => { playing = false; syncUI() }); $('dWhat').open = true }
  function voiceTick() {
    const c = voice.data[track.id][voice.seg], ct = voice.audio.currentTime
    t = segStart(voice.seg) + segs()[voice.seg].weight / total() * Math.min(.999, Math.max(.001, ct / c.dur))
    let k = c.w.length - 1; while (k >= 0 && c.w[k] > ct) k--
    if (k !== voice.cur) { voice.words[voice.cur]?.classList.remove('say'); voice.cur = k }
    voice.words[k]?.classList.add('say')
  }
  const voiceOff = () => { voice.on = false; $('voiceBtn').setAttribute('aria-pressed', false); stopVoice() }
  voice.audio.onended = () => {
    if (!playing || !voice.on) return; const i = voice.seg + 1
    if (i < segs().length) startClip(i); else { t = 1; playing = false; track.still ? voiceOff() : stopVoice(); syncUI() }
  }
  $('voiceBtn').onclick = () => {
    voice.on = !voice.on; $('voiceBtn').setAttribute('aria-pressed', voice.on)
    if (!voice.on) { stopVoice(); if (track.still) playing = false } else { preload(); if (track.still) { playing = true; startClip(0) } else if (playing) startClip(locate(t).i) }
    syncUI()
  }

  function buildPhases() {
    $('phases').innerHTML = ''
    segs().forEach((s, i) => { const b = document.createElement('button'); b.style.flex = s.weight; b.title = s.name; b.innerHTML = `<span>${esc(s.short || s.name)}</span>`; b.setAttribute('aria-label', s.name); b.onclick = () => setT(segStart(i) + .0005); $('phases').append(b) })
  }
  function setTrack(id) {
    track = def.tracks.find((x) => x.id === id) || def.tracks[0]; segIdx = -1; lastNums = ''
    document.querySelectorAll('#tracks button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.track === track.id))
    document.querySelector('[data-step=order]').hidden = !canOrder()
    $('nameTitle').textContent = nameByStep() ? W.whichStep : W.whichPart
    buildPhases(); setFocus(null); setT(0); setStep(step === 'order' && !canOrder() ? 'explore' : step); if (voice.on) preload()
  }
  function setStep(s) {
    step = s; playing = false; playlist = null; if (voice.on && track.still) voiceOff(); else stopVoice()
    $('voiceBtn').hidden = s !== 'explore' || !voice.data || !voice.data[track.id]; if (s !== 'explore') setFocus(null)
    document.querySelectorAll('.steps button').forEach((b) => b.setAttribute('aria-selected', b.dataset.step === s))
    $('pExplore').hidden = s !== 'explore' || !!focus; $('pFind').hidden = s !== 'find'; $('pName').hidden = s !== 'name'; $('pOrder').hidden = s !== 'order'
    $('transport').hidden = s === 'name' || s === 'order' || (track.still && s === 'find'); $('phases').hidden = s !== 'explore'
    $('play').hidden = s !== 'explore' || !!track.still; $('track').hidden = !!track.still
    $('hint').hidden = s === 'order' || cam.touched
    queue = []; task = null; segIdx = -1; syncUI()
    if (s === 'find') nextFind(); if (s === 'name') nextName(); if (s === 'order') resetOrder()
  }
  const tipOf = (i) => segs()[i].tip.replace(/^./, (c) => c.toLowerCase())

  // ---------- 2: find it (recognition; the model itself says where you are) ----------
  function nextFind() {
    if (!queue.length) queue = shuffle([...(segs().length > 1 ? segs().map((_, i) => ({ type: 'step', i })) : []), ...def.findable(track.id).map((id) => ({ type: 'part', id }))])
    task = queue.shift(); $('findVerdict').textContent = ''; $('findNext').hidden = true
    if (task.type === 'step') {
      $('findWhat').textContent = inSentence(segs()[task.i].name); $('findHow').textContent = W.findStep
      $('findHere').hidden = false; $('scrub').disabled = false
    } else {
      t = timeWith(task.id)
      $('findWhat').textContent = inSentence(P[task.id].name); $('findHow').textContent = W.tapPart
      $('findHere').hidden = true; $('scrub').disabled = true; syncUI()
    }
  }
  function findDone(ok, msg) {
    $('findVerdict').innerHTML = msg
    if (ok) { emit(`found/${track.id}/${task.type === 'step' ? 'p' + task.i : task.id}`); $('findNext').hidden = false; $('findHere').hidden = true; $('findNext').focus() }
    else if (!task.missed) { task.missed = true; queue.splice(Math.min(2, queue.length), 0, { ...task, missed: false }) }
  }
  $('findHere').onclick = () => {
    const i = locate(t).i
    findDone(i === task.i, i === task.i ? `<b>Ano.</b> Poznávací znak: ${esc(tipOf(i))}` : `<b>Tady je ${esc(inSentence(segs()[i].name))}.</b> Poznávací znak: ${esc(tipOf(i))} ${i < task.i ? W.later : W.earlier}`)
  }
  function answerFind(id) {
    if (!task || task.type !== 'part' || !$('findNext').hidden) return
    findDone(id === task.id, id === task.id ? `<b>Ano.</b> ${esc(P[id].what)}` : `<b>Tohle je ${esc(inSentence(P[id].name))}.</b> Zkus jinou tečku.`)
  }
  $('findNext').onclick = nextFind

  // ---------- 3: name it (recall) ----------
  function nextName() {
    const byStep = nameByStep(), all = byStep ? segs().map((_, i) => i) : def.findable(track.id)
    if (!queue.length) queue = shuffle([...all])
    const key = queue.shift(); let opts
    if (byStep) { task = { i: key, key, done: false }; t = segMid(key, .35 + Math.random() * .45); opts = all }
    else { task = { part: key, key, done: false }; t = timeWith(key); opts = shuffle([key, ...shuffle(all.filter((x) => x !== key)).slice(0, 7)]) }
    $('opts').innerHTML = ''; $('nameVerdict').textContent = ''; $('nameNext').hidden = true
    for (const k of opts) { const b = document.createElement('button'); b.textContent = byStep ? segs()[k].name : P[k].name; b.dataset.k = k; b.onclick = () => answerName(k, b); $('opts').append(b) }
    syncUI()
  }
  function answerName(k, btn) {
    if (task.done) return; task.done = true; const ok = k === task.key, byStep = task.part === undefined;
    [...$('opts').children].forEach((b) => { b.disabled = true; if (b.dataset.k === String(task.key)) b.classList.add('ok') })
    if (!ok) { btn.classList.add('bad'); queue.splice(Math.min(2, queue.length), 0, task.key) } else emit(`named/${track.id}/${byStep ? task.key : 'part:' + task.key}`)
    const name = byStep ? segs()[task.key].name : P[task.key].name, why = byStep ? `Poznávací znak: ${esc(tipOf(task.key))}` : esc(P[task.key].what)
    $('nameVerdict').innerHTML = `<b>${ok ? 'Ano.' : 'Tohle je ' + esc(inSentence(name)) + '.'}</b> ${why}`
    $('nameNext').hidden = false; $('nameNext').focus()
  }
  $('nameNext').onclick = nextName

  // ---------- 4: put in order (the played-back story shows the error) ----------
  function resetOrder() {
    const n = segs().length; order = { cards: shuffle([...Array(n).keys()]), pick: [] }
    $('cards').innerHTML = ''; $('orderVerdict').textContent = ''
    for (const i of order.cards) {
      renderScene(segMid(i, .75), { thumb: true }); const b = document.createElement('button'); b.dataset.i = i; b.setAttribute('aria-label', 'obrázek')
      b.innerHTML = `<img alt="" src="${cv.toDataURL('image/png')}">`; b.onclick = () => pickCard(i); $('cards').append(b)
    }
    drawOrder()
  }
  function drawOrder() {
    [...$('cards').children].forEach((b) => { const k = order.pick.indexOf(+b.dataset.i); b.className = ''; b.querySelector('.ord')?.remove(); if (k >= 0) b.insertAdjacentHTML('beforeend', `<span class="ord">${k + 1}</span>`) })
    $('orderPlay').disabled = order.pick.length < segs().length
  }
  function pickCard(i) { const k = order.pick.indexOf(i); if (k >= 0) order.pick.splice(k, 1); else order.pick.push(i); $('orderVerdict').textContent = ''; drawOrder() }
  $('orderPlay').onclick = () => { playlist = { seq: [...order.pick], k: 0, p: 0 }; playing = true }
  $('orderReset').onclick = resetOrder
  function orderDone() {
    let k = 0; while (k < order.pick.length && order.pick[k] === k) k++
    if (k === segs().length) { [...$('cards').children].forEach((b) => b.classList.add('on')); $('orderVerdict').innerHTML = '<b>Děj na sebe navazuje.</b> Pořadí sedí.'; emit(`ordered/${track.id}`); return }
    order.pick = order.pick.slice(0, k); drawOrder()
    $('orderVerdict').innerHTML = k ? `<b>Děj přeskočil po ${k}. obrázku.</b> Správný začátek zůstal, doplň zbytek.` : '<b>Děj přeskočil hned na začátku.</b> Zkus to znovu.'
  }

  // ---------- wiring ----------
  const paintSwatches = () => document.querySelectorAll('[data-sw]').forEach((el) => { el.style.background = rgb(def.palette[theme][el.dataset.sw]) })
  document.querySelectorAll('#tracks button').forEach((b) => b.onclick = () => setTrack(b.dataset.track))
  document.querySelectorAll('.steps button').forEach((b) => b.onclick = () => setStep(b.dataset.step))
  $('scrub').oninput = (e) => setT(e.target.value / 1000)
  $('play').onclick = () => {
    if (t >= 1) t = 0; playing = !playing
    if (voice.on) { if (!playing) voice.audio.pause(); else if (voice.seg === locate(t).i && voice.audio.currentTime > 0 && !voice.audio.ended) voice.audio.play(); else startClip(locate(t).i) }
    syncUI()
  }
  $('showAns').onclick = () => { $('ans').hidden = false; $('showAns').hidden = true; emit(`ans/${track.id}/${segIdx}`) }
  document.querySelectorAll('[name=theme]').forEach((r) => r.onchange = () => { theme = r.value; document.body.dataset.theme = theme; paintSwatches(); if (step === 'order') resetOrder() })
  document.querySelectorAll('[data-layer]').forEach((c) => c.onchange = () => { layers[c.dataset.layer] = c.checked; spotsKey = '' })
  addEventListener('keydown', (e) => { if (e.code === 'Space' && step === 'explore' && !track.still && !/BUTTON|INPUT|SUMMARY|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); $('play').click() } })
  let drag = null
  cv.onpointerdown = (e) => { drag = [e.clientX, e.clientY]; cam.touched = true; cam.goalAz = null; $('hint').hidden = true; cv.setPointerCapture(e.pointerId) }
  cv.onpointermove = (e) => { if (!drag) return; cam.az += (e.clientX - drag[0]) * -.008; cam.el = Math.max(-1.3, Math.min(1.3, cam.el + (e.clientY - drag[1]) * .008)); drag = [e.clientX, e.clientY] }
  cv.onpointerup = cv.onpointercancel = () => drag = null
  new ResizeObserver(() => { const d = Math.min(devicePixelRatio || 1, 2); cv.width = cv.clientWidth * d; cv.height = cv.clientHeight * d }).observe(cv)

  let last = performance.now(), first = true;
  (function frame(now) {
    const dt = Math.min(.1, (now - last) / 1000); last = now; if (!still) time += dt
    if (!cam.touched && !still) cam.az = lerp(cam.az, .5, 1 - Math.exp(-dt * 1.6)) // one opening turn so it reads as 3D
    if (cam.goalAz !== null) { cam.az = lerp(cam.az, cam.goalAz, still ? 1 : 1 - Math.exp(-dt * 4)); if (Math.abs(cam.az - cam.goalAz) < .005) cam.goalAz = null }
    if (playing) {
      if (voice.on && voice.seg >= 0) voiceTick()
      else if (playlist) {
        const s = segs()[playlist.seq[playlist.k]]; playlist.p += dt / (s.weight * 2.4)
        if (playlist.p >= 1) { playlist.p = 0; playlist.k++ }
        if (playlist.k >= playlist.seq.length) { playing = false; playlist = null; orderDone() } else t = segMid(playlist.seq[playlist.k], Math.min(.999, playlist.p))
      } else { t += dt / (total() * 4.2); if (t >= 1) { t = 1; playing = false } }
      syncUI()
    }
    if (cv.width && R) { renderScene(t, { dt, snap: first }); first = false; syncSpots() }
    requestAnimationFrame(frame)
  })(last)
  paintSwatches(); setTrack(track.id)

  return {
    def, cam, voice, setT, setTrack, setStep, setFocus, locate, segStart, segMid,
    get hot() { return hot }, get task() { return task }, get order() { return order }, get track() { return track.id }, get step() { return step },
  }
}
