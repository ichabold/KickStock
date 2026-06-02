'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useGameStore } from '@/stores/gameStore';
import type { StoredMatchResult, BootstrapData } from '@kickstock/types';

interface Props {
  onResults: (results: StoredMatchResult[]) => void;
  onNoResults?: () => void;
  className?: string;
  label?: string;
}

export function SimulateButton({ onResults, onNoResults, className, label }: Props) {
  const t = useTranslations('simulateButton');
  const [loading, setLoading] = useState(false);

  const dayIndex   = useGameStore(s => s.dayIndex);
  const advanceDay = useGameStore(s => s.advanceDay);
  const resetGame  = useGameStore(s => s.resetGame);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bootstrap  = useGameStore(s => (s as any)._bootstrap) as BootstrapData | null;

  const day = bootstrap?.days.find(d => d.day_index === dayIndex) ?? null;

  const defaultLabel = day ? t('simulate', { label: day.date_label }) : t('newGame');

  async function handleClick() {
    if (loading) return;
    if (!day) {
      resetGame();
      return;
    }
    setLoading(true);
    try {
      const res = await advanceDay();
      if (res && res.results.length > 0) {
        onResults(res.results);
      } else {
        onNoResults?.();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      className={className}
      onClick={handleClick}
      disabled={loading}
      aria-label={loading ? t('ariaLoading') : t('ariaSimulate')}
    >
      {loading ? t('loading') : (label ?? defaultLabel)}
    </button>
  );
}
