import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import ImageViewer from '../components/ImageViewer';
import { getConnection, resolveThumbUrl } from '../lib/connection';
import { decrypt, hasVaultKey } from '../lib/crypto';
import { generateAndUploadThumb } from '../lib/thumbGen';
import { getThumb, putThumb } from '../lib/thumbDb';

const thumbCache = new Map();

async function fetchWithRetry(url, options, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (res.status === 404) throw new Error('HTTP 404');
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (e.message === 'HTTP 404') throw e;
      lastErr = e;
    }
    if (i < retries - 1) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }
  throw lastErr;
}

let activeDecrypts = 0;
const MAX_CONCURRENT = 4;
const waitQueue = [];
function acquireSlot() {
  return new Promise(resolve => {
    if (activeDecrypts < MAX_CONCURRENT) { activeDecrypts++; resolve(); }
    else waitQueue.push(resolve);
  });
}
function releaseSlot() {
  activeDecrypts--;
  if (waitQueue.length > 0) { activeDecrypts++; waitQueue.shift()(); }
}

function findNextSibling(tree, targetPath) {
  function search(nodes) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].path === targetPath) {
        if (i + 1 < nodes.length) return nodes[i + 1].path;
        return null;
      }
      if (nodes[i].children?.length) {
        const found = search(nodes[i].children);
        if (found) return found;
      }
    }
    return null;
  }
  return search(tree);
}

function FolderIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
    </svg>
  );
}

function Placeholder() {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '18px' }}>
      ⟳
    </div>
  );
}

function ThumbCell({ image, onClick, isFavorite, showFolder }) {
  const conn = getConnection();
  const isCloud = conn.route === 'cloud';
  const [blobUrl, setBlobUrl] = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!isCloud) return;
    if (thumbCache.has(image.hash)) {
      setBlobUrl(thumbCache.get(image.hash));
      return;
    }
    let cancelled = false;
    const obs = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      obs.disconnect();
      (async () => {
        // 1. IndexedDB キャッシュ確認（thumb_ok=1 の webp のみ保存済み）
        if (image.thumb_ok) {
          const cached = await getThumb(image.hash);
          if (cached && !cancelled) {
            const url = URL.createObjectURL(new Blob([cached], { type: 'image/webp' }));
            thumbCache.set(image.hash, url);
            setBlobUrl(url);
            return;
          }
        }
        if (cancelled) return;

        // 2. ネットワーク取得（リトライ×3、1s/2s/3s バックオフ）
        const headers = conn.token ? { 'Authorization': `Bearer ${conn.token}` } : {};
        const fetchUrl = image.thumb_ok
          ? conn.cloudUrl + `/thumbs/${image.hash}`
          : conn.cloudUrl + `/gallery/image/${image.hash}/data`;
        const mimeType = image.thumb_ok ? 'image/webp' : 'image/png';

        await acquireSlot();
        if (cancelled) { releaseSlot(); return; }
        try {
          const res = await fetchWithRetry(fetchUrl, { headers });
          const plain = await decrypt(await res.arrayBuffer());
          releaseSlot();
          if (cancelled) return;
          const url = URL.createObjectURL(new Blob([plain], { type: mimeType }));
          thumbCache.set(image.hash, url);
          setBlobUrl(url);
          // thumb_ok=1 の webp だけ IndexedDB に保存（フルPNGは保存しない）
          if (image.thumb_ok) putThumb(image.hash, plain).catch(() => {});
          if (!image.thumb_ok && isCloud) generateAndUploadThumb(plain, image.hash, conn).catch(() => {});
        } catch {
          releaseSlot();
        }
      })();
    }, { rootMargin: '200px' });
    if (rootRef.current) obs.observe(rootRef.current);
    return () => {
      cancelled = true;
      obs.disconnect();
    };
  }, [isCloud, image.hash, image.thumb_ok, conn.cloudUrl, conn.token]);

  const imgSrc = isCloud ? blobUrl : resolveThumbUrl(image.hash);

  return (
    <div ref={rootRef} onClick={onClick} style={{ cursor: 'pointer', position: 'relative' }}>
      <div style={{ aspectRatio: '1/1', overflow: 'hidden', background: 'var(--line)' }}>
        {imgSrc ? (
          <img
            src={imgSrc}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            loading="lazy"
          />
        ) : (
          <Placeholder />
        )}
      </div>
      {isFavorite && (
        <span style={{ position: 'absolute', top: '3px', right: '4px', color: '#f5c518', fontSize: '13px', lineHeight: 1, textShadow: '0 1px 2px rgba(0,0,0,0.7)', pointerEvents: 'none' }}>★</span>
      )}
      {showFolder && image.folder && (
        <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.55)', color: 'rgba(255,255,255,0.85)', fontSize: '10px', padding: '2px 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{image.folder}</span>
      )}
    </div>
  );
}

function FolderRow({ node, depth, onNavigate }) {
  return (
    <>
      <button
        onClick={() => onNavigate(node.path)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
          background: 'none', border: 'none', borderBottom: '1px solid var(--line)',
          cursor: 'pointer', padding: `10px 12px 10px ${12 + depth * 16}px`,
          color: 'var(--text)', fontSize: 'var(--fs-body)', textAlign: 'left', minHeight: '44px',
        }}
      >
        <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}><FolderIcon /></span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-label)', flexShrink: 0 }}>{node.imageCount}枚</span>
      </button>
      {node.children?.map(child => (
        <FolderRow key={child.path} node={child} depth={depth + 1} onNavigate={onNavigate} />
      ))}
    </>
  );
}

function FolderCard({ node, onNavigate }) {
  return (
    <button
      onClick={() => onNavigate(node.path)}
      style={{
        display: 'flex', alignItems: 'center', gap: '12px', width: '100%',
        background: 'none', border: '1px solid var(--line)', borderRadius: '8px',
        cursor: 'pointer', padding: '10px 12px', color: 'var(--text)',
        textAlign: 'left', boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', flexShrink: 0 }}>
        {[0, 1, 2, 3].map(i => {
          const hash = node.previewHashes?.[i];
          return (
            <div key={i} style={{ width: '60px', height: '60px', overflow: 'hidden', background: 'var(--line)', borderRadius: '2px' }}>
              {hash ? (
                <img src={resolveThumbUrl(hash)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" />
              ) : (
                <Placeholder />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</div>
        <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', marginTop: '4px' }}>{node.imageCount}枚</div>
      </div>
    </button>
  );
}

function FolderCardTree({ nodes, onNavigate, depth = 0 }) {
  return (
    <>
      {nodes.map(node => (
        <div key={node.path} style={depth > 0 ? { paddingLeft: `${depth * 16}px` } : {}}>
          <FolderCard node={node} onNavigate={onNavigate} />
          {node.children?.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px', marginTop: '8px' }}>
              <FolderCardTree nodes={node.children} onNavigate={onNavigate} depth={depth + 1} />
            </div>
          )}
        </div>
      ))}
    </>
  );
}

const SECTION_LABEL = { fontSize: 'var(--fs-title)', fontWeight: 600, margin: '0 0 8px' };
const SIZE_PRESETS = [{ label: '小', val: 80 }, { label: '中', val: 110 }, { label: '大', val: 160 }];

export default function AlbumScreen({ addToast, resetKey, connectionRoute }) {
  const [galleryData, setGalleryData] = useState(null);
  const [recentImages, setRecentImages] = useState([]);
  const [presets, setPresets] = useState([]);
  const [path, setPath] = useState(null);
  const [folderData, setFolderData] = useState(null);

  // フラット表示モード: null | { type: 'favorites'|'search'|'preset', label, images }
  const [flatMode, setFlatMode] = useState(null);

  // ビューア
  const [viewer, setViewer] = useState(null); // null | { images, idx }

  // お気に入り更新マップ (hash → boolean)
  const [favUpdates, setFavUpdates] = useState({});

  // 検索
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState({ total: 0, processed: 0, newCount: 0, movedCount: 0, deletedCount: 0 });
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('icon');
  const [thumbColMin, setThumbColMin] = useState(() => {
    try { return parseInt(localStorage.getItem('pv_thumbColMin')) || 110; } catch { return 110; }
  });
  const pollRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const loadRoot = useCallback(async () => {
    try {
      const [gallery, recent, presetsData] = await Promise.all([
        api.getGallery(),
        api.getRecentImages(20),
        api.getPresets(),
      ]);
      setGalleryData(gallery);
      setRecentImages(recent.images || []);
      setPresets(presetsData.presets || []);
    } catch (e) {
      if (!e.message?.includes('400')) addToast('error', `ギャラリーの読み込みに失敗しました: ${e.message}`);
      setGalleryData({ tree: [], totalImages: 0, totalFolders: 0 });
      setRecentImages([]);
      setPresets([]);
    }
  }, [addToast]);

  const loadFolder = useCallback(async (folderPath) => {
    try {
      const data = await api.getGalleryFolder(folderPath);
      setFolderData(data);
    } catch (e) {
      addToast('error', `フォルダの読み込みに失敗しました: ${e.message}`);
    }
  }, [addToast]);

  // cloud モードで vault key が未設定なら早期警告
  useEffect(() => {
    if (connectionRoute === 'cloud' && !hasVaultKey()) {
      addToast('error', 'vault鍵が未設定: 設定 → 接続設定でインポートしてください');
    }
  }, [connectionRoute, addToast]);

  useEffect(() => {
    if (!connectionRoute || connectionRoute === 'offline') return;
    setLoading(true);
    loadRoot().finally(() => setLoading(false));
  }, [connectionRoute, loadRoot]);

  useEffect(() => {
    if (resetKey > 0) {
      setPath(null);
      setFlatMode(null);
      setFolderData(null);
      setViewer(null);
      setSearchOpen(false);
      setSearchQuery('');
      loadRoot();
      window.scrollTo(0, 0);
    }
  }, [resetKey, loadRoot]);

  const navigateTo = useCallback(async (folderPath) => {
    setPath(folderPath);
    setFlatMode(null);
    setFolderData(null);
    setViewer(null);
    setSearchOpen(false);
    await loadFolder(folderPath);
  }, [loadFolder]);

  const goRoot = useCallback(() => {
    setPath(null);
    setFlatMode(null);
    setFolderData(null);
    setViewer(null);
    setSearchOpen(false);
    setSearchQuery('');
    loadRoot();
  }, [loadRoot]);

  const goUp = useCallback((targetPath) => {
    if (!targetPath) { goRoot(); return; }
    setPath(targetPath);
    setFlatMode(null);
    setFolderData(null);
    setViewer(null);
    loadFolder(targetPath);
  }, [goRoot, loadFolder]);

  const handleRescan = useCallback(async () => {
    if (scanning) return;
    try {
      await api.postRescan();
      setScanning(true);
      pollRef.current = setInterval(async () => {
        try {
          const status = await api.getRescanStatus();
          setScanStatus(status);
          if (!status.scanning) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setScanning(false);
            addToast('success', `リスキャン完了: 新規${status.newCount}枚、移動${status.movedCount}枚、削除${status.deletedCount}枚`);
            if (path) await loadFolder(path);
            else await loadRoot();
          }
        } catch {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setScanning(false);
        }
      }, 3000);
    } catch {
      addToast('error', 'リスキャンの開始に失敗しました');
    }
  }, [scanning, path, addToast, loadFolder, loadRoot]);

  const showFavorites = useCallback(async () => {
    try {
      const data = await api.getFavorites(50);
      setFlatMode({ type: 'favorites', label: 'お気に入り', images: data.images || [] });
      setPath(null);
      setFolderData(null);
      setViewer(null);
    } catch {
      addToast('error', 'お気に入りの読み込みに失敗しました');
    }
  }, [addToast]);

  const runSearch = useCallback(async (q) => {
    if (!q.trim()) return;
    try {
      const data = await api.searchGallery(q.trim(), 50);
      setFlatMode({ type: 'search', label: `検索: ${q.trim()}`, images: data.images || [] });
      setPath(null);
      setFolderData(null);
      setViewer(null);
    } catch {
      addToast('error', '検索に失敗しました');
    }
  }, [addToast]);

  const showPreset = useCallback(async (preset) => {
    try {
      const data = await api.getByPreset(preset.id, 50);
      setFlatMode({ type: 'preset', label: `プリセット: ${preset.name}`, images: data.images || [] });
      setPath(null);
      setFolderData(null);
      setViewer(null);
    } catch {
      addToast('error', 'プリセットアルバムの読み込みに失敗しました');
    }
  }, [addToast]);

  const handleNextFolder = useCallback(() => {
    if (folderData?.subfolders?.length > 0) {
      navigateTo(folderData.subfolders[0].path);
      return;
    }
    if (!galleryData?.tree || !path) return;
    const nextSibling = findNextSibling(galleryData.tree, path);
    if (nextSibling) navigateTo(nextSibling);
  }, [folderData, galleryData, path, navigateTo]);

  const openViewer = useCallback((images, idx) => {
    setViewer({ images, idx });
  }, []);

  const handleFavoriteToggle = useCallback((hash, val) => {
    setFavUpdates(m => ({ ...m, [hash]: val === 1 }));
  }, []);

  const handleCaptionSave = useCallback(() => {}, []);

  const handleDelete = useCallback((hash) => {
    setViewer(prev => {
      if (!prev) return null;
      const newImages = prev.images.filter(img => img.hash !== hash);
      if (newImages.length === 0) return null;
      return { ...prev, images: newImages };
    });
    setRecentImages(prev => prev.filter(img => img.hash !== hash));
    setFolderData(prev => prev ? { ...prev, images: prev.images.filter(img => img.hash !== hash) } : null);
    setFlatMode(prev => prev ? { ...prev, images: prev.images.filter(img => img.hash !== hash) } : null);
  }, []);

  const setThumbSize = useCallback((val) => {
    setThumbColMin(val);
    try { localStorage.setItem('pv_thumbColMin', val); } catch {}
  }, []);

  const isFavorite = useCallback((img) => {
    return hash => {
      if (hash in favUpdates) return favUpdates[hash];
      return img.favorite === 1;
    };
  }, [favUpdates]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100dvh - 48px - 54px)', color: 'var(--text-secondary)', fontSize: 'var(--fs-body)' }}>
        読み込み中...
      </div>
    );
  }

  const breadcrumb = path
    ? path.split('/').map((name, i, arr) => ({ name, path: arr.slice(0, i + 1).join('/') }))
    : [];

  const isFlat = flatMode !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 48px - 54px)' }}>
      {/* ヘッダー行 */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', borderBottom: '1px solid var(--line)', minHeight: '44px', flexShrink: 0, gap: '6px' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', fontSize: 'var(--fs-label)', minWidth: 0 }}>
          <button
            onClick={goRoot}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: (path || isFlat) ? 'var(--accent)' : 'var(--text)', padding: '4px 0', minHeight: '44px', flexShrink: 0, fontSize: 'var(--fs-label)' }}
          >ルート</button>
          {isFlat && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
              <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>›</span>
              <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--fs-label)' }}>{flatMode.label}</span>
            </span>
          )}
          {!isFlat && breadcrumb.map((item, i) => (
            <span key={item.path} style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
              <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>›</span>
              <button
                onClick={() => goUp(item.path)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: i === breadcrumb.length - 1 ? 'var(--text)' : 'var(--accent)', padding: '4px 0', minHeight: '44px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--fs-label)' }}
              >{item.name}</button>
            </span>
          ))}
        </div>
        {scanning && (
          <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-label)', flexShrink: 0 }}>
            {scanStatus.processed}/{scanStatus.total}枚
          </span>
        )}
        {/* ★ フィルタ */}
        <button
          onClick={() => isFlat && flatMode.type === 'favorites' ? goRoot() : showFavorites()}
          style={{ background: isFlat && flatMode.type === 'favorites' ? 'var(--accent)' : 'none', color: isFlat && flatMode.type === 'favorites' ? '#fff' : '#f5c518', border: '1px solid var(--line)', borderRadius: '4px', cursor: 'pointer', padding: '4px 7px', minHeight: '32px', fontSize: '16px', flexShrink: 0 }}
          title="お気に入り"
        >★</button>
        {/* 🔍 検索 */}
        <button
          onClick={() => { setSearchOpen(v => !v); setTimeout(() => searchInputRef.current?.focus(), 50); }}
          style={{ background: searchOpen ? 'var(--accent)' : 'none', color: searchOpen ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--line)', borderRadius: '4px', cursor: 'pointer', padding: '4px 7px', minHeight: '32px', fontSize: '16px', flexShrink: 0 }}
          title="検索"
        >🔍</button>
        {/* 🔄 リスキャン */}
        <button
          onClick={handleRescan}
          disabled={scanning}
          style={{ background: 'none', border: 'none', cursor: scanning ? 'default' : 'pointer', padding: '4px 6px', minHeight: '44px', fontSize: '18px', opacity: scanning ? 0.5 : 1, flexShrink: 0 }}
          title="リスキャン"
        >{scanning ? '⟳' : '🔄'}</button>
      </div>

      {/* 検索バー */}
      {searchOpen && (
        <div style={{ display: 'flex', gap: '8px', padding: '8px 12px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runSearch(searchQuery); }}
            placeholder="プロンプト・フォルダ・セリフで検索..."
            style={{ flex: 1, background: 'var(--bg-secondary, var(--bg))', border: '1px solid var(--line)', borderRadius: '6px', padding: '8px 10px', fontSize: 'var(--fs-body)', color: 'var(--text)', outline: 'none' }}
          />
          <button
            onClick={() => runSearch(searchQuery)}
            style={{ background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: '6px', padding: '0 14px', cursor: 'pointer', fontSize: 'var(--fs-body)' }}
          >検索</button>
        </div>
      )}

      {/* サイズコントロール */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        {SIZE_PRESETS.map(({ label, val }) => (
          <button
            key={val}
            onClick={() => setThumbSize(val)}
            style={{ background: thumbColMin === val ? 'var(--accent)' : 'none', color: thumbColMin === val ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--line)', borderRadius: '4px', cursor: 'pointer', padding: '2px 8px', fontSize: 'var(--fs-label)', minHeight: '26px', flexShrink: 0 }}
          >{label}</button>
        ))}
        <input
          type="range"
          min={60} max={200} step={5}
          value={thumbColMin}
          onChange={e => setThumbSize(parseInt(e.target.value))}
          style={{ flex: 1, cursor: 'pointer', accentColor: 'var(--accent)' }}
        />
      </div>

      {/* コンテンツ */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 24px' }}>

        {/* フラット表示（お気に入り・検索・プリセット別） */}
        {isFlat ? (
          <section>
            <h2 style={SECTION_LABEL}>{flatMode.label}</h2>
            {flatMode.images.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body)', textAlign: 'center', padding: '32px 0' }}>
                {flatMode.type === 'preset' ? 'このプリセットの画像はまだありません' : '該当する画像がありません'}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${thumbColMin}px, 1fr))`, gap: '2px' }}>
                {flatMode.images.map((img, i) => (
                  <ThumbCell
                    key={img.hash}
                    image={img}
                    onClick={() => openViewer(flatMode.images, i)}
                    isFavorite={img.hash in favUpdates ? favUpdates[img.hash] : img.favorite === 1}
                    showFolder={flatMode.type !== 'favorites'}
                  />
                ))}
              </div>
            )}
          </section>

        ) : path === null ? (
          /* ルート表示 */
          <>
            {recentImages.length > 0 && (
              <section style={{ marginBottom: '20px' }}>
                <h2 style={SECTION_LABEL}>新着</h2>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${thumbColMin}px, 1fr))`, gap: '2px' }}>
                  {recentImages.map((img, i) => (
                    <ThumbCell
                      key={img.hash}
                      image={img}
                      onClick={() => openViewer(recentImages, i)}
                      isFavorite={img.hash in favUpdates ? favUpdates[img.hash] : img.favorite === 1}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* プリセット別 */}
            {presets.length > 0 && (
              <section style={{ marginBottom: '20px' }}>
                <h2 style={SECTION_LABEL}>プリセット別</h2>
                <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
                  {presets.map(p => (
                    <button
                      key={p.id}
                      onClick={() => showPreset(p)}
                      style={{ background: 'var(--line)', border: 'none', borderRadius: '20px', cursor: 'pointer', padding: '6px 14px', fontSize: 'var(--fs-label)', color: 'var(--text)', flexShrink: 0, whiteSpace: 'nowrap' }}
                    >{p.name}</button>
                  ))}
                </div>
              </section>
            )}

            {/* フォルダ */}
            <section>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <h2 style={{ ...SECTION_LABEL, margin: 0 }}>フォルダ</h2>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => setViewMode('list')}
                    style={{ background: viewMode === 'list' ? 'var(--accent)' : 'none', color: viewMode === 'list' ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--line)', borderRadius: '4px', cursor: 'pointer', padding: '4px 8px', fontSize: '16px', minHeight: '32px' }}
                    title="一覧モード"
                  >☰</button>
                  <button
                    onClick={() => setViewMode('icon')}
                    style={{ background: viewMode === 'icon' ? 'var(--accent)' : 'none', color: viewMode === 'icon' ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--line)', borderRadius: '4px', cursor: 'pointer', padding: '4px 8px', fontSize: '16px', minHeight: '32px' }}
                    title="アイコンモード"
                  >▦</button>
                </div>
              </div>
              {!galleryData?.tree?.length ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body)', textAlign: 'center', padding: '32px 0' }}>
                  保存済み画像はありません
                </div>
              ) : viewMode === 'list' ? (
                <div style={{ border: '1px solid var(--line)', borderRadius: '6px', overflow: 'hidden' }}>
                  {galleryData.tree.map(node => (
                    <FolderRow key={node.path} node={node} depth={0} onNavigate={navigateTo} />
                  ))}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(thumbColMin * 2.6)}px, 1fr))`, gap: '8px' }}>
                  <FolderCardTree nodes={galleryData.tree} onNavigate={navigateTo} />
                </div>
              )}
            </section>
          </>

        ) : (
          /* フォルダ内表示 */
          <>
            {folderData?.subfolders?.length > 0 && (
              <section style={{ marginBottom: '16px' }}>
                <div style={{ border: '1px solid var(--line)', borderRadius: '6px', overflow: 'hidden' }}>
                  {folderData.subfolders.map(sf => (
                    <button
                      key={sf.path}
                      onClick={() => navigateTo(sf.path)}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', padding: '10px 12px', color: 'var(--text)', fontSize: 'var(--fs-body)', textAlign: 'left', minHeight: '44px' }}
                    >
                      <span style={{ color: 'var(--text-secondary)' }}><FolderIcon /></span>
                      <span>{sf.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {folderData === null ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body)', textAlign: 'center', padding: '32px 0' }}>読み込み中...</div>
            ) : folderData.images.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body)', textAlign: 'center', padding: '32px 0' }}>画像がありません</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${thumbColMin}px, 1fr))`, gap: '2px' }}>
                {folderData.images.map((img, i) => (
                  <ThumbCell
                    key={img.hash}
                    image={img}
                    onClick={() => openViewer(folderData.images, i)}
                    isFavorite={img.hash in favUpdates ? favUpdates[img.hash] : img.favorite === 1}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ImageViewer */}
      {viewer && (
        <ImageViewer
          images={viewer.images}
          initialIndex={viewer.idx}
          onClose={() => setViewer(null)}
          onNextFolder={handleNextFolder}
          onFavoriteToggle={handleFavoriteToggle}
          onCaptionSave={handleCaptionSave}
          addToast={addToast}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
