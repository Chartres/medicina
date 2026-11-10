import { defineConfig } from 'vite'

// One page per lesson. A lesson is a self-contained HTML file; src/lesson.ts gives it sign-in and progress.
export default defineConfig({
  build: { rollupOptions: { input: { home: 'index.html', 'deleni-bunky': 'deleni-bunky/index.html' } } },
})
