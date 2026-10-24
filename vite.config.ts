import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { rollupOptions: { input: { main: 'index.html', art: 'art.html' } } },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
  },
} as never);
