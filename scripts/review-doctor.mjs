import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const DB_PATH = join(DATA_DIR, 'index.db');
const TOOL_VERSION = '1.0.2';

const VERDICT = Object.freeze({
  COMPATIBLE: 'COMPATIBLE',
  REPAIR_REQUIRED: 'REPAIR_REQUIRED',
  UNKNOWN: 'UNKNOWN',
});

const REQUIRED_IMAGE_COLUMNS = {
  hash: 'TEXT',
  rel_path: 'TEXT',
  filename: 'TEXT',
  folder: 'TEXT',
  size_bytes: 'INTEGER',
  created_at: 'TEXT',
  modified_at: 'TEXT',
  width: 'INTEGER',
  height: 'INTEGER',
  prompt: 'TEXT',
  negative: 'TEXT',
  seed: 'INTEGER',
  model: 'TEXT',
  steps: 'INTEGER',
  scale: 'REAL',
  sampler: 'TEXT',
  preset_id: 'TEXT',
  favorite: 'INTEGER',
  caption: 'TEXT',
  thumb_ok: 'INTEGER',
  indexed_at: 'TEXT',
  caption_config: 'TEXT',
  char_prompts: 'TEXT',
  meta_updated_at: 'TEXT',
};

const REQUIRED_IMAGE_INDEXES = ['idx_folder', 'idx_created', 'idx_favorite'];

function parseArgs(argv) {
  const out = {
    json: false,
    deep: false,
    port: null,
    vaultRoot: null,
    timeoutMs: 2500,
  };

  for (const arg of argv) {
    if (arg === '--json') out.json = true;
    else if (arg === '--deep') out.deep = true;
    else if (arg.startsWith('--port=')) out.port = Number(arg.slice('--port='.length));
    else if (arg.startsWith('--vault-root=')) out.vaultRoot = arg.slice('--vault-root='.length);
    else if (arg.startsWith('--timeout-ms=')) out.timeoutMs = Number(arg.slice('--timeout-ms='.length));
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
  console.log(`Prompt Vault Review Doctor v${TOOL_VERSION}\n\nUsage:\n  node scripts/review-doctor.mjs [--json] [--deep] [--vault-root=PATH] [--port=8789]\n\nOptions:\n  --json             JSON only (machine-readable evidence)\n  --deep             use PRAGMA integrity_check instead of quick_check\n  --vault-root=PATH  override VAULT_ROOT without modifying .env\n  --port=N           healthz port (default: PORT/.env or 8789)\n  --timeout-ms=N     healthz timeout (default: 2500)\n\nExit codes:\n  0  COMPATIBLE\n  2  REPAIR_REQUIRED\n  3  UNKNOWN\n  64 invalid CLI usage\n\nThis tool is read-only with respect to Prompt Vault data. It never runs migrations,\ncheckpoints WAL, rewrites JSON, or modifies the Vault/SQLite database.`);
}

function readEnvValue(key) {
  if (process.env[key]) return process.env[key];
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return null;
  try {
    for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      if (line.slice(0, eq).trim() !== key) continue;
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

function runGit(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function probeRepository() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  return {
    root: '.',
    branch: runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
    head: runGit(['rev-parse', 'HEAD']),
    dirty: Boolean(runGit(['status', '--porcelain'])),
    packageVersion: pkg.version ?? null,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  };
}

function fileMeta(path, { hash = false } = {}) {
  if (!existsSync(path)) return { exists: false };
  try {
    const st = statSync(path);
    const out = {
      exists: true,
      sizeBytes: st.size,
      modifiedAt: st.mtime.toISOString(),
    };
    if (hash && st.isFile()) {
      out.sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
    return out;
  } catch (error) {
    return { exists: true, error: error.message };
  }
}

function uniqueDuplicates(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

function validateCards(data) {
  const errors = [];
  const warnings = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { errors: ['root must be an object'], warnings };
  }
  if (!Array.isArray(data.slots)) errors.push('slots must be an array');
  if (!Array.isArray(data.cards)) errors.push('cards must be an array');
  if (errors.length) return { errors, warnings };

  const slotIds = data.slots.map((s) => s?.id).filter(Boolean);
  const cardIds = data.cards.map((c) => c?.id).filter(Boolean);
  const duplicateSlotIds = uniqueDuplicates(slotIds);
  const duplicateCardIds = uniqueDuplicates(cardIds);
  if (duplicateSlotIds.length) errors.push(`duplicate slot ids: ${duplicateSlotIds.join(', ')}`);
  if (duplicateCardIds.length) errors.push(`duplicate card ids: ${duplicateCardIds.join(', ')}`);

  const snakeOrderSlots = data.slots.filter((s) => !('order' in s) && 'slot_order' in s);
  const snakeFolderSlots = data.slots.filter((s) => !('useAsFolder' in s) && 'use_as_folder' in s);
  const snakeFilenameSlots = data.slots.filter((s) => !('useInFilename' in s) && 'use_in_filename' in s);
  const mixedOrderSlots = data.slots.filter((s) => 'order' in s && 'slot_order' in s);
  const mixedFolderSlots = data.slots.filter((s) => 'useAsFolder' in s && 'use_as_folder' in s);
  const mixedFilenameSlots = data.slots.filter((s) => 'useInFilename' in s && 'use_in_filename' in s);

  const snakeSlotCount = snakeOrderSlots.length + snakeFolderSlots.length + snakeFilenameSlots.length;
  const mixedSlotCount = mixedOrderSlots.length + mixedFolderSlots.length + mixedFilenameSlots.length;

  if (snakeSlotCount > 0) errors.push(`slots using noncanonical keys (slot_order/use_as_folder/use_in_filename): ${snakeSlotCount} fields across ${data.slots.length} slots`);
  if (mixedSlotCount > 0) errors.push(`slots containing both canonical and snake_case keys: ${mixedSlotCount} fields`);

  const slotSet = new Set(slotIds);
  const cardSet = new Set(cardIds);
  const snakeSlotCards = data.cards.filter((c) => !c?.slotId && c?.slot_id);
  const snakeParentCards = data.cards.filter((c) => !c?.parentId && c?.parent_id);
  const mixedSlotCards = data.cards.filter((c) => c?.slotId && c?.slot_id);
  const mixedParentCards = data.cards.filter((c) => c?.parentId && c?.parent_id);
  if (snakeSlotCards.length) {
    errors.push(`cards using noncanonical slot_id instead of slotId: ${snakeSlotCards.length} (see ai-family-foundation #3)`);
  }
  if (snakeParentCards.length) {
    errors.push(`cards using noncanonical parent_id instead of parentId: ${snakeParentCards.length} (see ai-family-foundation #3)`);
  }
  if (mixedSlotCards.length) errors.push(`cards containing both slotId and slot_id: ${mixedSlotCards.length}`);
  if (mixedParentCards.length) errors.push(`cards containing both parentId and parent_id: ${mixedParentCards.length}`);

  const orphanCards = data.cards
    .filter((c) => {
      const effectiveSlotId = c?.slotId ?? c?.slot_id;
      return !effectiveSlotId || !slotSet.has(effectiveSlotId);
    })
    .map((c) => c?.id ?? '<missing-id>');
  if (orphanCards.length) errors.push(`true cards with missing/unknown effective slot reference: ${orphanCards.slice(0, 20).join(', ')}`);

  const missingParentCards = data.cards
    .filter((c) => {
      const effectiveParentId = c?.parentId ?? c?.parent_id;
      return Boolean(effectiveParentId && !cardSet.has(effectiveParentId));
    })
    .map((c) => c?.id ?? '<missing-id>');
  if (missingParentCards.length) errors.push(`cards with missing/unknown effective parent reference: ${missingParentCards.slice(0, 20).join(', ')}`);

  if (data.version == null && data.schemaVersion == null) warnings.push('no version/schemaVersion field');
  return { errors, warnings };
}

function validatePresets(data) {
  const errors = [];
  const warnings = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { errors: ['root must be an object'], warnings };
  }
  if (!Array.isArray(data.presets)) errors.push('presets must be an array');
  if (Array.isArray(data.presets)) {
    const ids = data.presets.map((p) => p?.id).filter(Boolean);
    const dupes = uniqueDuplicates(ids);
    if (dupes.length) errors.push(`duplicate preset ids: ${dupes.join(', ')}`);
  }
  if (data.version == null && data.schemaVersion == null) warnings.push('no version/schemaVersion field');
  return { errors, warnings };
}

function validateSettings(data) {
  const errors = [];
  const warnings = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { errors: ['root must be an object'], warnings };
  }
  if (!data.generation || typeof data.generation !== 'object') warnings.push('generation section missing');
  return { errors, warnings };
}

function probeJsonFile(name, path, validate) {
  const meta = fileMeta(path, { hash: true });
  if (!meta.exists) {
    return { name, verdict: VERDICT.UNKNOWN, ...meta, validJson: false, errors: ['file not found'], warnings: [] };
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const data = JSON.parse(raw);
    const validation = validate(data);
    return {
      name,
      verdict: validation.errors.length ? VERDICT.REPAIR_REQUIRED : VERDICT.COMPATIBLE,
      ...meta,
      validJson: true,
      version: data?.schemaVersion ?? data?.version ?? null,
      errors: validation.errors,
      warnings: validation.warnings,
    };
  } catch (error) {
    return {
      name,
      verdict: VERDICT.REPAIR_REQUIRED,
      ...meta,
      validJson: false,
      errors: [error.message],
      warnings: [],
    };
  }
}

async function loadDatabaseModule() {
  try {
    const mod = await import('better-sqlite3');
    return mod.default;
  } catch (error) {
    return { loadError: error.message };
  }
}

function pragmaRows(db, pragma) {
  const rows = db.pragma(pragma);
  return Array.isArray(rows) ? rows : [rows];
}

function probeSqlite(Database, deep) {
  const dbMeta = fileMeta(DB_PATH);
  const walMeta = fileMeta(`${DB_PATH}-wal`);
  const shmMeta = fileMeta(`${DB_PATH}-shm`);

  if (!dbMeta.exists) {
    return {
      verdict: VERDICT.UNKNOWN,
      database: dbMeta,
      wal: walMeta,
      shm: shmMeta,
      error: 'data/index.db not found',
    };
  }
  if (!Database || Database.loadError) {
    return {
      verdict: VERDICT.UNKNOWN,
      database: dbMeta,
      wal: walMeta,
      shm: shmMeta,
      error: `better-sqlite3 unavailable: ${Database?.loadError ?? 'unknown error'}`,
    };
  }

  let db;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    const checkName = deep ? 'integrity_check' : 'quick_check';
    const checkRows = pragmaRows(db, checkName);
    const checkMessages = checkRows.map((row) => String(Object.values(row)[0]));
    const integrityOk = checkMessages.length === 1 && checkMessages[0].toLowerCase() === 'ok';

    const imageColumns = pragmaRows(db, 'table_info(images)');
    const columnsByName = new Map(imageColumns.map((column) => [column.name, column]));
    const missingColumns = [];
    const typeMismatches = [];
    for (const [name, expectedType] of Object.entries(REQUIRED_IMAGE_COLUMNS)) {
      const actual = columnsByName.get(name);
      if (!actual) missingColumns.push(name);
      else if (String(actual.type ?? '').toUpperCase() !== expectedType) {
        typeMismatches.push({ column: name, expected: expectedType, actual: actual.type ?? null });
      }
    }

    const indexes = pragmaRows(db, 'index_list(images)').map((row) => row.name).filter(Boolean);
    const missingIndexes = REQUIRED_IMAGE_INDEXES.filter((name) => !indexes.includes(name));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
    const rowCount = tables.includes('images') ? db.prepare('SELECT COUNT(*) AS count FROM images').get().count : null;
    const schemaMigrationsPresent = tables.includes('schema_migrations');
    const userVersion = db.pragma('user_version', { simple: true });
    const journalMode = db.pragma('journal_mode', { simple: true });

    const verdict = (!integrityOk || missingColumns.length || typeMismatches.length || missingIndexes.length)
      ? VERDICT.REPAIR_REQUIRED
      : VERDICT.COMPATIBLE;

    return {
      verdict,
      database: dbMeta,
      wal: walMeta,
      shm: shmMeta,
      check: { kind: checkName, ok: integrityOk, messages: checkMessages },
      journalMode,
      userVersion,
      rowCount,
      tables,
      imageSchema: {
        missingColumns,
        typeMismatches,
        missingIndexes,
        indexes,
        columns: imageColumns.map((c) => ({
          name: c.name,
          type: c.type,
          notNull: Boolean(c.notnull),
          defaultValue: c.dflt_value,
          primaryKey: Boolean(c.pk),
        })),
      },
      migrationTracking: {
        schemaMigrationsPresent,
        note: schemaMigrationsPresent
          ? 'schema_migrations table present'
          : 'schema_migrations table absent; current main uses ad-hoc ALTER TABLE upgrades',
      },
    };
  } catch (error) {
    return {
      verdict: VERDICT.REPAIR_REQUIRED,
      database: dbMeta,
      wal: walMeta,
      shm: shmMeta,
      error: error.message,
    };
  } finally {
    try { db?.close(); } catch {}
  }
}

function probeM2M3(vaultRoot, cards, presets) {
  if (!vaultRoot) {
    return {
      verdict: VERDICT.UNKNOWN,
      state: 'VAULT_ROOT_UNKNOWN',
      note: 'pass --vault-root=PATH or set VAULT_ROOT/.env to inspect legacy M2 migration residue',
    };
  }

  const rootMeta = fileMeta(vaultRoot);
  if (!rootMeta.exists) {
    return { verdict: VERDICT.UNKNOWN, state: 'VAULT_ROOT_MISSING', root: rootMeta };
  }

  const source = fileMeta(join(vaultRoot, 'presets.json'), { hash: true });
  const backup = fileMeta(join(vaultRoot, 'presets.json.bak'), { hash: true });
  const cardsExists = cards.exists;
  const cardsHealthy = cards.verdict === VERDICT.COMPATIBLE;
  const presetsExists = presets.exists;
  const presetsHealthy = presets.verdict === VERDICT.COMPATIBLE;

  if (source.exists && cardsExists) {
    return {
      verdict: VERDICT.REPAIR_REQUIRED,
      state: 'AMBIGUOUS_SOURCE_AND_TARGET',
      source,
      backup,
      note: 'legacy presets.json and data/cards.json coexist; current startup migration skips when cards.json exists',
    };
  }
  if (backup.exists && (!cardsHealthy || !presetsHealthy)) {
    return {
      verdict: VERDICT.REPAIR_REQUIRED,
      state: 'BACKUP_PRESENT_TARGET_UNHEALTHY',
      source,
      backup,
      note: 'migration backup exists but one or more M3 targets are missing/invalid',
    };
  }
  if (backup.exists && cardsHealthy && presetsHealthy) {
    return {
      verdict: VERDICT.COMPATIBLE,
      state: 'MIGRATED_LIKELY',
      source,
      backup,
      note: 'legacy .bak and healthy M3 targets found; journal/completion marker does not exist in current implementation',
    };
  }
  if (source.exists && !cardsExists) {
    return {
      verdict: VERDICT.UNKNOWN,
      state: 'LEGACY_SOURCE_PENDING',
      source,
      backup,
      note: 'legacy source exists and cards target is absent; current app would attempt implicit migration at startup',
    };
  }
  if (!source.exists && !backup.exists && cardsHealthy && presetsHealthy) {
    return {
      verdict: VERDICT.COMPATIBLE,
      state: 'M3_NATIVE_OR_HISTORY_UNAVAILABLE',
      source,
      backup,
    };
  }
  if (!source.exists && !backup.exists && (!cardsExists || !presetsExists)) {
    return {
      verdict: VERDICT.UNKNOWN,
      state: 'NO_LEGACY_EVIDENCE_TARGET_MISSING',
      source,
      backup,
    };
  }

  return {
    verdict: VERDICT.UNKNOWN,
    state: 'UNCLASSIFIED',
    source,
    backup,
  };
}

function probeStaticRisks() {
  const dbPath = join(ROOT, 'server', 'db.js');
  const serverPath = join(ROOT, 'server.js');
  const dbText = existsSync(dbPath) ? readFileSync(dbPath, 'utf8') : '';
  const serverText = existsSync(serverPath) ? readFileSync(serverPath, 'utf8') : '';

  const silentAlterColumns = ['caption_config', 'char_prompts', 'meta_updated_at'].filter((column) => {
    const re = new RegExp(`ALTER\\s+TABLE\\s+images\\s+ADD\\s+COLUMN\\s+${column}[\\s\\S]{0,140}?catch\\s*\\{\\s*\\}`, 'i');
    return re.test(dbText);
  });

  const directJsonWrites = {
    cards: /writeFileSync\(\s*CARDS_PATH\s*,/m.test(serverText),
    presets: /writeFileSync\(\s*PRESETS_DATA_PATH\s*,/m.test(serverText),
    settings: /writeFileSync\(\s*SETTINGS_PATH\s*,/m.test(serverText),
  };
  const implicitM2M3 = /runMigration\(\s*vaultRoot\s*\)/m.test(serverText);

  return [
    {
      issue: 'prompt-vault-dev#33',
      present: silentAlterColumns.length > 0,
      detail: silentAlterColumns.length
        ? `silent ALTER TABLE catch remains for: ${silentAlterColumns.join(', ')}`
        : 'silent ALTER TABLE pattern not detected',
    },
    {
      issue: 'prompt-vault-dev#34',
      present: Object.values(directJsonWrites).some(Boolean),
      detail: directJsonWrites,
    },
    {
      issue: 'prompt-vault-dev#35 Phase 4',
      present: implicitM2M3,
      detail: implicitM2M3
        ? 'M2→M3 migration is still invoked from normal startup path'
        : 'implicit startup migration invocation not detected',
    },
  ];
}

function requestJson(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ reachable: true, statusCode: res.statusCode, body: JSON.parse(body) });
        } catch (error) {
          resolve({ reachable: true, statusCode: res.statusCode, parseError: error.message, bodyPreview: body.slice(0, 500) });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => resolve({ reachable: false, error: error.message }));
  });
}

async function probeRuntime(port, packageVersion, timeoutMs) {
  const health = await requestJson(`http://127.0.0.1:${port}/api/healthz`, timeoutMs);
  if (!health.reachable) {
    return { state: 'NOT_REACHABLE', port, health };
  }
  const reportedVersion = health.body?.version ?? null;
  return {
    state: 'REACHABLE',
    port,
    health,
    versionMatchesRepository: reportedVersion != null ? reportedVersion === packageVersion : null,
  };
}

function combineVerdicts(parts) {
  const values = parts.map((p) => p?.verdict).filter(Boolean);
  if (values.includes(VERDICT.REPAIR_REQUIRED)) return VERDICT.REPAIR_REQUIRED;
  if (values.includes(VERDICT.UNKNOWN)) return VERDICT.UNKNOWN;
  return VERDICT.COMPATIBLE;
}

function printHuman(report) {
  const icon = (v) => v === VERDICT.COMPATIBLE ? 'OK' : v === VERDICT.REPAIR_REQUIRED ? '!!' : '??';
  console.log(`Prompt Vault Review Doctor v${TOOL_VERSION}`);
  console.log(`checked: ${report.checkedAt}`);
  console.log(`repo: ${report.repository.branch ?? '?'} @ ${report.repository.head ?? '?'}${report.repository.dirty ? ' (dirty)' : ''}`);
  console.log(`verdict: ${report.verdict}\n`);

  console.log(`[${icon(report.fran.sqlite.verdict)}] SQLite: ${report.fran.sqlite.verdict}`);
  if (report.fran.sqlite.error) console.log(`     ${report.fran.sqlite.error}`);
  else {
    const missing = report.fran.sqlite.imageSchema?.missingColumns ?? [];
    console.log(`     rows=${report.fran.sqlite.rowCount ?? '?'} missingColumns=${missing.length} quick=${report.fran.sqlite.check?.ok ?? '?'}`);
  }

  for (const item of [report.fran.json.cards, report.fran.json.presets, report.fran.json.settings]) {
    console.log(`[${icon(item.verdict)}] JSON ${item.name}: ${item.verdict}${item.errors?.length ? ` — ${item.errors.join('; ')}` : ''}`);
  }

  console.log(`[${icon(report.fran.m2m3.verdict)}] M2→M3: ${report.fran.m2m3.state}`);
  console.log(`[${report.fran.runtime.state === 'REACHABLE' ? 'OK' : '--'}] runtime: ${report.fran.runtime.state} (port ${report.fran.runtime.port})`);

  const presentRisks = report.implementationRisks.filter((r) => r.present);
  if (presentRisks.length) {
    console.log('\nKnown implementation risks still present in this HEAD:');
    for (const risk of presentRisks) console.log(`  - ${risk.issue}: ${typeof risk.detail === 'string' ? risk.detail : JSON.stringify(risk.detail)}`);
  }

  console.log('\nRead-only: no migrations, WAL checkpoints, JSON writes, or Vault mutations were executed.');
}

const args = parseArgs(process.argv.slice(2));
const repository = probeRepository();
const vaultRoot = args.vaultRoot || readEnvValue('VAULT_ROOT');
const port = Number(args.port || readEnvValue('PORT') || 8789);

const cards = probeJsonFile('cards.json', join(DATA_DIR, 'cards.json'), validateCards);
const presets = probeJsonFile('presets.json', join(DATA_DIR, 'presets.json'), validatePresets);
const settings = probeJsonFile('settings.json', join(DATA_DIR, 'settings.json'), validateSettings);
const Database = await loadDatabaseModule();
const sqlite = probeSqlite(Database, args.deep);
const m2m3 = probeM2M3(vaultRoot, cards, presets);
const runtime = await probeRuntime(port, repository.packageVersion, args.timeoutMs);
const implementationRisks = probeStaticRisks();

const verdict = combineVerdicts([sqlite, cards, presets, settings, m2m3]);
const report = {
  tool: {
    name: 'prompt-vault-review-doctor',
    version: TOOL_VERSION,
    readOnly: true,
  },
  checkedAt: new Date().toISOString(),
  verdict,
  repository,
  fran: {
    vaultRootConfigured: Boolean(vaultRoot),
    sqlite,
    json: { cards, presets, settings },
    m2m3,
    runtime,
  },
  implementationRisks,
  limitations: [
    'Cloudflare D1/R2/DO are not queried by this script.',
    'No SQLite WAL checkpoint or migration is executed.',
    'No JSON file is repaired or rewritten.',
    'A reachable healthz only proves the local HTTP process responded; it is not a full API smoke test.',
    'cards.json validation treats slot_id/parent_id as noncanonical schema pollution from the known cross-repo contract bug (#3), while true orphan detection uses slotId ?? slot_id.',
  ],
};

if (args.json) console.log(JSON.stringify(report, null, 2));
else printHuman(report);

if (verdict === VERDICT.REPAIR_REQUIRED) process.exitCode = 2;
else if (verdict === VERDICT.UNKNOWN) process.exitCode = 3;
