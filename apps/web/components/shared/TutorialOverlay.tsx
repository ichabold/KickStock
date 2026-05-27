'use client';

import { useState } from 'react';

const TUT_STEPS = [
  {
    title: 'Bienvenue sur KickStock !',
    text: 'Investissez dans les équipes nationales comme des actions. Plus une équipe performe, plus son prix monte.',
    icon: '⚽',
  },
  {
    title: 'Mouvements de prix',
    text: "Un résultat positif augmente le prix. Une défaite le fait chuter. Le gagnant absorbe 40% de la valeur du perdant.",
    icon: '📈',
  },
  {
    title: 'Dividendes & Taxes',
    text: "Quand votre équipe se qualifie (R32, R16, QF, SF, Finale, Champion), vous recevez des dividendes en KC. La taxe (10% groupes, 5% KO) s'applique uniquement à la vente.",
    icon: '💰',
  },
  {
    title: 'Lock-up marché',
    text: "Le marché est gelé 15 min avant et 30 min après chaque match. Planifiez vos trades à l'avance !",
    icon: '🔒',
  },
];

export default function TutorialOverlay({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const s = TUT_STEPS[step];

  return (
    <div style={ts.overlay} onClick={onClose}>
      <div style={ts.box} onClick={e => e.stopPropagation()}>
        <button style={ts.close} onClick={onClose}>✕</button>
        <div style={ts.icon}>{s.icon}</div>
        <div style={ts.title}>{s.title}</div>
        <div style={ts.text}>{s.text}</div>
        <div style={ts.dots}>
          {TUT_STEPS.map((_, i) => (
            <div key={i} style={{ ...ts.dot, ...(i === step ? ts.dotOn : {}) }} />
          ))}
        </div>
        <div style={ts.btns}>
          {step > 0 && (
            <button style={{ ...ts.btn, ...ts.btnSec }} onClick={() => setStep(n => n - 1)}>
              ← RETOUR
            </button>
          )}
          {step < TUT_STEPS.length - 1 ? (
            <button style={{ ...ts.btn, ...ts.btnPri }} onClick={() => setStep(n => n + 1)}>
              SUIVANT →
            </button>
          ) : (
            <button style={{ ...ts.btn, ...ts.btnPri }} onClick={onClose}>
              COMMENCER ✓
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const ts: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.88)',
    zIndex: 450,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px 16px',
  },
  box: {
    background: 'var(--s1)',
    border: '1px solid var(--border-hi)',
    borderRadius: 16,
    padding: '32px 28px',
    width: '100%',
    maxWidth: 440,
    position: 'relative',
    textAlign: 'center',
  },
  close: {
    position: 'absolute',
    top: 12,
    right: 14,
    background: 'none',
    border: 'none',
    color: 'var(--muted)',
    fontSize: 16,
    cursor: 'pointer',
  },
  icon: { fontSize: 48, marginBottom: 12 },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 22,
    letterSpacing: 2,
    color: 'var(--gold)',
    marginBottom: 10,
  },
  text: {
    fontSize: 13,
    color: 'var(--muted)',
    lineHeight: 1.6,
    marginBottom: 20,
  },
  dots: { display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 20 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--border-hi)',
    transition: 'all .2s',
  },
  dotOn: { width: 18, borderRadius: 3, background: 'var(--gold)' },
  btns: { display: 'flex', gap: 8, justifyContent: 'center' },
  btn: {
    padding: '10px 24px',
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: 1,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  },
  btnPri: { background: 'var(--gold)', color: '#000', border: 'none' },
  btnSec: { background: 'none', border: '1px solid var(--border-hi)', color: 'var(--muted)' },
};
