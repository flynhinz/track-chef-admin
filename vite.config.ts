import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vitest 3's `test` block is not in Vite 8's UserConfig types; vitest consumes it at runtime.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  // @ts-expect-error vitest 3 + vite 8 type mismatch — runtime config is correct
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
