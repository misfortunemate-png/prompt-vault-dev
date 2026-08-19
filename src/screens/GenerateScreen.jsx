import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

const MODELS = [
  { value: 'nai-diffusion-4-5-full', label: 'V4.5 Full' },
  { value: 'nai-diffusion-4-5-curated', label: 'V4.5 Curated' },
  { value: 'nai-diffusion-4-full', label: 'V4 Full' },
  { value: 'nai-diffusion-3', label: 'V3' },
];

const RESOLUTIONS = [
  { value: 'portrait', label: 'Portrait (832×1216)', width: 832, height: 1216 },
  { value: 'landscape', label: 'Landscape (1216×832)', width: 1216, height: 832 },
  { value: 'square', label: 'Square (1024×1024)', width: 1024, height: 1024 },
];

const SAMPLERS = ['k_euler_ancestral', 'k_euler', 'k_dpmpp_2m_sde'];

const NONE = '（なし）';

const labelStyle = {
  display: 'block',
  fontSize: 'var(--fs-label)',
  color: 'var(--text-secondary)',
  marginBottom: '4px',
};

const selectStyle = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-s)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 'var(--fs-body)',
};

const inputStyle = {
  ...selectStyle,
};

const sectionStyle = {
  background: 'var(--surface)',
  borderRadius: 'var(--radius-m)',
  padding: '12px 14px',
  marginBottom: '10px',
};

const collapseHeaderStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text)',
  fontSize: 'var(--fs-body)',
  padding: '0',
  width: '100%',
  textAlign: 'left',
};

function SelectField({ label, value, options, onChange }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} style={selectStyle}>
        {options.map(o => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

function ParamSelect({ label, value, options, onChange }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} style={selectStyle}>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function ParamNumber({ label, value, min, max, step, onChange }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step || 1}
        onChange={e => onChange(Number(e.target.value))}
        style={inputStyle}
      />
    </div>
  );
}

function ParamText({ label, value, placeholder, onChange }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="number"
        value={value}
        placeholder={placeholder}
        min={0}
        onChange={e => onChange(e.target.value)}
        style={inputStyle}
      />
    </div>
  );
}

function ResultCard({ item, onSave }) {
  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 'var(--radius-m)',
      padding: '12px',
      marginBottom: '10px',
      display: 'flex',
      gap: '12px',
      alignItems: 'flex-start',
    }}>
      <img
        src={`/api/images/.tmp/${item.filename}`}
        alt=""
        style={{
          width: 72,
          height: 72,
          objectFit: 'cover',
          borderRadius: 'var(--radius-s)',
          flexShrink: 0,
          background: 'var(--line)',
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', marginBottom: '2px' }}>
          {item.width}×{item.height} • seed: {item.seed}
        </div>
        <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[item.character, item.outfit].filter(v => v && v !== NONE).join(' / ') || '（選択なし）'}
        </div>
        <button
          onClick={onSave}
          disabled={item.saved}
          style={{
            padding: '6px 14px',
            background: item.saved ? 'transparent' : 'var(--accent)',
            color: item.saved ? 'var(--text-secondary)' : 'var(--accent-contrast)',
            border: item.saved ? '1px solid var(--line)' : 'none',
            borderRadius: 'var(--radius-s)',
            fontSize: 'var(--fs-label)',
            cursor: item.saved ? 'default' : 'pointer',
            minHeight: '32px',
          }}
        >
          {item.saved ? '✓ 保存済み' : '保存'}
        </button>
      </div>
    </div>
  );
}

export default function GenerateScreen({ addToast }) {
  const [presetData, setPresetData] = useState(null);
  const [vaultReady, setVaultReady] = useState(false);
  const [loading, setLoading] = useState(true);

  const [presetIdx, setPresetIdx] = useState(0);
  const [character, setCharacter] = useState(NONE);
  const [situation, setSituation] = useState(NONE);
  const [outfit, setOutfit] = useState(NONE);
  const [extra, setExtra] = useState(NONE);

  const [editedPrompt, setEditedPrompt] = useState('');
  const [editedNegative, setEditedNegative] = useState('');
  const [showPromptEdit, setShowPromptEdit] = useState(false);
  const [showParams, setShowParams] = useState(false);

  const [model, setModel] = useState('nai-diffusion-4-5-full');
  const [resolution, setResolution] = useState('portrait');
  const [steps, setSteps] = useState(28);
  const [scale, setScale] = useState(5);
  const [sampler, setSampler] = useState('k_euler_ancestral');
  const [seed, setSeed] = useState('');

  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState([]);

  const computePrompt = useCallback(() => {
    if (!presetData || !presetData.presets.length) return '';
    const preset = presetData.presets[presetIdx] || presetData.presets[0];
    const parts = [preset.positive];
    if (character !== NONE) parts.push(character);
    if (situation !== NONE) parts.push(situation);
    if (outfit !== NONE) parts.push(outfit);
    if (extra !== NONE) parts.push(extra);
    return parts.join(', ');
  }, [presetData, presetIdx, character, situation, outfit, extra]);

  useEffect(() => {
    if (!presetData) return;
    setEditedPrompt(computePrompt());
    const preset = presetData.presets[presetIdx] || presetData.presets[0];
    if (preset) setEditedNegative(preset.negative || '');
  }, [computePrompt, presetData, presetIdx]);

  useEffect(() => {
    async function loadData() {
      try {
        const [info, settings] = await Promise.all([
          api.getSystemInfo(),
          api.getSettings(),
        ]);
        const ready = !!info.vaultRoot;
        setVaultReady(ready);
        if (settings.generation?.model) setModel(settings.generation.model);

        if (ready) {
          const presets = await api.getPresets();
          setPresetData(presets);
        }
      } catch {
        addToast('error', 'データの読み込みに失敗しました');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [addToast]);

  const resolveSecondPreset = () => {
    if (outfit !== NONE) return outfit;
    if (situation !== NONE) return situation;
    if (extra !== NONE) return extra;
    return NONE;
  };

  const handleGenerate = async () => {
    if (steps > 28) {
      if (!confirm('ステップ数が28を超えています。Anlasが消費されます。続行しますか？')) return;
    }

    setGenerating(true);
    const res = RESOLUTIONS.find(r => r.value === resolution) || RESOLUTIONS[0];
    const currentCharacter = character;
    const currentOutfit = resolveSecondPreset();

    try {
      const result = await api.generate({
        prompt: editedPrompt,
        negative_prompt: editedNegative,
        model,
        width: res.width,
        height: res.height,
        steps,
        scale,
        sampler,
        seed: seed !== '' ? parseInt(seed, 10) : null,
        save_meta: { character: currentCharacter, outfit: currentOutfit },
      });

      setResults(prev => [{
        ...result.image,
        character: currentCharacter,
        outfit: currentOutfit,
        saved: false,
      }, ...prev]);
    } catch (e) {
      addToast('error', '生成に失敗しました: ' + (e.message || ''));
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async (idx) => {
    const item = results[idx];
    try {
      await api.saveImage({
        filename: item.filename,
        character: item.character,
        outfit: item.outfit,
      });
      setResults(prev => prev.map((r, i) => i === idx ? { ...r, saved: true } : r));
    } catch (e) {
      addToast('error', '保存に失敗しました: ' + (e.message || ''));
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100dvh - 48px - 54px)', color: 'var(--text-secondary)', fontSize: 'var(--fs-body)' }}>
        読み込み中...
      </div>
    );
  }

  return (
    <div style={{ overflowY: 'auto', height: 'calc(100dvh - 48px - 54px)', padding: '12px 16px 24px' }}>

      {!vaultReady && (
        <div style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius-m)',
          padding: '16px',
          marginBottom: '10px',
          color: 'var(--text-secondary)',
          fontSize: 'var(--fs-body)',
          textAlign: 'center',
        }}>
          設定画面でVAULT_ROOTを確認してください
        </div>
      )}

      {/* 1. プリセット選択 */}
      <div style={sectionStyle}>
        <label style={labelStyle}>プリセット</label>
        <select
          value={presetIdx}
          onChange={e => setPresetIdx(Number(e.target.value))}
          style={selectStyle}
          disabled={!presetData}
        >
          {presetData ? presetData.presets.map((p, i) => (
            <option key={i} value={i}>{p.name}</option>
          )) : <option>読み込み中...</option>}
        </select>
      </div>

      {/* 2. 個別プルダウン群 */}
      {presetData && (
        <div style={{ ...sectionStyle, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <SelectField
            label="キャラ"
            value={character}
            options={[NONE, ...presetData.characters]}
            onChange={setCharacter}
          />
          <SelectField
            label="シチュ"
            value={situation}
            options={[NONE, ...presetData.situations]}
            onChange={setSituation}
          />
          <SelectField
            label="衣装"
            value={outfit}
            options={[NONE, ...presetData.outfits]}
            onChange={setOutfit}
          />
          <SelectField
            label="その他"
            value={extra}
            options={[NONE, ...presetData.extras]}
            onChange={setExtra}
          />
        </div>
      )}

      {/* 3. プロンプト確認・編集 */}
      <div style={sectionStyle}>
        <button onClick={() => setShowPromptEdit(!showPromptEdit)} style={collapseHeaderStyle}>
          {showPromptEdit ? '▼' : '▶'} プロンプト確認・編集
        </button>
        {showPromptEdit && (
          <div style={{ marginTop: '12px' }}>
            <label style={labelStyle}>正プロンプト</label>
            <textarea
              value={editedPrompt}
              onChange={e => setEditedPrompt(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
            />
            <label style={{ ...labelStyle, marginTop: '10px' }}>ネガティブ</label>
            <textarea
              value={editedNegative}
              onChange={e => setEditedNegative(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>
        )}
      </div>

      {/* 4. パラメータ */}
      <div style={sectionStyle}>
        <button onClick={() => setShowParams(!showParams)} style={collapseHeaderStyle}>
          {showParams ? '▼' : '▶'} パラメータ
        </button>
        {showParams && (
          <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <ParamSelect
              label="モデル"
              value={model}
              options={MODELS}
              onChange={setModel}
            />
            <ParamSelect
              label="解像度"
              value={resolution}
              options={RESOLUTIONS.map(r => ({ value: r.value, label: r.label }))}
              onChange={setResolution}
            />
            <ParamNumber
              label="ステップ"
              value={steps}
              min={1}
              max={50}
              onChange={setSteps}
            />
            <ParamNumber
              label="ガイダンス"
              value={scale}
              min={1}
              max={10}
              step={0.1}
              onChange={setScale}
            />
            <ParamSelect
              label="サンプラー"
              value={sampler}
              options={SAMPLERS.map(s => ({ value: s, label: s }))}
              onChange={setSampler}
            />
            <ParamText
              label="シード（空=ランダム）"
              value={seed}
              placeholder="空=ランダム"
              onChange={setSeed}
            />
          </div>
        )}
      </div>

      {/* 5. 生成ボタン */}
      <button
        onClick={handleGenerate}
        disabled={!vaultReady || generating || !presetData}
        style={{
          width: '100%',
          padding: '14px',
          background: 'var(--accent)',
          color: 'var(--accent-contrast)',
          border: 'none',
          borderRadius: 'var(--radius-m)',
          fontSize: 'var(--fs-body)',
          fontWeight: 600,
          cursor: (!vaultReady || generating || !presetData) ? 'not-allowed' : 'pointer',
          marginBottom: '16px',
          minHeight: '48px',
          opacity: (!vaultReady || generating || !presetData) ? 0.5 : 1,
        }}
      >
        {generating ? '生成中…' : '生成'}
      </button>

      {/* 6. 生成結果一覧 */}
      {results.map((item, idx) => (
        <ResultCard
          key={`${item.filename}-${idx}`}
          item={item}
          onSave={() => handleSave(idx)}
        />
      ))}
    </div>
  );
}
