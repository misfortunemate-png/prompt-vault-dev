// pv#115: 設定画面「クラウド同期」（Fran 接続時のみ SettingsScreen が表示する）
// フォルダ選択（最上位フォルダ単位・D-5）と手動同期（D-4）。同期 API は Fran にしかないので FRAN_URL を直接呼ぶ
import { useState, useEffect, useCallback } from 'react';
import { FRAN_URL } from '../lib/connection';
import { recordInvalid, recordFailure } from '../lib/invalidLog';

const POLL_MS = 2500;

async function franJson(path, init = {}) {
  const res = await fetch(FRAN_URL + path, {
    ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch (e) {
    recordInvalid({ kind: 'sync-response-not-json', stage: 'pv#115 CloudSyncSection', raw: { path, status: res.status }, reason: `応答が JSON でない: ${e.message}` });
  }
  return { status: res.status, ok: res.ok, body };
}

const btnStyle = {
  padding: '10px 14px',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-s)',
  background: 'var(--bg)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 'var(--fs-label)',
  minHeight: '44px',
};

function SyncFolderSelector({ addToast }) {
  const [folders, setFolders] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    franJson('/sync/folders').then(r => {
      if (cancelled) return;
      if (!r.ok || !Array.isArray(r.body?.folders)) {
        addToast('error', `同期フォルダの読み込みに失敗しました（${r.status}）`);
        setFolders([]);
        return;
      }
      setFolders(r.body.folders);
      setChecked(new Set(r.body.folders.filter(f => f.selected).map(f => f.name)));
    }).catch(e => {
      recordFailure('pv#115 CloudSyncSection.loadFolders', 'sync-folders-load-failed', e);
      if (!cancelled) { addToast('error', '同期フォルダの読み込みに失敗しました'); setFolders([]); }
    });
    return () => { cancelled = true; };
  }, [addToast]);

  const toggle = (name) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const save = async () => {
    setSaving(true);
    try {
      const r = await franJson('/sync/folders', { method: 'PUT', body: JSON.stringify({ folders: [...checked] }) });
      if (r.ok) addToast('success', `同期フォルダを保存しました（${r.body?.folders?.length ?? 0} 件）`);
      else addToast('error', `同期フォルダの保存に失敗しました（${r.status}）`);
    } catch (e) {
      recordFailure('pv#115 CloudSyncSection.saveFolders', 'sync-folders-save-failed', e);
      addToast('error', '同期フォルダの保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (folders === null) return <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)' }}>読み込み中…</div>;
  if (folders.length === 0) return <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)' }}>フォルダがありません</div>;

  return (
    <div>
      <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius-s)', marginBottom: '8px' }}>
        {folders.map(f => (
          <label key={f.name} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', minHeight: '40px', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontSize: 'var(--fs-body)' }}>
            <input type="checkbox" checked={checked.has(f.name)} onChange={() => toggle(f.name)} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name === '' ? '（ルート直下）' : f.name}</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-label)', flexShrink: 0 }}>{f.imageCount} 枚</span>
          </label>
        ))}
      </div>
      <button onClick={save} disabled={saving} style={{ ...btnStyle, opacity: saving ? 0.5 : 1 }}>保存</button>
    </div>
  );
}

function SyncButton({ addToast }) {
  const [status, setStatus] = useState(null);
  const [polling, setPolling] = useState(false);

  const refresh = useCallback(async () => {
    const r = await franJson('/sync/status');
    if (!r.ok || !r.body || !['idle', 'running'].includes(r.body.state)) {
      recordInvalid({ kind: 'sync-status-unknown', stage: 'pv#115 CloudSyncSection.status', raw: r.body, reason: `state が idle/running でない（${r.status}）` });
      return null;
    }
    setStatus(r.body);
    return r.body;
  }, []);

  useEffect(() => {
    refresh().then(s => { if (s?.state === 'running') setPolling(true); })
      .catch(e => recordFailure('pv#115 CloudSyncSection.initialStatus', 'sync-status-failed', e));
  }, [refresh]);

  useEffect(() => {
    if (!polling) return;
    const id = setInterval(async () => {
      try {
        const s = await refresh();
        if (s?.state === 'idle') {
          setPolling(false);
          const n = s.lastRun?.failed ?? 0;
          if (n > 0) addToast('error', `同期でエラーが ${n} 件ありました`);
          else if (s.lastRun?.errors?.length) addToast('error', s.lastRun.errors[0]);
          else addToast('success', `同期が完了しました（送信 ${s.lastRun?.uploaded ?? 0} 件）`);
        }
      } catch (e) {
        recordFailure('pv#115 CloudSyncSection.poll', 'sync-status-failed', e);
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [polling, refresh, addToast]);

  const run = async () => {
    try {
      const r = await franJson('/sync/run', { method: 'POST' });
      if (r.status === 503) { addToast('error', r.body?.error?.includes('vault鍵') ? 'vault鍵が設定されていません' : (r.body?.error || '同期を開始できません')); return; }
      if (r.status === 409) { addToast('error', '同期が実行中です'); setPolling(true); return; }
      if (!r.ok) { addToast('error', `同期を開始できません（${r.status}）`); return; }
      await refresh();
      setPolling(true);
    } catch (e) {
      recordFailure('pv#115 CloudSyncSection.run', 'sync-run-failed', e);
      addToast('error', '同期を開始できません');
    }
  };

  const running = status?.state === 'running';
  const p = status?.progress;
  const last = status?.lastRun;
  const pct = p && p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;

  return (
    <div style={{ marginTop: '16px' }}>
      <button onClick={run} disabled={running} style={{ ...btnStyle, width: '100%', opacity: running ? 0.5 : 1 }}>
        {running ? '同期中…' : '同期'}
      </button>
      {running && p && (
        <div style={{ marginTop: '8px', fontSize: 'var(--fs-label)' }}>
          <div style={{ height: '8px', background: 'var(--line)', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
          </div>
          <div style={{ marginTop: '4px', color: 'var(--text-secondary)' }}>
            {p.phase === 'scanning' ? '対象を確認中…' : p.phase === 'cleanup' ? '後片付け中…' : `${p.current} / ${p.total}`}
            {p.currentFolder ? `（${p.currentFolder}）` : ''}
          </div>
        </div>
      )}
      {!running && last && (
        <div style={{ marginTop: '8px', fontSize: 'var(--fs-label)', color: 'var(--text-secondary)' }}>
          <div>前回: 送信 {last.uploaded} ／ スキップ {last.skipped} ／ エラー {last.failed}</div>
          {last.errors?.length > 0 && (
            <ul style={{ margin: '4px 0 0', paddingLeft: '18px', wordBreak: 'break-all' }}>
              {last.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function CloudSyncSection({ addToast, sectionStyle }) {
  return (
    <div style={sectionStyle}>
      <h3 style={{ fontSize: 'var(--fs-title)', marginBottom: '12px' }}>クラウド同期</h3>
      <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', marginBottom: '8px' }}>
        選んだフォルダの画像を、表示用 WebP（原寸・品質80）にしてクラウドへ送ります。子フォルダも含みます。
      </div>
      <SyncFolderSelector addToast={addToast} />
      <SyncButton addToast={addToast} />
    </div>
  );
}
