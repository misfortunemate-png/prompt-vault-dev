import { useState, useEffect } from 'react';
import TemplateCardList from './TemplateCardList';
import TemplatePresetList from './TemplatePresetList';

export default function TemplateScreen({ addToast, resetKey }) {
  const [subNav, setSubNav] = useState('cards');

  useEffect(() => {
    if (resetKey > 0) {
      setSubNav('cards');
      window.scrollTo(0, 0);
    }
  }, [resetKey]);

  return (
    <div style={{ height: 'calc(100dvh - 48px - 54px)', overflowY: 'auto' }}>
      <div style={{ display: 'flex', borderBottom: '2px solid var(--line)', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
        {[
          { key: 'cards', label: 'カード' },
          { key: 'presets', label: 'プリセット' },
        ].map(item => (
          <button
            key={item.key}
            onClick={() => setSubNav(item.key)}
            style={{
              flex: 1,
              padding: '12px 0',
              background: 'none',
              border: 'none',
              borderBottom: subNav === item.key ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: '-2px',
              cursor: 'pointer',
              fontSize: 'var(--fs-body)',
              fontWeight: subNav === item.key ? 600 : 400,
              color: subNav === item.key ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >{item.label}</button>
        ))}
      </div>

      {subNav === 'cards'
        ? <TemplateCardList addToast={addToast} />
        : <TemplatePresetList addToast={addToast} />
      }
    </div>
  );
}
