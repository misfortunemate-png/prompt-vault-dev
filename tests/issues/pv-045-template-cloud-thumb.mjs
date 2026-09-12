import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const result = (name, ok, detail = '') => ({ name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail });

export default {
  issue: 'pv#45',
  title: 'Template Cloud thumbnails use authenticated decryption path',
  level: 'STATIC_CONTRACT',
  gate: true,
  verifierPath: 'tests/issues/pv-045-template-cloud-thumb.mjs',
  async verify() {
    const cards = read('../../src/screens/TemplateCardList.jsx');
    const presets = read('../../src/screens/TemplatePresetList.jsx');
    const api = read('../../src/lib/api.js');
    const template = `${cards}\n${presets}`;
    const apiHasDecryptPath = /async\s+getThumb\s*\([^)]*\)[\s\S]*Authorization[\s\S]*decrypt\s*\(/.test(api);
    const rawDirect = /resolveThumbUrl\s*\(/.test(template);
    const usesSafeLoader = /api\.getThumb\s*\(/.test(template) || /(?:Thumb|Thumbnail)[A-Za-z0-9_]*\s/.test(template);
    return [
      result('Cloud thumb API path authenticates and decrypts', apiHasDecryptPath, 'api.getThumb no longer clearly provides auth+decrypt'),
      result('Template does not feed raw resolveThumbUrl into image elements', !rawDirect, 'Template still calls resolveThumbUrl for thumb display'),
      result('Template uses a JS thumbnail loader/component capable of decrypted blobs', usesSafeLoader && !rawDirect, 'cards/presets do not use api.getThumb or an explicit thumbnail component'),
    ];
  },
};
