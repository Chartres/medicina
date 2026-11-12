import { defineConfig, type Plugin } from 'vite'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

// A lesson is src/lessons/<slug>/ and nothing else: its page at /<slug>/ is a copy of the generic lesson
// page (lekce/index.html), emitted here with the lesson's title, so a lesson never brings its own HTML.
const lessons = readdirSync('src/lessons', { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(`src/lessons/${d.name}/meta.json`)).map((d) => d.name)
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const lessonPages = (): Plugin => ({
  name: 'lesson-pages',
  enforce: 'post',
  generateBundle(_, bundle) {
    const shell = bundle['lekce/index.html']
    if (!shell || shell.type !== 'asset') return this.error('lekce/index.html was not built')
    for (const slug of lessons) {
      const meta = JSON.parse(readFileSync(`src/lessons/${slug}/meta.json`, 'utf8'))
      const html = String(shell.source)
        .replace(/<title>.*?<\/title>/, `<title>${esc(meta.title)} – Na medicínu</title>`)
        .replace(/(<meta name="description" content=")[^"]*/, `$1${esc(meta.blurb)}`)
      this.emitFile({ type: 'asset', fileName: `${slug}/index.html`, source: html })
    }
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
