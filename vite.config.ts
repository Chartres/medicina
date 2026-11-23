import { defineConfig, type Plugin } from 'vite'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

// A lesson is src/lessons/<slug>/ and nothing else: its page at /<slug>/ is a copy of the generic lesson
// page (lekce/index.html), emitted here with the lesson's title, description, canonical and link card, so a
// lesson never brings its own HTML. The sitemap is written here too, from the same list, dated by the build.
const lessons = readdirSync('src/lessons', { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(`src/lessons/${d.name}/meta.json`)).map((d) => d.name)
const readMeta = (slug: string) => JSON.parse(readFileSync(`src/lessons/${slug}/meta.json`, 'utf8'))
const SITE = 'https://medicina.dravec.org'
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const lessonPages = (): Plugin => ({
  name: 'lesson-pages',
  enforce: 'post',
  generateBundle(_, bundle) {
    const shell = bundle['lekce/index.html']
    if (!shell || shell.type !== 'asset') return this.error('lekce/index.html was not built')
    for (const slug of lessons) {
      const meta = readMeta(slug)
      const url = `${SITE}/${slug}/`
      // the link card's title: name first and at most 45 characters (flywheel docs/standards/discoverability.md)
      const card = [`Na medicínu: ${meta.title}`, meta.title].find((t) => t.length <= 45) ?? meta.title.slice(0, 44) + '…'
      const html = String(shell.source)
        .replace(/<title>.*?<\/title>/, `<title>${esc(meta.title)} – Na medicínu</title>`)
        .replace(/(<meta (?:name|property)="(?:description|og:description|twitter:description)" content=")[^"]*/g, `$1${esc(meta.blurb)}`)
        .replace(/(<meta (?:property|name)="(?:og:title|twitter:title)" content=")[^"]*/g, `$1${esc(card)}`)
        .replace(/(<link rel="canonical" href=")[^"]*/, `$1${url}`)
        .replace(/(<meta property="og:url" content=")[^"]*/, `$1${url}`)
      this.emitFile({ type: 'asset', fileName: `${slug}/index.html`, source: html })
    }
    // Lessons for members only (`access: "premium"`) wait for a person to read them and stay out of the sitemap.
    const urls = [`${SITE}/`, ...lessons.filter((slug) => readMeta(slug).access === 'public').map((slug) => `${SITE}/${slug}/`)]
    const lastmod = new Date().toISOString().slice(0, 10)
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
      + urls.map((u) => `  <url><loc>${u}</loc><lastmod>${lastmod}</lastmod></url>\n`).join('') + '</urlset>\n'
    this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap })
  },
  // in development the same page answers for every lesson
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const m = req.url?.match(/^\/([a-z0-9-]+)\/(\?.*)?$/)
      if (m && lessons.includes(m[1])) req.url = '/lekce/index.html'
      next()
    })
  },
})

export default defineConfig({
  plugins: [lessonPages()],
  // the lesson frame has an origin of its own and loads its scripts and audio across origins
  server: { cors: true },
  preview: { cors: true },
  build: { rollupOptions: { input: { home: 'index.html', lekce: 'lekce/index.html', model: 'model.html' } } },
})
