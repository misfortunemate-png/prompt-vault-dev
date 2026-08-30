import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

function patchPagesAssets(base) {
  if (base === '/') return null;
  return {
    name: 'patch-pages-assets',
    closeBundle() {
      const manifestPath = path.resolve('dist/manifest.json');
      if (fs.existsSync(manifestPath)) {
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        m.start_url = base;
        m.scope = base;
        m.icons = m.icons.map(icon => ({
          ...icon,
          src: icon.src.replace(/^\//, base),
        }));
        fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2));
      }
      const swPath = path.resolve('dist/sw.js');
      if (fs.existsSync(swPath)) {
        let sw = fs.readFileSync(swPath, 'utf-8');
        sw = sw
          .replace(/url\.pathname\.startsWith\('\/api\/'\)/g, `url.pathname.startsWith('${base}api/')`)
          .replace(/url\.pathname\.startsWith\('\/assets\/'\)/g, `url.pathname.startsWith('${base}assets/')`);
        fs.writeFileSync(swPath, sw);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE || '/';
  return {
    base,
    plugins: [react(), patchPagesAssets(base)].filter(Boolean),
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
  };
});
