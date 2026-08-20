import { useState, useRef, useCallback, useEffect } from 'react';
import { api } from '../lib/api';

export default function ImageViewer({ images, initialIndex, onClose, onFavoriteToggle, onCaptionSave, addToast, onDelete }) {
  const [idx, setIdx] = useState(initialIndex ?? 0);
  const [detail, setDetail] = useState(null);
  const [overlayExpanded, setOverlayExpanded] = useState(false);
  const [scale, setScale] = useState(1);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [negExpanded, setNegExpanded] = useState(false);
  const [captionEdit, setCaptionEdit] = useState(null);
  const [captionSaving, setCaptionSaving] = useState(false);
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

  const fetchSeqRef = useRef(0);
  const touchRef = useRef({ startX: 0, startY: 0, startDist: 0, isPinch: false, lastTap: 0 });
  const img = images[idx];

  // images が縮小して idx が範囲外になった場合に clamp
  useEffect(() => {
    if (images.length > 0 && idx >= images.length) {
      setIdx(images.length - 1);
    }
  }, [idx, images.length]);

  useEffect(() => {
    setDetail(null);
    setPromptExpanded(false);
    setNegExpanded(false);
    setCaptionEdit(null);
    setShowCardDialog(false);
    setShowDeleteConfirm(false);
  }, [idx]);

  useEffect(() => {
    if (!overlayExpanded || !img) return;
    let cancelled = false;
    const seq = ++fetchSeqRef.current;
    api.getGalleryImage(img.hash)
      .then(d => { if (!cancelled && seq === fetchSeqRef.current) setDetail(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [overlayExpanded, img?.hash]);

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
      const ratio = dist / t.startDist;
      setScale(prev => Math.max(0.5, Math.min(5, prev * ratio)));
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
    if (Math.abs(dy) > 80 && dy < 0 && Math.abs(dx) < Math.abs(dy)) {
      onClose();
      return;
    }
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? 1 : -1);
      return;
    }
    const now = Date.now();
    if (now - t.lastTap < 300) {
      setScale(1);
      t.lastTap = 0;
    } else {
      t.lastTap = now;
    }
  }, [go, onClose]);

  const handleImageAreaClick = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    if (x < w * 0.25) go(-1);
    else if (x > w * 0.75) go(1);
    else setOverlayExpanded(v => !v);
  }, [go]);

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
      await api.setCaption(img.hash, captionEdit);
      if (onCaptionSave) onCaptionSave(img.hash, captionEdit);
      const saved = captionEdit;
      // 保存後に遅延完了した detail fetch が caption を上書きするのを防ぐ
      fetchSeqRef.current++;
      setDetail(prev => prev ? { ...prev, caption: saved } : { caption: saved });
      setCaptionEdit(null);
    } catch {}
    setCaptionSaving(false);
  }, [img, captionEdit, onCaptionSave]);

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

  if (!img) return null;

  const isFav = favoriteMap[img.hash] ?? false;
  const d = detail;

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

        {/* 画像エリア */}
        <div
          className="iv-image-area"
          onClick={handleImageAreaClick}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', minHeight: 0, cursor: 'pointer' }}
        >
          <img
            src={`/api/images/full/${img.hash}`}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', transform: `scale(${scale})`, transformOrigin: 'center', transition: 'transform 0.1s ease', display: 'block' }}
            draggable={false}
          />
        </div>

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

              {/* セリフ */}
              <div style={{ marginTop: '10px' }}>
                <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '11px', marginBottom: '4px' }}>セリフ</div>
                {captionEdit !== null ? (
                  <div>
                    <textarea
                      value={captionEdit}
                      onChange={e => setCaptionEdit(e.target.value)}
                      rows={3}
                      style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '4px', padding: '6px', fontSize: '13px', resize: 'vertical' }}
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Escape') setCaptionEdit(null); }}
                    />
                    <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                      <button onClick={saveCaption} disabled={captionSaving} style={{ flex: 1, background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: '4px', padding: '7px', cursor: 'pointer', fontSize: '13px' }}>保存</button>
                      <button onClick={() => setCaptionEdit(null)} style={{ flex: 1, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: '4px', padding: '7px', cursor: 'pointer', fontSize: '13px' }}>キャンセル</button>
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
                {cardSlots.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
                <option value="__new__">＋ 新規スロット</option>
              </select>
            </div>

            {cardNewSlotMode && (
              <div style={{ marginBottom: '10px' }}>
                <label style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>新規スロット名</label>
                <input
                  type="text"
                  value={cardNewSlotName}
                  onChange={e => setCardNewSlotName(e.target.value)}
                  placeholder="スロット名を入力"
                  autoFocus
                  style={{ ...DIALOG_INPUT }}
                />
              </div>
            )}

            <div style={{ marginBottom: '10px' }}>
              <label style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>カード名</label>
              <input
                type="text"
                value={cardName}
                onChange={e => setCardName(e.target.value)}
                placeholder="カード名（省略時: 無題）"
                style={{ ...DIALOG_INPUT }}
              />
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>正プロンプト</label>
              <textarea
                value={cardPos}
                onChange={e => setCardPos(e.target.value)}
                rows={4}
                style={{ ...DIALOG_INPUT, resize: 'vertical' }}
              />
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>負プロンプト</label>
              <textarea
                value={cardNeg}
                onChange={e => setCardNeg(e.target.value)}
                rows={3}
                style={{ ...DIALOG_INPUT, resize: 'vertical' }}
              />
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
              <button
                onClick={() => setShowDeleteConfirm(false)}
                style={{ flex: 1, padding: '10px', background: 'var(--line)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: 'var(--fs-body)', color: 'var(--text)' }}
              >キャンセル</button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{ flex: 1, padding: '10px', background: '#e53e3e', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: 'var(--fs-body)', color: '#fff', opacity: deleting ? 0.6 : 1 }}
              >{deleting ? '削除中...' : '削除'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
