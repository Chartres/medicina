// Walks a lesson the way a learner would, at desktop and phone width, and fails on anything broken.
//   node e2e/lesson.mjs [slug …]      (default: every lesson)   — run `npm run build` first, or use `npm run e2e`
// It is generic: it reads the lesson's own definition from the page, so a new lesson needs no new test code.
// Screenshots of every step land in shots/<slug>/ — look at them; a green run only proves nothing crashed.
// Uses system Chrome (narration is AAC, which the bundled Chromium cannot play) with software GL.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const dir = new URL('..', import.meta.url).pathname
const PORT = 8765, URL0 = `http://localhost:${PORT}/`
const slugs = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir + 'src/lessons', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
for (const s of slugs) assert.ok(existsSync(`${dir}dist/${s}/index.html`), `dist/${s}/index.html missing — run npm run build`)

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: dir, stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 2500))
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const errors = []

try {
  for (const slug of slugs) {
    mkdirSync(`${dir}shots/${slug}`, { recursive: true })
    for (const [tag, viewport] of [['desk', { width: 1360, height: 860 }], ['phone', { width: 390, height: 800 }]]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
      page.on('pageerror', (e) => errors.push(`${slug} ${tag}: ${e}`))
      page.on('console', (m) => m.type() === 'error' && !/font|ERR_|favicon/.test(m.text()) && errors.push(`${slug} ${tag}: ${m.text()}`))
      await page.goto(URL0 + slug + '/')
      await page.waitForFunction(() => window.app && document.querySelector('#name')?.textContent, null, { timeout: 15000 })
      await page.waitForTimeout(2200) // the opening turn settles
      const shot = (n) => page.screenshot({ path: `${dir}shots/${slug}/${tag}-${n}.png` })
      const tracks = await page.evaluate(() => app.def.tracks.map((t) => ({ id: t.id, n: t.steps.length, still: !!t.still, names: t.steps.map((s) => s.name) })))

      // 1. Prohlížej: every step of every track renders; a full sweep of time throws nothing
      for (const tr of tracks) {
        await page.evaluate((id) => app.setTrack(id), tr.id)
        for (let i = 0; i < tr.n; i++) {
          await page.evaluate((i) => app.setT(app.segMid(i, .55)), i)
          await page.waitForTimeout(150)
          assert.equal((await page.textContent('#name')).trim(), tr.names[i])
          await shot(`${tr.id}-${i}`)
        }
        for (let t = 0; t <= 1.0001; t += 0.005) { await page.evaluate((t) => app.setT(t), t); if (Math.round(t * 200) % 20 === 0) await page.waitForTimeout(20) }
        const spots = await page.locator('#spots button:not([hidden])').count()
        assert.ok(spots > 0, `${tr.id}: no numbered spots at the end of the track`)
      }

      // touch: a vertical drag on the model tilts it and is never handed to the page; two fingers zoom
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('cv')).touchAction), 'none')
      const g = await page.evaluate(() => {
        const cv = document.getElementById('cv'), r = cv.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
        const ev = (type, id, dx, dy) => cv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x + dx, clientY: y + dy, bubbles: true }))
        const el0 = app.cam.el; ev('pointerdown', 11, 0, 0); ev('pointermove', 11, 0, 60); ev('pointerup', 11, 0, 60)
        const el1 = app.cam.el; ev('pointerdown', 12, -40, 0); ev('pointerdown', 13, 40, 0); ev('pointermove', 13, 90, 0); ev('pointerup', 12, -40, 0); ev('pointerup', 13, 90, 0)
        const z = app.cam.zoom; app.cam.zoom = 1; app.cam.el = el0
        return { tilted: el1 - el0, zoom: z, scrollY }
      })
      assert.ok(g.tilted > .3 && g.zoom > 1.3 && g.scrollY === 0, 'touch gestures: ' + JSON.stringify(g))

      if (tag === 'desk') {
        const first = tracks[0]
        await page.evaluate((id) => app.setTrack(id), first.id)
        // every findable part can be reached, opens its card, and its sub-parts appear once it is open
        const parts = await page.evaluate((id) => app.def.findable(id).map((p) => ({ id: p, name: app.def.parts[p].name, subs: app.def.parts[p].subs || [] })), first.id)
        for (const part of parts) {
          const found = await page.evaluate(async (id) => {
            for (let k = 0; k <= 200; k++) { app.setT(k / 200); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); if (app.hot.some((h) => h[0] === id)) return true }
            return false
          }, part.id)
          assert.ok(found, `part ${part.id} never gets a spot in track ${first.id}`)
          await page.click(`#spots button[data-id=${part.id}]`)
          assert.equal(await page.textContent('#cardName'), part.name)
          if (part.subs.length) {
            await page.waitForTimeout(1300)
            await shot(`card-${part.id}`)
            const sub = await page.evaluate(() => [...document.querySelectorAll('#cardSubs button')].map((b) => b.dataset.id))
            assert.deepEqual(sub, part.subs)
            const visible = await page.evaluate((ids) => ids.filter((id) => app.hot.some((h) => h[0] === id)), part.subs)
            if (visible.length) { await page.click(`#spots button[data-id=${visible[0]}]`); assert.notEqual(await page.textContent('#cardName'), part.name); await page.click('#cardBack') }
          }
          await page.click('#cardBack')
          assert.ok(await page.isVisible('#pExplore'))
        }
        // the deeper level and the question open
        await page.click(`#spots button[data-id=${parts[0].id}]`); await page.click('#cardDeepBox summary'); assert.ok((await page.textContent('#cardDeep')).length > 20); await page.click('#cardBack')
        await page.click('#dWhat summary'); await page.click('#showAns'); assert.ok(await page.isVisible('#ans'))
        // the second look
        await page.click('.view summary'); await page.click('input[value=fluo]'); await page.evaluate(() => app.setT(app.segMid(Math.floor(app.def.tracks[0].steps.length / 2), .5))); await page.waitForTimeout(300)
        await shot('fluo'); await page.click('input[value=paper]')

        // 2. Najdi: a wrong place is named, the right one confirmed; every kind of task comes up
        await page.click('[data-step=find]')
        const nTasks = (first.n > 1 ? first.n : 0) + parts.length
        for (let k = 0; k < nTasks; k++) {
          const task = await page.evaluate(() => app.task)
          if (task.type === 'step') {
            await page.evaluate((i) => app.setT(app.segMid(i)), (task.i + 2) % first.n)
            await page.click('#findHere')
            assert.match(await page.textContent('#findVerdict'), /^Tady je /)
            await page.evaluate((i) => app.setT(app.segMid(i)), task.i)
            await page.click('#findHere')
          } else {
            await page.waitForTimeout(150)
            if (k < 2) await shot('find-part')
            await page.click(`#spots button[data-id=${task.id}]`)
          }
          assert.match(await page.textContent('#findVerdict'), /^Ano\./)
          await page.click('#findNext')
        }
        // 3. Pojmenuj: one wrong, one right
        await page.click('[data-step=name]')
        for (const right of [false, true]) {
          await page.waitForTimeout(150)
          const key = String(await page.evaluate(() => app.task.key))
          const keys = await page.evaluate(() => [...document.querySelectorAll('#opts button')].map((b) => b.dataset.k))
          await page.click(`#opts button[data-k="${right ? key : keys.find((x) => x !== key)}"]`)
          assert.match(await page.textContent('#nameVerdict'), right ? /^Ano\./ : /^Tohle je /)
          await shot('name-' + right)
          await page.click('#nameNext')
        }
        // 4. Seřaď: a wrong order keeps its correct beginning; the right order passes
        if (await page.isVisible('[data-step=order]')) {
          await page.click('[data-step=order]')
          assert.equal(await page.locator('#cards img').count(), first.n)
          const right = [...Array(first.n).keys()], wrong = [...right];[wrong[2], wrong[3]] = [wrong[3], wrong[2]]
          for (const seq of [wrong, right.slice(2)]) {
            for (const i of seq) await page.click(`#cards button[data-i="${i}"]`)
            await page.click('#orderPlay')
            await page.waitForFunction(() => document.getElementById('orderVerdict').textContent.length > 0, null, { timeout: 120000 })
            assert.match(await page.textContent('#orderVerdict'), seq === wrong ? /přeskočil po 2\. obrázku/ : /navazuje/)
            if (seq === wrong) { assert.deepEqual(await page.evaluate(() => app.order.pick), [0, 1]); await shot('order-wrong') }
          }
        }
        await page.click('[data-step=explore]')

        // narration, when the lesson has clips: the clip drives time and marks the spoken word; the next step follows on its own
        if (await page.isVisible('#voiceBtn')) {
          await page.evaluate((id) => app.setTrack(id), first.id)
          await page.click('#voiceBtn'); if (!first.still) await page.click('#play')
          await page.waitForTimeout(5000)
          const v = await page.evaluate(() => ({ ct: app.voice.audio.currentTime, say: document.querySelectorAll('.say').length, idx: app.voice.cur, i: app.locate(+document.getElementById('scrub').value / 1000).i, open: document.getElementById('dWhat').open }))
          assert.ok(v.ct > 3 && v.say === 1 && v.idx > 3 && v.i === 0 && v.open, 'narration: ' + JSON.stringify(v))
          await shot('voice')
          if (first.n > 1) {
            await page.evaluate(() => { app.voice.audio.pause(); app.voice.audio.dispatchEvent(new Event('ended')) })
            await page.waitForFunction(() => app.voice.seg === 1 && app.voice.audio.currentTime > .5, null, { timeout: 15000 })
            assert.equal((await page.textContent('#name')).trim(), first.names[1])
            await page.click('#play'); assert.ok(await page.evaluate(() => app.voice.audio.paused))
          }
          await page.click('#voiceBtn')
        } else if (existsSync(`${dir}dist/${slug}/audio/timings.json`)) assert.fail('audio exists but the Hlas button is hidden')

        // progress: what was done is kept and the home page shows it
        const prog = await page.evaluate(() => JSON.parse(localStorage.getItem('medicina.progress')))
        const keys = Object.keys(prog.marks)
        for (const k of [`seen/${first.id}/0`, `part/${parts[0].id}`, `deep/${parts[0].id}`, `ans/${first.id}/`]) assert.ok(keys.some((x) => x.startsWith(`${slug}/${k}`)), 'missing mark ' + k)
        assert.ok(keys.some((k) => k.includes('/found/')) && keys.some((k) => k.includes('/named/')))
        assert.match(await page.textContent('#progressLine'), /prohlédnuto \d+ z \d+/)
        // the thumbnail for the home page: the model at a telling moment, without the spots
        await page.evaluate(() => { app.setStep('explore'); app.setT(app.segMid(Math.floor(app.def.tracks[0].steps.length / 2), .5)) })
        await page.waitForTimeout(400)
        await page.locator('#cv').screenshot({ path: `${dir}shots/${slug}/nahled.png` })
        // a lesson not yet read by Pavol ('premium') is listed only for members, so the signed-out home page must not show it
        const access = await page.evaluate(() => app.def.meta.access)
        await page.goto(URL0); await page.waitForSelector('#lessons')
        await page.waitForTimeout(300)
        assert.equal(await page.locator(`.lesson[href="/${slug}/"] .prog`).count(), access === 'public' ? 1 : 0, 'home page listing')
        await page.screenshot({ path: `${dir}shots/${slug}/desk-home.png` })
      } else {
        for (const st of ['find', 'name', 'order']) if (await page.isVisible(`[data-step=${st}]`)) { await page.click(`[data-step=${st}]`); await page.waitForTimeout(300); await shot('step-' + st) }
      }
      await page.close()
    }
  }
  assert.deepEqual(errors, [])
  console.log('ok', slugs.join(' '))
} finally {
  await browser.close(); server.kill()
}
