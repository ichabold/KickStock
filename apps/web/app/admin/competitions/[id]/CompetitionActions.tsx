'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  competitionId: number;
  isActive: boolean;
  currentDayIndex: number;
}

export default function CompetitionActions({ competitionId, isActive, currentDayIndex }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function call(label: string, fn: () => Promise<Response>) {
    setLoading(label);
    setMessage(null);
    try {
      const res = await fn();
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(`❌ ${json.error ?? res.statusText}`);
      } else {
        setMessage(`✓ ${label} OK`);
        router.refresh();
      }
    } catch (e) {
      setMessage(`❌ ${e instanceof Error ? e.message : 'Erreur réseau'}`);
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

  function syncFixtures() {
    call('Sync Fixtures', () =>
      fetch('/api/cron/sync-fixtures', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET ?? ''}`,
        },
        body: JSON.stringify({ competitionId }),
      }),
    );
  }

  function simulateDay() {
    call(`Simulate Day ${currentDayIndex}`, () =>
      fetch('/api/admin/simulate-day', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET ?? ''}`,
        },
        body: JSON.stringify({ competitionId, dayIndex: currentDayIndex }),
      }),
    );
  }

  const btnStyle = (color: string): React.CSSProperties => ({
    padding: '7px 14px', border: `1px solid ${color}`, background: 'transparent',
    color, cursor: 'pointer', fontSize: 11, fontFamily: 'monospace',
    opacity: loading ? 0.5 : 1,
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          style={btnStyle(isActive ? '#ff4444' : '#00FF87')}
          disabled={!!loading}
          onClick={toggleActive}
        >
          {loading === (isActive ? 'Désactiver' : 'Activer')
            ? '⏳ …'
            : isActive ? '○ DÉSACTIVER' : '● ACTIVER'}
        </button>

        <button style={btnStyle('#888')} disabled={!!loading} onClick={syncFixtures}>
          {loading === 'Sync Fixtures' ? '⏳ …' : '↻ SYNC FIXTURES'}
        </button>

        <button style={btnStyle('#FFDB00')} disabled={!!loading} onClick={simulateDay}>
          {loading?.startsWith('Simulate') ? '⏳ …' : `⚡ SIMULATE DAY ${currentDayIndex}`}
        </button>
      </div>

      {message && (
        <div style={{
          marginTop: 10, fontSize: 12,
          color: message.startsWith('✓') ? '#00FF87' : '#ff4444',
        }}>
          {message}
        </div>
      )}
    </div>
  );
}
