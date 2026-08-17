const tabs = [
  { key: 'generate', label: '生成' },
  { key: 'album', label: 'アルバム' },
  { key: 'template', label: 'テンプレート' },
];

export default function Footer({ activeTab, onTabChange }) {
  return (
    <nav style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      height: '54px',
      display: 'flex',
      background: 'var(--surface)',
      borderTop: '1px solid var(--line)',
      zIndex: 100,
    }}>
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          style={{
            flex: 1,
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 'var(--fs-label)',
            fontWeight: activeTab === tab.key ? 600 : 400,
            color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-secondary)',
            borderTop: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
          }}
        >{tab.label}</button>
      ))}
    </nav>
  );
}
