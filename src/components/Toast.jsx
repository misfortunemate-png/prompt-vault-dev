import { useEffect } from 'react';

const typeStyles = {
  success: { background: 'var(--accent)', color: 'var(--accent-contrast)' },
  error: { background: '#c0392b', color: '#fff' },
  info: { background: 'var(--surface)', color: 'var(--text-secondary)', border: '1px solid var(--line)' },
};

function ToastItem({ toast, onRemove }) {
  useEffect(() => {
    if (toast.type !== 'error') {
      const t = setTimeout(() => onRemove(toast.id), 3000);
      return () => clearTimeout(t);
    }
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
      ...typeStyles[toast.type] || typeStyles.info,
    }}>
      <span>{toast.message}</span>
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
      bottom: '62px',
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
