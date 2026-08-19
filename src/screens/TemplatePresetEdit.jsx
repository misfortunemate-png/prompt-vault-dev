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

export default function TemplatePresetEdit({ preset, cardsData, allTags, onSave, onCancel, addToast }) {
  const isNew = !preset?.id;
  const slots = [...(cardsData?.slots || [])].sort((a, b) => a.order - b.order);
  const cards = cardsData?.cards || [];

  const [name, setName] = useState(preset?.name || '');
  const [tags, setTags] = useState(preset?.tags || []);
  const [selectedCards, setSelectedCards] = useState(preset?.cards || {});
  const [saving, setSaving] = useState(false);

  const slotCards = (slotId) => cards.filter(c => c.slotId === slotId);

  const computedPositive = slots
    .map(s => {
      const cardId = selectedCards[s.id];
      if (!cardId) return '';
      return cards.find(c => c.id === cardId)?.positive || '';
    })
    .filter(Boolean)
    .join(', ');

  const computedNegative = slots
    .map(s => {
      const cardId = selectedCards[s.id];
      if (!cardId) return '';
      return cards.find(c => c.id === cardId)?.negative || '';
    })
    .filter(Boolean)
    .join(', ');

  const folderPreview = slots
    .filter(s => s.useAsFolder)
    .map(s => {
      const cardId = selectedCards[s.id];
      if (!cardId) return null;
      return cards.find(c => c.id === cardId)?.name;
    })
    .filter(Boolean);

  const filenamePreview = slots
    .filter(s => s.useInFilename)
    .map(s => {
      const cardId = selectedCards[s.id];
      if (!cardId) return null;
      return cards.find(c => c.id === cardId)?.name;
    })
    .filter(Boolean);

  const folderStr = folderPreview.length > 0 ? folderPreview.join('/') : 'その他';
  const fileStr = (filenamePreview.length > 0 ? filenamePreview.join('_') : 'gen') + '_{seed10桁}.png';
  const savePreview = `${folderStr}/${fileStr}`;

  const handleSave = async () => {
    if (!name.trim()) { addToast('error', 'プリセット名は必須です'); return; }
    setSaving(true);
    try {
      let saved;
      if (isNew) {
        saved = await api.addPreset({ name: name.trim(), tags, cards: selectedCards });
      } else {
        saved = await api.updatePreset(preset.id, { name: name.trim(), tags, cards: selectedCards });
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
    <div style={{ padding: '0 16px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0', marginBottom: '8px', borderBottom: '1px solid var(--line)' }}>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-body)', padding: 0 }}>‹ 戻る</button>
        <span style={{ fontSize: 'var(--fs-title)', fontWeight: 600 }}>{isNew ? 'プリセット追加' : 'プリセット編集'}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={labelStyle}>プリセット名 *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="例: 標準ポートレート" style={fieldStyle} />
        </div>

        <div>
          <label style={labelStyle}>タグ</label>
          <TagInput tags={tags} onChange={setTags} allTags={allTags} placeholder="タグを入力してEnter…" />
        </div>

        {slots.map(slot => (
          <div key={slot.id}>
            <label style={labelStyle}>{slot.name}</label>
            <select
              value={selectedCards[slot.id] || ''}
              onChange={e => setSelectedCards(prev => ({ ...prev, [slot.id]: e.target.value || null }))}
              style={fieldStyle}
            >
              <option value="">（なし）</option>
              {slotCards(slot.id).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        ))}

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

        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-s)', padding: '12px' }}>
          <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 600 }}>保存先プレビュー</div>
          <div style={{ fontSize: 'var(--fs-label)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{savePreview}</div>
        </div>
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--bg)', borderTop: '1px solid var(--line)', padding: '12px 16px', display: 'flex', gap: '8px', zIndex: 100 }}>
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
