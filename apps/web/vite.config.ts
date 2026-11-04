/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The SPA talks to same-origin `/api` and `/collab`; Vite proxies them in dev/preview,
// nginx does the same in the Docker deployment. Same origin keeps the auth cookies simple.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';
const collabTarget = process.env.COLLAB_PROXY_TARGET ?? 'ws://localhost:1234';

const proxy = {
  '/api': { target: apiTarget, changeOrigin: false },
  '/collab': {
    target: collabTarget,
    ws: true,
    rewrite: (path: string) => path.replace(/^\/collab/, ''),
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: Number(process.env.WEB_PORT ?? 4173), strictPort: true, proxy },
  build: { sourcemap: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
