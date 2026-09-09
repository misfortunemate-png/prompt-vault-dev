import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cardsPath = join(__dirname, '..', 'data', 'cards.json');

if (!existsSync(cardsPath)) { console.error('data/cards.json not found'); process.exit(1); }

const raw = readFileSync(cardsPath, 'utf8');
const data = JSON.parse(raw);

const slotIds = new Set(data.slots.map(s => s.id));

let fixed = 0;
for (const s of data.slots) {
  if ('slot_order' in s) { s.order = s.order ?? s.slot_order; delete s.slot_order; fixed++; }
  if ('use_as_folder' in s) { s.useAsFolder = s.useAsFolder ?? !!s.use_as_folder; delete s.use_as_folder; fixed++; }
  if ('use_in_filename' in s) { s.useInFilename = s.useInFilename ?? !!s.use_in_filename; delete s.use_in_filename; fixed++; }
}

for (const c of data.cards) {
  if ('slot_id' in c) { c.slotId = c.slotId ?? c.slot_id; delete c.slot_id; fixed++; }
  if ('parent_id' in c) { c.parentId = c.parentId ?? c.parent_id; delete c.parent_id; fixed++; }
}

const orphans = data.cards.filter(c => !slotIds.has(c.slotId));
if (orphans.length > 0) {
  console.log(`Removing ${orphans.length} orphan cards: ${orphans.map(c => c.id).join(', ')}`);
  data.cards = data.cards.filter(c => slotIds.has(c.slotId));
  fixed += orphans.length;
}

console.log(`Fixed ${fixed} issues`);
writeFileSync(cardsPath, JSON.stringify(data, null, 2));

const newHash = createHash('sha256').update(readFileSync(cardsPath)).digest('hex');
console.log(`New SHA-256: ${newHash}`);
console.log('Done. Server restart required to reload.');
