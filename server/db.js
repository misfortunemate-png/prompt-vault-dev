import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'index.db');

let db;

function getDb() {
  if (!db) {
    mkdirSync(join(__dirname, '..', 'data'), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS images (
        hash        TEXT PRIMARY KEY,
        rel_path    TEXT NOT NULL,
        filename    TEXT NOT NULL,
        folder      TEXT NOT NULL,
        size_bytes  INTEGER NOT NULL,
        created_at  TEXT NOT NULL,
        modified_at TEXT NOT NULL,
        width       INTEGER,
        height      INTEGER,
        prompt      TEXT,
        negative    TEXT,
        seed        INTEGER,
        model       TEXT,
        steps       INTEGER,
        scale       REAL,
        sampler     TEXT,
        preset_id   TEXT,
        favorite    INTEGER DEFAULT 0,
        caption     TEXT,
        thumb_ok    INTEGER DEFAULT 0,
        indexed_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_folder ON images(folder);
      CREATE INDEX IF NOT EXISTS idx_created ON images(created_at);
      CREATE INDEX IF NOT EXISTS idx_favorite ON images(favorite);
    `);
  }
  return db;
}

export function getByHash(hash) {
  return getDb().prepare('SELECT * FROM images WHERE hash = ?').get(hash) ?? null;
}

export function upsertImage(row) {
  getDb().prepare(`
    INSERT INTO images (hash, rel_path, filename, folder, size_bytes, created_at, modified_at,
      width, height, prompt, negative, seed, model, steps, scale, sampler, preset_id,
      favorite, caption, thumb_ok, indexed_at)
    VALUES (@hash, @rel_path, @filename, @folder, @size_bytes, @created_at, @modified_at,
      @width, @height, @prompt, @negative, @seed, @model, @steps, @scale, @sampler, @preset_id,
      @favorite, @caption, @thumb_ok, @indexed_at)
    ON CONFLICT(hash) DO UPDATE SET
      rel_path    = excluded.rel_path,
      filename    = excluded.filename,
      folder      = excluded.folder,
      size_bytes  = excluded.size_bytes,
      modified_at = excluded.modified_at,
      width       = COALESCE(excluded.width, images.width),
      height      = COALESCE(excluded.height, images.height),
      prompt      = COALESCE(excluded.prompt, images.prompt),
      negative    = COALESCE(excluded.negative, images.negative),
      seed        = COALESCE(excluded.seed, images.seed),
      model       = COALESCE(excluded.model, images.model),
      steps       = COALESCE(excluded.steps, images.steps),
      scale       = COALESCE(excluded.scale, images.scale),
      sampler     = COALESCE(excluded.sampler, images.sampler),
      preset_id   = COALESCE(excluded.preset_id, images.preset_id),
      indexed_at  = excluded.indexed_at
  `).run(row);
}

export function deleteByHash(hash) {
  getDb().prepare('DELETE FROM images WHERE hash = ?').run(hash);
}

export function deleteImage(hash) {
  const row = getDb().prepare('SELECT rel_path FROM images WHERE hash = ?').get(hash);
  if (!row) return null;
  getDb().prepare('DELETE FROM images WHERE hash = ?').run(hash);
  return row.rel_path;
}

export function listByFolder(folder) {
  return getDb().prepare(
    'SELECT hash, filename, folder, thumb_ok, favorite, created_at, width, height FROM images WHERE folder = ? ORDER BY created_at DESC'
  ).all(folder);
}

export function listFolders() {
  return getDb().prepare(
    'SELECT folder, COUNT(*) as count FROM images GROUP BY folder ORDER BY folder'
  ).all();
}

export function getRecent(limit = 20) {
  return getDb().prepare(
    'SELECT hash, filename, folder, thumb_ok, favorite, created_at, width, height FROM images ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

export function getStats() {
  const d = getDb();
  const { total } = d.prepare('SELECT COUNT(*) as total FROM images').get();
  const { folders } = d.prepare('SELECT COUNT(DISTINCT folder) as folders FROM images').get();
  const { thumbed } = d.prepare('SELECT COUNT(*) as thumbed FROM images WHERE thumb_ok = 1').get();
  return { total, folders, thumbed };
}

export function setThumbOk(hash, val) {
  getDb().prepare('UPDATE images SET thumb_ok = ? WHERE hash = ?').run(val, hash);
}

export function getAllHashes() {
  return getDb().prepare('SELECT hash, rel_path FROM images').all();
}

export function setFavorite(hash, flag) {
  getDb().prepare('UPDATE images SET favorite = ? WHERE hash = ?').run(flag, hash);
}

export function getFavorites(limit = 50) {
  return getDb().prepare(
    'SELECT hash, filename, folder, thumb_ok, favorite, created_at, width, height FROM images WHERE favorite = 1 ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

export function search(query, limit = 50) {
  const like = `%${query}%`;
  return getDb().prepare(
    `SELECT hash, filename, folder, thumb_ok, favorite, created_at, width, height FROM images
     WHERE prompt LIKE ? OR negative LIKE ? OR folder LIKE ? OR filename LIKE ? OR caption LIKE ?
     ORDER BY created_at DESC LIMIT ?`
  ).all(like, like, like, like, like, limit);
}

export function getByPreset(presetId, limit = 50) {
  return getDb().prepare(
    'SELECT hash, filename, folder, thumb_ok, favorite, created_at, width, height FROM images WHERE preset_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(presetId, limit);
}

export function setCaption(hash, text) {
  getDb().prepare('UPDATE images SET caption = ? WHERE hash = ?').run(text, hash);
}

export function getAllPreviewHashes(limit = 4) {
  const rows = getDb().prepare(`
    SELECT folder, hash FROM (
      SELECT folder, hash,
        ROW_NUMBER() OVER (PARTITION BY folder ORDER BY created_at DESC) AS rn
      FROM images
    ) WHERE rn <= ?
  `).all(limit);
  const map = {};
  for (const { folder, hash } of rows) {
    if (!map[folder]) map[folder] = [];
    map[folder].push(hash);
  }
  return map;
}
