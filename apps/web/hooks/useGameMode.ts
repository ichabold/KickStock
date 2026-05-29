'use client';

/**
 * useGameMode — Returns the current game mode and a toggle function.
 *
 * Mode: 'online' (default) | 'offline'
 * Stored in localStorage('kickstock:mode').
 *
 * Switching mode reloads the page intentionally: it avoids conditional
 * hook issues and ensures the correct store is mounted from the start.
 */

import { useState, useEffect } from 'react';

export type GameMode = 'online' | 'offline';

const MODE_KEY = 'kickstock:mode';

export function useGameMode() {
  const [mode, setModeState] = useState<GameMode>('online');

  useEffect(() => {
    const stored = localStorage.getItem(MODE_KEY) as GameMode | null;
    if (stored === 'online' || stored === 'offline') setModeState(stored);
  }, []);

  function switchMode(next: GameMode) {
    localStorage.setItem(MODE_KEY, next);
    window.location.reload();
  }

  return { mode, switchMode };
}

/** Read mode synchronously (no React — for store initialisation). */
export function getGameModeSync(): GameMode {
  if (typeof window === 'undefined') return 'online';
  const stored = localStorage.getItem(MODE_KEY) as GameMode | null;
  return stored === 'online' || stored === 'offline' ? stored : 'online';
}
