import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';

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

function ThumbCell({ image, onClick }) {
  return (
    <div onClick={onClick} style={{ cursor: 'pointer' }}>
      <div style={{ aspectRatio: '1/1', overflow: 'hidden', background: 'var(--line)' }}>
        {image.thumb_ok ? (
          <img
            src={image.thumbUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            loading="lazy"
          />
        ) : (
          <Placeholder />
        )}
      </div>
    </div>
  );
}

function FolderRow({ node, depth, onNavigate }) {
  return (
    <>
      <button
        onClick={() => onNavigate(node.path)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          background: 'none',
          border: 'none',
          borderBottom: '1px solid var(--line)',
          cursor: 'pointer',
          padding: `10px 12px 10px ${12 + depth * 16}px`,
          color: 'var(--text)',
          fontSize: 'var(--fs-body)',
          textAlign: 'left',
          minHeight: '44px',
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
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        width: '100%',
        background: 'none',
        border: '1px solid var(--line)',
        borderRadius: '8px',
        cursor: 'pointer',
        padding: '10px 12px',
        color: 'var(--text)',
        textAlign: 'left',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', flexShrink: 0 }}>
        {[0, 1, 2, 3].map(i => {
          const hash = node.previewHashes?.[i];
          return (
            <div key={i} style={{ width: '60px', height: '60px', overflow: 'hidden', background: 'var(--line)', borderRadius: '2px' }}>
              {hash ? (
                <img
                  src={`/api/thumbs/${hash}.webp`}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  loading="lazy"
                />
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

const GRID_3 = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '2px' };
const SECTION_LABEL = { fontSize: 'var(--fs-title)', fontWeight: 600, margin: '0 0 8px' };

export default function AlbumScreen({ addToast }) {
  const [galleryData, setGalleryData] = useState(null);
  const [recentImages, setRecentImages] = useState([]);
  const [path, setPath] = useState(null);
  const [folderData, setFolderData] = useState(null);
  const [viewerImages, setViewerImages] = useState([]);
  const [viewerIdx, setViewerIdx] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState({ total: 0, processed: 0, newCount: 0, movedCount: 0, deletedCount: 0 });
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('icon');
  const pollRef = useRef(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const loadRoot = useCallback(async () => {
    try {
      const [gallery, recent] = await Promise.all([
        api.getGallery(),
        api.getRecentImages(20),
      ]);
      setGalleryData(gallery);
      setRecentImages(recent.images || []);
    } catch (e) {
      if (!e.message?.includes('400')) {
        addToast('error', 'ギャラリーの読み込みに失敗しました');
      }
      setGalleryData({ tree: [], totalImages: 0, totalFolders: 0 });
      setRecentImages([]);
    }
  }, [addToast]);

  const loadFolder = useCallback(async (folderPath) => {
    try {
      const data = await api.getGalleryFolder(folderPath);
      setFolderData(data);
    } catch {
      addToast('error', 'フォルダの読み込みに失敗しました');
    }
  }, [addToast]);

  useEffect(() => {
    loadRoot().finally(() => setLoading(false));
  }, [loadRoot]);

  const navigateTo = useCallback(async (folderPath) => {
    setPath(folderPath);
    setFolderData(null);
    setViewerIdx(null);
    await loadFolder(folderPath);
  }, [loadFolder]);

  const goRoot = useCallback(() => {
    setPath(null);
    setFolderData(null);
    setViewerIdx(null);
    loadRoot();
  }, [loadRoot]);

  const goUp = useCallback((targetPath) => {
    if (!targetPath) { goRoot(); return; }
    setPath(targetPath);
    setFolderData(null);
    setViewerIdx(null);
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
            if (path) { await loadFolder(path); } else { await loadRoot(); }
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

  const openViewer = (images, idx) => {
    setViewerImages(images);
    setViewerIdx(idx);
  };

  const closeViewer = () => setViewerIdx(null);

  const nextImage = useCallback(() => {
    setViewerIdx(prev => (prev !== null && prev < viewerImages.length - 1 ? prev + 1 : prev));
  }, [viewerImages.length]);

  const prevImage = useCallback(() => {
    setViewerIdx(prev => (prev !== null && prev > 0 ? prev - 1 : prev));
  }, []);

  const handleViewerClick = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const isLeft = e.clientX - rect.left < rect.width / 2;
    const isTop = e.clientY - rect.top < rect.height / 2;
    if (isLeft && isTop) closeViewer();
    else if (!isLeft && isTop) nextImage();
    else if (!isLeft && !isTop) nextImage();
    else prevImage();
  }, [nextImage, prevImage]);

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

  const currentImages = path ? (folderData?.images || []) : recentImages;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 48px - 54px)' }}>
      {/* ヘッダー行 */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', borderBottom: '1px solid var(--line)', minHeight: '44px', flexShrink: 0, gap: '6px' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', fontSize: 'var(--fs-label)' }}>
          <button
            onClick={goRoot}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: path ? 'var(--accent)' : 'var(--text)', padding: '4px 0', minHeight: '44px', flexShrink: 0, fontSize: 'var(--fs-label)' }}
          >
            ルート
          </button>
          {breadcrumb.map((item, i) => (
            <span key={item.path} style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
              <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>›</span>
              <button
                onClick={() => goUp(item.path)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: i === breadcrumb.length - 1 ? 'var(--text)' : 'var(--accent)', padding: '4px 0', minHeight: '44px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--fs-label)' }}
              >
                {item.name}
              </button>
            </span>
          ))}
        </div>
        {scanning && (
          <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-label)', flexShrink: 0 }}>
            {scanStatus.processed}/{scanStatus.total}枚
          </span>
        )}
        <button
          onClick={handleRescan}
          disabled={scanning}
          style={{ background: 'none', border: 'none', cursor: scanning ? 'default' : 'pointer', padding: '4px 6px', minHeight: '44px', fontSize: '18px', opacity: scanning ? 0.5 : 1, flexShrink: 0 }}
          title="リスキャン"
        >
          {scanning ? '⟳' : '🔄'}
        </button>
      </div>

      {/* コンテンツ */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 24px' }}>
        {path === null ? (
          /* ルート表示 */
          <>
            {recentImages.length > 0 && (
              <section style={{ marginBottom: '20px' }}>
                <h2 style={SECTION_LABEL}>新着</h2>
                <div style={GRID_3}>
                  {recentImages.map((img, i) => (
                    <ThumbCell key={img.hash} image={img} onClick={() => openViewer(recentImages, i)} />
                  ))}
                </div>
              </section>
            )}

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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px' }}>
                  <FolderCardTree nodes={galleryData.tree} onNavigate={navigateTo} />
                </div>
              )}
            </section>
          </>
        ) : (
          /* フォルダ内表示 */
          <>
            {/* サブフォルダ */}
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

            {/* 画像グリッド */}
            {folderData === null ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body)', textAlign: 'center', padding: '32px 0' }}>
                読み込み中...
              </div>
            ) : folderData.images.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body)', textAlign: 'center', padding: '32px 0' }}>
                画像がありません
              </div>
            ) : (
              <div style={GRID_3}>
                {folderData.images.map((img, i) => (
                  <ThumbCell key={img.hash} image={img} onClick={() => openViewer(folderData.images, i)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 4象限ビューア */}
      {viewerIdx !== null && viewerImages[viewerIdx] && (
        <div
          onClick={handleViewerClick}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.94)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', userSelect: 'none', touchAction: 'none' }}
        >
          <div style={{ position: 'absolute', top: 20, left: 16, color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>✕ 戻る</div>
          <div style={{ position: 'absolute', top: 20, right: 16, color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>次 ▶</div>
          <div style={{ position: 'absolute', bottom: 70, left: 16, color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>◀ 前</div>
          <div style={{ position: 'absolute', bottom: 70, right: 16, color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>次 ▶</div>

          <img
            src={`/api/images/full/${viewerImages[viewerIdx].hash}`}
            alt=""
            style={{ width: '75%', maxWidth: '320px', objectFit: 'contain', borderRadius: '4px', display: 'block' }}
          />

          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '11px', marginTop: '12px', textAlign: 'center', maxWidth: '80%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {viewerImages[viewerIdx].filename}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px', marginTop: '4px' }}>
            {viewerIdx + 1} / {viewerImages.length}
          </div>
        </div>
      )}
    </div>
  );
}
