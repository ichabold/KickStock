'use client';

/**
 * gameStore — public entry point for all components.
 *
 * Reads the mode from localStorage (via getGameModeSync) at module init
 * and re-exports the correct store. Components always import from here —
 * the mode switch is invisible to them.
 *
 * Online (default): onlineGameStore — server-backed, real API results.
 * Offline:          localGameStore  — localStorage, client-side simulation.
 *
 * Mode stored in localStorage('kickstock:mode').
 * Switching reloads the page (avoids conditional hook issues).
 */

import { getGameModeSync } from '@/hooks/useGameMode';
import {
  useOnlineGameStore,
  buildMatchesForCurrentDay as onlineBuildMatches,
  fmt, pctOf,
} from './onlineGameStore';
import {
  useLocalGameStore,
  buildMatchesForCurrentDay as localBuildMatches,
} from './localGameStore';

const mode = getGameModeSync();

export { fmt, pctOf };

// Cast to localGameStore's type (superset of GameState — both stores implement it)
export const useGameStore = (
  mode === 'online' ? useOnlineGameStore : useLocalGameStore
) as typeof useLocalGameStore;

export const buildMatchesForCurrentDay = (
  mode === 'online' ? onlineBuildMatches : localBuildMatches
) as typeof localBuildMatches;
