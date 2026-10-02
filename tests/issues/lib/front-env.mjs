// フロントの src/lib/*.js を node で直接 import するための最小の環境（pv#95 系 verifier 共用）
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { repoRoot } from './fran-harness.mjs';

export class MemStore {
  constructor(init = {}) { this._m = new Map(Object.entries(init)); }
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
  setItem(k, v) { this._m.set(k, String(v)); }
  removeItem(k) { this._m.delete(k); }
  clear() { this._m.clear(); }
}

// 毎回新しいモジュール実体として読み込む（再読み込みの模擬）
export async function freshImport(relPath) {
  const url = pathToFileURL(join(repoRoot, relPath)).href;
  return import(`${url}?t=${Date.now()}_${Math.random()}`);
}

// globalThis の差し替えを一時的に行い、終わったら戻す
export async function withGlobals(patch, fn) {
  const saved = {};
  for (const k of Object.keys(patch)) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { value: patch[k], configurable: true, writable: true });
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(patch)) {
      if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
      else delete globalThis[k];
    }
  }
}

export const check = (name, ok, detail = '') => ({ name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail });
