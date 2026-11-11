// "Lekce na přání" end to end in a real browser, with the backend stubbed: no sign-in, no e-mail,
// nothing reaches Supabase. Run: node e2e/requests.mjs   (needs Google Chrome)
//
// The app is served by the dev server with a made-up Supabase address; every request to it is
// answered here from a small in-memory copy of the three things the page talks to (the member
// row, the requests table, the photo bucket). A session is planted in localStorage the way
// supabase-js stores one. Screenshots of the member view land in shots/.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const dir = new URL('..', import.meta.url).pathname
mkdirSync(dir + 'shots', { recursive: true })

const PORT = 8766, HOME = `http://localhost:${PORT}/`, API = 'https://stub.supabase.co'
const UID = '0b0e4a52-6f0c-4f0e-9b7a-1c2d3e4f5a6b'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const session = {
  access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', exp: 4102444800 })}.stub`,
  refresh_token: 'stub', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800,
  user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'zak@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-11-01T10:00:00Z' },
}
const photo = { name: 'strana.png', mimeType: 'image/png', buffer: readFileSync(dir + 'public/deleni-bunky/nahled.png') }

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: dir, stdio: 'ignore', env: { ...process.env, VITE_SUPABASE_URL: API, VITE_SUPABASE_PUBLISHABLE_KEY: 'stub' },
})
// The analytics client drops events from automated browsers. Look like a person, so the event can be checked.
const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] })
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
const errors = []
let failed = false

/** A page with its own stub backend. `db` is the state the test reads and changes. */
async function open({ signedIn = true, member = true, requests = [], viewport = { width: 1360, height: 900 } } = {}) {
  const db = { member, requests: structuredClone(requests), uploads: [], inserts: [], events: [], lists: 0, failUpload: false, rejectInsert: false, loseAnswer: false }
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'cs-CZ', timezoneId: 'Europe/Prague', userAgent: UA })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && !/font|ERR_|Failed to load resource/.test(m.text()) && errors.push(m.text()))
  await page.clock.install({ time: new Date('2026-11-11T19:00:00Z') })
  if (signedIn) await page.addInitScript((s) => localStorage.setItem('sb-stub-auth-token', JSON.stringify(s)), session)
  await page.route(API + '/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), method = req.method()
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    if (url.pathname === '/rest/v1/medicina_members') {
      const one = /vnd\.pgrst\.object/.test(req.headers().accept ?? '')
      if (!db.member) return one ? json(406, { code: 'PGRST116', message: 'no rows' }) : json(200, [])
      return json(200, one ? { tier: 'premium' } : [{ tier: 'premium' }])
    }
    if (url.pathname === '/rest/v1/medicina_requests' && method === 'GET') {
      db.lists++
      return json(200, [...db.requests].sort((a, b) => b.created_at.localeCompare(a.created_at)))
    }
    if (url.pathname === '/rest/v1/medicina_requests' && method === 'POST') {
      const row = req.postDataJSON()
      db.inserts.push(row)
      if (db.rejectInsert) return json(403, { code: '42501', message: 'new row violates row-level security policy for table "medicina_requests"' })
      db.requests.push({ lesson_slug: null, status_note: null, result_url: null, ...row, status: 'queued', created_at: await page.evaluate(() => new Date().toISOString()) })
      if (db.loseAnswer) return route.abort('connectionreset') // stored, but the browser never hears
      return json(201, null)
    }
    if (url.pathname.startsWith('/storage/v1/object/')) {
      if (db.failUpload) return json(500, { statusCode: '500', error: 'Internal', message: 'stub failure' })
      const body = req.postDataBuffer() ?? Buffer.alloc(0) // multipart: one part, the file
      db.uploads.push({ path: url.pathname.replace('/storage/v1/object/', ''), jpeg: body.includes('Content-Type: image/jpeg') && body.includes(Buffer.from([0xff, 0xd8, 0xff])), bytes: body.length })
      return json(200, { Key: url.pathname, Id: 'stub' })
    }
    if (url.pathname === '/rest/v1/events') { db.events.push(req.postDataJSON()); return json(201, null) }
    return json(200, method === 'GET' ? [] : null) // progress sync and the rest
  })
  await page.goto(HOME)
  await page.waitForLoadState('networkidle')
  return { page, db, close: () => ctx.close() }
}
const at = (iso, over) => ({ id: crypto.randomUUID(), kind: 'new', lesson_slug: null, topic: 'Mitóza', status: 'queued', status_note: null, result_url: null, created_at: iso, ...over })
const text = (page, sel) => page.locator(sel).innerText()
/** Analytics are fire-and-forget, so give them a moment to arrive. */
const keyActions = async (db) => { await new Promise((r) => setTimeout(r, 400)); return db.events.filter((e) => e.event === 'key_action').map((e) => e.props) }

async function check(name, fn) {
  try { await fn(); console.log('pass ', name) } catch (e) { failed = true; console.log('FAIL ', name, '\n     ', String(e.message ?? e).split('\n').slice(0, 6).join('\n      ')) }
}

try {
  // wait for the dev server
  for (let i = 0; i < 40; i++) { try { if ((await fetch(HOME)).ok) break } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)) }

  await check('signed out: the section is hidden and empty', async () => {
    const { page, close } = await open({ signedIn: false })
    assert.equal(await page.locator('#requests').isHidden(), true)
    assert.equal(await page.locator('#requests').innerHTML(), '')
    await close()
  })

  await check('signed in, not a member: hidden and empty, no mention of tiers', async () => {
    const { page, db, close } = await open({ member: false })
    await page.locator('#account .acc-who').waitFor()
    assert.equal(await page.locator('#requests').isHidden(), true)
    assert.equal(await page.locator('#requests').innerHTML(), '')
    assert.equal(db.lists, 0, 'a non-member never asks for requests')
    assert.doesNotMatch(await page.locator('body').innerText(), /premium|členství|tarif/i)
    await close()
  })

  await check('member: form, validation, upload, insert, list, analytics', async () => {
    const { page, db, close } = await open()
    const sec = page.locator('#requests')
    await sec.getByRole('heading', { name: 'Lekce na přání' }).waitFor()
    assert.match(await text(page, '.rq-lede'), /člověk ji předem nečte/)
    assert.equal(await page.locator('.rq-mine').isHidden(), true, 'no list before the first request')
    assert.equal(await sec.locator('.rq-slab').count(), 1, 'one primary button')

    // too short a topic: said plainly, nothing sent
    await sec.getByLabel('Téma').fill('ab')
    await sec.getByRole('button', { name: 'Poslat k postavení' }).click()
    assert.equal(await text(page, '.rq-msg'), 'Téma musí mít aspoň 3 znaky.')
    assert.equal(db.inserts.length, 0)

    // by keyboard: topic, notes, photos, send
    await sec.getByLabel('Téma').fill('Meióza')
    await page.keyboard.press('Tab'); await page.keyboard.type('Crossing-over a rozdíl proti mitóze')
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'rq-file', 'the photo picker is reachable by keyboard')
    await sec.locator('.rq-file').setInputFiles([photo, { ...photo, name: 'strana2.png' }])
    assert.deepEqual(await sec.locator('.rq-files li span').allInnerTexts(), ['Stránka 1', 'Stránka 2'])
    await sec.locator('.rq-file').setInputFiles([{ ...photo, name: 'strana3.png' }]) // a second pick adds, it does not replace
    assert.equal(await sec.locator('.rq-files li').count(), 3)
    await sec.getByRole('button', { name: 'Odebrat stránku 3' }).click()
    assert.equal(await sec.locator('.rq-files li').count(), 2)
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Poslat k postavení')
    await page.keyboard.press('Enter')

    await page.locator('.rq-msg', { hasText: 'Hotovo, lekce je ve frontě.' }).waitFor()
    assert.equal(db.inserts.length, 1)
    const row = db.inserts[0]
    assert.match(row.id, /^[0-9a-f-]{36}$/)
    assert.deepEqual({ ...row, id: 0 }, { id: 0, kind: 'new', topic: 'Meióza', notes: 'Crossing-over a rozdíl proti mitóze', attachments: [`${UID}/${row.id}/0.jpg`, `${UID}/${row.id}/1.jpg`] })
    assert.deepEqual(db.uploads.map((u) => u.path), row.attachments.map((p) => 'medicina-requests/' + p), 'photos go up before the row, to the paths the row names')
    assert.ok(db.uploads.every((u) => u.jpeg && u.bytes > 1000), 'a PNG goes up as JPEG: ' + JSON.stringify(db.uploads))
    assert.deepEqual(await keyActions(db), [{ action: 'lesson_request', kind: 'new' }])
    // the form is clean again and the request is listed
    assert.equal(await sec.getByLabel('Téma').inputValue(), '')
    assert.equal(await sec.locator('.rq-files li').count(), 0)
    assert.deepEqual(await sec.locator('.rq-list li strong').allInnerTexts(), ['Meióza'])
    assert.match(await text(page, '.rq-list li .rq-meta'), /VE FRONTĚ/i)

    // polling: every 30 s while it moves, with the change announced; none once all are final
    const before = db.lists
    db.requests[0].status = 'building'
    await page.clock.fastForward(30_000); await page.locator('.rq-meta', { hasText: /staví se/i }).waitFor()
    assert.equal(db.lists, before + 1)
    assert.equal(await page.locator('.rq-live').textContent(), 'Meióza: Staví se.')
    Object.assign(db.requests[0], { status: 'live', result_url: '/meioza/' })
    await page.clock.fastForward(30_000); await page.locator('.rq-list a').waitFor()
    assert.equal(await page.locator('.rq-list a').getAttribute('href'), '/meioza/')
    assert.equal(await text(page, '.rq-list a'), 'Otevřít lekci')
    const settled = db.lists
    await page.clock.fastForward(120_000); await page.waitForTimeout(200)
    assert.equal(db.lists, settled, 'no polling when every request is final')
    await close()
  })

  await check('a failed upload says which photo, keeps text and photos, and a retry goes through', async () => {
    const { page, db, close } = await open()
    const sec = page.locator('#requests')
    await sec.getByLabel('Téma').fill('Dýchací řetězec')
    await sec.locator('.rq-file').setInputFiles([photo])
    db.failUpload = true
    await sec.getByRole('button', { name: 'Poslat k postavení' }).click()
    await page.locator('.rq-msg', { hasText: 'Fotku 1 se nepodařilo nahrát. Text i fotky zůstaly, zkus to znovu.' }).waitFor()
    assert.equal(await sec.getByLabel('Téma').inputValue(), 'Dýchací řetězec')
    assert.equal(await sec.locator('.rq-files li').count(), 1)
    assert.equal(db.inserts.length, 0, 'no row without its photos')
    db.failUpload = false
    await sec.getByRole('button', { name: 'Poslat k postavení' }).click()
    await page.locator('.rq-msg', { hasText: 'Hotovo' }).waitFor()
    assert.equal(db.inserts.length, 1)
    await close()
  })

  await check('a refused insert says so and keeps the text', async () => {
    const { page, db, close } = await open()
    const sec = page.locator('#requests')
    await sec.getByLabel('Téma').fill('Krebsův cyklus')
    db.rejectInsert = true
    await sec.getByRole('button', { name: 'Poslat k postavení' }).click()
    await page.locator('.rq-msg', { hasText: 'Zadání se nepodařilo odeslat. Text i fotky zůstaly, zkus to za chvíli znovu.' }).waitFor()
    assert.equal(await sec.getByLabel('Téma').inputValue(), 'Krebsův cyklus')
    assert.deepEqual(await keyActions(db), [])
    await close()
  })

  await check('an answer lost on the way: the request is found in the list, not filed twice', async () => {
    const { page, db, close } = await open()
    const sec = page.locator('#requests')
    await sec.getByLabel('Téma').fill('Golgiho aparát')
    db.loseAnswer = true
    await sec.getByRole('button', { name: 'Poslat k postavení' }).click()
    await page.locator('.rq-msg', { hasText: 'Hotovo, lekce je ve frontě.' }).waitFor()
    assert.equal(db.inserts.length, 1)
    assert.deepEqual(await sec.locator('.rq-list li strong').allInnerTexts(), ['Golgiho aparát'])
    assert.equal(await sec.getByLabel('Téma').inputValue(), '')
    await close()
  })

  await check('daily cap: three in 24 hours close the form with the agreed sentence', async () => {
    const three = [at('2026-11-11T18:30:00Z'), at('2026-11-11T12:00:00Z', { status: 'live', result_url: '/a/' }), at('2026-11-10T20:00:00Z', { status: 'failed', status_note: 'Fotky nejdou přečíst.' })]
    const { page, close } = await open({ requests: three })
    await page.locator('.rq-cap', { hasText: 'Dnes už jsou zadané tři lekce. Další půjde zadat zítra.' }).waitFor()
    assert.equal(await page.locator('.rq-slab').isDisabled(), true)
    await page.locator('#requests').screenshot({ path: `${dir}shots/requests-desk-cap.png` })
    await close()
    // two today and one older than 24 hours: open
    const { page: p2, close: c2 } = await open({ requests: [three[0], three[1], at('2026-11-10T18:00:00Z')] })
    await p2.locator('.rq-list li').first().waitFor()
    assert.equal(await p2.locator('.rq-slab').isDisabled(), false)
    assert.equal(await p2.locator('.rq-cap').textContent(), '')
    await c2()
  })

  await check('the third request of the day: confirmation and the cap line together', async () => {
    const { page, db, close } = await open({ requests: [at('2026-11-11T18:30:00Z'), at('2026-11-11T12:00:00Z')] })
    await page.locator('#requests').getByLabel('Téma').fill('Třetí dnes')
    await page.locator('.rq-slab').click()
    await page.locator('.rq-msg', { hasText: 'Hotovo' }).waitFor()
    assert.equal(await text(page, '.rq-cap'), 'Dnes už jsou zadané tři lekce. Další půjde zadat zítra.')
    assert.equal(db.inserts.length, 1)
    await close()
  })

  // ---- screenshots of the member view (look at them) ----
  const sample = [
    at('2026-11-11T18:52:00Z', { topic: 'Meióza a crossing-over' }),
    at('2026-11-11T17:10:00Z', { topic: 'Buněčný cyklus: kontrolní body', status: 'building' }),
    at('2026-11-10T16:05:00Z', { topic: 'Chybí popis anafáze II', kind: 'revise', lesson_slug: 'deleni-bunky', status: 'checking' }),
    at('2026-11-09T19:30:00Z', { topic: 'Stavba a funkce mitochondrie', status: 'live', result_url: '/mitochondrie/' }),
    at('2026-11-08T15:00:00Z', { topic: 'Fotosyntéza', status: 'failed', status_note: 'Fotky stránek jsou rozmazané, text z nich nejde přečíst. Vyfoť je znovu za světla.' }),
    at('2026-11-07T15:00:00Z', { topic: 'Dějiny medicíny', status: 'rejected', status_note: 'Tohle není v sešitu z biologie.' }),
  ]
  for (const [tag, viewport] of [['desk', { width: 1360, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
    await check(`screenshots at ${viewport.width}`, async () => {
      const empty = await open({ viewport })
      await empty.page.locator('#requests h2').waitFor()
      await empty.page.screenshot({ path: `${dir}shots/requests-${tag}-empty.png`, fullPage: true })
      await empty.close()

      const { page, close } = await open({ viewport, requests: sample })
      const sec = page.locator('#requests')
      await sec.locator('.rq-list li').first().waitFor()
      await sec.getByLabel('Téma').fill('Dýchací řetězec a tvorba ATP')
      await sec.getByLabel(/Co má lekce pokrýt/).fill('Hlavně komplexy I až IV, kde vzniká protonový gradient a kolik ATP z toho je. V sešitu je to na dvou stranách.')
      await sec.locator('.rq-file').setInputFiles([photo, { ...photo, name: 'b.png' }])
      await sec.locator('.rq-file').focus()
      await page.screenshot({ path: `${dir}shots/requests-${tag}.png`, fullPage: true })
      await sec.screenshot({ path: `${dir}shots/requests-${tag}-section.png` })
      // nothing wider than the screen, nothing smaller than 13 px, targets at least 44 px
      const m = await page.evaluate(() => {
        const sec = document.querySelector('#requests')
        const small = [...sec.querySelectorAll('*')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 13).map((e) => e.className || e.tagName)
        const low = [...sec.querySelectorAll('button, a, label.rq-btn, input[type=text], textarea')].filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.className || e.tagName)
        return { overflow: document.documentElement.scrollWidth - innerWidth, small, low }
      })
      assert.deepEqual(m, { overflow: 0, small: [], low: [] })

      // the lesson-page dialog (opened here on the home page; it carries its own styles)
      await page.evaluate(async () => (await import('/src/requests.ts')).openRequestDialog({ kind: 'revise', lessonSlug: 'deleni-bunky', lessonTitle: 'Buněčný cyklus a dělení buněk' }))
      await page.locator('dialog.rq-dialog').getByLabel('Co upravit').fill('V anafázi II chybí, že se rozcházejí chromatidy')
      await page.screenshot({ path: `${dir}shots/requests-${tag}-dialog.png` })
      await close()
    })
  }

  await check('lesson dialog: a revise request carries the lesson', async () => {
    const { page, db, close } = await open()
    await page.locator('#requests h2').waitFor()
    await page.evaluate(async () => (await import('/src/requests.ts')).openRequestDialog({ kind: 'revise', lessonSlug: 'deleni-bunky', lessonTitle: 'Buněčný cyklus a dělení buněk' }))
    const d = page.locator('dialog.rq-dialog')
    await d.getByLabel('Co upravit').fill('Chybí crossing-over')
    await d.getByRole('button', { name: 'Poslat k úpravě' }).click()
    await d.locator('.rq-msg', { hasText: 'Hotovo, úprava je ve frontě.' }).waitFor()
    assert.deepEqual({ ...db.inserts[0], id: 0 }, { id: 0, kind: 'revise', topic: 'Chybí crossing-over', notes: '', attachments: [], lesson_slug: 'deleni-bunky' })
    assert.deepEqual(await keyActions(db), [{ action: 'lesson_request', kind: 'revise' }])
    await d.getByRole('button', { name: 'Zavřít' }).click()
    await page.locator('dialog.rq-dialog').waitFor({ state: 'detached' })
    await close()
  })

  assert.deepEqual(errors, [], 'no page errors')
} catch (e) {
  failed = true
  console.error(e)
} finally {
  await browser.close()
  server.kill()
}
console.log(failed ? '\nFAILED' : '\nall passed; screenshots in shots/requests-*.png')
process.exit(failed ? 1 : 0)
