// "Lekce na přání": a premium member asks for a new lesson (home page) or a change to one
// (lesson page). The request waits in `medicina_requests`; a builder on Pavol's machine picks it
// up and moves its status until the lesson is live. Rules (who, how many, which columns) are
// enforced in the database: supabase/migrations/20261111_medicina_requests.sql.
import { fw, supabase, type User } from './platform/platform'
import { onMember } from './platform/members'
import './requests.css'

export type Status = 'queued' | 'building' | 'checking' | 'live' | 'failed' | 'rejected'
export type Kind = 'new' | 'revise'
export interface LessonRequest {
  id: string; kind: Kind; lesson_slug: string | null; topic: string
  status: Status; status_note: string | null; result_url: string | null; created_at: string
}

const BUCKET = 'medicina-requests', MAX_FILES = 8, MAX_SIDE = 2200, DAILY_CAP = 3, POLL_MS = 30_000
export const CAP_MESSAGE = 'Dnes už jsou zadané tři lekce. Další půjde zadat zítra.'

// ---------- pure parts (requests.test.ts) ----------
export const STATUS_LABEL: Record<Status, string> = {
  queued: 'Ve frontě', building: 'Staví se', checking: 'Kontroluje se', live: 'Hotovo', failed: 'Nepovedlo se', rejected: 'Zamítnuto',
}
export const isFinal = (s: Status) => s === 'live' || s === 'failed' || s === 'rejected'
export const shouldPoll = (rs: Pick<LessonRequest, 'status'>[]) => rs.some((r) => !isFinal(r.status))
export const capReached = (rs: Pick<LessonRequest, 'created_at'>[], now = Date.now()) =>
  rs.filter((r) => now - Date.parse(r.created_at) < 24 * 3600e3).length >= DAILY_CAP
export const attachmentPath = (uid: string, requestId: string, n: number) => `${uid}/${requestId}/${n}.jpg`

/** Size after scaling the longest side down to `max`; never up. */
export function fitSize(w: number, h: number, max = MAX_SIDE): [number, number] {
  const k = Math.min(1, max / Math.max(w, h))
  return [Math.round(w * k), Math.round(h * k)]
}

/** The address if it stays on this site, else null. The builder writes this field from what it was asked, so it is not trusted. */
export function safeUrl(u: string | null, origin = location.origin): string | null {
  if (!u) return null
  try {
    const url = new URL(u, origin)
    return url.origin === origin ? url.pathname + url.search + url.hash : null
  } catch { return null }
}

export function statusLine(r: LessonRequest, origin?: string): { label: string; note: string | null; link: string | null } {
  return {
    label: STATUS_LABEL[r.status] ?? r.status,
    note: r.status === 'failed' || r.status === 'rejected' ? r.status_note : null,
    link: r.status === 'live' ? safeUrl(r.result_url, origin) : null,
  }
}

/** The first thing wrong with a request, in words for the learner, or null. */
export function validate(input: { topic: string; notes: string; files: { name: string; type: string }[] }): string | null {
  const topic = input.topic.trim()
  if (topic.length < 3) return 'Téma musí mít aspoň 3 znaky.'
  if (topic.length > 200) return 'Téma může mít nejvýš 200 znaků.'
  if (input.notes.length > 4000) return 'Popis může mít nejvýš 4000 znaků.'
  if (input.files.length > MAX_FILES) return `Fotek může být nejvýš ${MAX_FILES}.`
  const other = input.files.find((f) => !f.type.startsWith('image/'))
  return other ? `Soubor ${other.name} není obrázek.` : null
}

// ---------- state: the member and their requests ----------
let member: User | null = null
let requests: LessonRequest[] = []
let timer = 0, loadFailed = false
let live: HTMLElement | null = null // the home section's announcer; its presence means statuses are on screen
const views = new Set<() => void>()

/** Reload the member's requests. False when the load failed (the old list stays). */
async function refresh(): Promise<boolean> {
  const who = member
  if (!supabase || !who) return false
  const { data, error } = await supabase.from('medicina_requests')
    .select('id,kind,lesson_slug,topic,status,status_note,result_url,created_at').order('created_at', { ascending: false }).limit(50)
  if (member !== who) return false // signed out or switched while loading
  loadFailed = !!error || !data
  if (!loadFailed) {
    const before = new Map(requests.map((r) => [r.id, r.status]))
    requests = data as LessonRequest[]
    const moved = requests.filter((r) => before.has(r.id) && before.get(r.id) !== r.status)
    if (live && moved.length) live.textContent = moved.map((r) => `${r.topic}: ${STATUS_LABEL[r.status] ?? r.status}.`).join(' ')
  }
  views.forEach((draw) => draw())
  // every 30 s while something is still moving and its status is on screen; otherwise not at all
  clearTimeout(timer)
  if (live && shouldPoll(requests)) timer = window.setTimeout(() => void refresh(), POLL_MS)
  return !loadFailed
}

onMember((m) => {
  member = m; requests = []; loadFailed = false
  clearTimeout(timer)
  views.forEach((draw) => draw())
  if (m) void refresh()
})

// ---------- photos ----------
/** Longest side at most 2200 px, JPEG. A phone photo of a page drops from several MB to about one. */
async function downscale(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const [w, h] = fitSize(bmp.width, bmp.height)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h) // JPEG has no transparency
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('toBlob'))), 'image/jpeg', 0.85))
}

// ---------- the form (shared by the home section and the lesson dialog) ----------
interface FormCopy { kind: Kind; lessonSlug?: string; topic: string; notes: string; button: string; done: string }
let seq = 0

function requestForm(copy: FormCopy): { form: HTMLFormElement; dispose(): void } {
  const id = `rq${++seq}`
  const form = document.createElement('form')
  form.className = 'rq-form'; form.noValidate = true
  form.innerHTML = `
    <label for="${id}t">${copy.topic}</label>
    <input id="${id}t" name="topic" type="text" required minlength="3" maxlength="200" autocomplete="off">
    <label for="${id}n">${copy.notes} <span>nepovinné</span></label>
    <textarea id="${id}n" name="notes" rows="4" maxlength="4000"></textarea>
    <div class="rq-photos" role="group" aria-labelledby="${id}p">
      <span class="rq-label" id="${id}p">Stránky ze sešitu <span>nepovinné, nejvýš ${MAX_FILES} fotek</span></span>
      <ul class="rq-files"></ul>
      <input id="${id}f" class="rq-file" type="file" accept="image/*" multiple aria-describedby="${id}p">
      <label for="${id}f" class="rq-btn">Přidat fotky</label>
    </div>
    <button class="rq-slab" type="submit">${copy.button}</button>
    <p class="rq-msg" id="${id}m" role="status"></p>
    <p class="rq-cap" role="status"></p>`
  const topic = form.querySelector<HTMLInputElement>('[name=topic]')!, notes = form.querySelector<HTMLTextAreaElement>('[name=notes]')!
  const picker = form.querySelector<HTMLInputElement>('.rq-file')!, fileList = form.querySelector<HTMLElement>('.rq-files')!
  const button = form.querySelector<HTMLButtonElement>('.rq-slab')!, msg = form.querySelector<HTMLElement>('.rq-msg')!, cap = form.querySelector<HTMLElement>('.rq-cap')!
  const say = (text: string) => { msg.textContent = text }
  topic.setAttribute('aria-describedby', `${id}m`)
  topic.addEventListener('input', () => topic.removeAttribute('aria-invalid'))

  let files: File[] = [], busy = false
  // What an earlier try already uploaded, so a second try continues instead of uploading twice.
  let attempt: { id: string; sent: File[] } | null = null

  function drawFiles() {
    fileList.querySelectorAll('img').forEach((i) => URL.revokeObjectURL(i.src))
    fileList.replaceChildren(...files.map((f, i) => {
      const li = document.createElement('li'), thumb = document.createElement('img'), name = document.createElement('span'), drop = document.createElement('button')
      thumb.src = URL.createObjectURL(f); thumb.alt = ''
      name.textContent = `Stránka ${i + 1}`
      drop.type = 'button'; drop.className = 'rq-btn'; drop.textContent = 'Odebrat'; drop.setAttribute('aria-label', `Odebrat stránku ${i + 1}`)
      // a removed photo may already be up under this try's number, so the next try starts a fresh folder
      drop.addEventListener('click', () => { files = files.filter((x) => x !== f); attempt = null; drawFiles(); picker.focus() })
      li.append(thumb, name, drop)
      return li
    }))
    picker.disabled = files.length >= MAX_FILES
  }
  picker.addEventListener('change', () => {
    const picked = [...(picker.files ?? [])], images = picked.filter((f) => f.type.startsWith('image/'))
    const room = MAX_FILES - files.length
    files = [...files, ...images.slice(0, room)]
    picker.value = '' // the same photo can be picked again after it was removed
    say(images.length > room ? `Fotek může být nejvýš ${MAX_FILES}. Další se nepřidaly.` : images.length < picked.length ? 'Přidat jdou jen obrázky.' : '')
    drawFiles()
  })

  // The cap is known from the list, so say it before anything is typed, not after.
  function sync() {
    const capped = capReached(requests)
    button.disabled = busy || capped
    cap.textContent = capped ? CAP_MESSAGE : ''
  }
  views.add(sync); sync()

  async function send(): Promise<void> {
    const who = member
    if (!supabase || !who) return
    const text = { topic: topic.value.trim(), notes: notes.value.trim() }
    const wrong = validate({ ...text, files })
    if (wrong) {
      say(wrong)
      if (wrong.startsWith('Téma')) { topic.setAttribute('aria-invalid', 'true'); topic.focus() }
      return
    }
    say('')
    await refresh()
    if (capReached(requests)) return // the cap line says why

    if (!attempt || !attempt.sent.every((f, i) => files[i] === f)) attempt = { id: crypto.randomUUID(), sent: [] }
    const paths = files.map((_, i) => attachmentPath(who.id, attempt!.id, i))
    for (let i = attempt.sent.length; i < files.length; i++) {
      say(`Nahrává se fotka ${i + 1} z ${files.length}.`)
      let small: Blob
      try { small = await downscale(files[i]) } catch { return say(`Fotku ${i + 1} se nepodařilo načíst. Odeber ji a přidej jinou. Text zůstal.`) }
      const { error } = await supabase.storage.from(BUCKET).upload(paths[i], small, { contentType: 'image/jpeg' })
      if (error && !/exists|duplicate/i.test(error.message)) { // "already exists": an earlier try got it there
        fw.logError(error, { where: 'request_upload' })
        return say(`Fotku ${i + 1} se nepodařilo nahrát. Text i fotky zůstaly, zkus to znovu.`)
      }
      attempt.sent.push(files[i])
    }

    say('Odesílá se zadání.')
    const { error } = await supabase.from('medicina_requests').insert({
      id: attempt.id, kind: copy.kind, topic: text.topic, notes: text.notes, attachments: paths,
      ...(copy.kind === 'revise' ? { lesson_slug: copy.lessonSlug } : {}),
    })
    // Already in (an earlier try got through and only its answer was lost): the database says 23505, or,
    // when that try was the third of the day, refuses at the cap. Either way the list has it.
    if (error && error.code !== '23505' && !((await refresh()) && requests.some((r) => r.id === attempt!.id))) {
      if (capReached(requests)) return say('') // filed from another tab meanwhile; the cap line says why
      fw.logError(error, { where: 'request_insert' })
      return say('Zadání se nepodařilo odeslat. Text i fotky zůstaly, zkus to za chvíli znovu.')
    }
    fw.track('key_action', { action: 'lesson_request', kind: copy.kind })
    form.reset(); files = []; attempt = null; drawFiles()
    say(copy.done)
    await refresh()
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (busy) return
    busy = true; sync()
    void send().catch((err) => { fw.logError(err, { where: 'request_send' }); say('Zadání se nepodařilo odeslat. Text i fotky zůstaly, zkus to za chvíli znovu.') })
      .finally(() => { busy = false; sync() })
  })
  return { form, dispose: () => { views.delete(sync); fileList.querySelectorAll('img').forEach((i) => URL.revokeObjectURL(i.src)) } }
}

// ---------- home page section ----------
const when = new Intl.DateTimeFormat('cs', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' })

function requestItem(r: LessonRequest): HTMLLIElement {
  const s = statusLine(r)
  const li = document.createElement('li'), topic = document.createElement('strong'), meta = document.createElement('span'), time = document.createElement('time')
  topic.textContent = r.topic
  time.dateTime = r.created_at; time.textContent = when.format(new Date(r.created_at))
  meta.className = 'rq-meta'
  const state = document.createElement('b'); state.textContent = s.label
  meta.append(state, time)
  if (r.kind === 'revise') meta.append(Object.assign(document.createElement('span'), { textContent: 'úprava lekce' }))
  li.append(topic, meta)
  if (s.note) li.append(Object.assign(document.createElement('p'), { textContent: s.note }))
  if (s.link) li.append(Object.assign(document.createElement('a'), { href: s.link, textContent: 'Otevřít lekci' }))
  return li
}

/** The member's section on the home page. Hidden for everyone else, with nothing in it. */
export function mountRequests(host: HTMLElement) {
  let built: ReturnType<typeof requestForm> | null = null
  const draw = () => {
    if (!member) {
      built?.dispose(); built = null
      live = null; host.hidden = true; host.replaceChildren()
      return
    }
    if (!built) {
      host.className = 'rq'
      host.setAttribute('aria-labelledby', 'rqTitle')
      host.innerHTML = `
        <h2 id="rqTitle">Lekce na přání</h2>
        <p class="rq-lede">Napiš téma a přidej fotky stránek ze sešitu. Lekce se podle nich postaví sama, trvá to desítky minut. Projde automatickou kontrolou faktů, ale člověk ji předem nečte, tak hlas, když v ní něco nesedí.</p>
        <div class="rq-mine" hidden><h3>Zadané lekce</h3><p class="rq-failed" hidden>Zadané lekce se teď nepodařilo načíst.</p><ul class="rq-list"></ul></div>
        <p class="rq-live" role="status"></p>`
      built = requestForm({ kind: 'new', topic: 'Téma', notes: 'Co má lekce pokrýt', button: 'Poslat k postavení', done: 'Hotovo, lekce je ve frontě. Jak postupuje, je vidět tady dole.' })
      host.querySelector('.rq-lede')!.after(built.form)
      live = host.querySelector<HTMLElement>('.rq-live')
      host.hidden = false
      if (shouldPoll(requests)) void refresh() // mounted after the list had loaded: start the clock
    }
    host.querySelector<HTMLElement>('.rq-mine')!.hidden = requests.length === 0 && !loadFailed
    host.querySelector<HTMLElement>('.rq-failed')!.hidden = !loadFailed
    host.querySelector('.rq-list')!.replaceChildren(...requests.map(requestItem))
  }
  views.add(draw); draw()
  // back on the tab: catch up at once instead of waiting for the next tick
  document.addEventListener('visibilitychange', () => { if (!document.hidden && live && (loadFailed || shouldPoll(requests))) void refresh() })
}

// ---------- lesson page dialog ----------
/** Ask for a change to a live lesson. Does nothing unless a member is signed in. */
export function openRequestDialog(opts: { kind: 'revise'; lessonSlug: string; lessonTitle: string }) {
  if (!member) return
  const d = document.createElement('dialog')
  d.className = 'rq rq-dialog'
  d.setAttribute('aria-labelledby', 'rqDialogTitle')
  d.innerHTML = `
    <h2 id="rqDialogTitle">Upravit lekci</h2>
    <p class="rq-which"></p>
    <p class="rq-lede">Napiš, co v lekci nesedí nebo chybí. Úprava se postaví sama, trvá to desítky minut. Projde automatickou kontrolou faktů, ale člověk ji předem nečte.</p>
    <button type="button" class="rq-btn rq-close">Zavřít</button>`
  d.querySelector('.rq-which')!.textContent = opts.lessonTitle
  const { form, dispose } = requestForm({ kind: 'revise', lessonSlug: opts.lessonSlug, topic: 'Co upravit', notes: 'Podrobnosti', button: 'Poslat k úpravě', done: 'Hotovo, úprava je ve frontě. Jak postupuje, je vidět na úvodní stránce.' })
  d.querySelector('.rq-lede')!.after(form)
  d.querySelector('.rq-close')!.addEventListener('click', () => d.close())
  d.addEventListener('close', () => { dispose(); d.remove() })
  document.body.append(d)
  d.showModal()
}
