'use client';

import { useState } from 'react';
import { CALENDAR } from '@kickstock/constants';
import { useGameStore } from '@/stores/gameStore';
import type { StoredMatchResult } from '@kickstock/types';

interface Props {
  /**
   * Called when simulation produces match results.
   * The parent decides how to animate / display them.
   */
  onResults: (results: StoredMatchResult[]) => void;
  /**
   * Called when simulation advances the day but produces no results
   * (e.g. transition day, end of tournament). Optional.
   */
  onNoResults?: () => void;
  /** className applied to the <button> element */
  className?: string;
  /** Override the default label. Falls back to "⚡ SIMULER — {day.label}" */
  label?: string;
}

/**
 * MECHANIC COMPONENT — "Simulate day" button.
 *
 * Shared verbatim between MobileShell (SimulateTab) and BrowserShell (topbar).
 * Guarantees that advanceDay() is called exactly once per click, with the same
 * loading/disabled logic on both platforms.
 *
 * The component handles:
 *   - calling advanceDay() from the game store
 *   - loading state (disabled during the async call)
 *   - routing results to the parent via onResults / onNoResults
 *
 * The parent decides what to do with the results (show animation, navigate, etc.)
 *
 * Do NOT add shell-specific navigation or animation logic here.
 * Style via className prop — this component owns no CSS.
 */
export function SimulateButton({ onResults, onNoResults, className, label }: Props) {
  const [loading, setLoading] = useState(false);

  const dayIndex   = useGameStore(s => s.dayIndex);
  const advanceDay = useGameStore(s => s.advanceDay);
  const day        = CALENDAR[dayIndex];

  const defaultLabel = day ? `⚡ SIMULER — ${day.label}` : '🔄 NOUVEAU JEU';

  async function handleClick() {
    if (loading) return;
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
      aria-label={loading ? 'Simulation en cours…' : 'Simuler la journée'}
    >
      {loading ? '⏳ EN COURS…' : (label ?? defaultLabel)}
    </button>
  );
}
