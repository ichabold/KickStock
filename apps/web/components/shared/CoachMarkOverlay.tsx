'use client';

import { useState, useEffect, useCallback } from 'react';

interface Beat {
  selector: string;
  label: string;
  text: string;
  tip: 'top' | 'bottom' | 'right';
}

// 4 beats anchored to real UI elements in BrowserShell
const BROWSER_BEATS: Beat[] = [
  {
    selector: '.stile',
    label: 'RÈGLE 1 · 4',
    text: 'Chaque carte = une équipe nationale. Elle gagne → son prix monte. Elle perd → le vainqueur absorbe 40% de sa valeur.',
    tip: 'bottom',
  },
  {
    selector: '.tbs:first-child',
    label: 'RÈGLE 2 · 4',
    text: 'Quand une de tes équipes se qualifie (R32, R16, QF, SF, Finale), un dividende atterrit automatiquement dans ton cash.',
    tip: 'bottom',
  },
  {
    selector: '.sim-inline-btn',
    label: 'RÈGLE 3 · 4',
    text: "Le marché gèle 15 min avant chaque match. Ce bouton simule la journée — fais tes trades avant qu'il ne disparaisse.",
    tip: 'bottom',
  },
  {
    selector: '.bbuy',
    label: 'RÈGLE 4 · 4 — DERNIÈRE',
    text: 'Acheter est gratuit. Vendre coûte 10% (groupes) ou 5% (KO). Voilà — choisis une équipe et fais ton premier trade !',
    tip: 'top',
  },
];

// 4 beats anchored to real UI elements in MobileShell
const MOBILE_BEATS: Beat[] = [
  {
    selector: '[data-coach="nation-card"]',
    label: 'RÈGLE 1 · 4',
    text: 'Chaque carte = une équipe nationale. Elle gagne → prix ▲. Elle perd → le vainqueur absorbe 40% de sa valeur.',
    tip: 'bottom',
  },
  {
    selector: '[data-coach="cash-stat"]',
    label: 'RÈGLE 2 · 4',
    text: 'Quand une équipe que tu détiens se qualifie (R32, R16, QF…), un dividende atterrit automatiquement dans ton cash.',
    tip: 'bottom',
  },
  {
    selector: '[data-coach="play-btn"]',
    label: 'RÈGLE 3 · 4',
    text: "Le marché gèle avant chaque match. Ce bouton lance la journée — trade avant pour ne pas rater les mouvements de prix.",
    tip: 'top',
  },
  {
    selector: '[data-coach="nation-card"] button',
    label: 'RÈGLE 4 · 4 — DERNIÈRE',
    text: 'Acheter est gratuit. Vendre coûte 10% (groupes) ou 5% (KO). Maintenant → choisis une équipe et lance-toi !',
    tip: 'top',
  },
];

interface Props {
  shell: 'browser' | 'mobile';
  onDone: () => void;
}

const PAD = 10;
const TIP_W = 280;

export default function CoachMarkOverlay({ shell, onDone }: Props) {
  const beats = shell === 'browser' ? BROWSER_BEATS : MOBILE_BEATS;
  const [step,    setStep]    = useState(0);
  const [rect,    setRect]    = useState<DOMRect | null>(null);
  const [tipPos,  setTipPos]  = useState<{ top: number; left: number } | null>(null);

  const beat = beats[step];

  const measure = useCallback(() => {
    const el = document.querySelector(beat.selector) as HTMLElement | null;
    if (!el) { setRect(null); setTipPos(null); return; }

    const r = el.getBoundingClientRect();
    setRect(r);

    const cx = r.left + r.width / 2;
    const tipLeft = Math.max(12, Math.min(cx - TIP_W / 2, window.innerWidth - TIP_W - 12));

    let tipTop: number;
    if (beat.tip === 'bottom') {
      tipTop = r.bottom + PAD + 16;
    } else {
      tipTop = r.top - PAD - 140; // approximate tip height
    }

    setTipPos({ top: tipTop, left: tipLeft });
  }, [beat]);

  // Re-measure on step change or resize
  useEffect(() => {
    const timeout = setTimeout(measure, 60);
    window.addEventListener('resize', measure);
    return () => { clearTimeout(timeout); window.removeEventListener('resize', measure); };
  }, [measure]);

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

  // Spotlight rect with padding
  const sp = rect ? {
    left:   rect.left   - PAD,
    top:    rect.top    - PAD,
    width:  rect.width  + PAD * 2,
    height: rect.height + PAD * 2,
  } : null;

  return (
    <div style={o.root} onClick={onDone}>
      {/* Spotlight: transparent box + box-shadow dims everything outside */}
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

      {/* Fallback dim when element not found */}
      {!sp && <div style={o.dimFallback} />}

      {/* Tooltip */}
      {tipPos && (
        <div
          style={{ ...o.tip, top: tipPos.top, left: tipPos.left, width: TIP_W }}
          onClick={e => e.stopPropagation()}
        >
          {/* Arrow */}
          {sp && (
            <div style={{
              ...o.arrow,
              ...(beat.tip === 'bottom'
                ? { top: -7, left: 24, transform: 'rotate(-135deg)' }
                : { bottom: -7, left: 24, transform: 'rotate(45deg)' }),
            }} />
          )}

          <div style={o.tipLabel}>{beat.label}</div>
          <div style={o.tipText}>{beat.text}</div>
          <div style={o.tipFoot}>
            <div style={o.dots}>
              {beats.map((_, i) => (
                <div key={i} style={{ ...o.dot, ...(i === step ? o.dotOn : {}) }} />
              ))}
            </div>
            <button style={o.gotIt} onClick={advance}>
              {isLast ? 'TRADER →' : 'COMPRIS →'}
            </button>
          </div>
        </div>
      )}

      {/* Skip */}
      <button style={o.skip} onClick={onDone}>
        Passer le tutoriel
      </button>
    </div>
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
