import { useState, useEffect, useCallback, useRef } from 'react';
import TagSuggest from '../components/TagSuggest';
import { api } from '../lib/api';
import { getConnection, resolveTmpImgUrl } from '../lib/connection';
import { decrypt, encrypt } from '../lib/crypto';

const MODELS = [
  { value: 'nai-diffusion-5-full',       label: 'V5 Full ⚡' },
  { value: 'nai-diffusion-5-curated',    label: 'V5 Curated ⚡' },
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

function QueueTaskRow({ task, onPreview, onSave, onRemove }) {
  const conn = getConnection();
  const isCloud = conn.route === 'cloud';
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    if (task.status !== 'done') return;
    if (!isCloud || !task.result?.hash) return;
    let url = null;
    let cancelled = false;
    const headers = conn.token ? { 'Authorization': `Bearer ${conn.token}` } : {};
    fetch(conn.cloudUrl + `/gallery/image/${task.result.hash}/data`, { headers })
      .then(r => r.ok ? r.arrayBuffer() : null)
      .then(buf => buf ? decrypt(buf) : null)
      .then(plain => {
        if (cancelled || !plain) return;
        url = URL.createObjectURL(new Blob([plain], { type: 'image/png' }));
        setBlobUrl(url);
      })
      .catch(() => {});
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [task.status, task.result?.hash, isCloud, conn.cloudUrl, conn.token]);

  const hasThumb = isCloud ? !!blobUrl : !!(task.result?.filename);
  const thumbSrc = isCloud ? blobUrl : (task.result?.filename ? resolveTmpImgUrl(task.result.filename) : null);
  const previewResult = isCloud ? { ...task.result, blobUrl } : task.result;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
      {task.status === 'done' && hasThumb ? (
        <img
          src={thumbSrc}
          alt=""
          onClick={() => onPreview(previewResult)}
          style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 'var(--radius-s)', flexShrink: 0, cursor: 'zoom-in', background: 'var(--line)' }}
        />
      ) : (
        <span style={{ fontSize: '14px', flexShrink: 0, width: 36, textAlign: 'center' }}>{STATUS_ICONS[task.status] || '?'}</span>
      )}
      <span style={{ flex: 1, fontSize: 'var(--fs-label)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: task.status === 'error' ? '#c0392b' : 'var(--text-primary)' }}>
        {task.label}
        {task.status === 'error' && task.error && <span style={{ display: 'block', fontSize: '11px', color: '#c0392b' }}>{task.error}</span>}
      </span>
      {task.status === 'done' && (
        <button
          onClick={onSave}
          style={{ padding: '3px 10px', border: task.saved ? '1px solid var(--line)' : 'none', borderRadius: 'var(--radius-s)', background: task.saved ? 'none' : 'var(--accent)', color: task.saved ? 'var(--text-secondary)' : 'var(--accent-contrast)', cursor: task.saved ? 'default' : 'pointer', fontSize: '11px', flexShrink: 0 }}
        >{task.saved ? '✓' : '保存'}</button>
      )}
      {task.status === 'pending' && (
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '14px', padding: '0 4px', flexShrink: 0 }}>×</button>
      )}
    </div>
  );
}

async function generateCloudThumbnail(hash, addToast) {
  const conn = getConnection();
  if (conn.route !== 'cloud') return;
  const headers = conn.token ? { 'Authorization': `Bearer ${conn.token}` } : {};
  try {
    const res = await fetch(conn.cloudUrl + `/gallery/image/${hash}/data`, { headers });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const plain = await decrypt(await res.arrayBuffer());
    const imgUrl = URL.createObjectURL(new Blob([plain], { type: 'image/png' }));
    const imgEl = new Image();
    await new Promise((ok, ng) => { imgEl.onload = ok; imgEl.onerror = ng; imgEl.src = imgUrl; });
    URL.revokeObjectURL(imgUrl);
    const MAX_W = 320;
    const sc = Math.min(1, MAX_W / imgEl.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(imgEl.naturalWidth * sc);
    canvas.height = Math.round(imgEl.naturalHeight * sc);
    canvas.getContext('2d').drawImage(imgEl, 0, 0, canvas.width, canvas.height);
    const webpBlob = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.8));
    const encThumb = await encrypt(new Uint8Array(await webpBlob.arrayBuffer()));
    await fetch(conn.cloudUrl + `/thumbs/${hash}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body: encThumb,
    });
  } catch (e) {
    if (addToast) addToast('error', `サムネイル生成失敗: ${e.message}`);
  }
}

function ResultCard({ item, onSave, onPreview }) {
  const label = item.filenameSegments?.filter(Boolean).join(' / ') || '（選択なし）';
  const imgSrc = item.blobUrl || resolveTmpImgUrl(item.filename);
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
        src={imgSrc}
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

export default function GenerateScreen({ addToast, results, setResults, maxResults, resetKey, connectionRoute }) {
  const [cardsData, setCardsData] = useState(null);
  const [presetsData, setPresetsData] = useState(null);
  const [vaultReady, setVaultReady] = useState(false);
  const [loading, setLoading] = useState(true);

  const [selectedPresetId, setSelectedPresetId] = useState(null);
  const [selectedCardMap, setSelectedCardMap] = useState({});
  const [localSlotOrder, setLocalSlotOrder] = useState(null);
  const [localSlotProps, setLocalSlotProps] = useState({});
  // randomChildMode: slotId -> false means "pick specific child"; absent/true means random
  const [randomChildMode, setRandomChildMode] = useState({});
  // selectedChildMap: slotId -> childCardId (used when randomChildMode[slotId] === false)
  const [selectedChildMap, setSelectedChildMap] = useState({});
  const [slotEnabledMap, setSlotEnabledMap] = useState({});
  const [slotRandomMap, setSlotRandomMap] = useState({});

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
  const [randomSize, setRandomSize] = useState(false);

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
  const promptApplied = useRef(false);
  const promptEditRef = useRef(null);
  const addedTaskIdsRef = useRef(new Set());
  const queueInitializedRef = useRef(false);

  const sortedSlots = cardsData ? (() => {
    let slotsArr = [...cardsData.slots];
    if (localSlotOrder) {
      const idxMap = {};
      localSlotOrder.forEach((id, i) => { idxMap[id] = i; });
      slotsArr.sort((a, b) => (idxMap[a.id] ?? 9999) - (idxMap[b.id] ?? 9999));
    } else {
      slotsArr.sort((a, b) => a.order - b.order);
    }
    return slotsArr.map(s => ({
      ...s,
      useAsFolder: s.id in localSlotProps ? localSlotProps[s.id].useAsFolder : s.useAsFolder,
      useInFilename: s.id in localSlotProps ? localSlotProps[s.id].useInFilename : s.useInFilename,
    }));
  })() : [];

  // ── Prompt computation ──

  const computePositive = useCallback((cardMap, data) => {
    if (!data) return '';
    return [...data.slots].sort((a, b) => a.order - b.order)
      .map(s => {
        if (slotEnabledMap[s.id] === false) return '';
        if (slotRandomMap[s.id]) return '';
        const id = cardMap[s.id];
        if (!id) return '';
        const card = data.cards.find(c => c.id === id);
        if (!card) return '';
        if (randomChildMode[s.id] === false && selectedChildMap[s.id]) {
          const child = data.cards.find(c => c.id === selectedChildMap[s.id]);
          return [card.positive, child?.positive].filter(Boolean).join(', ');
        }
        return card.positive || '';
      })
      .filter(Boolean).join(', ');
  }, [randomChildMode, selectedChildMap, slotEnabledMap, slotRandomMap]);

  const computeNegative = useCallback((cardMap, data) => {
    if (!data) return '';
    return [...data.slots].sort((a, b) => a.order - b.order)
      .map(s => {
        if (slotEnabledMap[s.id] === false) return '';
        if (slotRandomMap[s.id]) return '';
        const id = cardMap[s.id];
        if (!id) return '';
        const card = data.cards.find(c => c.id === id);
        if (!card) return '';
        if (randomChildMode[s.id] === false && selectedChildMap[s.id]) {
          const child = data.cards.find(c => c.id === selectedChildMap[s.id]);
          return [card.negative, child?.negative].filter(Boolean).join(', ');
        }
        return card.negative || '';
      })
      .filter(Boolean).join(', ');
  }, [randomChildMode, selectedChildMap, slotEnabledMap, slotRandomMap]);

  useEffect(() => {
    if (cardsData) {
      if (promptApplied.current && typeof promptApplied.current === 'object') {
        setEditedPositive(promptApplied.current.positive || '');
        setEditedNegative(promptApplied.current.negative || '');
        promptApplied.current = true;
      } else {
        setEditedPositive(computePositive(selectedCardMap, cardsData));
        setEditedNegative(computeNegative(selectedCardMap, cardsData));
      }
    }
  }, [selectedCardMap, cardsData, computePositive, computeNegative]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('pv3-last-prompt'));
      if (stored) {
        if (stored.model) setModel(stored.model);
        if (stored.resolution) setResolution(stored.resolution);
        if (stored.steps != null) setSteps(stored.steps);
        if (stored.scale != null) setScale(stored.scale);
        if (stored.sampler) setSampler(stored.sampler);
        promptApplied.current = stored;
      }
    } catch {}
  }, []);

  // #7: カード選択の永続化 — 復元
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('pv3-selected-cards'));
      if (stored && typeof stored === 'object') {
        setSelectedCardMap(stored);
      }
    } catch {}
  }, []);

  // #7: カード選択の永続化 — 保存（初回復元を除外するためにrefで管理）
  const cardMapInitialized = useRef(false);
  useEffect(() => {
    if (!cardMapInitialized.current) {
      cardMapInitialized.current = true;
      return;
    }
    try {
      localStorage.setItem('pv3-selected-cards', JSON.stringify(selectedCardMap));
    } catch {}
  }, [selectedCardMap]);

  // #10: resetKey — スクロールトップ
  useEffect(() => {
    if (resetKey > 0) {
      window.scrollTo(0, 0);
    }
  }, [resetKey]);

  useEffect(() => {
    if (showPromptEdit && promptEditRef.current) {
      promptEditRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showPromptEdit]);

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
    if (!connectionRoute || connectionRoute === 'offline') return;
    async function loadData() {
      try {
        if (connectionRoute === 'cloud') {
          setVaultReady(true);
          try {
            const [cd, pd] = await Promise.all([api.getCards(), api.getPresets()]);
            setCardsData(cd);
            setPresetsData(pd);
          } catch { /* cloud では cards/presets なしでも動作可 */ }
        } else {
          const [info, settings] = await Promise.all([api.getSystemInfo(), api.getSettings()]);
          if (settings.generation?.model && !promptApplied.current) setModel(settings.generation.model);
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
        }
      } catch {
        addToast('error', 'データの読み込みに失敗しました');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [addToast, connectionRoute]);

  useEffect(() => {
    if (queueData.state !== 'running') return;
    const id = setInterval(async () => {
      try { const d = await api.getQueue(); setQueueData(d); } catch {}
    }, 2000);
    return () => clearInterval(id);
  }, [queueData.state]);

  // キュー完了タスクを results に自動追加
  useEffect(() => {
    const tasks = queueData.tasks;
    if (!queueInitializedRef.current) {
      tasks.forEach(t => { if (t.status === 'done') addedTaskIdsRef.current.add(t.id); });
      queueInitializedRef.current = true;
      return;
    }
    const newDone = tasks.filter(t => t.status === 'done' && !addedTaskIdsRef.current.has(t.id));
    if (newDone.length === 0) return;
    const conn = getConnection();
    const isCloud = conn.route === 'cloud';
    newDone.forEach(async (task) => {
      addedTaskIdsRef.current.add(task.id);
      let parsedResult = task.result;
      if (typeof parsedResult === 'string') {
        try { parsedResult = JSON.parse(parsedResult); } catch { return; }
      }
      if (!parsedResult) return;
      const entry = {
        ...parsedResult,
        task_id: task.id,
        folderSegments: task.folder_segments || task.folderSegments || [],
        filenameSegments: task.filename_segments || task.filenameSegments || [],
        saved: !!task.saved,
      };
      if (isCloud && parsedResult.hash) {
        const headers = conn.token ? { 'Authorization': `Bearer ${conn.token}` } : {};
        try {
          const r = await fetch(conn.cloudUrl + `/gallery/image/${parsedResult.hash}/data`, { headers });
          if (r.ok) {
            const plain = await decrypt(await r.arrayBuffer());
            entry.blobUrl = URL.createObjectURL(new Blob([plain], { type: 'image/png' }));
          }
        } catch {}
      }
      setResults(prev => [entry, ...prev].slice(0, maxResults));
    });
  }, [queueData.tasks, maxResults]);

  useEffect(() => {
    if (queueData.state !== 'running') return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [queueData.state]);

  // ── Preset selection ──

  const handlePresetSelect = (presetId) => {
    setSelectedPresetId(presetId);
    if (!presetId) {
      setSelectedCardMap({});
      setLocalSlotOrder(null);
      setLocalSlotProps({});
      setRandomChildMode({});
      setSelectedChildMap({});
      return;
    }
    const preset = presetsData?.presets.find(p => p.id === presetId);
    if (!preset) return;
    setSelectedCardMap({ ...preset.cards });
    setLocalSlotOrder(preset.slotOrder || null);
    if (preset.folder !== undefined || preset.filename !== undefined) {
      const props = {};
      (cardsData?.slots || []).forEach(s => {
        props[s.id] = {
          useAsFolder: preset.folder === s.id,
          useInFilename: (preset.filename || []).includes(s.id),
        };
      });
      setLocalSlotProps(props);
    } else {
      setLocalSlotProps({});
    }
    // Load child card selections from preset.childCards
    const childCards = preset.childCards || {};
    const newRcm = {}, newScm = {};
    Object.entries(childCards).forEach(([slotId, childId]) => {
      if (childId) { newRcm[slotId] = false; newScm[slotId] = childId; }
    });
    setRandomChildMode(newRcm);
    setSelectedChildMap(newScm);
  };

  const handleSlotChange = (slotId, cardId) => {
    setSelectedPresetId(null);
    setSelectedCardMap(prev => ({ ...prev, [slotId]: cardId || null }));
    setRandomChildMode(prev => { const n = {...prev}; delete n[slotId]; return n; });
    setSelectedChildMap(prev => { const n = {...prev}; delete n[slotId]; return n; });
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
      setLocalSlotOrder(null);
      await refreshCardsData();
    } catch (e) {
      addToast('error', e.message);
    }
  };

  const handleToggleSlotProp = async (slot, prop) => {
    try {
      if (prop === 'useAsFolder') {
        // #7: F is radio — clear all other slots' useAsFolder
        const updatedData = JSON.parse(JSON.stringify(cardsData));
        // Apply current localSlotProps to base data
        updatedData.slots.forEach(s => {
          if (s.id in localSlotProps) {
            if ('useAsFolder' in localSlotProps[s.id]) s.useAsFolder = localSlotProps[s.id].useAsFolder;
            if ('useInFilename' in localSlotProps[s.id]) s.useInFilename = localSlotProps[s.id].useInFilename;
          }
        });
        const newVal = !slot.useAsFolder;
        updatedData.slots.forEach(s => {
          if (newVal) s.useAsFolder = s.id === slot.id;
          else if (s.id === slot.id) s.useAsFolder = false;
        });
        await api.putCards(updatedData);
        setLocalSlotProps({});
      } else {
        await api.updateSlot(slot.id, { [prop]: !slot[prop] });
        // Update localSlotProps if overrides are active
        if (Object.keys(localSlotProps).length > 0) {
          setLocalSlotProps(prev => {
            const next = { ...prev };
            next[slot.id] = { ...(next[slot.id] || {}), [prop]: !slot[prop] };
            return next;
          });
        }
      }
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

  // ── Prompt storage ──

  const savePromptToStorage = useCallback(() => {
    try {
      localStorage.setItem('pv3-last-prompt', JSON.stringify({
        positive: editedPositive,
        negative: editedNegative,
        model, resolution, steps, scale, sampler,
      }));
    } catch {}
  }, [editedPositive, editedNegative, model, resolution, steps, scale, sampler]);

  const handleClearPrompt = useCallback(() => {
    localStorage.removeItem('pv3-last-prompt');
    localStorage.removeItem('pv3-selected-cards');
    setEditedPositive('');
    setEditedNegative('');
    setModel('nai-diffusion-4-5-full');
    setResolution('portrait');
    setSteps(28);
    setScale(5);
    setSampler('k_euler_ancestral');
    setSeed('');
    setSelectedCardMap({});
    setSelectedPresetId(null);
  }, []);

  // ── Random child resolution helper ──

  const resolveChildren = (slotIdToCardId) => {
    const childResolutions = {};
    Object.entries(slotIdToCardId).forEach(([slotId, cardId]) => {
      if (!cardId) return;
      const children = (cardsData?.cards || []).filter(c => c.parentId === cardId);
      if (children.length === 0) return;
      if (randomChildMode[slotId] === false) {
        // Specific child
        const childId = selectedChildMap[slotId];
        const child = childId ? children.find(c => c.id === childId) : null;
        if (child) childResolutions[slotId] = child;
      } else {
        // Random
        childResolutions[slotId] = children[Math.floor(Math.random() * children.length)];
      }
    });
    return childResolutions;
  };

  // ── Queue ──

  const pickResolution = () => randomSize
    ? RESOLUTIONS[Math.floor(Math.random() * RESOLUTIONS.length)]
    : (RESOLUTIONS.find(r => r.value === resolution) || RESOLUTIONS[0]);

  const buildSingleTask = () => {
    const res = pickResolution();
    const allCards = cardsData?.cards || [];

    const effectiveMap = {};
    const randomPicks = {};
    sortedSlots.forEach(slot => {
      if (slotEnabledMap[slot.id] === false) return;
      if (slotRandomMap[slot.id]) {
        const rootCards = allCards.filter(c => c.slotId === slot.id && !c.parentId);
        if (rootCards.length > 0) {
          const parent = rootCards[Math.floor(Math.random() * rootCards.length)];
          const children = allCards.filter(c => c.parentId === parent.id);
          if (children.length > 0) {
            randomPicks[slot.id] = children[Math.floor(Math.random() * children.length)];
          } else {
            randomPicks[slot.id] = parent;
          }
          effectiveMap[slot.id] = randomPicks[slot.id].id;
        }
      } else {
        effectiveMap[slot.id] = selectedCardMap[slot.id];
      }
    });

    const childRes = {};
    Object.entries(effectiveMap).forEach(([slotId, cardId]) => {
      if (!cardId || randomPicks[slotId]) return;
      const children = allCards.filter(c => c.parentId === cardId);
      if (children.length === 0) return;
      if (randomChildMode[slotId] === false) {
        const childId = selectedChildMap[slotId];
        const child = childId ? children.find(c => c.id === childId) : null;
        if (child) childRes[slotId] = child;
      } else {
        childRes[slotId] = children[Math.floor(Math.random() * children.length)];
      }
    });

    const getName = (slotId) => {
      if (randomPicks[slotId]) return randomPicks[slotId].name;
      const child = childRes[slotId];
      if (child) return child.name;
      const id = effectiveMap[slotId];
      return id ? allCards.find(c => c.id === id)?.name : null;
    };

    let pos = editedPositive;
    let neg = editedNegative;
    sortedSlots.forEach(slot => {
      if (slotEnabledMap[slot.id] === false) return;
      const rp = randomPicks[slot.id];
      if (rp) {
        if (rp.parentId) {
          const parent = allCards.find(c => c.id === rp.parentId);
          if (parent?.positive) pos = pos ? pos + ', ' + parent.positive : parent.positive;
          if (parent?.negative) neg = neg ? neg + ', ' + parent.negative : parent.negative;
        }
        if (rp.positive) pos = pos ? pos + ', ' + rp.positive : rp.positive;
        if (rp.negative) neg = neg ? neg + ', ' + rp.negative : rp.negative;
        return;
      }
      const child = childRes[slot.id];
      if (!child) return;
      if (child.positive) pos = pos ? pos + ', ' + child.positive : child.positive;
      if (child.negative) neg = neg ? neg + ', ' + child.negative : child.negative;
    });

    const folderSegments = [];
    sortedSlots.filter(s => s.useAsFolder && slotEnabledMap[s.id] !== false).forEach(s => {
      const finalCard = randomPicks[s.id] || childRes[s.id] || (effectiveMap[s.id] ? allCards.find(c => c.id === effectiveMap[s.id]) : null);
      if (!finalCard) return;
      if (finalCard.parentId) {
        const parent = allCards.find(c => c.id === finalCard.parentId);
        if (parent?.name) folderSegments.push(parent.name);
      }
      if (finalCard.name) folderSegments.push(finalCard.name);
    });

    const filenameSegments = sortedSlots.filter(s => s.useInFilename && slotEnabledMap[s.id] !== false).map(s => getName(s.id)).filter(Boolean);
    const label = sortedSlots.filter(s => slotEnabledMap[s.id] !== false).map(s => getName(s.id)).filter(Boolean).join(' × ') || '（選択なし）';
    return {
      positive: pos,
      negative: neg,
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
      savePromptToStorage();
    } catch (e) { addToast('error', e.message); }
  };

  const buildCartesianTasks = () => {
    const baseParams = { model, steps, scale, sampler, seed: seed !== '' ? parseInt(seed, 10) : null };
    const allCards = cardsData?.cards || [];
    const enabledSlots = sortedSlots.filter(s => slotEnabledMap[s.id] !== false);
    const slotOptions = enabledSlots.map(slot => {
      if (slotRandomMap[slot.id]) {
        return { slot, options: [null], isRandom: true };
      }
      const mode = cartesianMode[slot.id] ?? 'fixed';
      if (mode === 'expand') {
        const rootCards = allCards.filter(c => c.slotId === slot.id && !c.parentId);
        return { slot, options: rootCards.length > 0 ? rootCards : [null] };
      }
      const cardId = selectedCardMap[slot.id];
      const card = cardId ? allCards.find(c => c.id === cardId) : null;
      return { slot, options: [card] };
    });
    let combos = [{}];
    for (const { slot, options } of slotOptions) {
      combos = combos.flatMap(combo => options.map(card => ({ ...combo, [slot.id]: card })));
    }
    return combos.map(combo => {
      const randomPicks = {};
      const childRes = {};
      enabledSlots.forEach(slot => {
        if (slotRandomMap[slot.id]) {
          const slotCards = allCards.filter(c => c.slotId === slot.id);
          if (slotCards.length > 0) randomPicks[slot.id] = slotCards[Math.floor(Math.random() * slotCards.length)];
          return;
        }
        const card = combo[slot.id];
        if (!card) return;
        const children = allCards.filter(c => c.parentId === card.id);
        if (children.length > 0) childRes[slot.id] = children[Math.floor(Math.random() * children.length)];
      });
      const getName = (slotId) => {
        if (randomPicks[slotId]) return randomPicks[slotId].name;
        return (childRes[slotId]?.name || combo[slotId]?.name) || null;
      };
      let positive = enabledSlots.filter(s => !slotRandomMap[s.id]).map(s => combo[s.id]?.positive || '').filter(Boolean).join(', ');
      let negative = enabledSlots.filter(s => !slotRandomMap[s.id]).map(s => combo[s.id]?.negative || '').filter(Boolean).join(', ');
      enabledSlots.forEach(slot => {
        const rp = randomPicks[slot.id];
        if (rp) {
          if (rp.positive) positive = positive ? positive + ', ' + rp.positive : rp.positive;
          if (rp.negative) negative = negative ? negative + ', ' + rp.negative : rp.negative;
          return;
        }
        const child = childRes[slot.id];
        if (!child) return;
        if (child.positive) positive = positive ? positive + ', ' + child.positive : child.positive;
        if (child.negative) negative = negative ? negative + ', ' + child.negative : child.negative;
      });
      const folderSegments = [];
      enabledSlots.filter(s => s.useAsFolder).forEach(s => {
        const finalCard = randomPicks[s.id] || childRes[s.id] || combo[s.id];
        if (!finalCard) return;
        if (finalCard.parentId) {
          const parent = allCards.find(c => c.id === finalCard.parentId);
          if (parent?.name) folderSegments.push(parent.name);
        }
        if (finalCard.name) folderSegments.push(finalCard.name);
      });
      const filenameSegments = enabledSlots.filter(s => s.useInFilename).map(s => getName(s.id)).filter(Boolean);
      const label = enabledSlots.map(s => getName(s.id)).filter(Boolean).join(' × ') || '（選択なし）';
      const taskRes = pickResolution();
      const params = { ...baseParams, width: taskRes.width, height: taskRes.height };
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
      savePromptToStorage();
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
    const res = pickResolution();
    const allCards = cardsData?.cards || [];

    const effectiveMap = {};
    const randomPicks = {};
    sortedSlots.forEach(slot => {
      if (slotEnabledMap[slot.id] === false) return;
      if (slotRandomMap[slot.id]) {
        const slotCards = allCards.filter(c => c.slotId === slot.id);
        if (slotCards.length > 0) {
          randomPicks[slot.id] = slotCards[Math.floor(Math.random() * slotCards.length)];
          effectiveMap[slot.id] = randomPicks[slot.id].id;
        }
      } else {
        effectiveMap[slot.id] = selectedCardMap[slot.id];
      }
    });

    const childRes = {};
    Object.entries(effectiveMap).forEach(([slotId, cardId]) => {
      if (!cardId || randomPicks[slotId]) return;
      const children = allCards.filter(c => c.parentId === cardId);
      if (children.length === 0) return;
      if (randomChildMode[slotId] === false) {
        const childId = selectedChildMap[slotId];
        const child = childId ? children.find(c => c.id === childId) : null;
        if (child) childRes[slotId] = child;
      } else {
        childRes[slotId] = children[Math.floor(Math.random() * children.length)];
      }
    });

    const getName = (slotId) => {
      if (randomPicks[slotId]) return randomPicks[slotId].name;
      const child = childRes[slotId];
      if (child) return child.name;
      const id = effectiveMap[slotId];
      return id ? allCards.find(c => c.id === id)?.name : null;
    };

    let pos = editedPositive;
    let neg = editedNegative;
    sortedSlots.forEach(slot => {
      if (slotEnabledMap[slot.id] === false) return;
      const rp = randomPicks[slot.id];
      if (rp) {
        if (rp.positive) pos = pos ? pos + ', ' + rp.positive : rp.positive;
        if (rp.negative) neg = neg ? neg + ', ' + rp.negative : rp.negative;
        return;
      }
      const child = childRes[slot.id];
      if (!child) return;
      if (child.positive) pos = pos ? pos + ', ' + child.positive : child.positive;
      if (child.negative) neg = neg ? neg + ', ' + child.negative : child.negative;
    });

    const folderSegments = [];
    sortedSlots.filter(s => s.useAsFolder && slotEnabledMap[s.id] !== false).forEach(s => {
      const finalCard = randomPicks[s.id] || childRes[s.id] || (effectiveMap[s.id] ? allCards.find(c => c.id === effectiveMap[s.id]) : null);
      if (!finalCard) return;
      if (finalCard.parentId) {
        const parent = allCards.find(c => c.id === finalCard.parentId);
        if (parent?.name) folderSegments.push(parent.name);
      }
      if (finalCard.name) folderSegments.push(finalCard.name);
    });

    const filenameSegments = sortedSlots.filter(s => s.useInFilename && slotEnabledMap[s.id] !== false).map(s => getName(s.id)).filter(Boolean);

    try {
      const result = await api.generate({
        prompt: pos,
        negative_prompt: neg,
        model, width: res.width, height: res.height, steps, scale, sampler,
        seed: seed !== '' ? parseInt(seed, 10) : null,
        folderSegments,
        filenameSegments,
      });
      const conn = getConnection();
      if (conn.route === 'cloud' && result.image?.hash) {
        const hash = result.image.hash;
        const headers = conn.token ? { 'Authorization': `Bearer ${conn.token}` } : {};
        let blobUrl = null;
        try {
          const imgRes = await fetch(conn.cloudUrl + `/gallery/image/${hash}/data`, { headers });
          if (imgRes.ok) {
            const plain = await decrypt(await imgRes.arrayBuffer());
            blobUrl = URL.createObjectURL(new Blob([plain], { type: 'image/png' }));
          }
        } catch {}
        setResults(prev => {
          const next = [{ ...result.image, task_id: result.image.task_id ?? result.task_id, folderSegments, filenameSegments, saved: false, blobUrl }, ...prev];
          return next.length > maxResults ? next.slice(0, maxResults) : next;
        });
        generateCloudThumbnail(hash, addToast);
      } else {
        setResults(prev => {
          const next = [{ ...result.image, folderSegments, filenameSegments, saved: false }, ...prev];
          return next.length > maxResults ? next.slice(0, maxResults) : next;
        });
      }
      savePromptToStorage();
    } catch (e) {
      addToast('error', '生成に失敗しました: ' + (e.message || ''));
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async (idx) => {
    const item = results[idx];
    const conn = getConnection();
    try {
      if (conn.route === 'cloud') {
        await api.saveImage({ task_id: item.task_id });
      } else {
        await api.saveImage({ filename: item.filename, seed: item.seed, folderSegments: item.folderSegments || [], filenameSegments: item.filenameSegments || [] });
      }
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
            // Show only root cards in dropdown; children are resolved randomly at generation time
            const slotCards = cardsData.cards.filter(c => c.slotId === slot.id && !c.parentId && (c.positive?.trim() || c.negative?.trim()));
            const selectedCardId = selectedCardMap[slot.id];
            const selectedChildCount = selectedCardId
              ? cardsData.cards.filter(c => c.parentId === selectedCardId).length
              : 0;
            const isFirst = idx === 0;
            const isLast = idx === sortedSlots.length - 1;

            return (
              <div key={slot.id} style={{ marginBottom: idx < sortedSlots.length - 1 ? '12px' : 0, opacity: slotEnabledMap[slot.id] === false ? 0.4 : 1, transition: 'opacity 0.2s' }}>
                {/* 管理行: ▲▼ / スロット名 / 有効 / ランダム / F / N / × */}
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
                    <input type="checkbox" checked={slotEnabledMap[slot.id] !== false} onChange={() => setSlotEnabledMap(prev => ({ ...prev, [slot.id]: prev[slot.id] === false }))} />
                    有効
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none', flexShrink: 0 }}>
                    <input type="checkbox" checked={!!slotRandomMap[slot.id]} onChange={() => setSlotRandomMap(prev => ({ ...prev, [slot.id]: !prev[slot.id] }))} />
                    ランダム
                  </label>
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
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <select
                      value={selectedCardId || ''}
                      onChange={e => handleSlotChange(slot.id, e.target.value || null)}
                      disabled={!!slotRandomMap[slot.id]}
                      style={{ ...fieldStyle, width: '100%', opacity: slotRandomMap[slot.id] ? 0.5 : 1 }}
                    >
                      <option value="">（なし）</option>
                      {slotCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    {selectedChildCount > 0 && !slotRandomMap[slot.id] && (
                      <div style={{ marginTop: '5px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
                          <input
                            type="checkbox"
                            checked={randomChildMode[slot.id] !== false}
                            onChange={e => {
                              const isRandom = e.target.checked;
                              setRandomChildMode(prev => {
                                const n = {...prev};
                                if (isRandom) delete n[slot.id]; else n[slot.id] = false;
                                return n;
                              });
                              if (isRandom) setSelectedChildMap(prev => { const n = {...prev}; delete n[slot.id]; return n; });
                            }}
                          />
                          <span style={{ fontSize: '11px', color: 'var(--accent)' }}>⚄ 子カード {selectedChildCount}種からランダム</span>
                        </label>
                        {randomChildMode[slot.id] === false && (
                          <select
                            value={selectedChildMap[slot.id] || ''}
                            onChange={e => setSelectedChildMap(prev => ({ ...prev, [slot.id]: e.target.value || null }))}
                            style={{ ...fieldStyle, width: '100%', marginTop: '4px', fontSize: '12px' }}
                          >
                            <option value="">（子を指定しない）</option>
                            {(cardsData?.cards || []).filter(c => c.parentId === selectedCardId).map(c => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
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
      <div ref={promptEditRef} style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={() => setShowPromptEdit(!showPromptEdit)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 'var(--fs-body)', padding: 0, flex: 1, textAlign: 'left' }}>
            {showPromptEdit ? '▼' : '▶'} プロンプト確認・編集
          </button>
          <button
            onClick={handleClearPrompt}
            style={{ padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius-s)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'var(--fs-label)', flexShrink: 0 }}
          >クリア</button>
        </div>
        {showPromptEdit && (
          <div style={{ marginTop: '12px' }}>
            <label style={labelStyle}>正プロンプト（一時編集・カードに反映しない）</label>
            <textarea value={editedPositive} onChange={e => setEditedPositive(e.target.value)} rows={8} style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.5, minHeight: '40vh' }} />
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
              <select value={resolution} onChange={e => setResolution(e.target.value)} disabled={randomSize} style={{ ...fieldStyle, opacity: randomSize ? 0.5 : 1 }}>
                {RESOLUTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px', fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={randomSize} onChange={e => setRandomSize(e.target.checked)} />
                ランダムサイズ
              </label>
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
                      <QueueTaskRow key={task.id} task={task} onPreview={setPreviewItem} onSave={async () => {
                        if (task.saved) return;
                        try { await api.queueTaskSave(task.id); setQueueData(await api.getQueue()); addToast('success', '保存しました'); }
                        catch (e) { addToast('error', e.message); }
                      }} onRemove={() => handleRemoveTask(task.id)} />
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
            src={previewItem.blobUrl || resolveTmpImgUrl(previewItem.filename)}
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
