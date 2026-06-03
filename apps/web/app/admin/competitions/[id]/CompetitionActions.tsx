'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  competitionId: number;
  isActive: boolean;
  currentDayIndex: number;
}

type ResultDetail = Record<string, unknown>;

export default function CompetitionActions({ competitionId, isActive, currentDayIndex }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean; detail?: ResultDetail } | null>(null);

  async function call(label: string, fn: () => Promise<Response>) {
    setLoading(label);
    setMessage(null);
    try {
      const res = await fn();
      const json: ResultDetail = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: (json.error as string) ?? res.statusText, ok: false });
      } else {
        setMessage({ text: `${label} OK`, ok: true, detail: json });
        router.refresh();
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Erreur réseau', ok: false });
    } finally {
      setLoading(null);
    }
  }

  function toggleActive() {
    call(isActive ? 'Désactiver' : 'Activer', () =>
      fetch(`/api/admin/competitions/${competitionId}/toggle-active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !isActive }),
      }),
    );
  }

  function importTeams() {
    call('Import Teams', () =>
      fetch(`/api/admin/competitions/${competitionId}/import-teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  function syncFixtures() {
    call('Sync Fixtures', () =>
      fetch(`/api/admin/competitions/${competitionId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'fixtures' }),
      }),
    );
  }

  function syncResults() {
    call('Sync Results', () =>
      fetch(`/api/admin/competitions/${competitionId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'results' }),
      }),
    );
  }

  function syncSquads() {
    call('Sync Squads', () =>
      fetch(`/api/admin/competitions/${competitionId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'squads' }),
      }),
    );
  }

  function syncSchedule() {
    call('Sync Schedule', () =>
      fetch(`/api/admin/competitions/${competitionId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'schedule' }),
      }),
    );
  }

  function simulateDay() {
    call(`Simulate Day ${currentDayIndex}`, () =>
      fetch('/api/admin/simulate-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitionId, dayIndex: currentDayIndex }),
      }),
    );
  }

  const btn = (color: string): React.CSSProperties => ({
    padding: '7px 14px',
    border: `1px solid ${color}`,
    background: 'transparent',
    color,
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
    opacity: loading ? 0.5 : 1,
  });

  const isLoading = (label: string) => loading === label || loading?.startsWith(label);

  return (
    <div>
      {/* Row 1 — Lifecycle */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <button style={btn(isActive ? '#ff4444' : '#00FF87')} disabled={!!loading} onClick={toggleActive}>
          {isLoading(isActive ? 'Désactiver' : 'Activer')
            ? '⏳ …'
            : isActive ? '○ DÉSACTIVER' : '● ACTIVER'}
        </button>

        <button style={btn('#FFDB00')} disabled={!!loading} onClick={simulateDay}>
          {isLoading('Simulate') ? '⏳ …' : `⚡ SIMULATE DAY ${currentDayIndex}`}
        </button>
      </div>

      {/* Row 2 — API-Football calls */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={btn('#60a5fa')} disabled={!!loading} onClick={importTeams}>
          {isLoading('Import Teams') ? '⏳ …' : '⬇ IMPORT TEAMS'}
        </button>

        <button style={btn('#888')} disabled={!!loading} onClick={syncFixtures}>
          {isLoading('Sync Fixtures') ? '⏳ …' : '↻ SYNC FIXTURES'}
        </button>

        <button style={btn('#888')} disabled={!!loading} onClick={syncResults}>
          {isLoading('Sync Results') ? '⏳ …' : '↻ SYNC RESULTS'}
        </button>

        <button style={btn('#888')} disabled={!!loading} onClick={syncSquads}>
          {isLoading('Sync Squads') ? '⏳ …' : '↻ SYNC SQUADS'}
        </button>

        <button style={btn('#a855f7')} disabled={!!loading} onClick={syncSchedule}>
          {isLoading('Sync Schedule') ? '⏳ …' : '↻ SYNC SCHEDULE'}
        </button>
      </div>

      {message && (
        <div style={{ marginTop: 10, fontSize: 12, color: message.ok ? '#00FF87' : '#ff4444' }}>
          {message.ok ? '✓' : '❌'} {message.text}
          {message.ok && message.detail && (
            <span style={{ color: '#888', marginLeft: 8 }}>
              {Object.entries(message.detail)
                .filter(([k]) => k !== 'ok')
                .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                .join(' · ')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
