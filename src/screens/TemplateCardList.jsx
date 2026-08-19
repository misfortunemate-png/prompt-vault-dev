import { useState, useEffect, useRef } from 'react';
import TemplateCardEdit from './TemplateCardEdit';
import { api } from '../lib/api';

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  padding: '12px 16px',
  borderBottom: '1px solid var(--line)',
  gap: '8px',
};

const menuBtnStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-secondary)',
  fontSize: '20px',
  padding: '0 4px',
  lineHeight: 1,
};

function ContextMenu({ items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} style={{
      position: 'absolute',
      right: 0,
      top: '100%',
      background: 'var(--surface)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--radius-s)',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      zIndex: 300,
      minWidth: '140px',
    }}>
      {items.map((item, i) => (
        <div
          key={i}
          onMouseDown={(e) => { e.preventDefault(); item.action(); onClose(); }}
          style={{
            padding: '10px 14px',
            fontSize: 'var(--fs-label)',
            cursor: 'pointer',
            color: item.danger ? '#c0392b' : 'var(--text-primary)',
            borderBottom: i < items.length - 1 ? '1px solid var(--line)' : 'none',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >{item.label}</div>
      ))}
    </div>
  );
}

export default function TemplateCardList({ addToast }) {
  const [cardsData, setCardsData] = useState(null);
  const [presetsData, setPresetsData] = useState(null);
  const [nav, setNav] = useState({ view: 'slots' });
  const [menuTarget, setMenuTarget] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [addSlotMode, setAddSlotMode] = useState(false);
  const [newSlotName, setNewSlotName] = useState('');
  const [addCardMode, setAddCardMode] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const dragOverIdx = useRef(null);

  const refresh = async () => {
    try {
      const [cd, pd] = await Promise.all([api.getCards(), api.getPresets()]);
      setCardsData(cd);
      setPresetsData(pd);
    } catch (e) {
      addToast('error', e.message);
    }
  };

  useEffect(() => { refresh(); }, []);

  if (!cardsData) return <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>読み込み中…</div>;

  const slots = [...cardsData.slots].sort((a, b) => a.order - b.order);
  const cards = cardsData.cards;

  const currentSlot = nav.selectedSlot ? slots.find(s => s.id === nav.selectedSlot) : null;
  const slotCards = currentSlot ? cards.filter(c => c.slotId === currentSlot.id) : [];

  // ──────── SLOT RENAME ────────

  const startRename = (slot) => {
    setRenameTarget(slot.id);
    setRenameValue(slot.name);
  };

  const commitRename = async () => {
    if (!renameValue.trim()) { setRenameTarget(null); return; }
    try {
      await api.updateSlot(renameTarget, { name: renameValue.trim() });
      addToast('success', 'スロット名を更新しました');
      await refresh();
    } catch (e) {
      addToast('error', e.message);
    }
    setRenameTarget(null);
  };

  // ──────── SLOT PATH SETTINGS ────────

  const toggleSlotProp = async (slot, prop) => {
    try {
      await api.updateSlot(slot.id, { [prop]: !slot[prop] });
      await refresh();
    } catch (e) {
      addToast('error', e.message);
    }
  };

  // ──────── SLOT DELETE ────────

  const deleteSlot = async (slot) => {
    const cardCount = cards.filter(c => c.slotId === slot.id).length;
    const msg = cardCount > 0
      ? `「${slot.name}」とその ${cardCount} 枚のカードを削除しますか？`
      : `「${slot.name}」を削除しますか？`;
    if (!window.confirm(msg)) return;
    try {
      await api.deleteSlot(slot.id);
      addToast('success', 'スロットを削除しました');
      await refresh();
    } catch (e) {
      addToast('error', e.message);
    }
  };

  // ──────── SLOT ADD ────────

  const commitAddSlot = async () => {
    if (!newSlotName.trim()) { setAddSlotMode(false); return; }
    try {
      await api.addSlot({ name: newSlotName.trim() });
      addToast('success', 'スロットを追加しました');
      setNewSlotName('');
      setAddSlotMode(false);
      await refresh();
    } catch (e) {
      addToast('error', e.message);
    }
  };

  // ──────── SLOT DRAG ────────

  const handleDragStart = (e, idx) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, idx) => {
    e.preventDefault();
    dragOverIdx.current = idx;
  };

  const handleDrop = async (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); return; }
    const reordered = [...slots];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    reordered.forEach((s, i) => { s.order = i; });
    const updated = { ...cardsData, slots: reordered };
    try {
      await api.putCards(updated);
      await refresh();
    } catch (e) {
      addToast('error', e.message);
    }
    setDragIdx(null);
  };

  // ──────── CARD OPERATIONS ────────

  const deleteCard = async (card) => {
    const usedIn = (presetsData?.presets || []).filter(p => Object.values(p.cards || {}).includes(card.id));
    const msg = usedIn.length > 0
      ? `「${card.name}」は ${usedIn.length} 件のプリセットで使用中です。削除しますか？`
      : `「${card.name}」を削除しますか？`;
    if (!window.confirm(msg)) return;
    try {
      await api.deleteCard(card.id);
      addToast('success', 'カードを削除しました');
      await refresh();
    } catch (e) {
      addToast('error', e.message);
    }
  };

  const duplicateCard = async (card) => {
    try {
      await api.duplicateCard(card.id);
      addToast('success', 'カードを複製しました');
      await refresh();
    } catch (e) {
      addToast('error', e.message);
    }
  };

  // ──────── RENDER: CARD EDIT ────────

  if (nav.view === 'edit') {
    return (
      <TemplateCardEdit
        card={nav.editCard || null}
        slots={slots}
        onSave={async () => { await refresh(); setNav({ view: 'cards', selectedSlot: nav.selectedSlot }); }}
        onCancel={() => setNav({ view: 'cards', selectedSlot: nav.selectedSlot })}
        addToast={addToast}
      />
    );
  }

  // ──────── RENDER: CARD LIST ────────

  if (nav.view === 'cards' && currentSlot) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <button onClick={() => setNav({ view: 'slots' })} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-body)', padding: 0 }}>‹ スロット一覧</button>
          <span style={{ fontSize: 'var(--fs-title)', fontWeight: 600 }}>{currentSlot.name}</span>
        </div>

        {slotCards.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>カードがありません</div>
        ) : (
          slotCards.map(card => (
            <div key={card.id} style={{ ...rowStyle, position: 'relative' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600 }}>{card.name}</div>
                {card.positive && <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.positive}</div>}
              </div>
              <div style={{ position: 'relative' }}>
                <button style={menuBtnStyle} onClick={() => setMenuTarget(menuTarget === card.id ? null : card.id)}>⋯</button>
                {menuTarget === card.id && (
                  <ContextMenu
                    items={[
                      { label: '編集', action: () => setNav({ view: 'edit', selectedSlot: currentSlot.id, editCard: card }) },
                      { label: '複製', action: () => duplicateCard(card) },
                      { label: '削除', action: () => deleteCard(card), danger: true },
                    ]}
                    onClose={() => setMenuTarget(null)}
                  />
                )}
              </div>
            </div>
          ))
        )}

        <div style={{ padding: '12px 16px' }}>
          <button
            onClick={() => setNav({ view: 'edit', selectedSlot: currentSlot.id, editCard: null })}
            style={{ width: '100%', padding: '10px', border: '1px dashed var(--line)', borderRadius: 'var(--radius-s)', background: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-label)' }}
          >＋ カード追加</button>
        </div>
      </div>
    );
  }

  // ──────── RENDER: SLOT LIST ────────

  return (
    <div>
      {slots.map((slot, idx) => (
        <div
          key={slot.id}
          draggable
          onDragStart={e => handleDragStart(e, idx)}
          onDragOver={e => handleDragOver(e, idx)}
          onDrop={e => handleDrop(e, idx)}
          onDragEnd={() => setDragIdx(null)}
          style={{ ...rowStyle, position: 'relative', opacity: dragIdx === idx ? 0.4 : 1 }}
        >
          <span style={{ color: 'var(--text-secondary)', cursor: 'grab', fontSize: '18px', touchAction: 'none' }}>☰</span>

          {renameTarget === slot.id ? (
            <input
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenameTarget(null); }}
              style={{ flex: 1, padding: '4px 8px', border: '1px solid var(--accent)', borderRadius: 'var(--radius-s)', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: 'var(--fs-body)' }}
            />
          ) : (
            <button
              onClick={() => setNav({ view: 'cards', selectedSlot: slot.id })}
              style={{ flex: 1, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text-primary)', padding: 0 }}
            >
              {slot.name}
              <span style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', fontWeight: 400, marginLeft: '6px' }}>{cards.filter(c => c.slotId === slot.id).length}枚</span>
            </button>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={slot.useAsFolder} onChange={() => toggleSlotProp(slot, 'useAsFolder')} style={{ cursor: 'pointer' }} />
            F
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={slot.useInFilename} onChange={() => toggleSlotProp(slot, 'useInFilename')} style={{ cursor: 'pointer' }} />
            N
          </label>

          <div style={{ position: 'relative' }}>
            <button style={menuBtnStyle} onClick={() => setMenuTarget(menuTarget === slot.id ? null : slot.id)}>⋯</button>
            {menuTarget === slot.id && (
              <ContextMenu
                items={[
                  { label: '改名', action: () => startRename(slot) },
                  { label: '削除', action: () => deleteSlot(slot), danger: true },
                ]}
                onClose={() => setMenuTarget(null)}
              />
            )}
          </div>
        </div>
      ))}

      {addSlotMode ? (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', gap: '8px' }}>
          <input
            autoFocus
            value={newSlotName}
            onChange={e => setNewSlotName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitAddSlot(); if (e.key === 'Escape') { setAddSlotMode(false); setNewSlotName(''); } }}
            placeholder="スロット名"
            style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--accent)', borderRadius: 'var(--radius-s)', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: 'var(--fs-label)' }}
          />
          <button onClick={commitAddSlot} style={{ padding: '8px 14px', border: 'none', borderRadius: 'var(--radius-s)', background: 'var(--accent)', color: 'var(--accent-contrast)', cursor: 'pointer', fontSize: 'var(--fs-label)' }}>追加</button>
          <button onClick={() => { setAddSlotMode(false); setNewSlotName(''); }} style={{ padding: '8px 14px', border: '1px solid var(--line)', borderRadius: 'var(--radius-s)', background: 'none', cursor: 'pointer', fontSize: 'var(--fs-label)' }}>✕</button>
        </div>
      ) : (
        <div style={{ padding: '12px 16px' }}>
          <button
            onClick={() => setAddSlotMode(true)}
            style={{ width: '100%', padding: '10px', border: '1px dashed var(--line)', borderRadius: 'var(--radius-s)', background: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-label)' }}
          >＋ スロット追加</button>
        </div>
      )}

      <div style={{ padding: '8px 16px', fontSize: 'var(--fs-label)', color: 'var(--text-secondary)' }}>
        F=フォルダ分け、N=ファイル名使用
      </div>
    </div>
  );
}
