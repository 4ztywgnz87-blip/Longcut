import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // relative paths, so the app works from any sub-folder (e.g. GitHub Pages)
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
});
