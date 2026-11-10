// Smoke + logic check for v2 (and that v1 still loads). Run: node test.mjs
// Runs against the built site (npm run e2e builds first). Uses system Chrome because narration is AAC.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = new URL('..', import.meta.url).pathname;
mkdirSync(dir + 'shots', { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', '8765', '--strictPort'], { cwd: dir, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2500));
const URL0 = 'http://localhost:8765/';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
for (const [tag, viewport] of [['desk', { width: 1360, height: 860 }], ['phone', { width: 390, height: 800 }]]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => m.type() === 'error' && !/font|ERR_/.test(m.text()) && errors.push(m.text()));
  await page.goto(URL0 + 'deleni-bunky/');
  await page.waitForTimeout(2500); // opening turn settles
  const shot = n => page.screenshot({ path: `${dir}shots/${tag}-${n}.png` });
  for (const mode of ['mitoza', 'meioza']) {
    await page.evaluate(m => app.setMode(m), mode);
    const n = await page.evaluate(m => app.MODES[m].length, mode);
    for (let i = 0; i < n; i++) {
      await page.evaluate(i => { document.querySelectorAll('#phases button')[i].click(); const t0 = +document.getElementById('scrub').value / 1000; const s = app.MODES[document.querySelector('[aria-pressed=true]').id.slice(2)]; const tot = s.reduce((a, x) => a + x.w, 0); app.setT(t0 + s[i].w / tot * .55); }, i);
      await page.waitForTimeout(150);
      await shot(`${mode}-${i}`);
    }
    for (let t = 0; t <= 1.0001; t += 0.005) { await page.evaluate(t => app.setT(t), t); if (Math.round(t * 200) % 20 === 0) await page.waitForTimeout(20); }
  }
  if (tag === 'desk') {
    const s = await page.evaluate(() => ({
      g1: app.stats('mit', .2), sph: app.stats('mit', .6), meta: app.stats('mit', 3.5), ana: app.stats('mit', 4.5), end: app.stats('mit', 7),
      a1: app.stats('mei1', 4.5), t1: app.stats('mei1', 7), end2: app.stats('mei2', 7),
    }));
    assert.deepEqual(s.g1, [4, 4, '2n']); assert.deepEqual(s.sph, [4, '4 → 8', '2n']); assert.deepEqual(s.meta, [4, 8, '2n']); assert.deepEqual(s.ana, [8, 8, '2n + 2n']); assert.deepEqual(s.end, [4, 4, '2n']);
    assert.deepEqual(s.a1, [4, 8, 'n + n']); assert.deepEqual(s.t1, [2, 4, 'n']); assert.deepEqual(s.end2, [2, 2, 'n']);
    // meiosis I end and meiosis II start must be the same picture (no jump at the seam), in 3D
    const gap = await page.evaluate(() => {
      const end = app.divState('mei1', 7, app.SETS.mei1, 0), SC = .76, DX = .9; let worst = 0;
      for (const [set, x, th] of [[app.SETS.mei2L, -DX, -Math.PI / 2], [app.SETS.mei2R, DX, Math.PI / 2]]) {
        const st = app.divState('mei2', 1, set, 0);
        for (const c of st.ch) {
          const w = [x + SC * (c.p[0] * Math.cos(th) - c.p[1] * Math.sin(th)), SC * (c.p[0] * Math.sin(th) + c.p[1] * Math.cos(th)), SC * c.p[2]];
          const o = end.ch.find(e => e.id === c.id && e.sg === c.sg);
          worst = Math.max(worst, Math.hypot(w[0] - o.p[0], w[1] - o.p[1], w[2] - o.p[2]), Math.abs(Math.sin(c.rot + th - o.rot)), Math.abs(c.psi - o.psi));
        }
      }
      return worst;
    });
    assert.ok(gap < 0.02, 'meiosis seam jump ' + gap);
    const gam = await page.evaluate(() => {
      const out = [];
      for (const set of [app.SETS.mei2L, app.SETS.mei2R]) {
        const st = app.divState('mei2', 7, set, 0);
        for (const side of [-1, 1]) out.push(st.ch.filter(c => c.side === side).map(c => c.id + c.col + (c.tip || '')).sort().join('|'));
      }
      return out;
    });
    assert.equal(new Set(gam).size, 4, 'gametes not distinct: ' + gam);
    // metaphase: every chromatid in the equatorial plane, sisters facing opposite poles
    const plane = await page.evaluate(() => app.divState('mit', 3.5, app.SETS.mit, 0).ch.map(c => [Math.abs(c.p[0]), c.side * c.sg]));
    assert.ok(plane.every(([x]) => x < .04), 'metaphase plate');

    // explore: numbered spot -> card -> sub-part -> back
    await page.evaluate(() => { app.setMode('mitoza'); document.querySelectorAll('#phases button')[4].click(); app.setT(+document.getElementById('scrub').value / 1000 + .03); });   // metaphase
    await page.waitForTimeout(200);
    await page.click('#spots button[data-id=chrom]');
    await page.waitForTimeout(1200);
    assert.equal(await page.textContent('#cardName'), 'Chromozom');
    assert.ok(await page.isHidden('#cardGone'));
    await shot('card-chrom');
    await page.click('#spots button[data-id=koh]');
    assert.equal(await page.textContent('#cardName'), 'Kohezin');
    await page.click('#cardBack'); await page.click('#cardBack');
    assert.ok(await page.isVisible('#pExplore'));
    await page.click('#spots button[data-id=rov]'); await page.click('#cardAct'); await page.waitForTimeout(1500);
    await shot('pole-view');
    await page.click('#cardBack');
    // fluorescence theme
    await page.click('.view summary'); await page.click('input[value=fluo]'); await page.evaluate(() => { app.cam.az = .5; app.setT(.62); }); await page.waitForTimeout(300);
    await shot('fluo'); await page.click('input[value=paper]');

    // find: wrong place names where you are, right place confirms
    await page.click('[data-step=find]');
    for (let k = 0; k < 12; k++) {
      const task = await page.evaluate(() => app.task);
      if (task.type === 'phase') {
        const wrong = (task.i + 2) % 7;
        await page.evaluate(i => { const s = app.MODES.mitoza, tot = s.reduce((a, x) => a + x.w, 0); app.setT((s.slice(0, i).reduce((a, x) => a + x.w, 0) + s[i].w / 2) / tot); }, wrong);
        await page.click('#findHere');
        assert.match(await page.textContent('#findVerdict'), /^Tady je /);
        await page.evaluate(i => { const s = app.MODES.mitoza, tot = s.reduce((a, x) => a + x.w, 0); app.setT((s.slice(0, i).reduce((a, x) => a + x.w, 0) + s[i].w / 2) / tot); }, task.i);
        await page.click('#findHere');
      } else {
        await page.waitForTimeout(120);
        if (k === 0 || k === 5) await shot('find-struct');
        await page.click(`#spots button[data-id=${task.id}]`);
      }
      assert.match(await page.textContent('#findVerdict'), /^Ano\./);
      await page.click('#findNext');
    }
    // name: one wrong, one right
    await page.click('[data-step=name]');
    for (const right of [false, true]) {
      const i = await page.evaluate(() => app.task.i);
      await page.locator('#opts button').nth(right ? i : (i + 1) % 7).click();
      assert.match(await page.textContent('#nameVerdict'), right ? /^Ano\./ : /^Tohle je /);
      await page.waitForTimeout(100); await shot('name-' + right);
      await page.click('#nameNext');
    }
    // order: wrong order is flagged after playback, right order passes
    await page.click('[data-step=order]');
    assert.equal(await page.locator('#cards img').count(), 8);
    await shot('order');
    for (const seq of [[0, 1, 3, 2, 4, 5, 6, 7], [2, 3, 4, 5, 6, 7]]) {   // wrong at the third card: the first two stay, the rest is re-picked
      for (const i of seq) await page.click(`#cards button[data-i="${i}"]`);
      await page.click('#orderPlay');
      await page.waitForFunction(() => document.getElementById('orderVerdict').textContent.length > 0, null, { timeout: 90000 });
      assert.match(await page.textContent('#orderVerdict'), seq.length === 8 ? /přeskočil po 2\. obrázku/ : /navazuje/);
      if (seq.length === 8) { assert.deepEqual(await page.evaluate(() => app.order.pick), [0, 1]); await shot('order-wrong'); }
    }
    await page.click('[data-step=explore]');
    // the spindle must not cross an intact nuclear envelope
    const cross = await page.evaluate(() => { let bad = 0; for (let u = 0; u < 7; u += .02) for (const k of ['mit', 'mei1']) { const S = app.divState(k, u, app.SETS[k], 0); if (S.envA > .6 && S.polA > .25) bad++; } return bad; });
    assert.equal(cross, 0, 'spindle through intact envelope');

    // narration: the clip drives time and marks the spoken word; the next phase follows on its own
    await page.evaluate(() => { app.setMode('mitoza'); });
    await page.click('#voiceBtn'); await page.click('#play');
    await page.waitForTimeout(5000);
    const n1 = await page.evaluate(() => ({ ct: app.voice.audio.currentTime, say: document.querySelectorAll('.say').length, idx: app.voice.cur, i: app.locate(+document.getElementById('scrub').value / 1000).i, open: document.getElementById('dWhat').open }));
    assert.ok(n1.ct > 3 && n1.say === 1 && n1.idx > 3 && n1.i === 0 && n1.open, JSON.stringify(n1));
    await shot('voice');
    await page.evaluate(() => { app.voice.audio.pause(); app.voice.audio.dispatchEvent(new Event('ended')); });   // local test server cannot seek
    await page.waitForFunction(() => app.voice.seg === 1 && app.voice.audio.currentTime > .5, null, { timeout: 15000 });
    assert.equal(await page.textContent('#name'), 'S fáze ');
    await page.click('#play');
    assert.ok(await page.evaluate(() => app.voice.audio.paused));
    await page.click('#voiceBtn');

    // progress: the lesson reported what was done, the platform kept it, the home page shows it
    const prog = await page.evaluate(() => JSON.parse(localStorage.getItem('medicina.progress')));
    const keys = Object.keys(prog.marks);
    for (const k of ['deleni-bunky/seen/mitoza/0', 'deleni-bunky/seen/meioza/8', 'deleni-bunky/part/chrom', 'deleni-bunky/part/koh', 'deleni-bunky/ordered/mitoza']) assert.ok(keys.includes(k), 'missing mark ' + k);
    assert.ok(keys.some(k => k.includes('/found/mitoza/')) && keys.some(k => k.includes('/named/mitoza/')));
    assert.deepEqual(prog.summary['deleni-bunky'].order, [1, 2]);
    assert.match(await page.textContent('#progressLine'), /prohlédnuto \d+ z 30/);
    await page.evaluate(() => { app.setMode('mitoza'); app.setStep('explore'); document.querySelectorAll('#phases button')[4].click(); app.setT(+document.getElementById('scrub').value / 1000 + .03); });
    await page.waitForTimeout(400);
    await page.locator('#cv').screenshot({ path: dir + 'shots/nahled.png' });
    await page.goto(URL0); await page.waitForSelector('.lesson .prog');
    assert.match(await page.textContent('.lesson .prog'), /Seřaď1 z 2|1 z 2Seřaď/);
    await shot('home');
    await page.goto(URL0 + 'deleni-bunky/');
  }
  if (tag === 'phone') { for (const st of ['find', 'name', 'order']) { await page.evaluate(() => app.setMode('meioza')); await page.click(`[data-step=${st}]`); await page.waitForTimeout(300); await shot('step-' + st); } }
  await page.close();
}
// v1 stays as it was
const ph = await browser.newPage({ viewport: { width: 390, height: 800 } }); await ph.goto(URL0); await ph.waitForSelector('.lesson'); await ph.screenshot({ path: dir + 'shots/phone-home.png' }); await ph.close();
const v1 = await browser.newPage(); v1.on('pageerror', e => errors.push('v1 ' + e)); await v1.goto(URL0 + 'deleni-bunky/v1/'); assert.ok(await v1.isVisible('#quizBtn')); await v1.close();
await browser.close(); server.kill();
assert.deepEqual(errors, []);
console.log('ok');
