import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Camera access requires a secure context: localhost is treated as secure by
// browsers, so `npm run dev` / `npm run preview` work out of the box.
export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  server: { host: 'localhost', port: 5173 },
  preview: { host: 'localhost', port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
