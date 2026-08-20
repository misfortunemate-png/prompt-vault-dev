import { useState } from 'react';
import TagInput from '../components/TagInput';
import { api } from '../lib/api';

const fieldStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-s)',
  background: 'var(--bg)',
  color: 'var(--text-primary)',
  fontSize: 'var(--fs-label)',
};

const labelStyle = {
  display: 'block',
  fontSize: 'var(--fs-label)',
  color: 'var(--text-secondary)',
  marginBottom: '4px',
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

export default function TemplatePresetEdit({ preset, cardsData, allTags, onSave, onCancel, addToast }) {
  const isNew = !preset?.id;
  const allSlots = [...(cardsData?.slots || [])].sort((a, b) => a.order - b.order);
  const cards = cardsData?.cards || [];

  const defaultSlotOrder = allSlots.map(s => s.id);

  const [name, setName] = useState(preset?.name || '');
  const [tags, setTags] = useState(preset?.tags || []);
  const [selectedCards, setSelectedCards] = useState(preset?.cards || {});
  const [slotOrder, setSlotOrder] = useState(preset?.slotOrder || defaultSlotOrder);
  const [slotFolder, setSlotFolder] = useState(
    preset?.folder !== undefined ? preset.folder : (allSlots.find(s => s.useAsFolder)?.id || null)
  );
  const [slotFilename, setSlotFilename] = useState(
    preset?.filename !== undefined ? preset.filename : allSlots.filter(s => s.useInFilename).map(s => s.id)
  );
  const [saving, setSaving] = useState(false);

  // Ordered slots for display
  const orderedSlots = slotOrder
    .map(id => allSlots.find(s => s.id === id))
    .filter(Boolean)
    .concat(allSlots.filter(s => !slotOrder.includes(s.id)));

  const moveSlot = (idx, dir) => {
    const newOrder = [...slotOrder];
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= newOrder.length) return;
    [newOrder[idx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[idx]];
    setSlotOrder(newOrder);
  };

  const toggleFolder = (slotId) => {
    setSlotFolder(prev => prev === slotId ? null : slotId);
  };

  const toggleFilename = (slotId) => {
    setSlotFilename(prev =>
      prev.includes(slotId) ? prev.filter(id => id !== slotId) : [...prev, slotId]
    );
  };

  // Computed previews using orderedSlots + slotFolder/slotFilename
  const computedPositive = orderedSlots
    .map(s => { const id = selectedCards[s.id]; return id ? (cards.find(c => c.id === id)?.positive || '') : ''; })
    .filter(Boolean).join(', ');

  const computedNegative = orderedSlots
    .map(s => { const id = selectedCards[s.id]; return id ? (cards.find(c => c.id === id)?.negative || '') : ''; })
    .filter(Boolean).join(', ');

  const folderCardName = slotFolder
    ? cards.find(c => c.id === selectedCards[slotFolder])?.name || null
    : null;

  const filenameCardNames = slotFilename
    .map(sid => cards.find(c => c.id === selectedCards[sid])?.name)
    .filter(Boolean);

  const folderStr = folderCardName || 'その他';
  const fileStr = (filenameCardNames.length > 0 ? filenameCardNames.join('_') : 'gen') + '_{seed10桁}.png';
  const savePreview = `${folderStr}/${fileStr}`;

  const handleSave = async () => {
    if (!name.trim()) { addToast('error', 'プリセット名は必須です'); return; }
    setSaving(true);
    try {
      const data = {
        name: name.trim(),
        tags,
        cards: selectedCards,
        slotOrder,
        folder: slotFolder,
        filename: slotFilename,
      };
      let saved;
      if (isNew) {
        saved = await api.addPreset(data);
      } else {
        saved = await api.updatePreset(preset.id, data);
      }
      addToast('success', isNew ? 'プリセットを追加しました' : 'プリセットを更新しました');
      onSave(saved);
    } catch (e) {
      addToast('error', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '0 16px 136px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0', marginBottom: '8px', borderBottom: '1px solid var(--line)' }}>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-body)', padding: 0 }}>‹ 戻る</button>
        <span style={{ fontSize: 'var(--fs-title)', fontWeight: 600 }}>{isNew ? 'プリセット追加' : 'プリセット編集'}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* プリセット名 */}
        <div>
          <label style={labelStyle}>プリセット名 *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="例: 標準ポートレート" style={fieldStyle} />
        </div>

        {/* タグ */}
        <div>
          <label style={labelStyle}>タグ</label>
          <TagInput tags={tags} onChange={setTags} allTags={allTags} placeholder="タグを入力してEnter…" />
        </div>

        {/* スロット別カード選択 + F/N + 並び順 */}
        <div>
          <label style={labelStyle}>スロット別カード選択</label>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-s)', padding: '8px' }}>
            {orderedSlots.map((slot, idx) => (
              <div key={slot.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: idx < orderedSlots.length - 1 ? '6px' : 0 }}>
                {/* ▲▼ */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', flexShrink: 0 }}>
                  <button onClick={() => moveSlot(idx, -1)} disabled={idx === 0} style={{ ...arrowBtnStyle, opacity: idx === 0 ? 0.3 : 1 }}>▲</button>
                  <button onClick={() => moveSlot(idx, 1)} disabled={idx === orderedSlots.length - 1} style={{ ...arrowBtnStyle, opacity: idx === orderedSlots.length - 1 ? 0.3 : 1 }}>▼</button>
                </div>

                {/* スロット名 */}
                <span style={{ fontSize: 'var(--fs-label)', fontWeight: 600, width: '56px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{slot.name}</span>

                {/* カード選択 */}
                <select
                  value={selectedCards[slot.id] || ''}
                  onChange={e => setSelectedCards(prev => ({ ...prev, [slot.id]: e.target.value || null }))}
                  style={{ ...fieldStyle, flex: 1, padding: '5px 6px', fontSize: '12px' }}
                >
                  <option value="">（なし）</option>
                  {cards.filter(c => c.slotId === slot.id).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>

                {/* F (radio behavior) */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: 'var(--fs-label)', cursor: 'pointer', flexShrink: 0, userSelect: 'none', color: slotFolder === slot.id ? 'var(--accent)' : 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={slotFolder === slot.id} onChange={() => toggleFolder(slot.id)} />
                  F
                </label>

                {/* N (multi) */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: 'var(--fs-label)', cursor: 'pointer', flexShrink: 0, userSelect: 'none', color: slotFilename.includes(slot.id) ? 'var(--accent)' : 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={slotFilename.includes(slot.id)} onChange={() => toggleFilename(slot.id)} />
                  N
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* 合成プロンプトプレビュー */}
        {(computedPositive || computedNegative) && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-s)', padding: '12px' }}>
            <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>合成プレビュー</div>
            {computedPositive && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', marginBottom: '2px' }}>ポジティブ</div>
                <div style={{ fontSize: 'var(--fs-label)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{computedPositive}</div>
              </div>
            )}
            {computedNegative && (
              <div>
                <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', marginBottom: '2px' }}>ネガティブ</div>
                <div style={{ fontSize: 'var(--fs-label)', fontFamily: 'monospace', wordBreak: 'break-all', color: '#c0392b' }}>{computedNegative}</div>
              </div>
            )}
          </div>
        )}

        {/* 保存先プレビュー */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-s)', padding: '12px' }}>
          <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 600 }}>保存先プレビュー</div>
          <div style={{ fontSize: 'var(--fs-label)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{savePreview}</div>
        </div>
      </div>

      {/* 保存/キャンセルボタン */}
      <div style={{ position: 'fixed', bottom: 54, left: 0, right: 0, background: 'var(--bg)', borderTop: '1px solid var(--line)', padding: '12px 16px', display: 'flex', gap: '8px', zIndex: 150 }}>
        <button
          onClick={onCancel}
          style={{ flex: 1, padding: '10px', border: '1px solid var(--line)', borderRadius: 'var(--radius-s)', background: 'var(--surface)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 'var(--fs-label)' }}
        >キャンセル</button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ flex: 2, padding: '10px', border: 'none', borderRadius: 'var(--radius-s)', background: 'var(--accent)', color: 'var(--accent-contrast)', cursor: 'pointer', fontSize: 'var(--fs-label)', fontWeight: 600 }}
        >{saving ? '保存中…' : '保存'}</button>
      </div>
    </div>
  );
}
