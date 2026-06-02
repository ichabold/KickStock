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
import type { BootstrapData, TeamMeta } from '@kickstock/types';

export { fmt, pctOf };

const mode = getGameModeSync();

/**
 * Fields present on both LocalGameStore and OnlineGameStore that components
 * access via the shared useGameStore facade.
 *
 * Declaring them here makes useGameStore properly typed, eliminating the need
 * for (s as any)._bootstrap and (s as any)._teams casts throughout the app.
 */
export interface BootstrapSlice {
  _bootstrap:        BootstrapData | null;
  _teams:            TeamMeta[];
  bootstrapLoading:  boolean;
  bootstrapError:    boolean;
}

// Cast to localGameStore's full type (superset of GameState — both stores implement it)
// The BootstrapSlice fields are part of LocalGameStore and are safe to access
// without (s as any) casts.
export const useGameStore = (
  mode === 'online' ? useOnlineGameStore : useLocalGameStore
) as typeof useLocalGameStore;

export const buildMatchesForCurrentDay = (
  mode === 'online' ? onlineBuildMatches : localBuildMatches
) as typeof localBuildMatches;
