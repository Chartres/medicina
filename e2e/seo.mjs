// The discoverability kit (flywheel docs/standards/discoverability.md), checked against the built site.
//   node e2e/seo.mjs      — run `npm run build` first, or use `npm run e2e`
// No browser: crawlers and link unfurlers read the raw files and HTML, so this does too. The content
// type matters as much as the body: a missing file falls back to the app's HTML with 200 text/html.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const dir = new URL('..', import.meta.url).pathname
const SITE = 'https://medicina.dravec.org'
const PORT = Number(process.env.E2E_SEO_PORT) || 8767, BASE = `http://localhost:${PORT}`
assert.ok(existsSync(`${dir}dist/index.html`), 'dist/index.html missing — run npm run build')

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: dir, stdio: 'ignore' })
let failed = false
async function check(name, fn) {
  try { await fn(); console.log('pass ', name) } catch (e) { failed = true; console.log('FAIL ', name, '\n     ', String(e.message ?? e).split('\n').slice(0, 6).join('\n      ')) }
}
const get = async (path) => {
  const r = await fetch(BASE + path)
  return { status: r.status, type: r.headers.get('content-type') ?? '', body: Buffer.from(await r.arrayBuffer()) }
}
const meta = (html, key) => html.match(new RegExp(`<meta (?:property|name)="${key.replace(/[:.]/g, '\\$&')}" content="([^"]*)"`))?.[1]
const lessons = readdirSync(dir + 'src/lessons', { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(`${dir}src/lessons/${d.name}/meta.json`))
  .map((d) => JSON.parse(readFileSync(`${dir}src/lessons/${d.name}/meta.json`, 'utf8')))

try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/')).ok) break } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)) }

  await check('robots.txt: text/plain, welcomes everyone, names the sitemap', async () => {
    const r = await get('/robots.txt')
    assert.equal(r.status, 200)
    assert.match(r.type, /^text\/plain/)
    const t = r.body.toString()
    assert.match(t, /^User-agent: \*$/m)
    assert.match(t, /^Allow: \/$/m)
    assert.doesNotMatch(t, /^Disallow:/m)
    assert.match(t, new RegExp(`^Sitemap: ${SITE}/sitemap\\.xml$`, 'm'))
  })

  await check('sitemap.xml: XML, the root and every public lesson, none for members only', async () => {
    const r = await get('/sitemap.xml')
    assert.equal(r.status, 200)
    assert.match(r.type, /xml/)
    const t = r.body.toString()
    assert.match(t, /^<\?xml /)
    const locs = [...t.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    const want = [`${SITE}/`, ...lessons.filter((l) => l.access === 'public').map((l) => `${SITE}/${l.slug}/`)]
    assert.deepEqual(locs.sort(), want.sort())
    for (const l of lessons.filter((l) => l.access !== 'public')) assert.ok(!t.includes(`/${l.slug}/`), `${l.slug} is for members only`)
    const today = new Date().toISOString().slice(0, 10)
    assert.equal([...t.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].filter((m) => m[1] === today).length, locs.length, 'lastmod is the build date')
  })

  await check('llms.txt: text/plain, starts with a heading', async () => {
    const r = await get('/llms.txt')
    assert.match(r.type, /^text\/plain/)
    assert.match(r.body.toString(), /^# Na medicínu\n/)
  })

  await check('og.png: a 1200×630 PNG under 300 KB', async () => {
    const r = await get('/og.png')
    assert.equal(r.type, 'image/png')
    assert.ok(r.body.length <= 300 * 1024, `${r.body.length} bytes`)
    assert.deepEqual([r.body.readUInt32BE(16), r.body.readUInt32BE(20)], [1200, 630])
  })

  await check('security.txt, IndexNow key and favicon are served as files, not the app', async () => {
    const sec = await get('/.well-known/security.txt')
    assert.match(sec.type, /^text\/plain/)
    const t = sec.body.toString()
    assert.match(t, /^Contact: https:\/\/github\.com\/Chartres\/medicina\/issues$/m)
    const expires = new Date(t.match(/^Expires: (.+)$/m)?.[1] ?? '')
    assert.ok(expires > new Date() && expires - new Date() <= 366 * 864e5, `Expires ${expires.toISOString?.()} must be in the next year`)
    assert.match(t, /^Canonical: https:\/\/medicina\.dravec\.org\/\.well-known\/security\.txt$/m)
    const key = await get('/9cc2dcb0952bc859471bd181b22e3dcb.txt')
    assert.match(key.type, /^text\/plain/)
    assert.equal(key.body.toString().trim(), '9cc2dcb0952bc859471bd181b22e3dcb')
    assert.match((await get('/favicon.svg')).type, /^image\/svg\+xml/)
  })

  await check('home head: lang, canonical, description, link card, WebApplication JSON-LD', async () => {
    const html = (await get('/')).body.toString()
    assert.match(html, /<html lang="cs">/)
    assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/">`))
    assert.ok(meta(html, 'description')?.length > 50)
    assert.equal(meta(html, 'og:image'), `${SITE}/og.png`)
    assert.equal(meta(html, 'og:url'), `${SITE}/`)
    assert.ok(meta(html, 'og:title').startsWith('Na medicínu') && meta(html, 'og:title').length <= 45, meta(html, 'og:title'))
    assert.equal(meta(html, 'og:image:width'), '1200')
    assert.equal(meta(html, 'og:image:height'), '630')
    assert.equal(meta(html, 'twitter:card'), 'summary_large_image')
    assert.equal(meta(html, 'twitter:image'), `${SITE}/og.png`)
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
    const app = ld.find((d) => d['@type'] === 'WebApplication')
    assert.ok(app, 'no WebApplication JSON-LD')
    assert.deepEqual({ url: app.url, cat: app.applicationCategory, lang: app.inLanguage, free: app.isAccessibleForFree, price: app.offers?.price, cur: app.offers?.priceCurrency },
      { url: `${SITE}/`, cat: 'EducationalApplication', lang: 'cs', free: true, price: '0', cur: 'CZK' })
  })

  await check('each lesson page carries its own canonical, description and link card', async () => {
    for (const l of lessons) {
      const r = await get(`/${l.slug}/`)
      assert.match(r.type, /^text\/html/)
      const html = r.body.toString()
      const url = `${SITE}/${l.slug}/`
      assert.match(html, new RegExp(`<link rel="canonical" href="${url}">`), l.slug)
      assert.equal(meta(html, 'og:url'), url)
      assert.equal(meta(html, 'og:image'), `${SITE}/og.png`)
      assert.equal(meta(html, 'twitter:card'), 'summary_large_image')
      const blurb = l.blurb.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      for (const k of ['description', 'og:description', 'twitter:description']) assert.equal(meta(html, k), blurb, `${l.slug} ${k}`)
      const title = meta(html, 'og:title')
      assert.ok(title.length <= 45 && title.includes(l.title.slice(0, 20)), `${l.slug} og:title ${title}`)
    }
  })
} catch (e) {
  failed = true
  console.error(e)
} finally {
  server.kill()
}
console.log(failed ? '\nFAILED' : '\nall passed')
process.exit(failed ? 1 : 0)
