const tabLabels = {
  generate: '生成',
  album: 'アルバム',
  template: 'テンプレート',
};

function formatTime(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function LampCluster({ connectionState, onLampClick }) {
  const route = connectionState?.route ?? 'offline';
  const lastCheck = connectionState?.lastCheck ?? null;

  let dotColor, dotShadow, name;
  if (route === 'fran') {
    dotColor = '#22c55e';
    dotShadow = '0 0 4px rgba(34,197,94,0.5)';
    name = 'Fran';
  } else if (route === 'cloud') {
    dotColor = '#ef4444';
    dotShadow = '0 0 4px rgba(239,68,68,0.5)';
    name = 'Cloud';
  } else {
    dotColor = '#9ca3af';
    dotShadow = 'none';
    name = '未接続';
  }

  return (
    <button
      onClick={onLampClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '4px 8px',
        borderRadius: 'var(--radius-s)',
        minHeight: '44px',
      }}
      aria-label={`接続状態: ${name}`}
    >
      <span style={{
        width: '10px',
        height: '10px',
        borderRadius: '50%',
        background: dotColor,
        boxShadow: dotShadow,
        flexShrink: 0,
      }} />
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, textAlign: 'left' }}>
        <span style={{ fontSize: '11px', color: 'var(--text)', fontWeight: 500 }}>{name}</span>
        {lastCheck && (
          <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>{formatTime(lastCheck)}</span>
        )}
      </span>
    </button>
  );
}

export default function Header({ activeTab, onOpenSettings, onLampClick, connectionState }) {
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <LampCluster connectionState={connectionState} onLampClick={onLampClick} />
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
      </div>
    </header>
  );
}
