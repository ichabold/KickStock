'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';

interface Beat {
  selector: string;
  labelKey: string;
  textKey: string;
  tip: 'top' | 'bottom' | 'right';
}

const BROWSER_BEATS: Beat[] = [
  { selector: '[data-coach="schedule-match"]', labelKey: 'schedule.rule1Label', textKey: 'schedule.rule1Text', tip: 'bottom' },
  { selector: '.tbs:nth-child(2)',             labelKey: 'schedule.rule2Label', textKey: 'schedule.rule2Text', tip: 'bottom' },
  { selector: '.sim-inline-btn',               labelKey: 'schedule.rule3Label', textKey: 'schedule.rule3Text', tip: 'bottom' },
  { selector: '.tbs:nth-child(1)',             labelKey: 'schedule.rule4Label', textKey: 'schedule.rule4Text', tip: 'bottom' },
  { selector: '[data-coach="schedule-match"]', labelKey: 'schedule.rule5Label', textKey: 'schedule.rule5Text', tip: 'bottom' },
];

const MOBILE_BEATS: Beat[] = [
  { selector: '[data-coach="schedule-match"]', labelKey: 'schedule.rule1Label', textKey: 'schedule.rule1Text', tip: 'bottom' },
  { selector: '[data-coach="cash-stat"]',      labelKey: 'schedule.rule2Label', textKey: 'schedule.rule2Text', tip: 'bottom' },
  { selector: '[data-coach="play-btn"]',       labelKey: 'schedule.rule3Label', textKey: 'schedule.rule3Text', tip: 'top'    },
  { selector: '[data-coach="total-stat"]',     labelKey: 'schedule.rule4Label', textKey: 'schedule.rule4Text', tip: 'bottom' },
  { selector: '[data-coach="schedule-match"]', labelKey: 'schedule.rule5Label', textKey: 'schedule.rule5Text', tip: 'bottom' },
];

interface Props {
  shell: 'browser' | 'mobile';
  onDone: () => void;
}

const PAD = 10;
const TIP_W = 280;

export default function CoachMarkOverlay({ shell, onDone }: Props) {
  const t = useTranslations('coachMark');
  const beats = shell === 'browser' ? BROWSER_BEATS : MOBILE_BEATS;
  const [step,    setStep]    = useState(0);
  const [rect,    setRect]    = useState<DOMRect | null>(null);
  const [tipPos,  setTipPos]  = useState<{ top: number; left: number } | null>(null);

  const beat = beats[step];

  const measure = useCallback(() => {
    const el = document.querySelector(beat.selector) as HTMLElement | null;
    if (!el) {
      // Target not present in this game mode (e.g. offline-only button) —
      // fall back to a centered tooltip so the user can still advance/finish.
      setRect(null);
      const TIP_H = 130;
      setTipPos({
        top:  Math.max(12, (window.innerHeight - TIP_H) / 2),
        left: Math.max(12, Math.min((window.innerWidth - TIP_W) / 2, window.innerWidth - TIP_W - 12)),
      });
      return;
    }

    const r = el.getBoundingClientRect();
    setRect(r);

    const cx = r.left + r.width / 2;
    const tipLeft = Math.max(12, Math.min(cx - TIP_W / 2, window.innerWidth - TIP_W - 12));

    const TIP_H = 130;
    let tipTop: number;
    if (beat.tip === 'bottom') {
      tipTop = r.bottom + PAD + 16;
      if (tipTop + TIP_H > window.innerHeight - 20) {
        tipTop = r.top - PAD - TIP_H - 16;
      }
    } else {
      tipTop = r.top - PAD - TIP_H - 16;
      if (tipTop < 20) {
        tipTop = r.bottom + PAD + 16;
      }
    }
    tipTop = Math.max(12, Math.min(tipTop, window.innerHeight - TIP_H - 12));

    setTipPos({ top: tipTop, left: tipLeft });
  }, [beat]);

  useEffect(() => {
    const timeout = setTimeout(measure, step === 0 ? 200 : 80);
    window.addEventListener('resize', measure);
    return () => { clearTimeout(timeout); window.removeEventListener('resize', measure); };
  }, [measure, step]);

  function advance() {
    if (step < beats.length - 1) {
      setRect(null);
      setTipPos(null);
      setStep(s => s + 1);
    } else {
      onDone();
    }
  }

  const isLast = step === beats.length - 1;

  const sp = rect ? {
    left:   rect.left   - PAD,
    top:    rect.top    - PAD,
    width:  rect.width  + PAD * 2,
    height: rect.height + PAD * 2,
  } : null;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div style={o.root} onClick={onDone}>
      {sp && (
        <div
          style={{
            position: 'fixed',
            left:   sp.left,
            top:    sp.top,
            width:  sp.width,
            height: sp.height,
            borderRadius: 10,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.80)',
            border: '1.5px solid rgba(255,219,0,0.45)',
            zIndex: 480,
            pointerEvents: 'none',
          }}
        />
      )}

      {!sp && <div style={o.dimFallback} />}

      {tipPos && (
        <div
          style={{ ...o.tip, top: tipPos.top, left: tipPos.left, width: TIP_W }}
          onClick={e => e.stopPropagation()}
        >
          {sp && (
            <div style={{
              ...o.arrow,
              ...(beat.tip === 'bottom'
                ? { top: -7, left: 24, transform: 'rotate(-135deg)' }
                : { bottom: -7, left: 24, transform: 'rotate(45deg)' }),
            }} />
          )}

          <div style={o.tipLabel}>{t(beat.labelKey as Parameters<typeof t>[0])}</div>
          <div style={o.tipText}>{t(beat.textKey as Parameters<typeof t>[0])}</div>
          <div style={o.tipFoot}>
            <div style={o.dots}>
              {beats.map((_, i) => (
                <div key={i} style={{ ...o.dot, ...(i === step ? o.dotOn : {}) }} />
              ))}
            </div>
            <button style={o.gotIt} onClick={advance}>
              {isLast ? t('trade') : t('gotIt')}
            </button>
          </div>
        </div>
      )}

      <button style={o.skip} onClick={onDone}>
        {t('skip')}
      </button>
    </div>,
    document.body,
  );
}

const o: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    zIndex: 470,
    cursor: 'default',
  },
  dimFallback: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.80)',
    zIndex: 471,
  },
  tip: {
    position: 'fixed',
    zIndex: 490,
    background: '#0c0c0c',
    border: '1px solid var(--gold)',
    borderRadius: 12,
    padding: '14px 16px 12px',
    boxShadow: '0 12px 40px rgba(0,0,0,0.8)',
  },
  arrow: {
    position: 'absolute',
    width: 10,
    height: 10,
    background: '#0c0c0c',
    borderRight: '1px solid var(--gold)',
    borderBottom: '1px solid var(--gold)',
  },
  tipLabel: {
    fontFamily: 'var(--font-display)',
    fontSize: 10,
    letterSpacing: 2,
    color: 'var(--gold)',
    marginBottom: 6,
  },
  tipText: {
    fontSize: 12,
    color: 'var(--text)',
    lineHeight: 1.5,
    marginBottom: 10,
  },
  tipFoot: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dots: { display: 'flex', gap: 5, alignItems: 'center' },
  dot: {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: 'var(--border-hi)',
    transition: 'all .15s',
  },
  dotOn: { width: 14, borderRadius: 3, background: 'var(--gold)' },
  gotIt: {
    fontFamily: 'var(--font-display)',
    fontSize: 10,
    letterSpacing: 1,
    color: 'var(--gold)',
    background: 'rgba(255,219,0,0.1)',
    border: '1px solid var(--gold-dk)',
    padding: '4px 10px',
    borderRadius: 5,
    cursor: 'pointer',
  },
  skip: {
    position: 'fixed',
    bottom: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 495,
    background: 'none',
    border: 'none',
    color: 'var(--dim)',
    fontSize: 10,
    letterSpacing: 1,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    padding: '8px 16px',
  },
};
