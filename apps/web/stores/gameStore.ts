'use client';

/**
 * gameStore — public entry point for all components.
 *
 * Online mode (default):
 *   → onlineGameStore: server-backed state, real match results from API.
 *   → Trading lock enforced, LIVE tab replaces Simulate button.
 *
 * Offline / simulation mode (accessible via account menu):
 *   → localGameStore: per-device state in localStorage, client-side simulation.
 *   → No trading lock. Prices move from simulated results.
 *
 * Mode is stored in localStorage('kickstock:mode').
 * Switching mode reloads the page (intentional — avoids conditional hooks).
 *
 * All components import from '@/stores/gameStore' — the mode is invisible to them.
 */

// During SSR / first render, default to offline store to avoid hydration mismatch.
// The client will switch to online store after the first render if needed.
// For now, we re-export localGameStore as the default until the online store
// is fully wired to the new API-Football backend (S5).
//
// TODO (S5): switch default to onlineGameStore once sync-results is live.

export {
  useLocalGameStore as useGameStore,
  buildMatchesForCurrentDay,
  fmt,
  pctOf,
} from './localGameStore';
