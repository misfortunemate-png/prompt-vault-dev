import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CARDS_PATH = join(ROOT, 'data', 'cards.json');
const TOOL_VERSION = '1.1.1';

function parseArgs(argv) {
  const out = { json: false };
  for (const arg of argv) {
    if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(64);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Cards Integrity Report v${TOOL_VERSION}\n\nUsage:\n  node scripts/orphan-cards-report.mjs [--json]\n\nThis is read-only. It distinguishes true dangling slot references from the known\ncamelCase/snake_case contract mismatch (slotId vs slot_id, parentId vs parent_id).\nPrompt text is intentionally not emitted; only identifiers, names, timestamps,\nand content lengths are included so the output can be shared as review evidence.\n\nExit codes:\n  0  canonical and referentially consistent\n  2  schema mismatch or true orphan found\n  3  unable to inspect\n  64 invalid CLI usage`);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function safeString(value) {
  return typeof value === 'string' && value.length ? value : null;
}

function contentLength(value) {
  return typeof value === 'string' ? value.length : 0;
}

function cardEvidence(card, slotIds, cardIds) {
  const canonicalSlotId = safeString(card?.slotId);
  const snakeSlotId = safeString(card?.slot_id);
  const effectiveSlotId = canonicalSlotId ?? snakeSlotId;
  const canonicalParentId = safeString(card?.parentId);
  const snakeParentId = safeString(card?.parent_id);
  const effectiveParentId = canonicalParentId ?? snakeParentId;

  const usesSnakeSlotOnly = !canonicalSlotId && Boolean(snakeSlotId);
  const usesSnakeParentOnly = !canonicalParentId && Boolean(snakeParentId);
  const mixedSlotKeys = Boolean(canonicalSlotId && snakeSlotId);
  const mixedParentKeys = Boolean(canonicalParentId && snakeParentId);
  const targetSlotExists = Boolean(effectiveSlotId && slotIds.has(effectiveSlotId));
  const trueOrphan = !targetSlotExists;
  const parentMissing = Boolean(effectiveParentId && !cardIds.has(effectiveParentId));

  return {
    id: safeString(card?.id),
    name: safeString(card?.name),
    canonicalSlotId,
    snakeSlotId,
    effectiveSlotId,
    targetSlotExists,
    trueOrphan,
    usesSnakeSlotOnly,
    mixedSlotKeys,
    canonicalParentId,
    snakeParentId,
    effectiveParentId,
    parentMissing,
    usesSnakeParentOnly,
    mixedParentKeys,
    updated_at: safeString(card?.updated_at),
    positiveLength: contentLength(card?.positive),
    negativeLength: contentLength(card?.negative),
  };
}

function main() {
  if (!existsSync(CARDS_PATH)) {
    return {
      tool: { name: 'cards-integrity-report', version: TOOL_VERSION, readOnly: true },
      checkedAt: new Date().toISOString(),
      verdict: 'UNKNOWN',
      error: 'data/cards.json not found',
    };
  }

  let raw;
  let data;
  try {
    raw = readFileSync(CARDS_PATH);
    data = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    return {
      tool: { name: 'cards-integrity-report', version: TOOL_VERSION, readOnly: true },
      checkedAt: new Date().toISOString(),
      verdict: 'UNKNOWN',
      error: `unable to read/parse data/cards.json: ${error.message}`,
    };
  }

  if (!Array.isArray(data?.slots) || !Array.isArray(data?.cards)) {
    return {
      tool: { name: 'cards-integrity-report', version: TOOL_VERSION, readOnly: true },
      checkedAt: new Date().toISOString(),
      verdict: 'UNKNOWN',
      error: 'data/cards.json must contain slots[] and cards[]',
    };
  }

  const slotIds = new Set(data.slots.map((slot) => slot?.id).filter(Boolean));
  const cardIds = new Set(data.cards.map((card) => card?.id).filter(Boolean));
  const evidence = data.cards.map((card) => cardEvidence(card, slotIds, cardIds));

  const slotEvidence = data.slots.map((s) => ({
    id: s.id,
    name: s.name,
    hasCanonicalOrder: 'order' in s,
    hasSnakeOrder: 'slot_order' in s,
    hasCanonicalFolder: 'useAsFolder' in s,
    hasSnakeFolder: 'use_as_folder' in s,
    hasCanonicalFilename: 'useInFilename' in s,
    hasSnakeFilename: 'use_in_filename' in s,
  }));
  const snakeOnlySlots = slotEvidence.filter((s) =>
    (!s.hasCanonicalOrder && s.hasSnakeOrder) ||
    (!s.hasCanonicalFolder && s.hasSnakeFolder) ||
    (!s.hasCanonicalFilename && s.hasSnakeFilename)
  );
  const mixedSlots = slotEvidence.filter((s) =>
    (s.hasCanonicalOrder && s.hasSnakeOrder) ||
    (s.hasCanonicalFolder && s.hasSnakeFolder) ||
    (s.hasCanonicalFilename && s.hasSnakeFilename)
  );
  const noncanonicalSlots = slotEvidence.filter((s) =>
    s.hasSnakeOrder || s.hasSnakeFolder || s.hasSnakeFilename
  );
  const snakeCaseSlotFieldCount = slotEvidence.reduce((count, s) => count
    + Number(!s.hasCanonicalOrder && s.hasSnakeOrder)
    + Number(!s.hasCanonicalFolder && s.hasSnakeFolder)
    + Number(!s.hasCanonicalFilename && s.hasSnakeFilename), 0);
  const mixedSlotFieldCount = slotEvidence.reduce((count, s) => count
    + Number(s.hasCanonicalOrder && s.hasSnakeOrder)
    + Number(s.hasCanonicalFolder && s.hasSnakeFolder)
    + Number(s.hasCanonicalFilename && s.hasSnakeFilename), 0);

  const trueOrphanCards = evidence.filter((card) => card.trueOrphan);
  const snakeCaseSlotCards = evidence.filter((card) => card.usesSnakeSlotOnly);
  const snakeCaseParentCards = evidence.filter((card) => card.usesSnakeParentOnly);
  const mixedSlotKeyCards = evidence.filter((card) => card.mixedSlotKeys);
  const mixedParentKeyCards = evidence.filter((card) => card.mixedParentKeys);
  const missingParentCards = evidence.filter((card) => card.parentMissing);

  const missingSlotCounts = new Map();
  for (const card of trueOrphanCards) {
    const key = card.effectiveSlotId ?? '<missing-slot-id>';
    missingSlotCounts.set(key, (missingSlotCounts.get(key) ?? 0) + 1);
  }

  const schemaMismatchCards = evidence.filter((card) =>
    card.usesSnakeSlotOnly || card.usesSnakeParentOnly || card.mixedSlotKeys || card.mixedParentKeys
  );

  const sortCards = (cards) => [...cards].sort((a, b) => {
    const slotCmp = String(a.effectiveSlotId).localeCompare(String(b.effectiveSlotId));
    if (slotCmp) return slotCmp;
    return String(a.name).localeCompare(String(b.name));
  });

  const stat = statSync(CARDS_PATH);
  const affected = new Set([...trueOrphanCards, ...schemaMismatchCards]);
  const contentBearingAffectedCount = [...affected].filter((card) => card.positiveLength > 0 || card.negativeLength > 0).length;
  const hasRepair = trueOrphanCards.length > 0 || schemaMismatchCards.length > 0 || missingParentCards.length > 0 || noncanonicalSlots.length > 0;

  return {
    tool: { name: 'cards-integrity-report', version: TOOL_VERSION, readOnly: true },
    checkedAt: new Date().toISOString(),
    verdict: hasRepair ? 'REPAIR_REQUIRED' : 'COMPATIBLE',
    source: {
      path: 'data/cards.json',
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      sha256: sha256(raw),
      schemaVersion: data.schemaVersion ?? data.version ?? null,
    },
    summary: {
      slotCount: data.slots.length,
      cardCount: data.cards.length,
      trueOrphanCount: trueOrphanCards.length,
      snakeCaseSlotIdCount: snakeCaseSlotCards.length,
      snakeCaseParentIdCount: snakeCaseParentCards.length,
      mixedSlotKeyCount: mixedSlotKeyCards.length,
      mixedParentKeyCount: mixedParentKeyCards.length,
      missingParentCount: missingParentCards.length,
      snakeCaseSlotObjectCount: snakeOnlySlots.length,
      mixedSlotObjectCount: mixedSlots.length,
      snakeCaseSlotFieldCount,
      mixedSlotFieldCount,
      noncanonicalSlotCount: noncanonicalSlots.length,
      distinctMissingSlotIds: missingSlotCounts.size,
      contentBearingAffectedCount,
    },
    classification: {
      trueOrphans: sortCards(trueOrphanCards),
      snakeCaseSchemaMismatch: sortCards(schemaMismatchCards),
      missingParents: sortCards(missingParentCards),
      noncanonicalSlots: [...noncanonicalSlots].sort((a, b) => String(a.name).localeCompare(String(b.name))),
      missingSlots: [...missingSlotCounts.entries()]
        .map(([slotId, count]) => ({ slotId, count }))
        .sort((a, b) => b.count - a.count || a.slotId.localeCompare(b.slotId)),
    },
    interpretation: {
      canonicalCardKeys: ['slotId', 'parentId'],
      knownNonCanonicalKeys: ['slot_id', 'parent_id'],
      canonicalSlotKeys: ['order', 'useAsFolder', 'useInFilename'],
      knownNonCanonicalSlotKeys: ['slot_order', 'use_as_folder', 'use_in_filename'],
      note: 'A card using slot_id that points to an existing slot is a schema-contract mismatch, not a true orphan. See ai-family-foundation #3.',
    },
    privacy: {
      promptTextIncluded: false,
      note: 'positive/negative text is not emitted; only character lengths are reported',
    },
  };
}

function printCardLine(card) {
  return `id=${card.id ?? '?'} name=${JSON.stringify(card.name ?? '')} slot=${card.effectiveSlotId ?? '<missing>'} source=${card.canonicalSlotId ? 'slotId' : card.snakeSlotId ? 'slot_id' : 'none'} parent=${card.effectiveParentId ?? '-'} updated_at=${card.updated_at ?? '-'} contentLen=${card.positiveLength}/${card.negativeLength}`;
}

function printHuman(report) {
  console.log(`Cards Integrity Report v${TOOL_VERSION}`);
  console.log(`checked: ${report.checkedAt}`);
  console.log(`verdict: ${report.verdict}`);
  if (report.error) {
    console.log(`error: ${report.error}`);
    return;
  }
  const s = report.summary;
  console.log(`cards=${s.cardCount} slots=${s.slotCount}`);
  console.log(`trueOrphans=${s.trueOrphanCount} snakeCaseSlotId=${s.snakeCaseSlotIdCount} snakeCaseParentId=${s.snakeCaseParentIdCount} missingParents=${s.missingParentCount}`);
  console.log(`slotSchema: snakeObjects=${s.snakeCaseSlotObjectCount} mixedObjects=${s.mixedSlotObjectCount} snakeFields=${s.snakeCaseSlotFieldCount} mixedFields=${s.mixedSlotFieldCount}`);
  console.log(`cards.json sha256: ${report.source.sha256}`);

  if (report.classification.missingSlots.length) {
    console.log('\nTrue missing slotId groups:');
    for (const item of report.classification.missingSlots) console.log(`  ${item.slotId}: ${item.count}`);
  }

  if (report.classification.snakeCaseSchemaMismatch.length) {
    console.log('\nSchema-mismatch cards (not automatically true orphans):');
    for (const card of report.classification.snakeCaseSchemaMismatch) console.log(`  ${printCardLine(card)}`);
  }

  if (report.classification.trueOrphans.length) {
    console.log('\nTrue orphan cards:');
    for (const card of report.classification.trueOrphans) console.log(`  ${printCardLine(card)}`);
  }
}

const args = parseArgs(process.argv.slice(2));
const report = main();
if (args.json) console.log(JSON.stringify(report, null, 2));
else printHuman(report);

if (report.verdict === 'REPAIR_REQUIRED') process.exitCode = 2;
else if (report.verdict === 'UNKNOWN') process.exitCode = 3;
