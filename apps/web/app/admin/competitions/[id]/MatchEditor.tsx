'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  competitionId: number;
  fixtureId:     number;
  scheduledAt:   string | null;
  scoreA:        number | null;
  scoreB:        number | null;
  apiStatus:     string | null;
}

export default function MatchEditor({
  competitionId, fixtureId, scheduledAt, scoreA, scoreB, apiStatus,
}: Props) {
  const router = useRouter();
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg,     setMsg]     = useState<string | null>(null);

  // datetime-local needs format "YYYY-MM-DDTHH:mm"
  const toLocalInput = (iso: string | null) => {
    if (!iso) return '';
    return iso.slice(0, 16); // "2026-06-11T18:00"
  };

  const [date,   setDate]   = useState(toLocalInput(scheduledAt));
  const [sA,     setSA]     = useState(scoreA !== null ? String(scoreA) : '');
  const [sB,     setSB]     = useState(scoreB !== null ? String(scoreB) : '');
  const [status, setStatus] = useState(apiStatus ?? '');

  async function save() {
    setLoading(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = {};
      if (date)   body.scheduled_at = new Date(date).toISOString();
      if (sA !== '') body.score_a = parseInt(sA, 10);
      if (sB !== '') body.score_b = parseInt(sB, 10);
      if (status !== '') body.api_status = status || null;

      const res = await fetch(
        `/api/admin/competitions/${competitionId}/matches/${fixtureId}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setMsg('✓');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : 'Erreur'}`);
    } finally {
      setLoading(false);
    }
  }

  const inp: React.CSSProperties = {
    background: '#1a1a1a', border: '1px solid #333', color: '#fff',
    padding: '4px 8px', fontSize: 11, fontFamily: 'monospace',
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          background: 'transparent', border: '1px solid #333',
          color: '#666', fontSize: 10, padding: '2px 6px', cursor: 'pointer',
        }}
      >
        ✏️
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        type="datetime-local"
        style={{ ...inp, width: 160 }}
        value={date}
        onChange={e => setDate(e.target.value)}
        title="Date & heure UTC"
      />
      <input
        style={{ ...inp, width: 32, textAlign: 'center' }}
        value={sA} onChange={e => setSA(e.target.value)}
        placeholder="0" title="Score A"
      />
      <span style={{ color: '#555', fontSize: 11 }}>–</span>
      <input
        style={{ ...inp, width: 32, textAlign: 'center' }}
        value={sB} onChange={e => setSB(e.target.value)}
        placeholder="0" title="Score B"
      />
      <select
        style={{ ...inp, width: 80 }}
        value={status}
        onChange={e => setStatus(e.target.value)}
        title="Statut API"
      >
        {['', 'NS', '1H', 'HT', '2H', 'ET', 'PEN', 'FT', 'AET', 'PST', 'CANC'].map(s => (
          <option key={s} value={s}>{s || '—'}</option>
        ))}
      </select>
      <button
        onClick={save} disabled={loading}
        style={{
          background: '#FFDB00', color: '#000', border: 'none',
          padding: '4px 10px', fontSize: 10, cursor: 'pointer', fontWeight: 700,
        }}
      >
        {loading ? '…' : '✓'}
      </button>
      <button
        onClick={() => { setOpen(false); setMsg(null); }}
        style={{
          background: 'transparent', border: '1px solid #333',
          color: '#666', padding: '4px 8px', fontSize: 10, cursor: 'pointer',
        }}
      >
        ✕
      </button>
      {msg && (
        <span style={{ fontSize: 10, color: msg.startsWith('✓') ? '#00FF87' : '#ff4444' }}>
          {msg}
        </span>
      )}
    </div>
  );
}
