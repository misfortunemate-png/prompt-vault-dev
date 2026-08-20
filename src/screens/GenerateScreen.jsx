import { useState, useEffect, useCallback } from 'react';
import TagSuggest from '../components/TagSuggest';
import { api } from '../lib/api';

const MODELS = [
  { value: 'nai-diffusion-4-5-full',     label: 'V4.5 Full' },
  { value: 'nai-diffusion-4-5-curated',  label: 'V4.5 Curated' },
  { value: 'nai-diffusion-4-full',       label: 'V4 Full' },
  { value: 'nai-diffusion-3',            label: 'V3' },
];

const RESOLUTIONS = [
  { value: 'portrait',  label: 'Portrait (832×1216)',  width: 832,  height: 1216 },
  { value: 'landscape', label: 'Landscape (1216×832)', width: 1216, height: 832  },
  { value: 'square',    label: 'Square (1024×1024)',   width: 1024, height: 1024 },
];

const SAMPLERS = ['k_euler_ancestral', 'k_euler', 'k_dpmpp_2m_sde'];

const fieldStyle = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-s)',
  background: 'var(--bg)',
  color: 'var(--text-primary)',
  fontSize: 'var(--fs-body)',
  boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block',
  fontSize: 'var(--fs-label)',
  color: 'var(--text-secondary)',
  marginBottom: '4px',
};

const sectionStyle = {
  background: 'var(--surface)',
  borderRadius: 'var(--radius-m)',
  padding: '12px 14px',
  marginBottom: '10px',
};

const arrowBtnStyle = {
  background: 'none',
  border: '1px solid var(--line)',
  borderRadius: '3px',
  cursor: 'pointer',
  color: 'var(--text-secondary)',
  fontSize: '10px',
  padding: '0 4px',
  lineHeight: '14px',
  flexShrink: 0,
};

const STATUS_ICONS = { pending: '⏳', running: '🔄', done: '✅', error: '❌', skipped: '⏭' };

function ResultCard({ item, onSave, onPreview }) {
  const label = item.filenameSegments?.filter(Boolean).join(' / ') || '（選択なし）';
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
        onClick={onPreview}
        style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 'var(--radius-s)', flexShrink: 0, background: 'var(--line)', cursor: 'zoom-in' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', marginBottom: '2px' }}>
          {item.width}×{item.height} • seed: {item.seed}
        </div>
        <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
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
        >{item.saved ? '✓ 保存済み' : '保存'}</button>
      </div>
    </div>
  );
}

export default function GenerateScreen({ addToast, results, setResults, maxResults }) {
  const [cardsData, setCardsData] = useState(null);
  const [presetsData, setPresetsData] = useState(null);
  const [vaultReady, setVaultReady] = useState(false);
  const [loading, setLoading] = useState(true);

  const [selectedPresetId, setSelectedPresetId] = useState(null);
  const [selectedCardMap, setSelectedCardMap] = useState({});

  const [editedPositive, setEditedPositive] = useState('');
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

  const [queueData, setQueueData] = useState({ state: 'idle', tasks: [], currentIndex: null, startedAt: null });
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [showCartesian, setShowCartesian] = useState(false);
  const [cartesianMode, setCartesianMode] = useState({});
  const [tick, setTick] = useState(0);

  const [inlineSlotId, setInlineSlotId] = useState(null);
  const [inlinePos, setInlinePos] = useState('');
  const [inlineNeg, setInlineNeg] = useState('');
  const [inlineSaving, setInlineSaving] = useState(false);
  const [previewItem, setPreviewItem] = useState(null);

  const sortedSlots = cardsData ? [...cardsData.slots].sort((a, b) => a.order - b.order) : [];

  // ── Prompt computation ──

  const computePositive = useCallback((cardMap, data) => {
    if (!data) return '';
    return [...data.slots].sort((a, b) => a.order - b.order)
      .map(s => { const id = cardMap[s.id]; return id ? data.cards.find(c => c.id === id)?.positive || '' : ''; })
      .filter(Boolean).join(', ');
  }, []);

  const computeNegative = useCallback((cardMap, data) => {
    if (!data) return '';
    return [...data.slots].sort((a, b) => a.order - b.order)
      .map(s => { const id = cardMap[s.id]; return id ? data.cards.find(c => c.id === id)?.negative || '' : ''; })
      .filter(Boolean).join(', ');
  }, []);

  useEffect(() => {
    if (cardsData) {
      setEditedPositive(computePositive(selectedCardMap, cardsData));
      setEditedNegative(computeNegative(selectedCardMap, cardsData));
    }
  }, [selectedCardMap, cardsData, computePositive, computeNegative]);

  // ── Data loading ──

  const refreshCardsData = useCallback(async () => {
    try {
      const cd = await api.getCards();
      setCardsData(cd);
    } catch (e) {
      addToast('error', e.message);
    }
  }, [addToast]);

  useEffect(() => {
    async function loadData() {
      try {
        const [info, settings] = await Promise.all([api.getSystemInfo(), api.getSettings()]);
        if (settings.generation?.model) setModel(settings.generation.model);
        const ready = !!info.vaultRoot;
        setVaultReady(ready);
        if (ready) {
          const [cd, pd] = await Promise.all([api.getCards(), api.getPresets()]);
          setCardsData(cd);
          setPresetsData(pd);
        } else {
          const cd = await api.getCards();
          setCardsData(cd);
        }
      } catch {
        addToast('error', 'データの読み込みに失敗しました');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [addToast]);

  useEffect(() => {
    if (queueData.state !== 'running') return;
    const id = setInterval(async () => {
      try { const d = await api.getQueue(); setQueueData(d); } catch {}
    }, 2000);
    return () => clearInterval(id);
  }, [queueData.state]);

  useEffect(() => {
    if (queueData.state !== 'running') return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [queueData.state]);

  // ── Preset selection ──

  const handlePresetSelect = (presetId) => {
    setSelectedPresetId(presetId);
    if (!presetId) { setSelectedCardMap({}); return; }
    const preset = presetsData?.presets.find(p => p.id === presetId);
    if (preset) setSelectedCardMap({ ...preset.cards });
  };

  const handleSlotChange = (slotId, cardId) => {
    setSelectedPresetId(null);
    setSelectedCardMap(prev => ({ ...prev, [slotId]: cardId || null }));
    if (inlineSlotId === slotId) setInlineSlotId(null);
  };

  // ── Slot management ──

  const handleMoveSlot = async (idx, direction) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= sortedSlots.length) return;
    const updatedData = JSON.parse(JSON.stringify(cardsData));
    const slotA = updatedData.slots.find(s => s.id === sortedSlots[idx].id);
    const slotB = updatedData.slots.find(s => s.id === sortedSlots[targetIdx].id);
    const tmp = slotA.order;
    slotA.order = slotB.order;
    slotB.order = tmp;
    try {
      await api.putCards(updatedData);
      await refreshCardsData();
    } catch (e) {
      addToast('error', e.message);
    }
  };

  const handleToggleSlotProp = async (slot, prop) => {
    try {
      await api.updateSlot(slot.id, { [prop]: !slot[prop] });
      await refreshCardsData();
    } catch (e) {
      addToast('error', e.message);
    }
  };

  const handleDeleteSlot = async (slot) => {
    const cardCount = (cardsData?.cards || []).filter(c => c.slotId === slot.id).length;
    const msg = cardCount > 0
      ? `「${slot.name}」とその ${cardCount} 枚のカードを削除しますか？`
      : `「${slot.name}」を削除しますか？`;
    if (!window.confirm(msg)) return;
    try {
      await api.deleteSlot(slot.id);
      setSelectedCardMap(prev => { const next = { ...prev }; delete next[slot.id]; return next; });
      if (inlineSlotId === slot.id) setInlineSlotId(null);
      addToast('success', 'スロットを削除しました');
      await refreshCardsData();
    } catch (e) {
      addToast('error', e.message);
    }
  };

  const handleAddSlot = async () => {
    const nameVal = window.prompt('スロット名を入力してください:');
    if (!nameVal?.trim()) return;
    try {
      await api.addSlot({ name: nameVal.trim() });
      addToast('success', 'スロットを追加しました');
      await refreshCardsData();
    } catch (e) {
      addToast('error', e.message);
    }
  };

  // ── Inline card editing ──

  const openInlineEdit = (slot) => {
    if (inlineSlotId === slot.id) { setInlineSlotId(null); return; }
    const cardId = selectedCardMap[slot.id];
    const card = cardId ? cardsData?.cards.find(c => c.id === cardId) : null;
    setInlinePos(card?.positive || '');
    setInlineNeg(card?.negative || '');
    setInlineSlotId(slot.id);
  };

  const handleInlineOverwrite = async () => {
    const cardId = selectedCardMap[inlineSlotId];
    if (!cardId) return;
    setInlineSaving(true);
    try {
      await api.updateCard(cardId, { positive: inlinePos, negative: inlineNeg });
      await refreshCardsData();
      addToast('success', 'カードを上書き保存しました');
      setInlineSlotId(null);
    } catch (e) {
      addToast('error', e.message);
    } finally {
      setInlineSaving(false);
    }
  };

  const handleInlineSaveAsNew = async () => {
    const slotId = inlineSlotId;
    if (!slotId) return;
    const nameVal = window.prompt('新しいカード名を入力してください:');
    if (!nameVal?.trim()) return;
    setInlineSaving(true);
    try {
      const newCard = await api.addCard({ slotId, name: nameVal.trim(), positive: inlinePos, negative: inlineNeg });
      await refreshCardsData();
      setSelectedCardMap(prev => ({ ...prev, [slotId]: newCard.id }));
      addToast('success', '新しいカードを作成しました');
      setInlineSlotId(null);
    } catch (e) {
      addToast('error', e.message);
    } finally {
      setInlineSaving(false);
    }
  };

  // ── Queue ──

  const buildSingleTask = () => {
    const res = RESOLUTIONS.find(r => r.value === resolution) || RESOLUTIONS[0];
    const folderSegments = sortedSlots.filter(s => s.useAsFolder).map(s => {
      const id = selectedCardMap[s.id];
      return id ? cardsData?.cards.find(c => c.id === id)?.name : null;
    }).filter(Boolean);
    const filenameSegments = sortedSlots.filter(s => s.useInFilename).map(s => {
      const id = selectedCardMap[s.id];
      return id ? cardsData?.cards.find(c => c.id === id)?.name : null;
    }).filter(Boolean);
    const label = sortedSlots.map(s => {
      const id = selectedCardMap[s.id];
      return id ? cardsData?.cards.find(c => c.id === id)?.name : null;
    }).filter(Boolean).join(' × ') || '（選択なし）';
    return {
      positive: editedPositive,
      negative: editedNegative,
      params: { model, width: res.width, height: res.height, steps, scale, sampler, seed: seed !== '' ? parseInt(seed, 10) : null },
      folderSegments,
      filenameSegments,
      preset_id: selectedPresetId || null,
      label,
    };
  };

  const handleAddToQueue = async () => {
    if (!vaultReady) { addToast('error', 'VAULT_ROOTが未設定です'); return; }
    const task = buildSingleTask();
    try {
      const r = await api.queueAdd([task]);
      const d = await api.getQueue();
      setQueueData(d);
      setQueueExpanded(true);
      addToast('success', `キューに追加（${r.total}件）`);
    } catch (e) { addToast('error', e.message); }
  };

  const buildCartesianTasks = () => {
    const res = RESOLUTIONS.find(r => r.value === resolution) || RESOLUTIONS[0];
    const params = { model, width: res.width, height: res.height, steps, scale, sampler, seed: seed !== '' ? parseInt(seed, 10) : null };
    const slotOptions = sortedSlots.map(slot => {
      const mode = cartesianMode[slot.id] ?? 'fixed';
      if (mode === 'expand') {
        const cards = (cardsData?.cards || []).filter(c => c.slotId === slot.id);
        return { slot, options: cards.length > 0 ? cards : [null] };
      }
      const cardId = selectedCardMap[slot.id];
      const card = cardId ? cardsData?.cards.find(c => c.id === cardId) : null;
      return { slot, options: [card] };
    });
    let combos = [{}];
    for (const { slot, options } of slotOptions) {
      combos = combos.flatMap(combo => options.map(card => ({ ...combo, [slot.id]: card })));
    }
    return combos.map(combo => {
      const folderSegments = sortedSlots.filter(s => s.useAsFolder).map(s => combo[s.id]?.name).filter(Boolean);
      const filenameSegments = sortedSlots.filter(s => s.useInFilename).map(s => combo[s.id]?.name).filter(Boolean);
      const label = sortedSlots.map(s => combo[s.id]?.name).filter(Boolean).join(' × ') || '（選択なし）';
      const positive = sortedSlots.map(s => combo[s.id]?.positive || '').filter(Boolean).join(', ');
      const negative = sortedSlots.map(s => combo[s.id]?.negative || '').filter(Boolean).join(', ');
      return { positive, negative, params, folderSegments, filenameSegments, preset_id: selectedPresetId || null, label };
    });
  };

  const handleAddCartesian = async () => {
    if (!vaultReady) { addToast('error', 'VAULT_ROOTが未設定です'); return; }
    const tasks = buildCartesianTasks();
    if (tasks.length === 0) { addToast('error', '展開するタスクがありません'); return; }
    try {
      const r = await api.queueAdd(tasks);
      const d = await api.getQueue();
      setQueueData(d);
      setQueueExpanded(true);
      setShowCartesian(false);
      addToast('success', `${r.added}件をキューに追加（計${r.total}件）`);
    } catch (e) { addToast('error', e.message); }
  };

  const handleQueueStart = async () => {
    try { await api.queueStart(); setQueueData(await api.getQueue()); } catch (e) { addToast('error', e.message); }
  };

  const handleQueueStop = async () => {
    try { await api.queueStop(); setQueueData(await api.getQueue()); } catch (e) { addToast('error', e.message); }
  };

  const handleQueueClear = async () => {
    if (!window.confirm(`キューを全クリアしますか？（${queueData.tasks.length}件）`)) return;
    try {
      await api.queueClear();
      setQueueData({ state: 'idle', tasks: [], currentIndex: null, startedAt: null });
    } catch (e) { addToast('error', e.message); }
  };

  const handleRemoveTask = async (id) => {
    try { await api.queueRemoveTask(id); setQueueData(await api.getQueue()); } catch (e) { addToast('error', e.message); }
  };

  // ── Generation / Save ──

  const handleGenerate = async () => {
    if (steps > 28 && !window.confirm('ステップ数が28を超えています。Anlasが消費されます。続行しますか？')) return;
    setGenerating(true);
    const res = RESOLUTIONS.find(r => r.value === resolution) || RESOLUTIONS[0];

    const folderSegments = sortedSlots
      .filter(s => s.useAsFolder)
      .map(s => { const id = selectedCardMap[s.id]; return id ? cardsData.cards.find(c => c.id === id)?.name : null; })
      .filter(Boolean);

    const filenameSegments = sortedSlots
      .filter(s => s.useInFilename)
      .map(s => { const id = selectedCardMap[s.id]; return id ? cardsData.cards.find(c => c.id === id)?.name : null; })
      .filter(Boolean);

    try {
      const result = await api.generate({
        prompt: editedPositive,
        negative_prompt: editedNegative,
        model, width: res.width, height: res.height, steps, scale, sampler,
        seed: seed !== '' ? parseInt(seed, 10) : null,
      });
      setResults(prev => {
        const next = [{ ...result.image, folderSegments, filenameSegments, saved: false }, ...prev];
        return next.length > maxResults ? next.slice(0, maxResults) : next;
      });
    } catch (e) {
      addToast('error', '生成に失敗しました: ' + (e.message || ''));
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async (idx) => {
    const item = results[idx];
    try {
      await api.saveImage({ filename: item.filename, seed: item.seed, folderSegments: item.folderSegments || [], filenameSegments: item.filenameSegments || [] });
      setResults(prev => prev.map((r, i) => i === idx ? { ...r, saved: true } : r));
    } catch (e) {
      addToast('error', '保存に失敗しました: ' + (e.message || ''));
    }
  };

  // ── Render ──

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100dvh - 48px - 54px)', color: 'var(--text-secondary)' }}>
        読み込み中…
      </div>
    );
  }

  return (
    <div style={{ overflowY: 'auto', height: 'calc(100dvh - 48px - 54px)', padding: '12px 16px 24px' }}>

      {!vaultReady && (
        <div style={{ ...sectionStyle, color: 'var(--text-secondary)', textAlign: 'center' }}>
          設定画面でVAULT_ROOTを確認してください
        </div>
      )}

      {/* プリセット選択 */}
      {presetsData && presetsData.presets.length > 0 && (
        <div style={sectionStyle}>
          <label style={labelStyle}>プリセット</label>
          <select value={selectedPresetId || ''} onChange={e => handlePresetSelect(e.target.value || null)} style={fieldStyle}>
            <option value="">（プリセットなし）</option>
            {presetsData.presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      {/* スロット別カード選択 + スロット管理 */}
      {cardsData && (
        <div style={sectionStyle}>
          {sortedSlots.map((slot, idx) => {
            const slotCards = cardsData.cards.filter(c => c.slotId === slot.id);
            const selectedCardId = selectedCardMap[slot.id];
            const isFirst = idx === 0;
            const isLast = idx === sortedSlots.length - 1;

            return (
              <div key={slot.id} style={{ marginBottom: idx < sortedSlots.length - 1 ? '12px' : 0 }}>
                {/* 管理行: ▲▼ / スロット名 / F / N / × */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', flexShrink: 0 }}>
                    <button
                      onClick={() => handleMoveSlot(idx, -1)}
                      disabled={isFirst}
                      style={{ ...arrowBtnStyle, opacity: isFirst ? 0.3 : 1 }}
                    >▲</button>
                    <button
                      onClick={() => handleMoveSlot(idx, 1)}
                      disabled={isLast}
                      style={{ ...arrowBtnStyle, opacity: isLast ? 0.3 : 1 }}
                    >▼</button>
                  </div>

                  <span style={{ flex: 1, fontSize: 'var(--fs-label)', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {slot.name}
                  </span>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none', flexShrink: 0 }}>
                    <input type="checkbox" checked={!!slot.useAsFolder} onChange={() => handleToggleSlotProp(slot, 'useAsFolder')} />
                    F
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none', flexShrink: 0 }}>
                    <input type="checkbox" checked={!!slot.useInFilename} onChange={() => handleToggleSlotProp(slot, 'useInFilename')} />
                    N
                  </label>

                  <button
                    onClick={() => handleDeleteSlot(slot)}
                    title="スロット削除"
                    style={{ background: 'none', border: '1px solid var(--line)', borderRadius: '3px', cursor: 'pointer', color: '#c0392b', fontSize: '14px', padding: '0 6px', lineHeight: '22px', flexShrink: 0 }}
                  >×</button>
                </div>

                {/* カード選択行 */}
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <select
                    value={selectedCardId || ''}
                    onChange={e => handleSlotChange(slot.id, e.target.value || null)}
                    style={{ ...fieldStyle, flex: 1 }}
                  >
                    <option value="">（なし）</option>
                    {slotCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button
                    onClick={() => openInlineEdit(slot)}
                    title="インライン編集"
                    style={{
                      background: 'none',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-s)',
                      cursor: 'pointer',
                      color: inlineSlotId === slot.id ? 'var(--accent)' : 'var(--text-secondary)',
                      fontSize: '18px',
                      padding: '5px 8px',
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                  >✏️</button>
                </div>

                {/* インライン編集エリア */}
                {inlineSlotId === slot.id && (
                  <div style={{ marginTop: '8px', padding: '12px', background: 'var(--bg)', borderRadius: 'var(--radius-s)', border: '1px solid var(--accent)' }}>
                    <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600 }}>
                      {slot.name} — インライン編集
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      <label style={labelStyle}>ポジティブ</label>
                      <TagSuggest value={inlinePos} onChange={setInlinePos} rows={3} style={{ ...fieldStyle, resize: 'vertical' }} />
                    </div>
                    <div style={{ marginBottom: '10px' }}>
                      <label style={labelStyle}>ネガティブ</label>
                      <TagSuggest value={inlineNeg} onChange={setInlineNeg} rows={2} style={{ ...fieldStyle, resize: 'vertical' }} />
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <button
                        onClick={handleInlineOverwrite}
                        disabled={inlineSaving || !selectedCardMap[inlineSlotId]}
                        style={{ padding: '7px 12px', border: 'none', borderRadius: 'var(--radius-s)', background: 'var(--accent)', color: 'var(--accent-contrast)', cursor: 'pointer', fontSize: 'var(--fs-label)', opacity: !selectedCardMap[inlineSlotId] ? 0.5 : 1 }}
                      >上書き保存</button>
                      <button
                        onClick={handleInlineSaveAsNew}
                        disabled={inlineSaving}
                        style={{ padding: '7px 12px', border: '1px solid var(--accent)', borderRadius: 'var(--radius-s)', background: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-label)' }}
                      >新規カードとして保存</button>
                      <button
                        onClick={() => setInlineSlotId(null)}
                        style={{ padding: '7px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius-s)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'var(--fs-label)' }}
                      >キャンセル</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* スロット追加 */}
          <div style={{ marginTop: sortedSlots.length > 0 ? '12px' : 0 }}>
            <button
              onClick={handleAddSlot}
              style={{ width: '100%', padding: '10px', border: '1px dashed var(--line)', borderRadius: 'var(--radius-s)', background: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-label)' }}
            >＋ スロット追加</button>
          </div>
        </div>
      )}

      {/* プロンプト確認・編集 */}
      <div style={sectionStyle}>
        <button onClick={() => setShowPromptEdit(!showPromptEdit)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 'var(--fs-body)', padding: 0, width: '100%', textAlign: 'left' }}>
          {showPromptEdit ? '▼' : '▶'} プロンプト確認・編集
        </button>
        {showPromptEdit && (
          <div style={{ marginTop: '12px' }}>
            <label style={labelStyle}>正プロンプト（一時編集・カードに反映しない）</label>
            <textarea value={editedPositive} onChange={e => setEditedPositive(e.target.value)} rows={3} style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.5 }} />
            <label style={{ ...labelStyle, marginTop: '10px' }}>ネガティブ（一時編集）</label>
            <textarea value={editedNegative} onChange={e => setEditedNegative(e.target.value)} rows={2} style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
        )}
      </div>

      {/* パラメータ */}
      <div style={sectionStyle}>
        <button onClick={() => setShowParams(!showParams)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 'var(--fs-body)', padding: 0, width: '100%', textAlign: 'left' }}>
          {showParams ? '▼' : '▶'} パラメータ
        </button>
        {showParams && (
          <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={labelStyle}>モデル</label>
              <select value={model} onChange={e => setModel(e.target.value)} style={fieldStyle}>
                {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>解像度</label>
              <select value={resolution} onChange={e => setResolution(e.target.value)} style={fieldStyle}>
                {RESOLUTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>ステップ</label>
              <input type="number" value={steps} min={1} max={50} onChange={e => setSteps(Number(e.target.value))} style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>ガイダンス</label>
              <input type="number" value={scale} min={1} max={10} step={0.1} onChange={e => setScale(Number(e.target.value))} style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>サンプラー</label>
              <select value={sampler} onChange={e => setSampler(e.target.value)} style={fieldStyle}>
                {SAMPLERS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>シード（空=ランダム）</label>
              <input type="number" value={seed} min={0} placeholder="空=ランダム" onChange={e => setSeed(e.target.value)} style={fieldStyle} />
            </div>
          </div>
        )}
      </div>

      {/* 生成・キューボタン */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        <button
          onClick={handleGenerate}
          disabled={!vaultReady || generating}
          style={{
            flex: 2, padding: '14px',
            background: 'var(--accent)', color: 'var(--accent-contrast)',
            border: 'none', borderRadius: 'var(--radius-m)',
            fontSize: 'var(--fs-body)', fontWeight: 600,
            cursor: (!vaultReady || generating) ? 'not-allowed' : 'pointer',
            minHeight: '48px',
            opacity: (!vaultReady || generating) ? 0.5 : 1,
          }}
        >{generating ? '生成中…' : '生成'}</button>
        <button
          onClick={handleAddToQueue}
          disabled={!vaultReady}
          style={{
            flex: 1, padding: '14px',
            background: 'none', color: 'var(--accent)',
            border: '1px solid var(--accent)', borderRadius: 'var(--radius-m)',
            fontSize: 'var(--fs-body)', fontWeight: 600,
            cursor: !vaultReady ? 'not-allowed' : 'pointer',
            minHeight: '48px',
            opacity: !vaultReady ? 0.5 : 1,
          }}
        >＋キュー</button>
        <button
          onClick={() => setShowCartesian(true)}
          disabled={!vaultReady}
          style={{
            flex: 1, padding: '14px',
            background: 'none', color: 'var(--accent)',
            border: '1px solid var(--accent)', borderRadius: 'var(--radius-m)',
            fontSize: 'var(--fs-body)', fontWeight: 600,
            cursor: !vaultReady ? 'not-allowed' : 'pointer',
            minHeight: '48px',
            opacity: !vaultReady ? 0.5 : 1,
          }}
        >＋直積</button>
      </div>

      {/* 結果一覧 */}
      {results.map((item, idx) => (
        <ResultCard key={`${item.filename}-${idx}`} item={item} onSave={() => handleSave(idx)} onPreview={() => setPreviewItem(item)} />
      ))}

      {/* キューパネル */}
      {(() => {
        const pendingCount = queueData.tasks.filter(t => t.status === 'pending').length;
        const doneCount = queueData.tasks.filter(t => t.status === 'done').length;
        const elapsedSec = queueData.startedAt ? (Math.floor((Date.now() - new Date(queueData.startedAt).getTime()) / 1000) + tick * 0) : 0;
        const realElapsed = queueData.startedAt ? Math.floor((Date.now() - new Date(queueData.startedAt).getTime()) / 1000) : 0;
        const avgSec = doneCount > 0 ? realElapsed / doneCount : null;
        const activeCount = queueData.tasks.filter(t => t.status === 'pending' || t.status === 'running').length;
        const etaSec = avgSec !== null ? Math.floor(avgSec * activeCount) : null;
        const fmtTime = s => s >= 60 ? `${Math.floor(s / 60)}分${s % 60}秒` : `${s}秒`;
        const progressPct = queueData.tasks.length > 0 ? Math.round(doneCount / queueData.tasks.length * 100) : 0;

        return (
          <div style={{ ...sectionStyle, marginTop: '10px' }}>
            <div
              onClick={() => setQueueExpanded(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
            >
              <span style={{ flex: 1, fontWeight: 600, color: 'var(--text-primary)', fontSize: 'var(--fs-body)' }}>
                {queueExpanded ? '▼' : '▶'} キュー（{queueData.tasks.length}件）
              </span>
              {queueData.state === 'running' && (
                <div style={{ width: 80, height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${progressPct}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.3s' }} />
                </div>
              )}
              <span style={{ fontSize: 'var(--fs-label)', color: queueData.state === 'running' ? 'var(--accent)' : 'var(--text-secondary)' }}>
                {queueData.state === 'running' ? '実行中' : queueData.state === 'paused' ? '中断' : ''}
              </span>
            </div>

            {queueExpanded && (
              <>
                {queueData.tasks.length === 0 ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-label)', textAlign: 'center', padding: '12px 0', marginTop: '8px' }}>
                    タスクなし
                  </div>
                ) : (
                  <div style={{ maxHeight: '200px', overflowY: 'auto', marginTop: '8px', borderTop: '1px solid var(--line)' }}>
                    {queueData.tasks.map(task => (
                      <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
                        <span style={{ fontSize: '14px', flexShrink: 0 }}>{STATUS_ICONS[task.status] || '?'}</span>
                        <span style={{ flex: 1, fontSize: 'var(--fs-label)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: task.status === 'error' ? '#c0392b' : 'var(--text-primary)' }}>
                          {task.label}
                        </span>
                        {task.status === 'pending' && (
                          <button onClick={() => handleRemoveTask(task.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '14px', padding: '0 4px', flexShrink: 0 }}>×</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {queueData.state === 'running' && (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-label)', marginTop: '8px', lineHeight: 1.6 }}>
                    <div>実行中: {queueData.currentIndex !== null ? queueData.tasks[queueData.currentIndex]?.label : ''}</div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <span>経過: {fmtTime(realElapsed)}</span>
                      {etaSec !== null && <span>残り推定: {fmtTime(etaSec)}</span>}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                  {queueData.state !== 'running' && (
                    <button
                      onClick={handleQueueStart}
                      disabled={pendingCount === 0}
                      style={{ padding: '7px 14px', border: 'none', borderRadius: 'var(--radius-s)', background: pendingCount === 0 ? 'var(--line)' : 'var(--accent)', color: pendingCount === 0 ? 'var(--text-secondary)' : 'var(--accent-contrast)', cursor: pendingCount === 0 ? 'default' : 'pointer', fontSize: 'var(--fs-label)' }}
                    >▶ 実行</button>
                  )}
                  {queueData.state === 'running' && (
                    <button
                      onClick={handleQueueStop}
                      style={{ padding: '7px 14px', border: 'none', borderRadius: 'var(--radius-s)', background: '#e67e22', color: '#fff', cursor: 'pointer', fontSize: 'var(--fs-label)' }}
                    >⏸ 中断</button>
                  )}
                  {queueData.state !== 'running' && (
                    <button
                      onClick={handleQueueClear}
                      disabled={queueData.tasks.length === 0}
                      style={{ padding: '7px 14px', border: '1px solid var(--line)', borderRadius: 'var(--radius-s)', background: 'none', color: queueData.tasks.length === 0 ? 'var(--text-secondary)' : '#c0392b', cursor: queueData.tasks.length === 0 ? 'default' : 'pointer', fontSize: 'var(--fs-label)' }}
                    >🗑 クリア</button>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* 直積ダイアログ */}
      {showCartesian && cardsData && (
        <div
          onClick={() => setShowCartesian(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--surface)', borderRadius: 'var(--radius-m) var(--radius-m) 0 0', width: '100%', maxWidth: 540, maxHeight: '80vh', overflowY: 'auto', padding: '20px 16px 24px' }}
          >
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-body)', color: 'var(--text-primary)', marginBottom: '16px' }}>＋直積バッチ</div>
            {sortedSlots.map(slot => {
              const mode = cartesianMode[slot.id] ?? 'fixed';
              const slotCards = (cardsData?.cards || []).filter(c => c.slotId === slot.id);
              const selectedCard = selectedCardMap[slot.id] ? cardsData.cards.find(c => c.id === selectedCardMap[slot.id]) : null;
              return (
                <div key={slot.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', padding: '8px 10px', background: 'var(--bg)', borderRadius: 'var(--radius-s)', border: `1px solid ${mode === 'expand' ? 'var(--accent)' : 'var(--line)'}` }}>
                  <span style={{ flex: 1, fontSize: 'var(--fs-label)', fontWeight: 600, color: 'var(--text-primary)' }}>{slot.name}</span>
                  <span style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {mode === 'fixed' ? (selectedCard?.name || '（なし）') : `${slotCards.length}枚展開`}
                  </span>
                  <button
                    onClick={() => setCartesianMode(m => ({ ...m, [slot.id]: mode === 'fixed' ? 'expand' : 'fixed' }))}
                    disabled={mode === 'expand' && slotCards.length === 0}
                    style={{ padding: '4px 10px', border: '1px solid var(--accent)', borderRadius: 'var(--radius-s)', background: mode === 'expand' ? 'var(--accent)' : 'none', color: mode === 'expand' ? 'var(--accent-contrast)' : 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-label)', flexShrink: 0 }}
                  >{mode === 'fixed' ? '全展開' : '固定'}</button>
                </div>
              );
            })}
            {(() => {
              const parts = sortedSlots.map(slot => {
                const mode = cartesianMode[slot.id] ?? 'fixed';
                return mode === 'expand' ? Math.max(1, (cardsData?.cards || []).filter(c => c.slotId === slot.id).length) : 1;
              });
              const total = parts.reduce((a, b) => a * b, 1);
              return (
                <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', margin: '14px 0 16px', textAlign: 'center' }}>
                  {parts.join(' × ')} = <strong style={{ color: 'var(--text-primary)' }}>{total}件</strong>
                </div>
              );
            })()}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleAddCartesian}
                style={{ flex: 1, padding: '12px', border: 'none', borderRadius: 'var(--radius-m)', background: 'var(--accent)', color: 'var(--accent-contrast)', fontSize: 'var(--fs-body)', fontWeight: 600, cursor: 'pointer' }}
              >キューに追加</button>
              <button
                onClick={() => setShowCartesian(false)}
                style={{ flex: 1, padding: '12px', border: '1px solid var(--line)', borderRadius: 'var(--radius-m)', background: 'none', color: 'var(--text-secondary)', fontSize: 'var(--fs-body)', cursor: 'pointer' }}
              >キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* 生成画像フルスクリーンプレビュー */}
      {previewItem && (
        <div
          onClick={() => setPreviewItem(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
        >
          <img
            src={`/api/images/.tmp/${previewItem.filename}`}
            alt=""
            style={{ maxWidth: '100%', maxHeight: 'calc(100% - 60px)', objectFit: 'contain' }}
          />
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 'var(--fs-label)', marginTop: '10px' }}>
            {previewItem.width}×{previewItem.height} • seed: {previewItem.seed} • タップして閉じる
          </div>
        </div>
      )}
    </div>
  );
}
