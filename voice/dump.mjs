// Writes voice/narration.json from the page's own text, so audio and page cannot drift apart.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = new URL('..', import.meta.url).pathname;
const b = await chromium.launch({ channel: 'chrome' }), p = await b.newPage();
await p.goto('file://' + root + 'deleni-bunky/index.html');
const out = await p.evaluate(() => Object.fromEntries(Object.entries(app.MODES).map(([m, s]) => [m, s.map(x => [x.name, x.tip, x.desc])])));
writeFileSync(root + 'voice/narration.json', JSON.stringify(out, null, 1));
await b.close();
console.log(Object.values(out).flat().length, 'clips');
