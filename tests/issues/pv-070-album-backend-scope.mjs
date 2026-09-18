import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const check = (name, ok, detail = '') => ({ name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail });

export default {
  issue: 'pv#70',
  title: 'Album async state is scoped to the active backend route',
  level: 'STATIC_CONTRACT',
  gate: true,
  verifierPath: 'tests/issues/pv-070-album-backend-scope.mjs',
  async verify() {
    const app = read('../../src/App.jsx');
    const album = read('../../src/screens/AlbumScreen.jsx');

    const keyedByRoute = /<AlbumScreen\s+key=\{\s*connectionState\.route\s*\}[\s\S]{0,300}connectionRoute=\{\s*connectionState\.route\s*\}/.test(app);
    const routeReload = /useEffect\(\(\)\s*=>\s*\{[\s\S]{0,700}setPath\(null\)[\s\S]{0,700}setViewer\(null\)[\s\S]{0,700}loadRoot\(\)[\s\S]{0,300}\},\s*\[\s*connectionRoute\s*,\s*loadRoot\s*\]\s*\)/.test(album);
    const pollCleanup = /useEffect\(\(\)\s*=>\s*\(\)\s*=>\s*\{\s*if\s*\(pollRef\.current\)\s*clearInterval\(pollRef\.current\);?\s*\},\s*\[\s*\]\s*\)/.test(album);

    return [
      check(
        'Album component is remounted when backend route changes',
        keyedByRoute,
        'AlbumScreen is not keyed by connectionState.route, so stale async completions can target the same component instance after a route switch',
      ),
      check(
        'new Album instance reloads backend-scoped root state',
        routeReload,
        'Album route lifecycle does not reset route-scoped state and reload the current backend',
      ),
      check(
        'Album polling is cleaned up on unmount',
        pollCleanup,
        'Album route-keyed unmount would leave rescan polling alive',
      ),
    ];
  },
};
