import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { FONT_REGISTRY, DISPLAY_DEFAULTS } from '../App';

const SAMPLER_OPTIONS = ['k_euler', 'k_euler_ancestral', 'k_dpmpp_2m_sde'];

const MODEL_OPTIONS = [
  { value: 'nai-diffusion-4-5-full', label: 'V4.5 Full' },
  { value: 'nai-diffusion-4-5-curated', label: 'V4.5 Curated' },
  { value: 'nai-diffusion-4-full', label: 'V4 Full' },
  { value: 'nai-diffusion-3', label: 'V3' },
];

const sectionStyle = {
  background: 'var(--surface)',
  borderRadius: 'var(--radius-m)',
  padding: '16px',
  marginBottom: '12px',
};

const labelStyle = {
  display: 'block',
  fontSize: 'var(--fs-label)',
  color: 'var(--text-secondary)',
  marginBottom: '6px',
};

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-s)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 'var(--fs-body)',
};

const numInputStyle = {
  ...inputStyle,
  width: '100%',
};

function SliderRow({ label, value, min, max, step, onChange, suffix }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={labelStyle}>
        {label}: {value}{suffix || ''}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
    </div>
  );
}

function SelectRow({ label, value, options, onChange }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={labelStyle}>{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={inputStyle}
      >
        {options.map(o => (
          <option key={o.value || o} value={o.value || o}>{o.label || o}</option>
        ))}
      </select>
    </div>
  );
}

export default function SettingsScreen({ onClose, addToast, displaySettings, updateDisplay }) {
  const [gen, setGen] = useState(null);
  const [guard, setGuard] = useState(null);
  const [captionStyle, setCaptionStyle] = useState(null);
  const [systemInfo, setSystemInfo] = useState(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [version, setVersion] = useState('');
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    api.getSettings().then(s => {
      setGen(s.generation);
      setGuard(s.guard);
      setCaptionStyle(s.captionStyle || { mode: 'margin', fontSize: 'medium', color: '#ffffff', outline: true });
    }).catch(() => addToast('error', '設定の読み込みに失敗しました'));
    api.getSystemInfo().then(setSystemInfo).catch(() => {});
  }, [addToast]);

  const handleSave = async () => {
    if (guard && guard.intervalMax < guard.intervalMin) {
      addToast('error', '最大間隔は最小間隔以上にしてください');
      return;
    }
    if (guard && guard.intervalMin < 1) {
      addToast('error', '最小間隔は1以上にしてください');
      return;
    }
    if (guard && (guard.maxPerJob < 1 || guard.maxPerJob > 500)) {
      addToast('error', 'ジョブ上限は1〜500にしてください');
      return;
    }
    try {
      await api.putSettings({ generation: gen, guard, captionStyle });
      addToast('success', '設定を保存しました');
    } catch {
      addToast('error', '設定の保存に失敗しました');
    }
  };

  const loadDebug = useCallback(async () => {
    try {
      const h = await api.healthz();
      setVersion(h.version);
    } catch {}
    try {
      const e = await api.getErrors();
      setErrors(e);
    } catch {}
  }, []);

  useEffect(() => {
    if (debugOpen) loadDebug();
  }, [debugOpen, loadDebug]);

  const handleClearSW = async () => {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' });
    }
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    location.reload();
  };

  const handleReset = async () => {
    if (!confirm('設定とデータをすべて削除しますか？')) return;
    if (!confirm('本当に削除しますか？元に戻せません')) return;
    try {
      await api.reset();
      localStorage.clear();
      location.reload();
    } catch {
      addToast('error', 'リセットに失敗しました');
    }
  };

  const handleTestApi = async () => {
    try {
      const r = await api.testApi();
      addToast(r.ok ? 'success' : 'error', r.ok ? r.message : r.error);
    } catch {
      addToast('error', 'API疎通テストに失敗しました');
    }
  };

  const handleTestFs = async () => {
    try {
      const r = await api.testFs();
      addToast(r.ok ? 'success' : 'error', r.ok ? r.message : r.error);
    } catch {
      addToast('error', 'FS書込テストに失敗しました');
    }
  };

  const mp = gen ? (gen.width * gen.height / 1_000_000).toFixed(2) : 0;
  const anlasWarning = gen && (gen.width * gen.height > 1_048_576 || gen.steps > 28);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      background: 'var(--bg)',
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{
        position: 'sticky',
        top: 0,
        height: '48px',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--line)',
        zIndex: 1001,
      }}>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--accent)', fontSize: 'var(--fs-body)',
            padding: '4px 8px', minHeight: '44px',
            display: 'flex', alignItems: 'center',
          }}
        >← 戻る</button>
        <span style={{ flex: 1, textAlign: 'center', fontWeight: 600, fontSize: 'var(--fs-title)' }}>設定</span>
        <span style={{ width: '60px' }} />
      </div>

      <div style={{ padding: '12px 16px 120px' }}>
        {/* §4.1 表示設定 */}
        <div style={sectionStyle}>
          <h3 style={{ fontSize: 'var(--fs-title)', marginBottom: '12px' }}>表示設定</h3>

          <div style={{ marginBottom: '12px' }}>
            <label style={labelStyle}>テーマ</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {['light', 'dark', 'sepia'].map(t => (
                <button
                  key={t}
                  onClick={() => updateDisplay('theme', t)}
                  style={{
                    flex: 1,
                    padding: '8px',
                    border: displaySettings.theme === t ? 'none' : '1px solid var(--line)',
                    borderRadius: 'var(--radius-s)',
                    background: displaySettings.theme === t ? 'var(--accent)' : 'transparent',
                    color: displaySettings.theme === t ? 'var(--accent-contrast)' : 'var(--text)',
                    cursor: 'pointer',
                    fontSize: 'var(--fs-label)',
                    minHeight: '44px',
                  }}
                >{t}</button>
              ))}
            </div>
          </div>

          <SliderRow
            label="本文サイズ"
            value={displaySettings.fontSize}
            min={14} max={28} step={1}
            onChange={v => updateDisplay('fontSize', v)}
            suffix="px"
          />
          <SliderRow
            label="行間"
            value={displaySettings.lineHeight}
            min={1.4} max={2.4} step={0.1}
            onChange={v => updateDisplay('lineHeight', Math.round(v * 10) / 10)}
          />
          <SliderRow
            label="余白"
            value={displaySettings.padding}
            min={0.5} max={3.0} step={0.25}
            onChange={v => updateDisplay('padding', v)}
            suffix="rem"
          />

          <SelectRow
            label="和文フォント"
            value={displaySettings.fontJa}
            options={FONT_REGISTRY.ja.map(f => ({ value: f.id, label: f.label }))}
            onChange={v => updateDisplay('fontJa', v)}
          />
          <SelectRow
            label="欧文フォント"
            value={displaySettings.fontEn}
            options={FONT_REGISTRY.en.map(f => ({ value: f.id, label: f.label }))}
            onChange={v => updateDisplay('fontEn', v)}
          />
        </div>

        {/* §4.2 生成の既定値 */}
        {gen && (
          <div style={sectionStyle}>
            <h3 style={{ fontSize: 'var(--fs-title)', marginBottom: '12px' }}>生成の既定値</h3>

            {anlasWarning && (
              <div style={{
                background: '#fef3cd',
                color: '#856404',
                padding: '8px 12px',
                borderRadius: 'var(--radius-s)',
                fontSize: 'var(--fs-label)',
                marginBottom: '12px',
              }}>
                無料枠を超えています。Anlasが消費されます
              </div>
            )}

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>既定モデル</label>
              <select
                value={gen.model}
                onChange={e => setGen({ ...gen, model: e.target.value })}
                style={inputStyle}
              >
                {MODEL_OPTIONS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>既定の幅</label>
                <input
                  type="number"
                  value={gen.width}
                  onChange={e => setGen({ ...gen, width: Number(e.target.value) })}
                  style={numInputStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>既定の高さ</label>
                <input
                  type="number"
                  value={gen.height}
                  onChange={e => setGen({ ...gen, height: Number(e.target.value) })}
                  style={numInputStyle}
                />
              </div>
            </div>
            <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              {gen.width}×{gen.height} = {mp}MP{gen.width * gen.height <= 1_048_576 ? '（無料枠内）' : ''}
            </div>

            <SliderRow
              label="Steps"
              value={gen.steps}
              min={1} max={50} step={1}
              onChange={v => setGen({ ...gen, steps: v })}
            />

            <SelectRow
              label="Sampler"
              value={gen.sampler}
              options={SAMPLER_OPTIONS}
              onChange={v => setGen({ ...gen, sampler: v })}
            />

            <SliderRow
              label="Scale"
              value={gen.scale}
              min={1.0} max={10.0} step={0.5}
              onChange={v => setGen({ ...gen, scale: v })}
            />

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>Seed（-1でランダム）</label>
              <input
                type="number"
                value={gen.seed}
                onChange={e => setGen({ ...gen, seed: Number(e.target.value) })}
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>結果保持件数（1〜100）</label>
              <input
                type="number"
                value={gen.maxResults ?? 5}
                min={1}
                max={100}
                onChange={e => setGen({ ...gen, maxResults: Math.max(1, Math.min(100, Number(e.target.value))) })}
                style={inputStyle}
              />
            </div>
          </div>
        )}

        {/* §4.3 ガード設定 */}
        {guard && (
          <div style={sectionStyle}>
            <h3 style={{ fontSize: 'var(--fs-title)', marginBottom: '12px' }}>ガード設定</h3>
            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>最小間隔（秒）</label>
              <input
                type="number"
                value={guard.intervalMin}
                min={1}
                onChange={e => setGuard({ ...guard, intervalMin: Number(e.target.value) })}
                style={inputStyle}
              />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>最大間隔（秒）</label>
              <input
                type="number"
                value={guard.intervalMax}
                min={guard.intervalMin}
                onChange={e => setGuard({ ...guard, intervalMax: Number(e.target.value) })}
                style={inputStyle}
              />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>ジョブ上限（枚）</label>
              <input
                type="number"
                value={guard.maxPerJob}
                min={1}
                max={500}
                onChange={e => setGuard({ ...guard, maxPerJob: Number(e.target.value) })}
                style={inputStyle}
              />
            </div>
          </div>
        )}

        {/* §4.4 システム情報 */}
        <div style={sectionStyle}>
          <h3 style={{ fontSize: 'var(--fs-title)', marginBottom: '12px' }}>システム情報</h3>
          {systemInfo ? (
            <>
              <div style={{ marginBottom: '8px' }}>
                <span style={labelStyle}>VAULT_ROOT</span>
                <div style={{ fontSize: 'var(--fs-body)', wordBreak: 'break-all' }}>
                  {systemInfo.vaultRoot || '未設定（.envにVAULT_ROOTを設定してください）'}
                </div>
              </div>
              <div style={{ marginBottom: '8px' }}>
                <span style={labelStyle}>NOVELAI_TOKEN</span>
                <div style={{ fontSize: 'var(--fs-body)' }}>
                  {systemInfo.novelaiToken || '未設定'}
                </div>
              </div>
              <div>
                <span style={labelStyle}>APIキー（NOVELAI_API_KEY）</span>
                <div style={{ fontSize: 'var(--fs-body)' }}>
                  {systemInfo.apiKey ? `設定済み（${systemInfo.apiKey}）` : '未設定'}
                </div>
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--text-secondary)' }}>読み込み中...</div>
          )}
        </div>

        {/* §4.4 台詞表示 */}
        {captionStyle && (
          <div style={sectionStyle}>
            <h3 style={{ fontSize: 'var(--fs-title)', marginBottom: '12px' }}>台詞表示</h3>

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>既定表示モード</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[['margin', '余白'], ['overlay', '画像内']].map(([v, l]) => (
                  <button key={v} onClick={() => setCaptionStyle(prev => ({ ...prev, mode: v }))} style={{
                    padding: '6px 14px', borderRadius: 'var(--radius-s)', border: '1px solid var(--line)',
                    background: captionStyle.mode === v ? 'var(--accent)' : 'var(--surface)',
                    color: captionStyle.mode === v ? 'var(--accent-contrast)' : 'var(--text-primary)',
                    cursor: 'pointer', fontSize: 'var(--fs-label)',
                  }}>{l}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>既定フォントサイズ</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[['small', '小 (14px)'], ['medium', '中 (20px)'], ['large', '大 (28px)']].map(([v, l]) => (
                  <button key={v} onClick={() => setCaptionStyle(prev => ({ ...prev, fontSize: v }))} style={{
                    padding: '6px 10px', borderRadius: 'var(--radius-s)', border: '1px solid var(--line)',
                    background: captionStyle.fontSize === v ? 'var(--accent)' : 'var(--surface)',
                    color: captionStyle.fontSize === v ? 'var(--accent-contrast)' : 'var(--text-primary)',
                    cursor: 'pointer', fontSize: 'var(--fs-label)',
                  }}>{l}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>既定文字色</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                {['#ffffff', '#000000', '#ff69b4'].map(c => (
                  <button key={c} onClick={() => setCaptionStyle(prev => ({ ...prev, color: c }))} style={{
                    width: '28px', height: '28px', borderRadius: '50%', background: c, cursor: 'pointer',
                    border: captionStyle.color === c ? '3px solid var(--accent)' : '1px solid var(--line)',
                    padding: 0, flexShrink: 0,
                  }} />
                ))}
                <input type="color" value={captionStyle.color || '#ffffff'} onChange={e => setCaptionStyle(prev => ({ ...prev, color: e.target.value }))} style={{ width: '36px', height: '28px', padding: '1px', borderRadius: 'var(--radius-s)', border: '1px solid var(--line)', cursor: 'pointer', background: 'none', flexShrink: 0 }} />
                <span style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)' }}>{captionStyle.color}</span>
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={captionStyle.outline !== false} onChange={e => setCaptionStyle(prev => ({ ...prev, outline: e.target.checked }))} />
              <span style={{ fontSize: 'var(--fs-label)', color: 'var(--text-primary)' }}>縁取りあり（既定）</span>
            </label>
          </div>
        )}

        {/* §4.5 保存ボタン */}
        <button
          onClick={handleSave}
          disabled={!gen || !guard}
          style={{
            width: '100%',
            padding: '14px',
            background: 'var(--accent)',
            color: 'var(--accent-contrast)',
            border: 'none',
            borderRadius: 'var(--radius-m)',
            fontSize: 'var(--fs-body)',
            fontWeight: 600,
            cursor: 'pointer',
            marginBottom: '12px',
            minHeight: '44px',
            opacity: (!gen || !guard) ? 0.5 : 1,
          }}
        >保存</button>

        {/* §4.6 デバッグ */}
        <div style={sectionStyle}>
          <button
            onClick={() => setDebugOpen(!debugOpen)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text)',
              fontSize: 'var(--fs-body)',
              padding: '4px 0',
              width: '100%',
              textAlign: 'left',
            }}
          >{debugOpen ? '▼' : '▶'} デバッグ</button>

          {debugOpen && (
            <div style={{ marginTop: '12px' }}>
              <div style={{ marginBottom: '12px', fontSize: 'var(--fs-label)', color: 'var(--text-secondary)' }}>
                バージョン: {version || '取得中...'}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                <button onClick={handleClearSW} style={debugBtnStyle}>
                  SWキャッシュクリア＋リロード
                </button>
                <button onClick={handleReset} style={{ ...debugBtnStyle, background: '#c0392b', color: '#fff' }}>
                  全データリセット
                </button>
                <button onClick={handleTestApi} style={debugBtnStyle}>
                  NovelAI疎通テスト
                </button>
                <button onClick={handleTestFs} style={debugBtnStyle}>
                  FS書込テスト
                </button>
              </div>

              <div>
                <h4 style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  直近エラー一覧
                </h4>
                {errors.length === 0 ? (
                  <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)' }}>
                    エラーはありません
                  </div>
                ) : (
                  errors.map((e, i) => (
                    <div key={i} style={{
                      background: 'var(--bg)',
                      padding: '8px',
                      borderRadius: 'var(--radius-s)',
                      marginBottom: '6px',
                      fontSize: 'var(--fs-label)',
                    }}>
                      <div style={{ color: 'var(--text-secondary)' }}>{e.ts}</div>
                      <div><strong>[{e.code}]</strong> {e.message}</div>
                      {e.detail && <div style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>{e.detail}</div>}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const debugBtnStyle = {
  padding: '10px',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-s)',
  background: 'var(--bg)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 'var(--fs-label)',
  minHeight: '44px',
};
