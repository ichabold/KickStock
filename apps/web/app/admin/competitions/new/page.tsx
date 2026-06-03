'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewCompetitionPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '', season: '', league_id: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/admin/competitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:      form.name,
          season:    parseInt(form.season, 10),
          league_id: parseInt(form.league_id, 10),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      router.push(`/admin/competitions/${json.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
      setLoading(false);
    }
  }

  const labelStyle: React.CSSProperties = { color: '#888', fontSize: 11, display: 'block', marginBottom: 4 };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', background: '#1a1a1a',
    border: '1px solid #333', color: '#fff', fontSize: 13,
    fontFamily: 'monospace', boxSizing: 'border-box',
  };

  return (
    <div style={{ maxWidth: 480 }}>
      <h1 style={{ color: '#FFDB00', fontSize: 18, marginBottom: 28 }}>Nouvelle compétition</h1>

      <form onSubmit={submit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div>
            <label style={labelStyle}>NOM *</label>
            <input
              style={inputStyle}
              placeholder="FIFA World Cup 2026"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>SAISON *</label>
              <input
                style={inputStyle}
                type="number"
                placeholder="2026"
                value={form.season}
                onChange={e => set('season', e.target.value)}
                required
              />
            </div>
            <div>
              <label style={labelStyle}>LEAGUE ID (API-Football) *</label>
              <input
                style={inputStyle}
                type="number"
                placeholder="1"
                value={form.league_id}
                onChange={e => set('league_id', e.target.value)}
                required
              />
            </div>
          </div>

          {error && (
            <div style={{ color: '#ff4444', fontSize: 12, padding: '8px 10px', border: '1px solid #ff4444' }}>
              ❌ {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '10px 20px', background: '#FFDB00', color: '#000',
                border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: 12, fontFamily: 'monospace', fontWeight: 700,
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? '⏳ CRÉATION…' : '✓ CRÉER LA COMPÉTITION'}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              style={{
                padding: '10px 16px', background: 'transparent', color: '#888',
                border: '1px solid #333', cursor: 'pointer',
                fontSize: 12, fontFamily: 'monospace',
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
