import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    allowedHosts: ['fraine.tail204746.ts.net'],
    hmr: {
      protocol: 'ws',
      port: 5173,
    },
  },
  build: {
    outDir: 'dist',
  },
});
