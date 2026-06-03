'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Step = {
  label: string;
  status: 'pending' | 'loading' | 'ok' | 'error';
  detail?: string;
};

const INITIAL_STEPS: Step[] = [
  { label: 'Création de la compétition', status: 'pending' },
  { label: 'Import des équipes (API-Football)',    status: 'pending' },
  { label: 'Sync du calendrier (fixtures)',        status: 'pending' },
];

export default function NewCompetitionPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', season: '', league_id: '' });
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [running, setRunning] = useState(false);

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function setStep(index: number, patch: Partial<Step>) {
    setSteps(prev => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    setSteps(INITIAL_STEPS);

    // ── Step 1 : Create competition ──────────────────────────────────────────
    setStep(0, { status: 'loading' });
    let competitionId: number;
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
      competitionId = json.id;
      setStep(0, { status: 'ok', detail: `id: ${competitionId}` });
    } catch (e) {
      setStep(0, { status: 'error', detail: e instanceof Error ? e.message : 'Erreur' });
      setRunning(false);
      return;
    }

    // ── Step 2 : Import teams ────────────────────────────────────────────────
    setStep(1, { status: 'loading' });
    try {
      const res = await fetch(`/api/admin/competitions/${competitionId}/import-teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      const detail = [
        json.imported != null ? `${json.imported} importées` : null,
        json.skipped  != null ? `${json.skipped} ignorées`   : null,
        json.unmapped?.length ? `non mappées: ${json.unmapped.join(', ')}` : null,
      ].filter(Boolean).join(' · ');
      setStep(1, { status: 'ok', detail: detail || undefined });
    } catch (e) {
      setStep(1, { status: 'error', detail: e instanceof Error ? e.message : 'Erreur' });
      // Non-blocking : on continue quand même avec les fixtures
    }

    // ── Step 3 : Sync fixtures ───────────────────────────────────────────────
    setStep(2, { status: 'loading' });
    try {
      const res = await fetch(`/api/admin/competitions/${competitionId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'fixtures' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      const detail = json.inserted != null ? `${json.inserted} fixtures insérés` : undefined;
      setStep(2, { status: 'ok', detail });
    } catch (e) {
      setStep(2, { status: 'error', detail: e instanceof Error ? e.message : 'Erreur' });
    }

    // ── Done : redirect after a short delay so user sees the result ──────────
    setTimeout(() => router.push(`/admin/competitions/${competitionId}`), 1200);
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', background: '#1a1a1a',
    border: '1px solid #333', color: '#fff', fontSize: 13,
    fontFamily: 'monospace', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    color: '#888', fontSize: 11, display: 'block', marginBottom: 4,
  };

  const stepIcon = (s: Step['status']) =>
    ({ pending: '○', loading: '⏳', ok: '✓', error: '❌' })[s];
  const stepColor = (s: Step['status']) =>
    ({ pending: '#555', loading: '#FFDB00', ok: '#00FF87', error: '#ff4444' })[s];

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
              disabled={running}
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
                disabled={running}
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
                disabled={running}
                required
              />
            </div>
          </div>

          {/* Progress steps — visible once running */}
          {running && (
            <div style={{
              padding: '14px 16px', background: '#111',
              border: '1px solid #222', display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              {steps.map((s, i) => (
                <div key={i} style={{ fontSize: 12, fontFamily: 'monospace' }}>
                  <span style={{ color: stepColor(s.status), marginRight: 8 }}>
                    {stepIcon(s.status)}
                  </span>
                  <span style={{ color: s.status === 'pending' ? '#555' : '#ccc' }}>
                    {s.label}
                  </span>
                  {s.detail && (
                    <span style={{ color: '#666', marginLeft: 8 }}>{s.detail}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button
              type="submit"
              disabled={running}
              style={{
                padding: '10px 20px', background: '#FFDB00', color: '#000',
                border: 'none', cursor: running ? 'not-allowed' : 'pointer',
                fontSize: 12, fontFamily: 'monospace', fontWeight: 700,
                opacity: running ? 0.6 : 1,
              }}
            >
              {running ? '⏳ EN COURS…' : '✓ CRÉER LA COMPÉTITION'}
            </button>
            {!running && (
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
            )}
          </div>

        </div>
      </form>
    </div>
  );
}
