import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  base: '/account/',
  envDir: '..',
  plugins: [react()],
  build: {
    outDir: '../dist/account',
    emptyOutDir: false,
  },
})
