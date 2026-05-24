/* eslint-disable react-refresh/only-export-components */
// src/contexts/ToastContext.jsx
// Global toast notification system — dark aesthetic matching the app.
import { createContext, useContext, useState, useCallback } from 'react';

const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

const T = {
  bg1: '#0f0f0f', accent: '#dedbd2',
  muted: 'rgba(222,219,210,0.38)',
  border: 'rgba(222,219,210,0.08)', borderH: 'rgba(222,219,210,0.22)',
};
const mono = { fontFamily: "'DM Mono', monospace" };

const ICONS = {
  success: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  error: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
  ),
  info: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(222,219,210,0.6)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
  warning: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
};

const BORDER_COLOR = {
  success: 'rgba(74,222,128,0.2)',
  error:   'rgba(239,68,68,0.2)',
  info:    'rgba(222,219,210,0.12)',
  warning: 'rgba(245,158,11,0.2)',
};

let idCounter = 0;

const Toast = ({ toast, onDismiss }) => {
  const [exiting, setExiting] = useState(false);

  const dismiss = () => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 220);
  };

  return (
    <div
      onClick={dismiss}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '10px',
        padding: '0.85rem 1rem',
        background: T.bg1,
        border: `1px solid ${BORDER_COLOR[toast.type] || T.border}`,
        borderRadius: '10px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        cursor: 'none',
        animation: exiting ? 'toast-out 0.22s ease forwards' : 'toast-in 0.22s ease',
        minWidth: '260px', maxWidth: '360px',
        position: 'relative', overflow: 'hidden',
      }}
    >
      <span style={{ flexShrink: 0, marginTop: '1px' }}>{ICONS[toast.type]}</span>
      <div style={{ flex: 1 }}>
        {toast.title && (
          <div style={{ ...mono, fontSize: '0.66rem', fontWeight: 700, color: T.accent, marginBottom: '2px' }}>
            {toast.title}
          </div>
        )}
        <div style={{ ...mono, fontSize: '0.62rem', color: T.muted, lineHeight: 1.5 }}>
          {toast.message}
        </div>
      </div>
      {/* Progress bar */}
      {toast.duration && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0,
          height: '2px',
          background: BORDER_COLOR[toast.type] || T.border,
          animation: `toast-progress ${toast.duration}ms linear forwards`,
        }} />
      )}
    </div>
  );
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts(p => p.filter(t => t.id !== id));
  }, []);

  const show = useCallback((message, { type = 'info', title, duration = 4000 } = {}) => {
    const id = ++idCounter;
    setToasts(p => [...p, { id, message, type, title, duration }]);
    if (duration) setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const toast = {
    success: (msg, opts) => show(msg, { type: 'success', ...opts }),
    error:   (msg, opts) => show(msg, { type: 'error',   ...opts }),
    info:    (msg, opts) => show(msg, { type: 'info',    ...opts }),
    warning: (msg, opts) => show(msg, { type: 'warning', ...opts }),
    dismiss,
  };

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      {/* Toast container */}
      <div style={{
        position: 'fixed', bottom: '1.5rem', right: '1.5rem',
        display: 'flex', flexDirection: 'column', gap: '8px',
        zIndex: 9999, pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: 'auto' }}>
            <Toast toast={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
      <style>{`
        @keyframes toast-in  { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes toast-out { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(8px); } }
        @keyframes toast-progress { from { width: 100%; } to { width: 0%; } }
      `}</style>
    </ToastCtx.Provider>
  );
};
