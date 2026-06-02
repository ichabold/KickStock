'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// ── Delete button ─────────────────────────────────────────────────────────────

export function DayDeleteButton({
  competitionId,
  dayIndex,
}: {
  competitionId: number;
  dayIndex: number;
}) {
  const router    = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm(`Supprimer la journée ${dayIndex} ?`)) return;
    setLoading(true);
    await fetch(`/api/admin/competitions/${competitionId}/days/${dayIndex}`, {
      method: 'DELETE',
    });
    router.refresh();
    setLoading(false);
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      style={{
        background: 'transparent', border: '1px solid #444',
        color: '#ff4444', fontSize: 10, padding: '2px 6px', cursor: 'pointer',
      }}
    >
      {loading ? '…' : '✕'}
    </button>
  );
}

// ── Add form ──────────────────────────────────────────────────────────────────

const PHASES   = ['Groups', 'R32', 'R16', 'QF', 'SF', '3rd', 'Final'] as const;
const DIV_KEYS = ['', 'r32', 'r16', 'qf', 'sf', 'final', 'champion'] as const;

export function DayAddForm({ competitionId }: { competitionId: number }) {
  const router = useRouter();
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg,     setMsg]     = useState<string | null>(null);
  const [form, setForm] = useState({
    day_index:  '',
    full_label: '',
    date_label: '',
    phase:      'Groups',
    div_key:    '',
  });

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  const isKO = form.phase !== 'Groups';

  const suggestedDivKey: Record<string, string> = {
    R32: 'r32', R16: 'r16', QF: 'qf', SF: 'sf', Final: 'final', '3rd': '',
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/competitions/${competitionId}/days`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          day_index:  parseInt(form.day_index, 10),
          full_label: form.full_label,
          date_label: form.date_label,
          phase:      form.phase,
          is_ko:      isKO,
          div_key:    form.div_key || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setMsg('✓ Journée ajoutée');
      setForm({ day_index: '', full_label: '', date_label: '', phase: 'Groups', div_key: '' });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : 'Erreur'}`);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: '#111', border: '1px solid #333', color: '#fff',
    padding: '6px 10px', fontSize: 12, fontFamily: 'monospace',
  };
  const labelStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 4, color: '#888', fontSize: 11,
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: '6px 14px', background: 'transparent', border: '1px solid #FFDB00',
          color: '#FFDB00', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace',
        }}
      >
        + AJOUTER UNE JOURNÉE
      </button>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 600 }}>
      <div style={{ color: '#FFDB00', fontSize: 12, fontWeight: 700 }}>NOUVELLE JOURNÉE</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 12 }}>
        <label style={labelStyle}>
          day_index *
          <input
            style={inputStyle}
            type="number" min="0"
            value={form.day_index}
            onChange={e => set('day_index', e.target.value)}
            required placeholder="0"
          />
        </label>
        <label style={labelStyle}>
          full_label * (ex: &quot;Day 1 · Thu Jun 11&quot;)
          <input
            style={inputStyle}
            value={form.full_label}
            onChange={e => set('full_label', e.target.value)}
            required placeholder="Day 1 · Thu Jun 11"
          />
        </label>
        <label style={labelStyle}>
          date_label * (ex: &quot;Jun 11&quot;)
          <input
            style={inputStyle}
            value={form.date_label}
            onChange={e => set('date_label', e.target.value)}
            required placeholder="Jun 11"
          />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <label style={labelStyle}>
          phase *
          <select
            style={inputStyle}
            value={form.phase}
            onChange={e => {
              const ph = e.target.value;
              set('phase', ph);
              set('div_key', suggestedDivKey[ph] ?? '');
            }}
          >
            {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label style={labelStyle}>
          is_ko (auto)
          <input
            style={{ ...inputStyle, color: isKO ? '#FFDB00' : '#555' }}
            value={isKO ? 'true (KO)' : 'false (Groupes)'}
            readOnly
          />
        </label>
        <label style={labelStyle}>
          div_key
          <select
            style={inputStyle}
            value={form.div_key}
            onChange={e => set('div_key', e.target.value)}
          >
            {DIV_KEYS.map(k => (
              <option key={k} value={k}>{k || '(aucun)'}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          type="submit" disabled={loading}
          style={{
            padding: '7px 18px', background: '#FFDB00', color: '#000',
            border: 'none', fontSize: 12, cursor: 'pointer', fontWeight: 700,
          }}
        >
          {loading ? '…' : 'AJOUTER'}
        </button>
        <button
          type="button" onClick={() => { setOpen(false); setMsg(null); }}
          style={{
            padding: '7px 14px', background: 'transparent',
            border: '1px solid #333', color: '#666', fontSize: 12, cursor: 'pointer',
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
    </form>
  );
}
