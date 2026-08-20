import { useState, useRef, useCallback, useEffect } from 'react';
import { api } from '../lib/api';

const FONT_SIZE_MAP = { small: '14px', medium: '20px', large: '28px' };
const DEFAULT_CAPTION_CFG = { mode: 'margin', fontSize: 'medium', color: '#ffffff', outline: true, x: 50, y: 20 };

export default function ImageViewer({ images, initialIndex, onClose, onFavoriteToggle, onCaptionSave, addToast, onDelete }) {
  const [idx, setIdx] = useState(initialIndex ?? 0);
  const [detail, setDetail] = useState(null);
  const [overlayExpanded, setOverlayExpanded] = useState(false);
  const [scale, setScale] = useState(1);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [negExpanded, setNegExpanded] = useState(false);
  const [captionEdit, setCaptionEdit] = useState(null);
  const [captionSaving, setCaptionSaving] = useState(false);
  const [captionCfg, setCaptionCfg] = useState(DEFAULT_CAPTION_CFG);
  const [defaultCaptionStyle, setDefaultCaptionStyle] = useState(null);
  const [favoriteMap, setFavoriteMap] = useState(() => {
    const m = {};
    images.forEach(img => { m[img.hash] = img.favorite === 1; });
    return m;
  });
  const [showCardDialog, setShowCardDialog] = useState(false);
  const [cardSlots, setCardSlots] = useState([]);
  const [cardSlotId, setCardSlotId] = useState('');
  const [cardNewSlotMode, setCardNewSlotMode] = useState(false);
  const [cardNewSlotName, setCardNewSlotName] = useState('');
  const [cardName, setCardName] = useState('');
  const [cardPos, setCardPos] = useState('');
  const [cardNeg, setCardNeg] = useState('');
  const [cardSaving, setCardSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // #1: thumbnail-first display
  const [displaySrc, setDisplaySrc] = useState('');
  const [imgLoading, setImgLoading] = useState(true);

  const fetchSeqRef = useRef(0);
  const touchRef = useRef({ startX: 0, startY: 0, startDist: 0, isPinch: false, lastTap: 0 });
  const dragRef = useRef({ active: false, startX: 0, startY: 0, startCX: 50, startCY: 20 });
  const img = images[idx];

  useEffect(() => {
    if (images.length > 0 && idx >= images.length) setIdx(images.length - 1);
  }, [idx, images.length]);

  useEffect(() => {
    setDetail(null);
    setPromptExpanded(false);
    setNegExpanded(false);
    setCaptionEdit(null);
    setShowCardDialog(false);
    setShowDeleteConfirm(false);
  }, [idx]);

  // #1: thumbnail-first + preload
  useEffect(() => {
    if (!img) return;
    setDisplaySrc(`/api/thumbs/${img.hash}.webp`);
    setImgLoading(true);
    const fullUrl = `/api/images/full/${img.hash}`;
    const loader = new Image();
    loader.onload = () => { setDisplaySrc(fullUrl); setImgLoading(false); };
    loader.src = fullUrl;
    return () => { loader.onload = null; };
  }, [img?.hash]);

  // #1: adjacent preload
  useEffect(() => {
    [images[idx - 1], images[idx + 1]].forEach(adj => {
      if (adj) { const i = new Image(); i.src = `/api/images/full/${adj.hash}`; }
    });
  }, [idx, images]);

  // Load default caption style from settings
  useEffect(() => {
    api.getSettings().then(s => { if (s.captionStyle) setDefaultCaptionStyle(s.captionStyle); }).catch(() => {});
  }, []);

  // Load captionCfg from detail when it arrives
  useEffect(() => {
    if (!detail) return;
    let cfg;
    try { if (detail.caption_config) cfg = JSON.parse(detail.caption_config); } catch {}
    setCaptionCfg(cfg || defaultCaptionStyle || DEFAULT_CAPTION_CFG);
  }, [detail?.hash, detail?.caption_config, defaultCaptionStyle]);

  useEffect(() => {
    if (!img) return;
    let cancelled = false;
    const seq = ++fetchSeqRef.current;
    api.getGalleryImage(img.hash)
      .then(d => { if (!cancelled && seq === fetchSeqRef.current) setDetail(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [img?.hash]);

  const go = useCallback((delta) => {
    setIdx(prev => {
      const next = prev + delta;
      if (next < 0 || next >= images.length) return prev;
      return next;
    });
    setScale(1);
  }, [images.length]);

  const handleTouchStart = useCallback((e) => {
    const t = touchRef.current;
    if (e.touches.length === 2) {
      t.isPinch = true;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      t.startDist = Math.hypot(dx, dy);
    } else {
      t.isPinch = false;
      t.startX = e.touches[0].clientX;
      t.startY = e.touches[0].clientY;
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    const t = touchRef.current;
    if (t.isPinch && e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      setScale(prev => Math.max(0.5, Math.min(5, prev * (dist / t.startDist))));
      t.startDist = dist;
    }
  }, []);

  const handleTouchEnd = useCallback((e) => {
    const t = touchRef.current;
    if (t.isPinch) { t.isPinch = false; return; }
    if (!e.changedTouches.length) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const dx = endX - t.startX;
    const dy = endY - t.startY;
    // #2: tap to set caption position in overlay mode
    if (captionEdit !== null && captionCfg.mode === 'overlay' && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const area = document.querySelector('.iv-image-area');
      if (area) {
        const rect = area.getBoundingClientRect();
        setCaptionCfg(prev => ({
          ...prev,
          x: Math.round(((endX - rect.left) / rect.width) * 100),
          y: Math.round(((endY - rect.top) / rect.height) * 100),
        }));
      }
      return;
    }
    if (Math.abs(dy) > 80 && dy < 0 && Math.abs(dx) < Math.abs(dy)) { onClose(); return; }
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { go(dx < 0 ? 1 : -1); return; }
    const now = Date.now();
    if (now - t.lastTap < 300) { setScale(1); t.lastTap = 0; } else { t.lastTap = now; }
  }, [go, onClose, captionEdit, captionCfg.mode]);

  const handleImageAreaClick = useCallback((e) => {
    // #2: tap to set caption position in overlay edit mode
    if (captionEdit !== null && captionCfg.mode === 'overlay') {
      const rect = e.currentTarget.getBoundingClientRect();
      setCaptionCfg(prev => ({
        ...prev,
        x: Math.round(((e.clientX - rect.left) / rect.width) * 100),
        y: Math.round(((e.clientY - rect.top) / rect.height) * 100),
      }));
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    if (x < w * 0.25) go(-1);
    else if (x > w * 0.75) go(1);
    else setOverlayExpanded(v => !v);
  }, [go, captionEdit, captionCfg.mode]);

  const toggleFavorite = useCallback(async (e) => {
    e.stopPropagation();
    if (!img) return;
    const newVal = favoriteMap[img.hash] ? 0 : 1;
    setFavoriteMap(m => ({ ...m, [img.hash]: newVal === 1 }));
    try {
      await api.setFavorite(img.hash, newVal);
      if (onFavoriteToggle) onFavoriteToggle(img.hash, newVal);
    } catch {
      setFavoriteMap(m => ({ ...m, [img.hash]: newVal !== 1 }));
    }
  }, [img, favoriteMap, onFavoriteToggle]);

  const saveCaption = useCallback(async () => {
    if (!img || captionEdit === null) return;
    setCaptionSaving(true);
    try {
      await api.setCaption(img.hash, captionEdit, captionCfg);
      if (onCaptionSave) onCaptionSave(img.hash, captionEdit);
      const saved = captionEdit;
      const savedCfg = captionCfg;
      fetchSeqRef.current++;
      setDetail(prev => prev
        ? { ...prev, caption: saved, caption_config: JSON.stringify(savedCfg) }
        : { caption: saved, caption_config: JSON.stringify(savedCfg) }
      );
      setCaptionEdit(null);
    } catch {}
    setCaptionSaving(false);
  }, [img, captionEdit, captionCfg, onCaptionSave]);

  const openCardDialog = useCallback(async () => {
    try {
      const data = await api.getCards();
      setCardSlots(data.slots || []);
      setCardSlotId(data.slots?.[0]?.id || '');
    } catch {
      setCardSlots([]);
      setCardSlotId('');
    }
    setCardNewSlotMode(false);
    setCardNewSlotName('');
    setCardName(img?.filename?.replace(/_\d+\.png$/i, '').replace(/[_-]+$/, '') || '');
    setCardPos(detail?.prompt || '');
    setCardNeg(detail?.negative || '');
    setShowCardDialog(true);
  }, [img, detail]);

  const submitCard = useCallback(async () => {
    if (cardSaving) return;
    setCardSaving(true);
    try {
      let slotId = cardSlotId;
      if (cardNewSlotMode) {
        if (!cardNewSlotName.trim()) {
          if (addToast) addToast('error', 'スロット名を入力してください');
          setCardSaving(false);
          return;
        }
        const slot = await api.addSlot({ name: cardNewSlotName.trim() });
        slotId = slot.id;
      }
      if (!slotId) {
        if (addToast) addToast('error', 'スロットを選択してください');
        setCardSaving(false);
        return;
      }
      await api.addCard({ slotId, name: cardName.trim() || '無題', positive: cardPos, negative: cardNeg });
      if (addToast) addToast('success', 'カードを登録しました');
      setShowCardDialog(false);
    } catch (e) {
      if (addToast) addToast('error', e.message?.includes('同名') ? e.message : 'カード登録に失敗しました');
    }
    setCardSaving(false);
  }, [cardSaving, cardSlotId, cardNewSlotMode, cardNewSlotName, cardName, cardPos, cardNeg, addToast]);

  const handleDelete = useCallback(async () => {
    if (deleting || !img) return;
    setDeleting(true);
    try {
      await api.deleteGalleryImage(img.hash);
      if (addToast) addToast('success', '画像を削除しました');
      setShowDeleteConfirm(false);
      if (onDelete) onDelete(img.hash);
    } catch {
      if (addToast) addToast('error', '画像の削除に失敗しました');
      setDeleting(false);
    }
  }, [deleting, img, addToast, onDelete]);

  // #2: caption overlay drag handlers
  const handleCaptionDragStart = useCallback((e) => {
    e.stopPropagation();
    dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, startCX: captionCfg.x ?? 50, startCY: captionCfg.y ?? 20 };
  }, [captionCfg.x, captionCfg.y]);

  const handleMouseMove = useCallback((e) => {
    if (!dragRef.current.active) return;
    const area = document.querySelector('.iv-image-area');
    if (!area) return;
    const rect = area.getBoundingClientRect();
    const dx = ((e.clientX - dragRef.current.startX) / rect.width) * 100;
    const dy = ((e.clientY - dragRef.current.startY) / rect.height) * 100;
    setCaptionCfg(prev => ({
      ...prev,
      x: Math.max(0, Math.min(100, dragRef.current.startCX + dx)),
      y: Math.max(0, Math.min(100, dragRef.current.startCY + dy)),
    }));
  }, []);

  const handleMouseUp = useCallback(() => { dragRef.current.active = false; }, []);

  if (!img) return null;

  const isFav = favoriteMap[img.hash] ?? false;
  const d = detail;
  const captionToShow = captionEdit !== null ? captionEdit : (d?.caption || null);
  const isPortrait = img.width && img.height ? img.height >= img.width : true;
  const captionFontSize = FONT_SIZE_MAP[captionCfg.fontSize || 'medium'];
  const captionColor = captionCfg.color || '#fff';
  const captionShadow = captionCfg.outline !== false
    ? '0 0 4px #000, 1px 1px 3px rgba(0,0,0,0.8), -1px -1px 3px rgba(0,0,0,0.8)'
    : 'none';

  const OVERLAY_BTN = {
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.2)',
    color: '#fff',
    borderRadius: '6px',
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: '13px',
  };

  const DIALOG_INPUT = {
    width: '100%',
    padding: '8px',
    borderRadius: '6px',
    border: '1px solid var(--line)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: 'var(--fs-body)',
    boxSizing: 'border-box',
  };

  return (
    <>
      <style>{`
        .iv-root { display: flex; flex-direction: column; }
        .iv-overlay { background: rgba(0,0,0,0.8); flex-shrink: 0; max-height: 55vh; overflow-y: auto; }
      `}</style>

      <div
        className="iv-root"
        style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#000', userSelect: 'none', touchAction: 'none' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {/* × ボタン */}
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff', fontSize: '18px', width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >×</button>

        {/* カウンター */}
        <div style={{ position: 'absolute', top: 16, left: 14, color: 'rgba(255,255,255,0.45)', fontSize: '12px', zIndex: 10, pointerEvents: 'none' }}>
          {idx + 1} / {images.length}
        </div>

        {/* #2: 余白モード用ラッパー or 通常レイアウト */}
        {captionToShow && captionCfg.mode === 'margin' ? (
          <div
            className="iv-image-area"
            onClick={handleImageAreaClick}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: isPortrait ? 'row' : 'column',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              minHeight: 0,
              cursor: 'pointer',
            }}
          >
            <img
              src={displaySrc}
              alt=""
              style={{
                maxWidth: isPortrait ? '75%' : '100%',
                maxHeight: isPortrait ? '100%' : '72%',
                objectFit: 'contain',
                transform: `scale(${scale})`,
                transformOrigin: 'center',
                transition: 'transform 0.1s ease, opacity 0.25s ease, filter 0.25s ease',
                opacity: imgLoading ? 0.5 : 1,
                filter: imgLoading ? 'blur(6px)' : 'none',
                display: 'block',
                flexShrink: 0,
              }}
              draggable={false}
            />
            <div style={{
              writingMode: isPortrait ? 'vertical-rl' : 'horizontal-tb',
              textOrientation: 'upright',
              fontSize: captionFontSize,
              color: captionColor,
              textShadow: captionShadow,
              padding: isPortrait ? '12px 6px' : '8px 12px',
              flexShrink: 0,
              maxWidth: isPortrait ? '25%' : '100%',
              maxHeight: isPortrait ? '100%' : '28%',
              overflow: 'hidden',
              lineHeight: 2,
              letterSpacing: isPortrait ? '0.1em' : 'normal',
              pointerEvents: 'none',
              whiteSpace: 'pre-wrap',
            }}>
              {captionToShow}
            </div>
          </div>
        ) : (
          <div
            className="iv-image-area"
            onClick={handleImageAreaClick}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', minHeight: 0, cursor: 'pointer', position: 'relative' }}
          >
            <img
              src={displaySrc}
              alt=""
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                transform: `scale(${scale})`,
                transformOrigin: 'center',
                transition: 'transform 0.1s ease, opacity 0.25s ease, filter 0.25s ease',
                opacity: imgLoading ? 0.5 : 1,
                filter: imgLoading ? 'blur(6px)' : 'none',
                display: 'block',
              }}
              draggable={false}
            />
            {/* #2: 画像内モード オーバーレイ */}
            {captionToShow && captionCfg.mode === 'overlay' && (
              <div
                style={{
                  position: 'absolute',
                  left: `${captionCfg.x ?? 50}%`,
                  top: `${captionCfg.y ?? 20}%`,
                  transform: 'translate(-50%, -50%)',
                  fontSize: captionFontSize,
                  color: captionColor,
                  textShadow: captionShadow,
                  maxWidth: '80%',
                  textAlign: 'center',
                  lineHeight: 1.8,
                  whiteSpace: 'pre-wrap',
                  pointerEvents: captionEdit !== null ? 'auto' : 'none',
                  cursor: captionEdit !== null ? 'move' : 'default',
                  userSelect: 'none',
                }}
                onMouseDown={captionEdit !== null ? handleCaptionDragStart : undefined}
              >
                {captionToShow}
              </div>
            )}
          </div>
        )}

        {/* 情報オーバーレイ */}
        <div className="iv-overlay">
          {/* 折りたたみバー */}
          <div
            onClick={() => setOverlayExpanded(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', cursor: 'pointer', minHeight: '44px' }}
          >
            <span style={{ flex: 1, color: 'rgba(255,255,255,0.8)', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{img.filename}</span>
            <button
              onClick={toggleFavorite}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', padding: '0 4px', lineHeight: 1, color: isFav ? '#f5c518' : 'rgba(255,255,255,0.4)' }}
            >{isFav ? '★' : '☆'}</button>
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px' }}>{overlayExpanded ? '▼' : '▲'}</span>
          </div>

          {/* 展開コンテンツ */}
          {overlayExpanded && (
            <div style={{ padding: '0 14px 14px' }}>
              {/* ファイル情報 */}
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '12px', marginBottom: '10px', lineHeight: 1.6 }}>
                <div>{img.folder || '(ルート)'}</div>
                {img.created_at && <div>{String(img.created_at).slice(0, 19).replace('T', ' ')}</div>}
                {d && (
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '4px' }}>
                    {d.seed != null && <span>seed: {d.seed}</span>}
                    {d.model && <span>model: {d.model}</span>}
                    {d.steps != null && <span>steps: {d.steps}</span>}
                    {d.scale != null && <span>scale: {d.scale}</span>}
                    {d.sampler && <span>sampler: {d.sampler}</span>}
                  </div>
                )}
              </div>

              {/* プロンプト */}
              {d?.prompt && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '11px', marginBottom: '3px' }}>プロンプト</div>
                  <div
                    onClick={() => setPromptExpanded(v => !v)}
                    style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12px', lineHeight: 1.5, cursor: 'pointer', ...(promptExpanded ? {} : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}
                  >{d.prompt}</div>
                </div>
              )}

              {/* ネガティブ */}
              {d?.negative && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '11px', marginBottom: '3px' }}>ネガティブ</div>
                  <div
                    onClick={() => setNegExpanded(v => !v)}
                    style={{ color: 'rgba(255,120,120,0.75)', fontSize: '12px', lineHeight: 1.5, cursor: 'pointer', ...(negExpanded ? {} : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}
                  >{d.negative}</div>
                </div>
              )}

              {/* アクションボタン行 */}
              <div style={{ display: 'flex', gap: '8px', margin: '10px 0 8px' }} onClick={e => e.stopPropagation()}>
                <button onClick={openCardDialog} style={OVERLAY_BTN}>📋 カードに登録</button>
                <button onClick={() => setShowDeleteConfirm(true)} style={{ ...OVERLAY_BTN, color: '#ff6b6b', borderColor: 'rgba(255,100,100,0.3)' }}>🗑 削除</button>
              </div>

              {/* #2: セリフ */}
              <div style={{ marginTop: '10px' }}>
                <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '11px', marginBottom: '4px' }}>セリフ</div>
                {captionEdit !== null ? (
                  <div onClick={e => e.stopPropagation()}>
                    <textarea
                      value={captionEdit}
                      onChange={e => setCaptionEdit(e.target.value)}
                      rows={3}
                      style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '4px', padding: '6px', fontSize: '13px', resize: 'vertical' }}
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Escape') setCaptionEdit(null); }}
                    />
                    {/* #2: スタイル設定 */}
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {/* モード */}
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', flexShrink: 0 }}>モード</span>
                        {[['margin', '余白'], ['overlay', '画像内']].map(([v, l]) => (
                          <button key={v} onClick={() => setCaptionCfg(prev => ({ ...prev, mode: v }))} style={{ padding: '4px 10px', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', background: captionCfg.mode === v ? 'rgba(255,255,255,0.2)' : 'transparent', color: '#fff', fontSize: '12px', cursor: 'pointer' }}>{l}</button>
                        ))}
                      </div>
                      {captionCfg.mode === 'overlay' && (
                        <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '11px' }}>画像をタップして位置を指定・ドラッグで調整</div>
                      )}
                      {/* フォントサイズ */}
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', flexShrink: 0 }}>サイズ</span>
                        {[['small', '小'], ['medium', '中'], ['large', '大']].map(([v, l]) => (
                          <button key={v} onClick={() => setCaptionCfg(prev => ({ ...prev, fontSize: v }))} style={{ padding: '4px 9px', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', background: captionCfg.fontSize === v ? 'rgba(255,255,255,0.2)' : 'transparent', color: '#fff', fontSize: '12px', cursor: 'pointer' }}>{l}</button>
                        ))}
                      </div>
                      {/* 文字色 */}
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', flexShrink: 0 }}>色</span>
                        {['#ffffff', '#000000', '#ff69b4'].map(c => (
                          <button key={c} onClick={() => setCaptionCfg(prev => ({ ...prev, color: c }))} style={{ width: '22px', height: '22px', borderRadius: '50%', background: c, border: captionCfg.color === c ? '2px solid #7ec8e3' : '1px solid rgba(255,255,255,0.3)', cursor: 'pointer', padding: 0, flexShrink: 0 }} />
                        ))}
                        <input type="color" value={captionCfg.color || '#ffffff'} onChange={e => setCaptionCfg(prev => ({ ...prev, color: e.target.value }))} style={{ width: '28px', height: '22px', padding: 0, border: '1px solid rgba(255,255,255,0.3)', borderRadius: '3px', cursor: 'pointer', background: 'none', flexShrink: 0 }} />
                      </div>
                      {/* 縁取り */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={captionCfg.outline !== false} onChange={e => setCaptionCfg(prev => ({ ...prev, outline: e.target.checked }))} />
                        <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>縁取り</span>
                      </label>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                      <button onClick={saveCaption} disabled={captionSaving} style={{ flex: 1, background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: '4px', padding: '7px', cursor: 'pointer', fontSize: '13px' }}>保存</button>
                      <button onClick={() => { setCaptionEdit(null); if (d?.caption_config) { try { setCaptionCfg(JSON.parse(d.caption_config)); } catch {} } else { setCaptionCfg(defaultCaptionStyle || DEFAULT_CAPTION_CFG); } }} style={{ flex: 1, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: '4px', padding: '7px', cursor: 'pointer', fontSize: '13px' }}>キャンセル</button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => setCaptionEdit(d?.caption ?? '')}
                    style={{ color: d?.caption ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.25)', fontSize: '13px', lineHeight: 1.5, cursor: 'pointer', minHeight: '32px', padding: '4px 0' }}
                  >{d?.caption || 'セリフなし'}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* カード登録ダイアログ */}
      {showCardDialog && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: 'var(--bg)', width: '100%', borderRadius: '12px 12px 0 0', padding: '16px', maxHeight: '85vh', overflowY: 'auto', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '14px' }}>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 'var(--fs-title)' }}>📋 カードに登録</span>
              <button onClick={() => setShowCardDialog(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: 'var(--text-secondary)', padding: '4px' }}>×</button>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>スロット</label>
              <select
                value={cardNewSlotMode ? '__new__' : cardSlotId}
                onChange={e => {
                  if (e.target.value === '__new__') { setCardNewSlotMode(true); setCardSlotId(''); }
                  else { setCardNewSlotMode(false); setCardSlotId(e.target.value); }
                }}
                style={{ ...DIALOG_INPUT }}
              >
                {cardSlots.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value="__new__">＋ 新規スロット</option>
              </select>
            </div>

            {cardNewSlotMode && (
              <div style={{ marginBottom: '10px' }}>
                <label style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>新規スロット名</label>
                <input type="text" value={cardNewSlotName} onChange={e => setCardNewSlotName(e.target.value)} placeholder="スロット名を入力" autoFocus style={{ ...DIALOG_INPUT }} />
              </div>
            )}

            <div style={{ marginBottom: '10px' }}>
              <label style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>カード名</label>
              <input type="text" value={cardName} onChange={e => setCardName(e.target.value)} placeholder="カード名（省略時: 無題）" style={{ ...DIALOG_INPUT }} />
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>正プロンプト</label>
              <textarea value={cardPos} onChange={e => setCardPos(e.target.value)} rows={4} style={{ ...DIALOG_INPUT, resize: 'vertical' }} />
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>負プロンプト</label>
              <textarea value={cardNeg} onChange={e => setCardNeg(e.target.value)} rows={3} style={{ ...DIALOG_INPUT, resize: 'vertical' }} />
            </div>

            <button
              onClick={submitCard}
              disabled={cardSaving || (cardNewSlotMode ? !cardNewSlotName.trim() : !cardSlotId)}
              style={{ width: '100%', padding: '12px', background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: '8px', fontSize: 'var(--fs-body)', fontWeight: 600, cursor: 'pointer', opacity: cardSaving ? 0.6 : 1 }}
            >{cardSaving ? '登録中...' : '登録'}</button>
          </div>
        </div>
      )}

      {/* 削除確認ダイアログ */}
      {showDeleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'var(--bg)', borderRadius: '12px', padding: '20px', maxWidth: '320px', width: '100%' }}>
            <p style={{ margin: '0 0 16px', fontSize: 'var(--fs-body)', lineHeight: 1.6 }}>この画像を削除しますか？（元に戻せません）</p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setShowDeleteConfirm(false)} style={{ flex: 1, padding: '10px', background: 'var(--line)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: 'var(--fs-body)', color: 'var(--text)' }}>キャンセル</button>
              <button onClick={handleDelete} disabled={deleting} style={{ flex: 1, padding: '10px', background: '#e53e3e', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: 'var(--fs-body)', color: '#fff', opacity: deleting ? 0.6 : 1 }}>{deleting ? '削除中...' : '削除'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
