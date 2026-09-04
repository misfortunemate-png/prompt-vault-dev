import { useState, useCallback, useEffect } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import Toast from './components/Toast';
import GenerateScreen from './screens/GenerateScreen';
import AlbumScreen from './screens/AlbumScreen';
import TemplateScreen from './screens/TemplateScreen';
import SettingsScreen from './screens/SettingsScreen';
import { api } from './lib/api';
import { getConnection, checkReachability, initVisibilityCheck, destroyVisibilityCheck } from './lib/connection';
import { startVersionCheck } from './lib/versionCheck';

const DISPLAY_KEY = 'pv-display-settings';

const FONT_REGISTRY = {
  ja: [
    { id: 'bizudp', label: 'BIZ UDPGothic', family: '"BIZ UDPGothic", sans-serif', source: 'system' },
    { id: 'noto-serif-jp', label: 'Noto Serif JP', family: '"Noto Serif JP", serif', source: 'google' },
    { id: 'noto-sans-jp', label: 'Noto Sans JP', family: '"Noto Sans JP", sans-serif', source: 'google' },
  ],
  en: [
    { id: 'system', label: 'System UI', family: 'system-ui, sans-serif', source: 'system' },
    { id: 'inter', label: 'Inter', family: '"Inter", sans-serif', source: 'google' },
    { id: 'eb-garamond', label: 'EB Garamond', family: '"EB Garamond", serif', source: 'google' },
  ],
};

const DISPLAY_DEFAULTS = {
  theme: 'light',
  fontSize: 16,
  lineHeight: 1.7,
  padding: 1.5,
  fontJa: 'bizudp',
  fontEn: 'system',
};

function applyDisplaySettings(s) {
  document.documentElement.setAttribute('data-theme', s.theme);

  const root = document.documentElement.style;
  const fs = s.fontSize;
  root.setProperty('--fs-body', fs + 'px');
  root.setProperty('--fs-heading', Math.round(fs * 1.375) + 'px');
  root.setProperty('--fs-title', Math.round(fs * 1.125) + 'px');
  root.setProperty('--fs-label', Math.round(fs * 0.8125) + 'px');
  root.setProperty('--lh-body', String(s.lineHeight));
  root.setProperty('--content-padding', s.padding + 'rem');

  const jaFont = FONT_REGISTRY.ja.find(f => f.id === s.fontJa);
  const enFont = FONT_REGISTRY.en.find(f => f.id === s.fontEn);
  if (jaFont) root.setProperty('--font-body', jaFont.family);
  if (enFont) root.setProperty('--font-heading', enFont.family);

  document.querySelectorAll('link[data-pv-font]').forEach(el => el.remove());
  const allFonts = [jaFont, enFont].filter(f => f && f.source === 'google');
  for (const font of allFonts) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.label)}:wght@400;600;700&display=swap`;
    link.setAttribute('data-pv-font', font.id);
    document.head.appendChild(link);
  }
}

function loadDisplaySettings() {
  try {
    const saved = localStorage.getItem(DISPLAY_KEY);
    if (saved) return { ...DISPLAY_DEFAULTS, ...JSON.parse(saved) };
  } catch {}
  return { ...DISPLAY_DEFAULTS };
}

export { FONT_REGISTRY, DISPLAY_DEFAULTS, DISPLAY_KEY, applyDisplaySettings, loadDisplaySettings };

let toastId = 0;

function PlaceholderView({ message }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: 'calc(100dvh - 48px - 54px)',
      color: 'var(--text-secondary)',
      fontSize: 'var(--fs-body)',
    }}>
      {message}
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('generate');
  const [resetKey, setResetKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [debugInitialOpen, setDebugInitialOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [displaySettings, setDisplaySettings] = useState(loadDisplaySettings);
  const [results, setResults] = useState([]);
  const [maxResults, setMaxResults] = useState(5);
  const [connectionState, setConnectionState] = useState(() => getConnection());

  const handleTabChange = useCallback((tab) => {
    if (tab === activeTab) {
      setResetKey(k => k + 1);
    } else {
      setActiveTab(tab);
    }
  }, [activeTab]);

  useEffect(() => {
    applyDisplaySettings(displaySettings);
  }, [displaySettings]);

  useEffect(() => {
    api.getSettings().then(s => {
      if (s.generation?.maxResults) setMaxResults(s.generation.maxResults);
    }).catch(() => {});
  }, []);

  const addToast = useCallback((type, message) => {
    const id = ++toastId;
    setToasts(prev => {
      const next = [...prev, { id, type, message }];
      return next.length > 3 ? next.slice(-3) : next;
    });
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    checkReachability().then(setConnectionState).catch(() => {});
    initVisibilityCheck(() => {
      checkReachability().then(setConnectionState).catch(() => {});
    });
    return () => destroyVisibilityCheck();
  }, []);

  useEffect(() => {
    return startVersionCheck(() => {
      addToast('info', '新しいバージョンがあります。3秒後に更新します…');
      setTimeout(() => window.location.reload(), 3000);
    });
  }, [addToast]);

  const updateDisplay = useCallback((key, value) => {
    setDisplaySettings(prev => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(DISPLAY_KEY, JSON.stringify(next));
      applyDisplaySettings(next);
      return next;
    });
  }, []);

  return (
    <>
      <Header
        activeTab={activeTab}
        onOpenSettings={() => { setDebugInitialOpen(false); setSettingsOpen(true); }}
        onLampClick={() => { setDebugInitialOpen(true); setSettingsOpen(true); }}
        connectionState={connectionState}
      />
      <div style={{ display: activeTab === 'generate' ? 'block' : 'none' }}>
        <GenerateScreen addToast={addToast} results={results} setResults={setResults} maxResults={maxResults} resetKey={resetKey} connectionRoute={connectionState.route} activeTab={activeTab} />
      </div>
      {activeTab === 'album' && <AlbumScreen addToast={addToast} resetKey={resetKey} connectionRoute={connectionState.route} />}
      {activeTab === 'template' && <TemplateScreen addToast={addToast} resetKey={resetKey} />}
      {activeTab !== 'generate' && activeTab !== 'album' && activeTab !== 'template' && <PlaceholderView message="未実装のタブです" />}
      <Footer activeTab={activeTab} onTabChange={handleTabChange} />
      <Toast toasts={toasts} removeToast={removeToast} />
      {settingsOpen && (
        <SettingsScreen
          onClose={() => { setSettingsOpen(false); setDebugInitialOpen(false); }}
          addToast={addToast}
          displaySettings={displaySettings}
          updateDisplay={updateDisplay}
          connectionState={connectionState}
          onConnectionChange={setConnectionState}
          debugInitialOpen={debugInitialOpen}
        />
      )}
    </>
  );
}
