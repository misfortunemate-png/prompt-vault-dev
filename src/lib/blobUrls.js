// pv#115 B-3: Blob URL の持ち主。作った URL は、差し替え・手放しのときに必ず revokeObjectURL する
// urlApi は既定で globalThis.URL（verifier から差し替えられるように引数にする）

// 一つの表示枠が持つ Blob URL。set で前の URL を解放し、release で今の URL を解放する
export function createBlobUrlSlot(urlApi = globalThis.URL) {
  let current = null;
  return {
    set(blob) {
      const url = urlApi.createObjectURL(blob);
      if (current) urlApi.revokeObjectURL(current);
      current = url;
      return url;
    },
    release() {
      if (current) urlApi.revokeObjectURL(current);
      current = null;
    },
    get current() { return current; },
  };
}

// 一覧（生成結果など）が持つ Blob URL 群。前回あって今回ない URL を解放する。releaseAll で残りも解放する
export function createBlobUrlSetTracker(urlApi = globalThis.URL) {
  let held = new Set();
  return {
    sync(urls) {
      const next = new Set(urls.filter(u => typeof u === 'string' && u.startsWith('blob:')));
      for (const u of held) if (!next.has(u)) urlApi.revokeObjectURL(u);
      held = next;
    },
    releaseAll() {
      for (const u of held) urlApi.revokeObjectURL(u);
      held = new Set();
    },
    get size() { return held.size; },
  };
}
