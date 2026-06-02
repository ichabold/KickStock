'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  competitionId: number;
  teamId:        string;
  strength:      number;
  groupCode:     string | null;
  initialPrice:  number;
}

export default function TeamEditor({
  competitionId, teamId, strength, groupCode, initialPrice
}: Props) {
  const router = useRouter();
  const [open,    setOpen]    = useState(false);
  const [str,     setStr]     = useState(String(strength));
  const [grp,     setGrp]     = useState(groupCode ?? '');
  const [price,   setPrice]   = useState(String(initialPrice));
  const [loading, setLoading] = useState(false);
  const [msg,     setMsg]     = useState<string | null>(null);

  async function save() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/admin/competitions/${competitionId}/teams/${teamId}`,
        {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            strength:      parseInt(str, 10),
            group_code:    grp || null,
            initial_price: parseFloat(price),
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setMsg('✓ Sauvegardé');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : 'Erreur'}`);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: '#1a1a1a', border: '1px solid #333', color: '#fff',
    padding: '4px 8px', fontSize: 11, width: 70, fontFamily: 'monospace',
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
        style={inputStyle}
        value={str}
        onChange={e => setStr(e.target.value)}
        placeholder="Force (0-100)"
        title="Force FIFA (0-100)"
      />
      <input
        style={{ ...inputStyle, width: 40 }}
        value={grp}
        onChange={e => setGrp(e.target.value.toUpperCase())}
        placeholder="Grp"
        title="Code groupe (A-L)"
        maxLength={1}
      />
      <input
        style={{ ...inputStyle, width: 60 }}
        value={price}
        onChange={e => setPrice(e.target.value)}
        placeholder="Prix KC"
        title="Prix initial en KC"
      />
      <button
        onClick={save}
        disabled={loading}
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
