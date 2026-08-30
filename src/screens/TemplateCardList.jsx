import { useState, useEffect } from 'react';
import TemplateCardEdit from './TemplateCardEdit';
import { api } from '../lib/api';
import { resolveThumbUrl } from '../lib/connection';

const btnStyle = (danger) => ({
  background: 'none',
  border: `1px solid ${danger ? 'rgba(192,57,43,0.3)' : 'var(--line)'}`,
  borderRadius: 'var(--radius-s)',
  color: danger ? '#c0392b' : 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: '12px',
  padding: '5px 8px',
  flexShrink: 0,
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
});

function ThumbGrid({ thumbs }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', width: '86px', flexShrink: 0 }}>
      {[0, 1, 2, 3].map(i => (
        <div key={i} style={{ width: '42px', height: '42px', background: 'var(--line)', borderRadius: '2px', overflow: 'hidden' }}>
          {thumbs[i] && <img src={resolveThumbUrl(thumbs[i].hash)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        </div>
      ))}
    </div>
  );
}

export default function TemplateCardList({ addToast }) {
  const [cardsData, setCardsData] = useState(null);
  const [presetsData, setPresetsData] = useState(null);
  const [nav, setNav] = useState({ view: 'slots' });
  const [addSlotMode, setAddSlotMode] = useState(false);
  const [newSlotName, setNewSlotName] = useState('');
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [cardThumbs, setCardThumbs] = useState({});

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

  // ────── Load thumbnails for card list view ──────
  useEffect(() => {
    if (nav.view !== 'cards' || !cardsData) return;
    const currentSlot = nav.selectedSlot ? cardsData.slots.find(s => s.id === nav.selectedSlot) : null;
    const slotCards = currentSlot ? cardsData.cards.filter(c => c.slotId === currentSlot.id) : [];
    if (!slotCards.length) return;
    let cancelled = false;
    const loadThumbs = async () => {
      const results = {};
      await Promise.all(slotCards.map(async (card) => {
        try {
          if (!card.positive) { results[card.id] = { images: [], total: 0 }; return; }
          const r = await api.getGalleryByCard(card.positive, 4);
          results[card.id] = r;
        } catch { results[card.id] = { images: [], total: 0 }; }
      }));
      if (!cancelled) setCardThumbs(results);
    };
    loadThumbs();
    return () => { cancelled = true; };
  }, [nav.view, nav.selectedSlot, cardsData]);

  if (!cardsData) return <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>読み込み中…</div>;

  const slots = [...cardsData.slots].sort((a, b) => a.order - b.order);
  const cards = cardsData.cards;
  const currentSlot = nav.selectedSlot ? slots.find(s => s.id === nav.selectedSlot) : null;
  const slotCards = currentSlot ? cards.filter(c => c.slotId === currentSlot.id) : [];

  // ────── Slot rename ──────
  const startRename = (slot) => { setRenameTarget(slot.id); setRenameValue(slot.name); };
  const commitRename = async () => {
    if (!renameValue.trim()) { setRenameTarget(null); return; }
    try {
      await api.updateSlot(renameTarget, { name: renameValue.trim() });
      addToast('success', 'スロット名を更新しました');
      await refresh();
    } catch (e) { addToast('error', e.message); }
    setRenameTarget(null);
  };

  // ────── Slot add ──────
  const commitAddSlot = async () => {
    if (!newSlotName.trim()) { setAddSlotMode(false); return; }
    try {
      await api.addSlot({ name: newSlotName.trim() });
      addToast('success', 'スロットを追加しました');
      setNewSlotName(''); setAddSlotMode(false);
      await refresh();
    } catch (e) { addToast('error', e.message); }
  };

  // ────── Card operations ──────
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
    } catch (e) { addToast('error', e.message); }
  };

  const duplicateCard = async (card) => {
    try {
      await api.duplicateCard(card.id);
      addToast('success', 'カードを複製しました');
      await refresh();
    } catch (e) { addToast('error', e.message); }
  };

  // ────── Card edit view ──────
  if (nav.view === 'edit') {
    return (
      <TemplateCardEdit
        card={nav.editCard || null}
        slotId={nav.selectedSlot}
        slotName={currentSlot?.name || ''}
        cards={slotCards}
        defaultParentId={nav.editParentId || null}
        onSave={async () => { await refresh(); setNav({ view: 'cards', selectedSlot: nav.selectedSlot }); }}
        onCancel={() => setNav({ view: 'cards', selectedSlot: nav.selectedSlot })}
        addToast={addToast}
      />
    );
  }

  // ────── Card list view ──────
  if (nav.view === 'cards' && currentSlot) {
    const rootCards = slotCards.filter(c => !c.parentId);
    const childrenOf = (parentId) => slotCards.filter(c => c.parentId === parentId);

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <button onClick={() => setNav({ view: 'slots' })} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-body)', padding: 0 }}>‹ スロット一覧</button>
          <span style={{ fontSize: 'var(--fs-title)', fontWeight: 600 }}>{currentSlot.name}</span>
        </div>

        {rootCards.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>カードがありません</div>
        ) : (
          rootCards.map(card => {
            const ct = cardThumbs[card.id] || { images: [], total: 0 };
            const children = childrenOf(card.id);
            return (
              <div key={card.id} style={{ borderBottom: '1px solid var(--line)' }}>
                {/* 親カード行 */}
                <div style={{ display: 'flex', gap: '10px', padding: '12px 14px', alignItems: 'flex-start' }}>
                  <ThumbGrid thumbs={ct.images} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--fs-body)', marginBottom: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {card.name}
                      {children.length > 0 && (
                        <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--accent)', fontWeight: 400 }}>⚄ 子{children.length}種</span>
                      )}
                    </div>
                    {card.positive && (
                      <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', marginBottom: '2px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{card.positive}</div>
                    )}
                    {card.negative && (
                      <div style={{ fontSize: 'var(--fs-label)', color: '#c0392b', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{card.negative}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0, alignItems: 'flex-end' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button style={btnStyle(false)} onClick={() => setNav({ view: 'edit', selectedSlot: currentSlot.id, editCard: card })}>編集</button>
                      <button style={btnStyle(false)} onClick={() => duplicateCard(card)}>コピー</button>
                    </div>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <button style={btnStyle(true)} onClick={() => deleteCard(card)}>削除</button>
                      {ct.total > 0 && <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{ct.total}枚</span>}
                    </div>
                    <button
                      style={{ ...btnStyle(false), fontSize: '11px', color: 'var(--accent)', borderColor: 'var(--accent)' }}
                      onClick={() => setNav({ view: 'edit', selectedSlot: currentSlot.id, editCard: null, editParentId: card.id })}
                    >＋子</button>
                  </div>
                </div>

                {/* 子カード行（インデント） */}
                {children.map(child => (
                  <div key={child.id} style={{ display: 'flex', gap: '10px', padding: '8px 14px 8px 30px', alignItems: 'center', background: 'var(--surface)', borderTop: '1px solid var(--line)' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', flexShrink: 0 }}>∟</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 'var(--fs-label)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{child.name}</div>
                      {child.positive && (
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{child.positive}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      <button style={btnStyle(false)} onClick={() => setNav({ view: 'edit', selectedSlot: currentSlot.id, editCard: child })}>編集</button>
                      <button style={btnStyle(true)} onClick={() => deleteCard(child)}>削除</button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })
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

  // ────── Slot list view ──────
  return (
    <div>
      {slots.map(slot => (
        <div key={slot.id} style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)', gap: '8px' }}>
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
              <span style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', fontWeight: 400, marginLeft: '6px' }}>
                {cards.filter(c => c.slotId === slot.id).length}枚
              </span>
            </button>
          )}
          <button onClick={() => startRename(slot)} title="改名" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '16px', padding: '0 4px' }}>✎</button>
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
    </div>
  );
}
