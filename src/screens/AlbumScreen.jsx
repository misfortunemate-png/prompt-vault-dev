import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

function FolderIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
    </svg>
  );
}

function extractLabel(filename) {
  return filename.split('_')[0] || filename;
}

const GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: '4px',
};

const SECTION_LABEL = {
  fontSize: 'var(--fs-title)',
  fontWeight: 600,
  marginBottom: '8px',
};

const IMG_LABEL = {
  fontSize: 'var(--fs-label)',
  color: 'var(--text-secondary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  padding: '2px 2px 0',
};

export default function AlbumScreen({ addToast }) {
  const [albumData, setAlbumData] = useState(null);
  const [path, setPath] = useState([]);
  const [folderFiles, setFolderFiles] = useState([]);
  const [viewerIdx, setViewerIdx] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadAlbum = useCallback(async () => {
    try {
      const data = await api.getImages();
      setAlbumData(data);
    } catch (e) {
      if (!e.message?.includes('400')) {
        addToast('error', 'アルバムの読み込みに失敗しました');
      }
      setAlbumData({ folders: [], recent: [] });
    }
  }, [addToast]);

  useEffect(() => {
    loadAlbum().finally(() => setLoading(false));
  }, [loadAlbum]);

  const openFolder = useCallback(async (folderName, openIdx = null) => {
    setPath([folderName]);
    setFolderFiles([]);
    setViewerIdx(null);
    try {
      const data = await api.getImageFolder(folderName);
      const files = data.files || [];
      setFolderFiles(files);
      if (openIdx !== null && files.length > 0) {
        setViewerIdx(Math.min(openIdx, files.length - 1));
      }
    } catch {
      addToast('error', 'フォルダの読み込みに失敗しました');
    }
  }, [addToast]);

  const openRecentImage = useCallback(async (folder, filename) => {
    setPath([folder]);
    setFolderFiles([]);
    setViewerIdx(null);
    try {
      const data = await api.getImageFolder(folder);
      const files = data.files || [];
      setFolderFiles(files);
      const idx = files.indexOf(filename);
      setViewerIdx(idx >= 0 ? idx : 0);
    } catch {
      addToast('error', 'フォルダの読み込みに失敗しました');
    }
  }, [addToast]);

  const goRoot = useCallback(() => {
    setPath([]);
    setViewerIdx(null);
    loadAlbum();
  }, [loadAlbum]);

  const closeViewer = () => setViewerIdx(null);

  const nextImage = useCallback(() => {
    setViewerIdx(prev => (prev !== null && prev < folderFiles.length - 1 ? prev + 1 : prev));
  }, [folderFiles.length]);

  const prevImage = useCallback(() => {
    setViewerIdx(prev => (prev !== null && prev > 0 ? prev - 1 : prev));
  }, []);

  const nextFolder = useCallback(async () => {
    if (!albumData?.folders?.length) return;
    const folders = albumData.folders;
    const currentFolderName = path[0];
    const currentIdx = folders.findIndex(f => f.name === currentFolderName);
    const nextIdx = (currentIdx + 1) % folders.length;
    await openFolder(folders[nextIdx].name, 0);
  }, [albumData, path, openFolder]);

  const handleViewerClick = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const isLeft = x < rect.width / 2;
    const isTop = y < rect.height / 2;

    if (isLeft && isTop) closeViewer();
    else if (!isLeft && isTop) nextFolder();
    else if (!isLeft && !isTop) nextImage();
    else prevImage();
  }, [nextFolder, nextImage, prevImage]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100dvh - 48px - 54px)', color: 'var(--text-secondary)', fontSize: 'var(--fs-body)' }}>
        読み込み中...
      </div>
    );
  }

  const currentFolder = path[0] ?? null;
  const isRoot = path.length === 0;

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ overflowY: 'auto', height: 'calc(100dvh - 48px - 54px)', padding: '12px 16px 24px' }}>

        {isRoot ? (
          /* ルート表示 */
          <>
            {/* 新着欄 */}
            {albumData?.recent?.length > 0 && (
              <section style={{ marginBottom: '16px' }}>
                <h2 style={SECTION_LABEL}>新着</h2>
                <div style={GRID}>
                  {albumData.recent.map((item, i) => (
                    <div
                      key={i}
                      onClick={() => openRecentImage(item.folder, item.filename)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div style={{ aspectRatio: '1/1', overflow: 'hidden', background: 'var(--line)' }}>
                        <img
                          src={`/api/images/${encodeURIComponent(item.folder)}/${encodeURIComponent(item.filename)}`}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          loading="lazy"
                        />
                      </div>
                      <div style={IMG_LABEL}>{item.folder}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* フォルダ欄 */}
            <section>
              <h2 style={SECTION_LABEL}>フォルダ</h2>
              {(!albumData?.folders?.length) ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body)', textAlign: 'center', padding: '32px 0' }}>
                  保存済み画像はありません
                </div>
              ) : (
                <div style={GRID}>
                  {albumData.folders.map((folder, i) => (
                    <div
                      key={i}
                      onClick={() => openFolder(folder.name)}
                      style={{ cursor: 'pointer', textAlign: 'center', padding: '8px 4px' }}
                    >
                      <div style={{ color: 'var(--text-secondary)', marginBottom: '4px', display: 'flex', justifyContent: 'center' }}>
                        <FolderIcon />
                      </div>
                      <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)' }}>
                        {folder.count}枚
                      </div>
                      <div style={{ fontSize: 'var(--fs-label)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {folder.name}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          /* フォルダ内表示 */
          <>
            {/* パンくず */}
            <div style={{ marginBottom: '12px', fontSize: 'var(--fs-label)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                onClick={goRoot}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 'var(--fs-label)', padding: 0, minHeight: '44px' }}
              >
                VAULT
              </button>
              <span style={{ color: 'var(--text-secondary)' }}>›</span>
              <span style={{ color: 'var(--text)' }}>{currentFolder}</span>
            </div>

            {folderFiles.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body)', textAlign: 'center', padding: '32px 0' }}>
                読み込み中...
              </div>
            ) : (
              <div style={GRID}>
                {folderFiles.map((filename, i) => (
                  <div
                    key={i}
                    onClick={() => setViewerIdx(i)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div style={{ aspectRatio: '1/1', overflow: 'hidden', background: 'var(--line)' }}>
                      <img
                        src={`/api/images/${encodeURIComponent(currentFolder)}/${encodeURIComponent(filename)}`}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        loading="lazy"
                      />
                    </div>
                    <div style={IMG_LABEL}>{extractLabel(filename)}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 4象限ビューア */}
      {viewerIdx !== null && currentFolder && folderFiles[viewerIdx] && (
        <div
          onClick={handleViewerClick}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'rgba(0,0,0,0.94)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
            touchAction: 'none',
          }}
        >
          {/* 四隅ガイド */}
          <div style={{ position: 'absolute', top: 20, left: 16, color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>✕ 戻る</div>
          <div style={{ position: 'absolute', top: 20, right: 16, color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>次フォルダ ▶</div>
          <div style={{ position: 'absolute', bottom: 70, left: 16, color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>◀ 前</div>
          <div style={{ position: 'absolute', bottom: 70, right: 16, color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>次 ▶</div>

          {/* 画像 */}
          <img
            src={`/api/images/${encodeURIComponent(currentFolder)}/${encodeURIComponent(folderFiles[viewerIdx])}`}
            alt=""
            style={{ width: '75%', maxWidth: '320px', objectFit: 'contain', borderRadius: '4px', display: 'block' }}
          />

          {/* ファイル名・位置 */}
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '11px', marginTop: '12px', textAlign: 'center', maxWidth: '80%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {folderFiles[viewerIdx]}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px', marginTop: '4px' }}>
            {viewerIdx + 1} / {folderFiles.length}
          </div>
        </div>
      )}
    </div>
  );
}
