import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const check = (name, ok, detail = '') => ({ name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail });

export default {
  issue: 'pv#42',
  title: 'Template state and mutations stay bound to one backend',
  level: 'STATIC_CONTRACT',
  gate: true,
  verifierPath: 'tests/issues/pv-042-template-backend-identity.mjs',
  async verify() {
    const app = read('../../src/App.jsx');
    const screen = read('../../src/screens/TemplateScreen.jsx');
    const cards = read('../../src/screens/TemplateCardList.jsx');
    const presets = read('../../src/screens/TemplatePresetList.jsx');
    const keyedAtApp = /<TemplateScreen[\s\S]{0,300}key=\{\s*connectionState\.route\s*\}/.test(app);
    const routeProp = /<TemplateScreen[\s\S]{0,300}(?:connectionRoute|route)=\{\s*connectionState\.route\s*\}/.test(app);
    const childrenKeyed = /<TemplateCardList[\s\S]{0,200}key=\{[^}]*route[^}]*\}/i.test(screen) && /<TemplatePresetList[\s\S]{0,200}key=\{[^}]*route[^}]*\}/i.test(screen);
    const childRouteAware = /connectionRoute|backendRoute|sourceRoute/.test(cards) && /connectionRoute|backendRoute|sourceRoute/.test(presets);
    const mountOnlyCards = /useEffect\(\(\)\s*=>\s*\{\s*refresh\(\);?\s*\},\s*\[\s*\]\s*\)/s.test(cards);
    const mountOnlyPresets = /useEffect\(\(\)\s*=>\s*\{\s*refresh\(\);?\s*\},\s*\[\s*\]\s*\)/s.test(presets);
    return [
      check('Template lifecycle is keyed or explicitly route-aware', keyedAtApp || (routeProp && (childrenKeyed || childRouteAware)), 'TemplateScreen receives no backend identity and is not remounted by route'),
      check('cards do not rely on a route-blind mount-only refresh', keyedAtApp || !mountOnlyCards, 'TemplateCardList refreshes only on mount'),
      check('presets do not rely on a route-blind mount-only refresh', keyedAtApp || !mountOnlyPresets, 'TemplatePresetList refreshes only on mount'),
    ];
  },
};
