'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface UnprocessedMatch {
  id:       string;
  nation_a: string;
  nation_b: string;
  phase:    string;
  nameA:    string;
  nameB:    string;
  flagA:    string;
  flagB:    string;
}

interface Props {
  competitionId: number;
  currentDayIndex: number;
}

export default function ManualResultForm({ competitionId, currentDayIndex }: Props) {
  const router = useRouter();
  const [matches,    setMatches]    = useState<UnprocessedMatch[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [selected,   setSelected]   = useState<string>('');
  const [scoreA,     setScoreA]     = useState('');
  const [scoreB,     setScoreB]     = useState('');
  const [hasET,      setHasET]      = useState(false);
  const [etWinner,   setEtWinner]   = useState<'A' | 'B' | ''>('');
  const [hasPens,    setHasPens]    = useState(false);
  const [penWinner,  setPenWinner]  = useState<'A' | 'B' | ''>('');
  const [penA,       setPenA]       = useState('');
  const [penB,       setPenB]       = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message,    setMessage]    = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/matches/unprocessed?competitionId=${competitionId}&dayIndex=${currentDayIndex}`)
      .then(r => r.json())
      .then((d: { matches: UnprocessedMatch[] }) => setMatches(d.matches ?? []))
      .catch(() => setMatches([]))
      .finally(() => setLoading(false));
  }, [competitionId, currentDayIndex]);

  const selectedMatch = matches.find(m => m.id === selected);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || scoreA === '' || scoreB === '') return;
    setSubmitting(true);
    setMessage(null);

    const body = {
      matchId:   selected,
      scoreA:    parseInt(scoreA, 10),
      scoreB:    parseInt(scoreB, 10),
      etRes:     hasET && etWinner ? etWinner : null,
      penWinner: hasPens && penWinner ? penWinner : null,
      penA:      hasPens ? parseInt(penA, 10) || 0 : 0,
      penB:      hasPens ? parseInt(penB, 10) || 0 : 0,
    };

    try {
      const res  = await fetch('/api/admin/matches/process-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ text: json.error ?? res.statusText, ok: false });
      } else {
        setMessage({ text: `✓ ${json.match} · ${json.res} · ${json.newPA} / ${json.newPB} KC`, ok: true });
        // Reset form and refresh
        setSelected(''); setScoreA(''); setScoreB('');
        setHasET(false); setEtWinner(''); setHasPens(false);
        setPenWinner(''); setPenA(''); setPenB('');
        setMatches(prev => prev.filter(m => m.id !== selected));
        router.refresh();
      }
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Erreur réseau', ok: false });
    } finally {
      setSubmitting(false);
    }
  }

  const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
  const inp: React.CSSProperties = {
    background: '#111', border: '1px solid #333', color: '#fff',
    padding: '5px 8px', fontSize: 11, fontFamily: 'monospace', width: 60,
  };
  const sel: React.CSSProperties = { ...inp, width: 'auto', minWidth: 200 };
  const lbl: React.CSSProperties = { fontSize: 10, color: '#888', fontFamily: 'monospace' };
  const chk: React.CSSProperties = { accentColor: '#FFDB00' };

  if (loading) return <div style={{ fontSize: 11, color: '#444', fontFamily: 'monospace' }}>Chargement des matches…</div>;
  if (matches.length === 0) return (
    <div style={{ fontSize: 11, color: '#444', fontFamily: 'monospace' }}>
      Aucun match non traité pour la journée {currentDayIndex}
    </div>
  );

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Match selector */}
      <div style={row}>
        <span style={lbl}>MATCH</span>
        <select value={selected} onChange={e => setSelected(e.target.value)} style={sel} required>
          <option value=''>— Sélectionner un match —</option>
          {matches.map(m => (
            <option key={m.id} value={m.id}>
              {m.flagA} {m.nameA} vs {m.nameB} {m.flagB} · {m.phase}
            </option>
          ))}
        </select>
      </div>

      {selectedMatch && (
        <>
          {/* Score */}
          <div style={row}>
            <span style={lbl}>SCORE</span>
            <span style={{ fontSize: 12, color: '#aaa', fontFamily: 'monospace' }}>{selectedMatch.flagA} {selectedMatch.nameA}</span>
            <input type='number' min={0} max={30} value={scoreA} onChange={e => setScoreA(e.target.value)}
              placeholder='0' style={inp} required />
            <span style={{ color: '#555' }}>–</span>
            <input type='number' min={0} max={30} value={scoreB} onChange={e => setScoreB(e.target.value)}
              placeholder='0' style={inp} required />
            <span style={{ fontSize: 12, color: '#aaa', fontFamily: 'monospace' }}>{selectedMatch.flagB} {selectedMatch.nameB}</span>
          </div>

          {/* Extra time toggle */}
          <div style={row}>
            <label style={{ ...lbl, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type='checkbox' checked={hasET} onChange={e => { setHasET(e.target.checked); if (!e.target.checked) { setHasPens(false); setPenWinner(''); } }} style={chk} />
              Prolongations (AET)
            </label>
            {hasET && (
              <>
                <span style={lbl}>Vainqueur AET</span>
                <select value={etWinner} onChange={e => setEtWinner(e.target.value as 'A' | 'B')} style={{ ...sel, minWidth: 120 }}>
                  <option value=''>Nul (→ pens)</option>
                  <option value='A'>{selectedMatch.flagA} {selectedMatch.nameA}</option>
                  <option value='B'>{selectedMatch.flagB} {selectedMatch.nameB}</option>
                </select>
              </>
            )}
          </div>

          {/* Penalties toggle (only if ET and no ET winner = drawn after AET) */}
          {hasET && !etWinner && (
            <div style={row}>
              <label style={{ ...lbl, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type='checkbox' checked={hasPens} onChange={e => setHasPens(e.target.checked)} style={chk} />
                Tirs au but
              </label>
              {hasPens && (
                <>
                  <span style={lbl}>Vainqueur</span>
                  <select value={penWinner} onChange={e => setPenWinner(e.target.value as 'A' | 'B')} style={{ ...sel, minWidth: 120 }} required={hasPens}>
                    <option value=''>—</option>
                    <option value='A'>{selectedMatch.flagA} {selectedMatch.nameA}</option>
                    <option value='B'>{selectedMatch.flagB} {selectedMatch.nameB}</option>
                  </select>
                  <span style={lbl}>Score</span>
                  <input type='number' min={0} max={20} value={penA} onChange={e => setPenA(e.target.value)} placeholder='0' style={{ ...inp, width: 45 }} />
                  <span style={{ color: '#555' }}>–</span>
                  <input type='number' min={0} max={20} value={penB} onChange={e => setPenB(e.target.value)} placeholder='0' style={{ ...inp, width: 45 }} />
                </>
              )}
            </div>
          )}

          {/* Submit */}
          <div style={row}>
            <button
              type='submit'
              disabled={submitting}
              style={{
                padding: '7px 16px', border: '1px solid #FFDB00',
                background: 'transparent', color: '#FFDB00',
                cursor: submitting ? 'not-allowed' : 'pointer',
                fontSize: 11, fontFamily: 'monospace',
                opacity: submitting ? 0.5 : 1,
              }}
            >
              {submitting ? '⏳ Traitement…' : '✔ VALIDER LE RÉSULTAT'}
            </button>
          </div>
        </>
      )}

      {message && (
        <div style={{ fontSize: 11, color: message.ok ? '#00FF87' : '#ff4444', fontFamily: 'monospace' }}>
          {message.ok ? '✓' : '❌'} {message.text}
        </div>
      )}
    </form>
  );
}
