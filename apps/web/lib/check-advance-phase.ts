/**
 * check-advance-phase.ts — Advances a competition to the next day/phase
 * once all matches of the current day are processed.
 *
 * Called by sync-results after processing results.
 * Idempotent: safe to call multiple times.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { buildR32Pool }      from '@kickstock/game-engine';
import type { StoredMatchResult } from '@kickstock/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export async function checkAndAdvancePhase(competitionId: number): Promise<void> {
  const admin = createAdminClient();

  // ── 1. Current day index from game_state ──────────────────────────────────
  const { data: gsRaw } = await adm(admin)
    .from('game_state')
    .select('current_day_index, current_phase, eliminated, r32_pool, r16_pool, qf_pool, sf_pool, final_pool, third_pool, champion_id')
    .eq('competition_id', competitionId)
    .maybeSingle();

  if (!gsRaw) return; // No game state for this competition yet

  const gs = gsRaw as {
    current_day_index: number;
    current_phase: string;
    eliminated: string[];
    r32_pool: string[]; r16_pool: string[]; qf_pool: string[];
    sf_pool: string[]; final_pool: string[]; third_pool: string[];
    champion_id: string | null;
  };

  const dayIndex = gs.current_day_index;

  // ── 2. Check for pending matches on current day ───────────────────────────
  const { count: pending } = await adm(admin)
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('competition_id', competitionId)
    .eq('day_index', dayIndex)
    .is('processed_at', null)
    .not('api_status', 'in', '("PST","SUSP","CANC","ABD")');

  if ((pending ?? 1) > 0) {
    return; // Day not complete yet
  }

  // ── 3. Load today's results ───────────────────────────────────────────────
  const { data: todayMatchesRaw } = await adm(admin)
    .from('matches')
    .select('result_data')
    .eq('competition_id', competitionId)
    .eq('day_index', dayIndex)
    .not('processed_at', 'is', null);

  const todayResults = ((todayMatchesRaw ?? []) as Array<{ result_data: StoredMatchResult }>)
    .map(m => m.result_data)
    .filter(Boolean);

  // ── 4. Update KO pools from today's results ───────────────────────────────
  let r16Pool   = [...gs.r16_pool];
  let qfPool    = [...gs.qf_pool];
  let sfPool    = [...gs.sf_pool];
  let finalPool = [...gs.final_pool];
  let thirdPool = [...gs.third_pool];
  let champion  = gs.champion_id;
  const eliminated = [...gs.eliminated];

  for (const r of todayResults) {
    if (!r.winnerId || !r.phase) continue;
    const phase = r.phase;

    if (phase === 'R32' && !r16Pool.includes(r.winnerId))
      r16Pool.push(r.winnerId);
    if (phase === 'R16' && !qfPool.includes(r.winnerId))
      qfPool.push(r.winnerId);
    if (phase === 'QF' && !sfPool.includes(r.winnerId))
      sfPool.push(r.winnerId);
    if (phase === 'SF') {
      if (!finalPool.includes(r.winnerId)) finalPool.push(r.winnerId);
      if (r.loserId && !thirdPool.includes(r.loserId)) thirdPool.push(r.loserId);
    }
    if (phase === 'Final' && r.winnerId) {
      champion = r.winnerId;
      if (r.loserId && !eliminated.includes(r.loserId)) eliminated.push(r.loserId);
    }
  }

  // ── 5. Last group day → build R32 pool ───────────────────────────────────
  const isGroupPhase = gs.current_phase === 'Groups';
  let newR32Pool = [...gs.r32_pool];

  if (isGroupPhase && newR32Pool.length === 0) {
    // Check if this is actually the last group day
    const { count: remainingGroupMatches } = await adm(admin)
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('competition_id', competitionId)
      .eq('phase', 'Groups')
      .is('processed_at', null)
      .not('api_status', 'in', '("PST","SUSP","CANC","ABD")');

    if ((remainingGroupMatches ?? 1) === 0) {
      // All group matches done — build R32 pool from standings
      const { data: allMatchesRaw } = await adm(admin)
        .from('matches')
        .select('day_index, result_data')
        .eq('competition_id', competitionId)
        .eq('phase', 'Groups')
        .not('processed_at', 'is', null);

      const allMatchResults: Record<number, StoredMatchResult[]> = {};
      for (const m of (allMatchesRaw ?? []) as Array<{ day_index: number; result_data: StoredMatchResult }>) {
        if (!m.result_data) continue;
        if (!allMatchResults[m.day_index]) allMatchResults[m.day_index] = [];
        allMatchResults[m.day_index].push(m.result_data);
      }

      // buildR32Pool uses the game-engine (which will be refactored in S4 to not need NATIONS)
      // For now it still imports NATIONS for group info — this is a known S4 todo
      newR32Pool = buildR32Pool(allMatchResults, eliminated);

      // Teams not in R32 pool are eliminated
      const { data: allTeamsRaw } = await adm(admin)
        .from('competition_teams')
        .select('team_id')
        .eq('competition_id', competitionId);

      const allTeamIds = ((allTeamsRaw ?? []) as Array<{ team_id: string }>).map(t => t.team_id);
      const r32Set = new Set(newR32Pool.filter(Boolean));

      for (const id of allTeamIds) {
        if (!r32Set.has(id) && !eliminated.includes(id)) {
          eliminated.push(id);
          // Set price to 1 KC for eliminated teams
          await adm(admin).rpc('liquidate_eliminated', {
            p_nation_id: id,
            p_day_index: dayIndex,
          });
        }
      }
    }
  }

  // ── 6. Get next day's phase ───────────────────────────────────────────────
  const { data: nextDayRaw } = await adm(admin)
    .from('competition_days')
    .select('phase')
    .eq('competition_id', competitionId)
    .eq('day_index', dayIndex + 1)
    .maybeSingle();

  const nextPhase = (nextDayRaw as { phase: string } | null)?.phase ?? gs.current_phase;

  // ── 7. Advance game_state ─────────────────────────────────────────────────
  await adm(admin).from('game_state')
    .update({
      current_day_index: dayIndex + 1,
      current_phase:     nextPhase,
      champion_id:       champion,
      eliminated,
      r32_pool:          newR32Pool,
      r16_pool:          r16Pool,
      qf_pool:           qfPool,
      sf_pool:           sfPool,
      final_pool:        finalPool,
      third_pool:        thirdPool,
      updated_at:        new Date().toISOString(),
    })
    .eq('competition_id', competitionId);

  console.log(`[advance-phase] Competition ${competitionId}: advanced to day ${dayIndex + 1} (${nextPhase})`);
}
