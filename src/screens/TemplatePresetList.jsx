import { useState, useEffect } from 'react';
import TemplatePresetEdit from './TemplatePresetEdit';
import { api } from '../lib/api';

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
          {thumbs[i] && <img src={thumbs[i].thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        </div>
      ))}
    </div>
  );
}

export default function TemplatePresetList({ addToast }) {
  const [cardsData, setCardsData] = useState(null);
  const [presetsData, setPresetsData] = useState(null);
  const [allTags, setAllTags] = useState([]);
  const [filterTag, setFilterTag] = useState(null);
  const [nav, setNav] = useState({ view: 'list' });
  const [presetThumbs, setPresetThumbs] = useState({});

  const refresh = async () => {
    try {
      const [cd, pd, tags] = await Promise.all([api.getCards(), api.getPresets(), api.getPresetTags()]);
      setCardsData(cd);
      setPresetsData(pd);
      setAllTags(tags);
    } catch (e) {
      addToast('error', e.message);
    }
  };

  useEffect(() => { refresh(); }, []);

  // Load thumbnails for each preset
  useEffect(() => {
    if (!presetsData) return;
    let cancelled = false;
    const load = async () => {
      const results = {};
      await Promise.all(presetsData.presets.map(async (preset) => {
        try {
          const r = await api.getByPreset(preset.id, 4);
          results[preset.id] = r.images || [];
        } catch { results[preset.id] = []; }
      }));
      if (!cancelled) setPresetThumbs(results);
    };
    load();
    return () => { cancelled = true; };
  }, [presetsData?.presets?.length]);

  if (!presetsData || !cardsData) {
    return <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>読み込み中…</div>;
  }

  const slots = [...(cardsData.slots || [])].sort((a, b) => a.order - b.order);
  const cards = cardsData.cards || [];
  const presets = presetsData.presets || [];
  const filtered = filterTag ? presets.filter(p => (p.tags || []).includes(filterTag)) : presets;

  const deletePreset = async (preset) => {
    if (!window.confirm(`「${preset.name}」を削除しますか？`)) return;
    try {
      await api.deletePreset(preset.id);
      addToast('success', 'プリセットを削除しました');
      await refresh();
    } catch (e) { addToast('error', e.message); }
  };

  const duplicatePreset = async (preset) => {
    try {
      await api.duplicatePreset(preset.id);
      addToast('success', 'プリセットを複製しました');
      await refresh();
    } catch (e) { addToast('error', e.message); }
  };

  const buildPathPreview = (preset) => {
    const effectiveSlots = preset.slotOrder
      ? preset.slotOrder.map(id => slots.find(s => s.id === id)).filter(Boolean)
      : slots;
    const folderSlotId = preset.folder !== undefined ? preset.folder : slots.find(s => s.useAsFolder)?.id;
    const filenameSlotIds = preset.filename !== undefined ? preset.filename : slots.filter(s => s.useInFilename).map(s => s.id);

    const folderCard = folderSlotId
      ? cards.find(c => c.id === (preset.cards || {})[folderSlotId])?.name
      : null;
    const fileCards = filenameSlotIds
      .map(sid => cards.find(c => c.id === (preset.cards || {})[sid])?.name)
      .filter(Boolean);

    const folder = folderCard || 'その他';
    const file = (fileCards.length > 0 ? fileCards.join('_') : 'gen') + '_{seed}.png';
    return `${folder}/${file}`;
  };

  const buildSlotAssignment = (preset) => {
    const effectiveSlots = preset.slotOrder
      ? preset.slotOrder.map(id => slots.find(s => s.id === id)).filter(Boolean)
      : slots;
    return effectiveSlots
      .map(s => {
        const cardId = (preset.cards || {})[s.id];
        if (!cardId) return null;
        const cardName = cards.find(c => c.id === cardId)?.name;
        if (!cardName) return null;
        return `${s.name}:${cardName}`;
      })
      .filter(Boolean)
      .join(' ／ ');
  };

  if (nav.view === 'edit') {
    return (
      <TemplatePresetEdit
        preset={nav.editPreset || null}
        cardsData={cardsData}
        allTags={allTags}
        onSave={async () => { await refresh(); setNav({ view: 'list' }); }}
        onCancel={() => setNav({ view: 'list' })}
        addToast={addToast}
      />
    );
  }

  return (
    <div>
      {allTags.length > 0 && (
        <div style={{ padding: '10px 16px', display: 'flex', flexWrap: 'wrap', gap: '6px', borderBottom: '1px solid var(--line)' }}>
          <button
            onClick={() => setFilterTag(null)}
            style={{ padding: '4px 10px', borderRadius: '99px', border: 'none', cursor: 'pointer', fontSize: 'var(--fs-label)', background: !filterTag ? 'var(--accent)' : 'var(--surface)', color: !filterTag ? 'var(--accent-contrast)' : 'var(--text-secondary)' }}
          >すべて</button>
          {allTags.map(tag => (
            <button
              key={tag}
              onClick={() => setFilterTag(tag === filterTag ? null : tag)}
              style={{ padding: '4px 10px', borderRadius: '99px', border: 'none', cursor: 'pointer', fontSize: 'var(--fs-label)', background: filterTag === tag ? 'var(--accent)' : 'var(--surface)', color: filterTag === tag ? 'var(--accent-contrast)' : 'var(--text-secondary)' }}
            >{tag}</button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          {filterTag ? `「${filterTag}」のプリセットはありません` : 'プリセットがありません'}
        </div>
      ) : (
        filtered.map(preset => {
          const thumbs = presetThumbs[preset.id] || [];
          const slotAssign = buildSlotAssignment(preset);
          const pathPreview = buildPathPreview(preset);
          return (
            <div key={preset.id} style={{ display: 'flex', gap: '10px', padding: '12px 14px', borderBottom: '1px solid var(--line)', alignItems: 'flex-start' }}>
              {/* 2×2 サムネ */}
              <ThumbGrid thumbs={thumbs} />

              {/* テキスト情報 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--fs-body)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preset.name}</div>
                {(preset.tags || []).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '4px' }}>
                    {preset.tags.map(t => (
                      <span key={t} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '99px', padding: '1px 6px', fontSize: '11px', color: 'var(--text-secondary)' }}>{t}</span>
                    ))}
                  </div>
                )}
                {slotAssign && (
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slotAssign}</div>
                )}
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>→ {pathPreview}</div>
              </div>

              {/* ボタン列 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0, alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button style={btnStyle(false)} onClick={() => setNav({ view: 'edit', editPreset: preset })}>編集</button>
                  <button style={btnStyle(false)} onClick={() => duplicatePreset(preset)}>コピー</button>
                </div>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <button style={btnStyle(true)} onClick={() => deletePreset(preset)}>削除</button>
                  {thumbs.length > 0 && <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{thumbs.length}枚+</span>}
                </div>
              </div>
            </div>
          );
        })
      )}

      <div style={{ padding: '12px 16px' }}>
        <button
          onClick={() => setNav({ view: 'edit', editPreset: null })}
          style={{ width: '100%', padding: '10px', border: '1px dashed var(--line)', borderRadius: 'var(--radius-s)', background: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-label)' }}
        >＋ プリセット追加</button>
      </div>
    </div>
  );
}
