const tabLabels = {
  generate: '生成',
  album: 'アルバム',
  template: 'テンプレート',
};

export default function Header({ activeTab, onOpenSettings }) {
  return (
    <header style={{
      position: 'sticky',
      top: 0,
      height: '48px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      background: 'var(--surface)',
      borderBottom: '1px solid var(--line)',
      zIndex: 100,
    }}>
      <span style={{ fontWeight: 600, fontSize: 'var(--fs-title)' }}>
        {tabLabels[activeTab] || activeTab}
      </span>
      <button
        onClick={onOpenSettings}
        style={{
          background: 'none',
          border: 'none',
          fontSize: '22px',
          cursor: 'pointer',
          color: 'var(--text)',
          padding: '4px',
          minWidth: '44px',
          minHeight: '44px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label="設定を開く"
      >⚙</button>
    </header>
  );
}
