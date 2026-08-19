import { useState, useEffect, useRef } from 'react';
import TemplatePresetEdit from './TemplatePresetEdit';
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
      position: 'absolute', right: 0, top: '100%',
      background: 'var(--surface)', border: '1px solid var(--line)',
      borderRadius: 'var(--radius-s)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      zIndex: 300, minWidth: '140px',
    }}>
      {items.map((item, i) => (
        <div
          key={i}
          onMouseDown={(e) => { e.preventDefault(); item.action(); onClose(); }}
          style={{ padding: '10px 14px', fontSize: 'var(--fs-label)', cursor: 'pointer', color: item.danger ? '#c0392b' : 'var(--text-primary)', borderBottom: i < items.length - 1 ? '1px solid var(--line)' : 'none' }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >{item.label}</div>
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
  const [menuTarget, setMenuTarget] = useState(null);

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

  if (!presetsData || !cardsData) {
    return <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>読み込み中…</div>;
  }

  const presets = presetsData.presets || [];
  const filtered = filterTag ? presets.filter(p => (p.tags || []).includes(filterTag)) : presets;

  const deletePreset = async (preset) => {
    if (!window.confirm(`「${preset.name}」を削除しますか？`)) return;
    try {
      await api.deletePreset(preset.id);
      addToast('success', 'プリセットを削除しました');
      await refresh();
    } catch (e) {
      addToast('error', e.message);
    }
  };

  const duplicatePreset = async (preset) => {
    try {
      await api.duplicatePreset(preset.id);
      addToast('success', 'プリセットを複製しました');
      await refresh();
    } catch (e) {
      addToast('error', e.message);
    }
  };

  if (nav.view === 'edit') {
    const editPreset = nav.editPreset || null;
    return (
      <TemplatePresetEdit
        preset={editPreset}
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
        filtered.map(preset => (
          <div key={preset.id} style={{ ...rowStyle, position: 'relative' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600 }}>{preset.name}</div>
              {(preset.tags || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                  {preset.tags.map(t => (
                    <span key={t} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '99px', padding: '1px 6px', fontSize: 'var(--fs-label)', color: 'var(--text-secondary)' }}>{t}</span>
                  ))}
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <button style={menuBtnStyle} onClick={() => setMenuTarget(menuTarget === preset.id ? null : preset.id)}>⋯</button>
              {menuTarget === preset.id && (
                <ContextMenu
                  items={[
                    { label: '編集', action: () => setNav({ view: 'edit', editPreset: preset }) },
                    { label: '複製', action: () => duplicatePreset(preset) },
                    { label: '削除', action: () => deletePreset(preset), danger: true },
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
          onClick={() => setNav({ view: 'edit', editPreset: null })}
          style={{ width: '100%', padding: '10px', border: '1px dashed var(--line)', borderRadius: 'var(--radius-s)', background: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-label)' }}
        >＋ プリセット追加</button>
      </div>
    </div>
  );
}
