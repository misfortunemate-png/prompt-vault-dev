import { useState } from 'react';
import TagSuggest from '../components/TagSuggest';
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

export default function TemplateCardEdit({ card, slots, cards = [], defaultParentId = null, onSave, onCancel, addToast }) {
  const [name, setName] = useState(card?.name || '');
  const [slotId, setSlotId] = useState(card?.slotId || slots[0]?.id || '');
  const [positive, setPositive] = useState(card?.positive || '');
  const [negative, setNegative] = useState(card?.negative || '');
  const [parentId, setParentId] = useState(card?.parentId || defaultParentId || '');
  const [saving, setSaving] = useState(false);

  const isNew = !card?.id;

  // Root cards in the same slot (excluding self) = valid parent options
  const parentOptions = cards.filter(c => !c.parentId && c.id !== card?.id);

  const handleSave = async () => {
    if (!name.trim()) { addToast('error', 'カード名は必須です'); return; }
    if (!slotId) { addToast('error', 'スロットを選択してください'); return; }
    setSaving(true);
    try {
      const payload = { name: name.trim(), slotId, positive, negative, parentId: parentId || null };
      let saved;
      if (isNew) {
        saved = await api.addCard(payload);
      } else {
        saved = await api.updateCard(card.id, payload);
      }
      addToast('success', isNew ? 'カードを追加しました' : 'カードを更新しました');
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
        <span style={{ fontSize: 'var(--fs-title)', fontWeight: 600 }}>{isNew ? 'カード追加' : 'カード編集'}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={labelStyle}>カード名 *</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例: キャラA"
            style={fieldStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>スロット *</label>
          <select value={slotId} onChange={e => setSlotId(e.target.value)} style={fieldStyle}>
            {slots.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {parentOptions.length > 0 && (
          <div>
            <label style={labelStyle}>親カード（省略可：設定すると生成時に親＋このカードを合成）</label>
            <select value={parentId} onChange={e => setParentId(e.target.value)} style={fieldStyle}>
              <option value="">（なし — 独立カード）</option>
              {parentOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label style={labelStyle}>ポジティブプロンプト</label>
          <TagSuggest
            value={positive}
            onChange={setPositive}
            rows={4}
            placeholder="例: 1girl, solo, smile"
            style={{ ...fieldStyle, resize: 'vertical' }}
          />
        </div>

        <div>
          <label style={labelStyle}>ネガティブプロンプト</label>
          <TagSuggest
            value={negative}
            onChange={setNegative}
            rows={3}
            placeholder="例: nsfw, lowres"
            style={{ ...fieldStyle, resize: 'vertical' }}
          />
        </div>
      </div>

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
