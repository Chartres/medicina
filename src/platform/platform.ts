// Sign-in, progress and analytics for every page. Lessons stay plain HTML and talk to this through
// DOM events, so a lesson also runs opened straight from disk with none of it.
import { supabase } from './supabase'
import { createFlywheelClient } from './flywheel-client'
import { empty, mark, merge, parse, same, type Progress } from './progress'
import './account.css'

const APP = 'medicina', KEY = 'medicina.progress'
export const fw = createFlywheelClient({ app: APP, supabase: supabase as never })

let progress: Progress = empty()
try { progress = parse(JSON.parse(localStorage.getItem(KEY) ?? 'null')) } catch { /* blocked storage: this visit only */ }
let userId: string | null = null, email = '', timer = 0
const listeners = new Set<(p: Progress) => void>()

// Who is signed in, for modules outside this file (members.ts, requests.ts). Called now and on every auth event.
export { supabase }
export type User = { id: string; email: string }
const userListeners = new Set<(u: User | null) => void>()
const currentUser = (): User | null => (userId ? { id: userId, email } : null)
export function onUser(fn: (u: User | null) => void) { userListeners.add(fn); fn(currentUser()) }

export const getProgress = () => progress
export function onProgress(fn: (p: Progress) => void) { listeners.add(fn); fn(progress) }
function changed() {
  try { localStorage.setItem(KEY, JSON.stringify(progress)) } catch { /* see above */ }
  listeners.forEach((fn) => fn(progress))
}
/** Record that something was done. Returns true the first time. */
export function addMark(key: string): boolean {
  if (!mark(progress, key, new Date().toISOString())) return false
  changed()
  clearTimeout(timer); timer = window.setTimeout(sync, 2500)
  return true
}
export function setSummary(lesson: string, s: Progress['summary'][string]) {
  progress.summary[lesson] = s
  try { localStorage.setItem(KEY, JSON.stringify(progress)) } catch { /* see above */ }
}

// Cloud copy in the fleet's shared `progress` table, one row per (user, app). Best effort: a failed
// sync leaves local progress as it is and the next mark tries again.
async function sync() {
  if (!supabase || !userId) return
  try {
    const { data, error } = await supabase.from('progress').select('data').eq('user_id', userId).eq('app', APP).maybeSingle()
    if (error) throw error
    const merged = merge(progress, parse(data?.data))
    const grew = !same(merged, progress)
    progress = merged
    if (grew) changed()
    await supabase.from('progress').upsert({ user_id: userId, app: APP, data: merged, updated_at: new Date().toISOString() }, { onConflict: 'user_id,app' })
  } catch (e) { fw.logError(e, { where: 'sync' }) }
}

// ---------- account control ----------
function render(host: HTMLElement) {
  if (!supabase) { host.hidden = true; return }
  host.innerHTML = userId
    ? `<span class="acc-who">${email.replace(/[&<>"]/g, '')}</span><button class="acc-btn" data-acc="out">Odhlásit</button>`
    : `<button class="acc-btn" data-acc="in">Přihlásit se</button>`
}
function dialog(): HTMLDialogElement {
  let d = document.querySelector<HTMLDialogElement>('#accDialog')
  if (d) return d
  d = document.createElement('dialog'); d.id = 'accDialog'
  d.innerHTML = `
    <form method="dialog" class="acc-form">
      <h2>Přihlášení</h2>
      <p>Postup se ukládá v tomhle prohlížeči. Po přihlášení ho najdeš i na jiném zařízení. Stačí e-mail, heslo není.</p>
      <label>E-mail<input type="email" name="email" required autocomplete="email" inputmode="email"></label>
      <button class="acc-slab" value="send">Poslat odkaz</button>
      <div class="acc-code" hidden>
        <p>Odkaz je v e-mailu. Otevři ho na tomhle zařízení, nebo sem opiš kód z e-mailu.</p>
        <label>Kód<input name="code" inputmode="numeric" autocomplete="one-time-code"></label>
        <button class="acc-slab" value="verify">Přihlásit kódem</button>
      </div>
      <p class="acc-msg" role="status"></p>
      <button class="acc-btn" value="close" formnovalidate>Zavřít</button>
    </form>`
  document.body.append(d)
  const form = d.querySelector('form')!, msg = d.querySelector('.acc-msg')!, codeBox = d.querySelector<HTMLElement>('.acc-code')!
  form.addEventListener('submit', async (e) => {
    const action = (e.submitter as HTMLButtonElement | null)?.value
    if (action === 'close') return
    e.preventDefault()
    const mail = String(new FormData(form).get('email') ?? '').trim(), code = String(new FormData(form).get('code') ?? '').trim()
    msg.textContent = ''
    if (action === 'send') {
      fw.track('signup_started')
      // the redirect is this origin exactly: an origin that is not allow-listed lands on a sibling app (auth-identity standard)
      const { error } = await supabase!.auth.signInWithOtp({ email: mail, options: { emailRedirectTo: window.location.origin } })
      if (error) msg.textContent = 'E-mail se nepodařilo odeslat. Zkus to za chvíli znovu.'
      else codeBox.hidden = false
    } else if (action === 'verify') {
      const { error } = await supabase!.auth.verifyOtp({ email: mail, token: code, type: 'email' })
      if (error) msg.textContent = 'Kód nesedí nebo už vypršel. Pošli si nový odkaz.'
      else d!.close()
    }
  })
  return d
}

export function initPlatform() {
  fw.track('page_view', { path: location.pathname })
  const host = document.querySelector<HTMLElement>('#account')
  if (!host) return
  render(host)
  host.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-acc]')?.dataset.acc
    if (act === 'in') dialog().showModal()
    if (act === 'out') supabase?.auth.signOut()
  })
  supabase?.auth.onAuthStateChange((event, session) => {
    const was = userId
    userId = session?.user.id ?? null; email = session?.user.email ?? ''
    fw.identify(userId)
    render(host)
    userListeners.forEach((fn) => fn(currentUser()))
    if (userId && !was) { if (event === 'SIGNED_IN') fw.track('signup_completed'); void sync() }
  })
}
