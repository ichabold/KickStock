'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  competitionId: number;
  name:          string;
  season:        number;
  leagueId:      number;
  startDate:     string | null;
  isActive:      boolean;
}

export default function CompetitionEditor({
  competitionId, name, season, leagueId, startDate, isActive,
}: Props) {
  const router = useRouter();
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg,     setMsg]     = useState<string | null>(null);

  const [fName,      setFName]      = useState(name);
  const [fSeason,    setFSeason]    = useState(String(season));
  const [fLeagueId,  setFLeagueId]  = useState(String(leagueId));
  const [fStartDate, setFStartDate] = useState(startDate ?? '');

  async function save() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/competitions/${competitionId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:       fName.trim(),
          season:     parseInt(fSeason, 10),
          league_id:  parseInt(fLeagueId, 10),
          start_date: fStartDate.trim() || null,
        }),
      });
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
    padding: '6px 10px', fontSize: 12, fontFamily: 'monospace',
    width: '100%', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    color: '#555', fontSize: 10, display: 'block', marginBottom: 4, letterSpacing: 1,
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: '6px 14px', background: 'transparent', border: '1px solid #333',
          color: '#888', cursor: 'pointer', fontSize: 11, fontFamily: 'monospace',
        }}
      >
        ✏️ ÉDITER MÉTADONNÉES
      </button>
    );
  }

  return (
    <div style={{
      background: '#0d0d0d', border: '1px solid #333',
      padding: 20, marginTop: 16, maxWidth: 560,
    }}>
      <div style={{ color: '#FFDB00', fontSize: 11, fontFamily: 'monospace', marginBottom: 16, letterSpacing: 1 }}>
        ÉDITER COMPÉTITION #{competitionId}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>NOM</label>
          <input style={inputStyle} value={fName} onChange={e => setFName(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>SAISON</label>
          <input style={inputStyle} type="number" value={fSeason} onChange={e => setFSeason(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>LEAGUE ID (API-Football)</label>
          <input style={inputStyle} type="number" value={fLeagueId} onChange={e => setFLeagueId(e.target.value)} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>DATE DE DÉBUT (YYYY-MM-DD) — utilisée pour le calcul des day_index</label>
          <input
            style={inputStyle}
            placeholder="2026-06-11"
            value={fStartDate}
            onChange={e => setFStartDate(e.target.value)}
          />
          <div style={{ color: '#444', fontSize: 10, marginTop: 4 }}>
            ⚠ Modifier cette date recalculera les day_index au prochain Sync Fixtures
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={save}
          disabled={loading}
          style={{
            padding: '7px 18px', background: '#FFDB00', color: '#000',
            border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? '⏳ …' : '✓ SAUVEGARDER'}
        </button>
        <button
          onClick={() => { setOpen(false); setMsg(null); }}
          style={{
            padding: '7px 14px', background: 'transparent', border: '1px solid #333',
            color: '#666', cursor: 'pointer', fontSize: 11, fontFamily: 'monospace',
          }}
        >
          Annuler
        </button>
        {msg && (
          <span style={{ fontSize: 11, color: msg.startsWith('✓') ? '#00FF87' : '#ff4444' }}>
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}
