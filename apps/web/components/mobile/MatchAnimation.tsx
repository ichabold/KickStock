'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { fmt } from '@kickstock/game-engine';
import type { StoredMatchResult, TeamMeta } from '@kickstock/types';
import styles from './MatchAnimation.module.css';

interface Props {
  results:   StoredMatchResult[];
  portfolio: Record<string, number>;
  prices:    Record<string, number>;
  teams:     TeamMeta[];
  onDone:    () => void;
}

// PHASE_LABEL is built dynamically per-render using translations — see phaseLabel() below

// Timing constants, tunable from one place
const ANIM = {
  play:       9000,
  et:         5000,
  stinger:    1500,
  penKick:     900,
  penDecided:  300,  // fast-forward once result is mathematically decided
  resultIn:    400,
};

type AnimPhase = 'playing' | 'stingerET' | 'et' | 'stingerPens' | 'pens' | 'result';

interface PenKick { team: 'A' | 'B'; name: string; scored: boolean; reveal: 'pending' | 'scored' | 'missed'; }

function PhaseStinger({ label, sub, tone, onDone }: {
  label: string; sub?: string; tone: 'gold' | 'loss'; onDone: () => void;
}) {
  useEffect(() => { const id = setTimeout(onDone, ANIM.stinger); return () => clearTimeout(id); }, [onDone]);
  return (
    <div className={styles.stinger} data-tone={tone}>
      <div className={styles.stingerLabel}>{label}</div>
      {sub && <div className={styles.stingerSub}>{sub}</div>}
    </div>
  );
}

function isPenDecided(played: PenKick[], targetA: number, targetB: number): boolean {
  const scoredA = played.filter(k => k.team === 'A' && k.scored).length;
  const scoredB = played.filter(k => k.team === 'B' && k.scored).length;
  const remainA = Math.max(0, 5 - played.filter(k => k.team === 'A').length);
  const remainB = Math.max(0, 5 - played.filter(k => k.team === 'B').length);
  if (played.length < 10) {
    if (scoredA > scoredB + remainB) return true;
    if (scoredB > scoredA + remainA) return true;
    return false;
  }
  return scoredA === targetA && scoredB === targetB;
}

export default function MatchAnimation({ results, portfolio, prices, teams, onDone }: Props) {
  const [idx, setIdx] = useState(0);
  const m = results[idx];

  if (!m) { onDone(); return null; }

  function nextMatch() {
    if (idx + 1 < results.length) setIdx(i => i + 1);
    else onDone();
  }

  return <SingleMatch key={idx} result={m} matchNum={idx + 1} total={results.length}
    portfolio={portfolio} prices={prices} teams={teams} onNext={nextMatch} />;
}

function SingleMatch({
  result, matchNum, total, portfolio, prices, teams, onNext,
}: {
  result:    StoredMatchResult;
  matchNum:  number;
  total:     number;
  portfolio: Record<string, number>;
  prices:    Record<string, number>;
  teams:     TeamMeta[];
  onNext:    () => void;
}) {
  const ta = useTranslations('matchAnimation');
  const gN = (id: string) => (teams ?? []).find(t => t.id === id);
  const nA = gN(result.a)!;
  const nB = gN(result.b)!;

  const [phase,    setPhase]    = useState<AnimPhase>('playing');
  const [sA,       setSA]       = useState(0);
  const [sB,       setSB]       = useState(0);
  const [prog,     setProg]     = useState(0);
  const [min,      setMin]      = useState(0);
  const [fA,       setFA]       = useState(false);
  const [fB,       setFB]       = useState(false);
  const [feed,     setFeed]     = useState<{ min: number; team: string; name: string; key: number }[]>([]);
  const [whistle,  setWhistle]  = useState(false);
  const [showRes,  setShowRes]  = useState(false);
  const [penEvents, setPenEvents] = useState<PenKick[]>([]);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const goalRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isKO  = result.res90 !== 'draw' ? true : !!result.penWinner || !!result.etRes;
  const goals = result.goals ?? [];

  const clearAll = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    goalRefs.current.forEach(t => clearTimeout(t));
    goalRefs.current = [];
  }, []);

  // ── 90-min phase ──────────────────────────────────────────────────────────
  const startPlaying = useCallback(() => {
    setSA(0); setSB(0); setProg(0); setMin(0);
    setFA(false); setFB(false); setFeed([]);
    setPhase('playing'); setShowRes(false); setWhistle(false);
    setPenEvents([]);

    const DUR = 9000, t0 = Date.now();
    timerRef.current = setInterval(() => {
      const p = Math.min((Date.now() - t0) / DUR, 1);
      setProg(p * 100); setMin(Math.floor(p * 90));
      if (p >= 1) {
        clearInterval(timerRef.current!);
        setWhistle(true);
        if (result.res90 === 'draw' && (result.etRes || result.penWinner)) {
          setTimeout(() => setPhase('stingerET'), 600);
        } else {
          setTimeout(() => setPhase('result'), 400);
          setTimeout(() => setShowRes(true), 700);
        }
      }
    }, 50);

    // Schedule 90-min goals
    goals.filter(g => g.min <= 90).forEach(g => {
      const t = setTimeout(() => {
        if (g.team === 'A') { setSA(p => p + 1); setFA(true); setTimeout(() => setFA(false), 400); }
        else                 { setSB(p => p + 1); setFB(true); setTimeout(() => setFB(false), 400); }
        setFeed(p => [{ ...g, key: Date.now() }, ...p].slice(0, 3));
      }, (g.min / 90) * DUR);
      goalRefs.current.push(t);
    });
  }, [result, goals]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ET phase (5 sec) ─────────────────────────────────────────────────────
  const startET = useCallback(() => {
    setWhistle(false);
    const ET = 5000, t0 = Date.now();
    timerRef.current = setInterval(() => {
      const p = Math.min((Date.now() - t0) / ET, 1);
      setProg(p * 100); setMin(90 + Math.floor(p * 30));
      if (p >= 1) {
        clearInterval(timerRef.current!);
        setWhistle(true);
        if (result.penWinner) {
          setTimeout(() => setPhase('stingerPens'), 600);
        } else {
          // ET winner scored
          const etGoal = goals.find(g => g.min > 90 && g.team === result.etRes);
          const etMin  = etGoal?.min ?? 105;
          const etName = etGoal?.name ?? '⚡ ET';
          if (result.etRes === 'A') { setSA(p => p + 1); setFA(true); setTimeout(() => setFA(false), 400); }
          else                       { setSB(p => p + 1); setFB(true); setTimeout(() => setFB(false), 400); }
          setFeed(p => [{ min: etMin, team: result.etRes!, name: etName, key: Date.now() }, ...p].slice(0, 3));
          setTimeout(() => setPhase('result'), 600);
          setTimeout(() => setShowRes(true), 900);
        }
      }
    }, 50);
  }, [result, goals]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Penalty phase ─────────────────────────────────────────────────────────
  const startPens = useCallback(() => {
    setWhistle(false);
    setPenEvents([]);
    const poolA = [nA.name];
    const poolB = [nB.name];
    const kicks: PenKick[] = [];
    let cA = 0, cB = 0, rA = 0, rB = 0;
    const tgt = { A: result.penA, B: result.penB };
    const total = Math.max(result.penA + result.penB + 2, 10);
    for (let i = 0; i < total; i++) {
      const team: 'A' | 'B' = i % 2 === 0 ? 'A' : 'B';
      const idx2 = team === 'A' ? rA++ : rB++;
      const pool = team === 'A' ? poolA : poolB;
      const name = pool[idx2 % pool.length];
      const scored = team === 'A' ? cA < tgt.A : cB < tgt.B;
      if (scored) { team === 'A' ? cA++ : cB++; }
      kicks.push({ team, name, scored, reveal: 'pending' });
    }

    const played: PenKick[] = [];
    let i = 0;
    const heldA = (portfolio[result.a] ?? 0) > 0;
    const heldB = (portfolio[result.b] ?? 0) > 0;

    const tick = () => {
      if (i >= kicks.length) {
        const doneId = setTimeout(() => {
          setPhase('result');
          setTimeout(() => setShowRes(true), 300);
        }, 200);
        goalRefs.current.push(doneId);
        return;
      }
      const k = { ...kicks[i], reveal: 'pending' as const };
      played.push(k);
      setPenEvents([...played]);

      // After 450ms reveal scored/missed
      const revealId = setTimeout(() => {
        played[played.length - 1] = { ...k, reveal: k.scored ? 'scored' : 'missed' };
        setPenEvents([...played]);
        if (k.team === 'A' && heldA) navigator.vibrate?.(k.scored ? 8 : 30);
        else if (k.team === 'B' && heldB) navigator.vibrate?.(k.scored ? 8 : 30);
      }, 450);
      goalRefs.current.push(revealId);

      i++;
      const decided = isPenDecided(played, result.penA, result.penB);
      const next = decided ? ANIM.penDecided : ANIM.penKick;
      const nextId = setTimeout(tick, next);
      goalRefs.current.push(nextId);
    };
    tick();
  }, [result, nA.name, nB.name, portfolio]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    startPlaying();
    return clearAll;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Skip ─────────────────────────────────────────────────────────────────
  function skip() {
    clearAll();
    setSA(result.scoreA); setSB(result.scoreB);
    setFA(true); setFB(true);
    setTimeout(() => { setFA(false); setFB(false); }, 400);
    setProg(100); setMin(result.res90 === 'draw' ? 120 : 90);
    setFeed(goals.slice(-3).map(g => ({ ...g, key: Math.random() })));
    if (result.penWinner) {
      const kicks: PenKick[] = [];
      for (let i = 0; i < result.penA + result.penB; i++) {
        kicks.push({ team: i % 2 === 0 ? 'A' : 'B', name: '—', scored: true, reveal: 'scored' });
      }
      setPenEvents(kicks);
    }
    setWhistle(true);
    setPhase('result');
    setTimeout(() => setShowRes(true), 300);
  }

  // ── Result type ───────────────────────────────────────────────────────────
  const expA     = (portfolio[result.a] ?? 0) > 0;
  const expB     = (portfolio[result.b] ?? 0) > 0;
  const krachId  = result.elimId && (portfolio[result.elimId] ?? 0) > 0 ? result.elimId : null;

  let rType: 'neutral' | 'win' | 'loss' | 'draw' | 'upset' = 'neutral';
  let pnlColor = 'var(--muted)';
  let pnlLabel: string | null = null;

  if (krachId) {
    rType = 'loss'; pnlColor = 'var(--loss)';
    const oldP = krachId === result.a ? result.pA : result.pB;
    pnlLabel = `− ${fmt((portfolio[krachId] ?? 0) * (oldP - 1))} KC`;
  } else if (expA || expB) {
    const myWin = expA ? result.res === 'A' : result.res === 'B';
    rType = myWin ? (result.isUpset ? 'upset' : 'win') : result.res === 'draw' ? 'draw' : 'loss';
    pnlColor = rType === 'win' ? 'var(--gain)' : rType === 'upset' ? 'var(--upset)' : rType === 'draw' ? 'var(--muted)' : 'var(--loss)';
    const myId    = expA ? result.a : result.b;
    const newP    = myId === result.a ? result.newPA : result.newPB;
    const oldP    = myId === result.a ? result.pA    : result.pB;
    const delta   = (newP - oldP) * (portfolio[myId] ?? 0);
    pnlLabel = delta > 0 ? `▲ +${fmt(delta)} KC` : delta < 0 ? `▼ ${fmt(Math.abs(delta))} KC` : '= 0 KC';
  }

  const divCash = result.divCash ?? 0;
  const phaseLabels: Record<string, string> = {
    Groups: ta('groupStage'), R32: ta('r32'), R16: ta('r16'),
    QF: ta('quarterFinal'), SF: ta('semiFinal'), Final: ta('final'), '3rd': ta('thirdPlace'),
  };
  const phaseHdr = phaseLabels[result.phase] ?? result.phase;
  const subHdr = phase === 'et' || phase === 'stingerET' ? `⚡ ${ta('extraTime')}`
    : phase === 'pens' || phase === 'stingerPens' ? `🎯 ${ta('penalties')}` : null;

  const penScoreA = penEvents.filter(k => k.team === 'A' && k.scored).length;
  const penScoreB = penEvents.filter(k => k.team === 'B' && k.scored).length;

  // Next kicker
  const lastPen = penEvents[penEvents.length - 1];
  const nxtTeam: 'A' | 'B' | null = phase === 'pens' && penEvents.length < result.penA + result.penB + 2
    ? (lastPen ? (lastPen.team === 'A' ? 'B' : 'A') : 'A')
    : null;
  const nxtPool = nxtTeam === 'A' ? [nA.name] : nxtTeam === 'B' ? [nB.name] : [];
  const nxtName = nxtTeam ? nxtPool[penEvents.filter(k => k.team === nxtTeam).length % nxtPool.length] : '';

  const resClasses = [
    styles.resultOverlay,
    showRes ? styles.show : '',
    rType === 'win' || rType === 'upset' ? styles.rWin : rType === 'loss' ? styles.rLoss : rType === 'draw' ? styles.rDraw : styles.rNeutral,
  ].filter(Boolean).join(' ');

  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      {/* Phase stingers */}
      {phase === 'stingerET' && (
        <PhaseStinger
          label={ta('extraTime')}
          sub={ta('extraTimeSub')}
          tone="gold"
          onDone={() => { setPhase('et'); startET(); }}
        />
      )}
      {phase === 'stingerPens' && (
        <PhaseStinger
          label={ta('penalties')}
          sub={ta('penaltiesSub')}
          tone="loss"
          onDone={() => { setPhase('pens'); startPens(); }}
        />
      )}

      {/* Skip button */}
      {(phase === 'playing' || phase === 'et') && (
        <button className={styles.skipBtn} onClick={skip}>{ta('skip')}</button>
      )}

      {/* Phase header */}
      <div className={styles.phaseHdr}>
        {`MATCH ${matchNum}/${total} · ${phaseHdr}`}
        {subHdr && <span className={styles.subHdr}>{subHdr}</span>}
      </div>

      {/* Teams + score */}
      <div className={styles.teamsRow}>
        <div className={styles.teamBox}>
          <div className={`${styles.teamFlagBig} ${phase === 'pens' && nxtTeam === 'A' && (portfolio[result.a] ?? 0) > 0 ? styles.goldRing : ''}`}>
            {nA.flag}
          </div>
          <div className={styles.teamNameSmall}>{nA.name.toUpperCase()}</div>
          {phase === 'pens' && nxtTeam === 'A' && (portfolio[result.a] ?? 0) > 0
            ? <div className={styles.yourTeam}>{ta('yourTeam')}</div>
            : expA && <div className={styles.expBadge}>{ta('exposed')}</div>
          }
        </div>
        <div className={styles.scoreBox} aria-label={`${sA} à ${sB}`}>
          <div className={`${styles.scoreNum} ${fA ? styles.flashA : ''}`}>{sA}</div>
          <div className={styles.scoreDash}>–</div>
          <div className={`${styles.scoreNum} ${fB ? styles.flashB : ''}`}>{sB}</div>
        </div>
        <div className={styles.teamBox}>
          <div className={`${styles.teamFlagBig} ${phase === 'pens' && nxtTeam === 'B' && (portfolio[result.b] ?? 0) > 0 ? styles.goldRing : ''}`}>
            {nB.flag}
          </div>
          <div className={styles.teamNameSmall}>{nB.name.toUpperCase()}</div>
          {phase === 'pens' && nxtTeam === 'B' && (portfolio[result.b] ?? 0) > 0
            ? <div className={styles.yourTeam}>{ta('yourTeam')}</div>
            : expB && <div className={styles.expBadge}>{ta('exposed')}</div>
          }
        </div>
      </div>

      {/* Progress bar (not shown in pens) */}
      {phase !== 'pens' && (
        <div className={styles.progWrap}>
          <div className={styles.progBg}>
            <div className={styles.progFill} style={{ width: `${prog}%` }} />
          </div>
          <div className={styles.progTimer}>{min}&apos;{phase === 'et' ? ` (${ta('etAbbr')})` : ''}</div>
        </div>
      )}

      {/* Whistle */}
      <div className={styles.whistle} style={{ opacity: whistle ? 1 : 0 }}>
        {phase === 'pens' ? `🎯 ${ta('penaltyShootout')}` : phase === 'et' ? `⚡ ${ta('fullTimeET')}` : `⚽ ${ta('fullTime')}`}
      </div>

      {/* Penalty view */}
      {phase === 'pens' ? (
        <div className={styles.pensWrap}>
          <div className={styles.pensHeader}>
            <span className={styles.pensTeamLabel}>{nA.flag} {nA.name}</span>
            <span className={styles.pensTeamLabel}>{nB.flag} {nB.name}</span>
          </div>
          {nxtTeam && (
            <div className={styles.nextKicker}
              style={{
                background: nxtTeam === 'A' ? 'var(--gain-bg)' : 'var(--loss-bg)',
                borderColor: nxtTeam === 'A' ? 'var(--gain-dk)' : 'var(--loss-dk)',
              }}>
              <div className={styles.nextKickerLbl}>À TIRER</div>
              <div className={styles.nextKickerName} style={{ color: nxtTeam === 'A' ? 'var(--gain)' : 'var(--loss)' }}>
                {nxtTeam === 'A' ? nA.flag : nB.flag} {nxtName}
              </div>
            </div>
          )}
          <div className={styles.pensCols}>
            <div>
              {penEvents.filter(k => k.team === 'A').map((k, i) => (
                <div key={i} className={styles.penKick} data-reveal={k.reveal}>
                  {k.reveal === 'pending' ? '⋯' : k.reveal === 'scored' ? '⚽' : '❌'}
                  <span className={styles.penKickerName}>{k.name}</span>
                </div>
              ))}
            </div>
            <div>
              {penEvents.filter(k => k.team === 'B').map((k, i) => (
                <div key={i} className={`${styles.penKick} ${styles.penKickRight}`} data-reveal={k.reveal}>
                  <span className={styles.penKickerName}>{k.name}</span>
                  {k.reveal === 'pending' ? '⋯' : k.reveal === 'scored' ? '⚽' : '❌'}
                </div>
              ))}
            </div>
          </div>
          <div className={styles.pensScore}>{penScoreA} – {penScoreB}</div>
        </div>
      ) : (
        /* Goal feed */
        <div className={styles.feed}>
          {feed.map(g => (
            <div key={g.key} className={`${styles.feedGoal} ${g.team === 'A' ? styles.feedA : styles.feedB}`}>
              ⚽ {g.min}&apos; — {g.name}
            </div>
          ))}
        </div>
      )}

      {/* Result overlay */}
      {phase === 'result' && (
        <div className={resClasses}>
          {krachId ? (
            <>
              <div className={styles.rIcon}>💀</div>
              <div className={styles.rLabel} style={{ color: 'var(--loss)' }}>CRASH</div>
              <div className={styles.rScoreRow}>
                <span style={{ fontSize: 24 }}>{nA.flag}</span>
                <div className={styles.rScoreA} style={{ color: 'var(--loss)' }}>{result.scoreA}</div>
                <div className={styles.rDash}>–</div>
                <div className={styles.rScoreB}>{result.scoreB}</div>
                <span style={{ fontSize: 24 }}>{nB.flag}</span>
              </div>
              {result.penWinner && <div className={styles.rSub}>Pens: {result.penA}–{result.penB}</div>}
              {pnlLabel && <div className={styles.rPnl} style={{ color: 'var(--loss)' }}>{pnlLabel}</div>}
              <div className={styles.rSub}>{gN(krachId)?.name.toUpperCase()} {ta('eliminatedKc')}</div>
            </>
          ) : (expA || expB) ? (
            <>
              {rType === 'upset' && <div className={styles.rIcon}>🚀</div>}
              <div className={styles.rLabel} style={{ color: pnlColor }}>
                {rType === 'win' ? 'VICTOIRE' : rType === 'loss' ? 'DÉFAITE' : rType === 'upset' ? 'UPSET!' : 'MATCH NUL'}
              </div>
              <div className={styles.rScoreRow}>
                <span style={{ fontSize: 24 }}>{nA.flag}</span>
                <div className={styles.rScoreA} style={{ color: result.scoreA > result.scoreB ? 'var(--gain)' : result.scoreA < result.scoreB ? 'var(--loss)' : 'var(--muted)' }}>{result.scoreA}</div>
                <div className={styles.rDash}>–</div>
                <div className={styles.rScoreB} style={{ color: result.scoreB > result.scoreA ? 'var(--gain)' : result.scoreB < result.scoreA ? 'var(--loss)' : 'var(--muted)' }}>{result.scoreB}</div>
                <span style={{ fontSize: 24 }}>{nB.flag}</span>
              </div>
              {result.penWinner && <div className={styles.rSub}>Pens: {result.penA}–{result.penB}</div>}
              {result.etRes && !result.penWinner && <div className={styles.rSub} style={{ color: 'var(--gold)' }}>⚡ AET</div>}
              {pnlLabel && <div className={styles.rPnl} style={{ color: pnlColor }}>{pnlLabel}</div>}
              {divCash > 0 && (
                <div className={styles.rDiv}>
                  <div className={styles.rDivLbl}>🎁 DIVIDENDE</div>
                  <div className={styles.rDivVal}>+{fmt(divCash)} KC</div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className={styles.rScoreRow}>
                <span style={{ fontSize: 28 }}>{nA.flag}</span>
                <div className={styles.rScoreA}>{result.scoreA}</div>
                <div className={styles.rDash}>–</div>
                <div className={styles.rScoreB}>{result.scoreB}</div>
                <span style={{ fontSize: 28 }}>{nB.flag}</span>
              </div>
              {result.penWinner && <div className={styles.rSub}>Pens: {result.penA}–{result.penB}</div>}
              {result.etRes && !result.penWinner && <div className={styles.rSub} style={{ color: 'var(--gold)' }}>⚡ AET</div>}
              {result.isUpset && <div className={styles.rSub} style={{ color: 'var(--upset)', fontWeight: 700 }}>🚀 UPSET!</div>}
              {result.elimId && (
                <div className={styles.rSub} style={{ color: 'var(--loss)' }}>
                  💀 {gN(result.elimId)?.name.toUpperCase()} ÉLIMINÉ
                </div>
              )}
            </>
          )}
          <button className={styles.nextBtn} onClick={onNext}>
            {matchNum < total ? ta('nextMatch') : ta('viewResults')}
          </button>
        </div>
      )}
    </div>
  );
}
