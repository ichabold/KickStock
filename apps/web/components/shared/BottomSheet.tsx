'use client';

import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export default function BottomSheet({ open, onClose, children }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      style={s.overlay}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={sheetRef} style={s.sheet}>
        <div style={s.handle} />
        {children}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 500,
    background: 'rgba(0,0,0,0.88)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    animation: 'fadeIn .15s ease-out',
  },
  sheet: {
    background: 'var(--s1)',
    borderTop: '1px solid var(--border-hi)',
    borderRadius: '20px 20px 0 0',
    padding: '12px 20px 32px',
    maxHeight: 'calc(100dvh - 60px)',
    overflowY: 'auto',
    animation: 'slideUp .2s ease-out',
  },
  handle: {
    width: 36,
    height: 4,
    background: 'var(--border-hi)',
    borderRadius: 2,
    margin: '0 auto 16px',
  },
};
