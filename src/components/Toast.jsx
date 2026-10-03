import { useEffect, useState } from 'react';
import { recordInvalid } from '../lib/invalidLog';

const typeStyles = {
  success: { background: 'var(--accent)', color: 'var(--accent-contrast)' },
  error: { background: '#c0392b', color: '#fff' },
  info: { background: 'var(--surface)', color: 'var(--text-secondary)', border: '1px solid var(--line)' },
  // F-07・J-2: 実際に使われている warn（App）と warning（GenerateScreen）は当たる枝として定める
  warn: { background: '#f59e0b', color: '#1f2937' },
  warning: { background: '#f59e0b', color: '#1f2937' },
};

const AUTO_DISMISS_MAP = { success: 2000, info: 5000, warn: 7000, warning: 7000, error: 10000 };
const FADE_MS = 300;

function ToastItem({ toast, onRemove }) {
  const [fading, setFading] = useState(false);

  const known = Object.prototype.hasOwnProperty.call(typeStyles, toast.type);

  useEffect(() => {
    if (!known) {
      // F-07: 当たらない型は info の見た目で出し、元の型を残す
      recordInvalid({ kind: 'toast-type-unknown', stage: 'F-07 Toast', raw: { type: toast.type, message: toast.message }, reason: 'success/error/info/warn/warning のどれでもない（info の見た目で表示）' });
    }
    if (toast.type === 'error') console.error(toast.message);
    else if (toast.type === 'warn' || toast.type === 'warning') console.warn(toast.message);
    const dismissMs = AUTO_DISMISS_MAP[toast.type] || AUTO_DISMISS_MAP.info;
    const fadeTimer = setTimeout(() => setFading(true), dismissMs - FADE_MS);
    const removeTimer = setTimeout(() => onRemove(toast.id), dismissMs);
    return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer); };
  }, [toast, onRemove]);

  return (
    <div style={{
      padding: '10px 16px',
      borderRadius: 'var(--radius-s)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      fontSize: 'var(--fs-label)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      opacity: fading ? 0 : 1,
      transition: `opacity ${FADE_MS}ms ease`,
      ...(known ? typeStyles[toast.type] : typeStyles.info),
    }}>
      <span>{known ? toast.message : `[${String(toast.type)}] ${toast.message}`}</span>
      {toast.type === 'error' && (
        <button
          onClick={() => onRemove(toast.id)}
          style={{
            background: 'none', border: 'none', color: 'inherit',
            cursor: 'pointer', fontSize: '16px', padding: '0 4px',
          }}
        >✕</button>
      )}
    </div>
  );
}

export default function Toast({ toasts, removeToast }) {
  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: '56px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 2000,
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      width: 'calc(100% - 32px)',
      maxWidth: '400px',
    }}>
      {toasts.slice(-3).map(t => (
        <ToastItem key={t.id} toast={t} onRemove={removeToast} />
      ))}
    </div>
  );
}
