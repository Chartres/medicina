import { defineConfig } from 'vite'
import { existsSync, readdirSync } from 'node:fs'

// One page per lesson: every top-level folder with an index.html next to a src/lessons/<slug>/ is a lesson page.
const lessons = readdirSync('src/lessons', { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(`${d.name}/index.html`)).map((d) => d.name)

export default defineConfig({
  build: { rollupOptions: { input: { home: 'index.html', ...Object.fromEntries(lessons.map((s) => [s, `${s}/index.html`])) } } },
})
