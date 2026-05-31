/**
 * check-advance-phase.ts — Advances a competition to the next day/phase
 * once all matches of the current day are processed.
 *
 * Called by sync-results after each processed result.
 * Idempotent: safe to call multiple times.
 * Competition-agnostic: works for WC2022, WC2026, or any other format.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { buildKOQualifiers }  from '@/lib/ko-qualifiers';
import type { StoredMatchResult } from '@kickstock/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export async function checkAndAdvancePhase(competitionId: number): Promise<void> {
  const admin = createAdminClient();

  // ── 1. Current competition game state ─────────────────────────────────────
  const { data: gsRaw } = await adm(admin)
    .from('competition_game_state')
    .select('*')
    .eq('competition_id', competitionId)
    .single();

  if (!gsRaw) return;

  const gs = gsRaw as {
    current_day_index: number; current_phase: string;
    eliminated: string[]; r32_pool: string[]; r16_pool: string[];
    qf_pool: string[]; sf_pool: string[]; final_pool: string[]; third_pool: string[];
    champion_id: string | null;
  };

  const dayIndex = gs.current_day_index;

  // ── 2. Are all matches for today processed? ───────────────────────────────
  const { count: pending } = await adm(admin)
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('competition_id', competitionId)
    .eq('day_index', dayIndex)
    .is('processed_at', null)
    .not('api_status', 'in', '("PST","SUSP","CANC","ABD")');

  if ((pending ?? 1) > 0) return;

  // ── 3. Load today's results ───────────────────────────────────────────────
  const { data: todayRaw } = await adm(admin)
    .from('matches')
    .select('result_data')
    .eq('competition_id', competitionId)
    .eq('day_index', dayIndex)
    .not('processed_at', 'is', null);

  const todayResults = ((todayRaw ?? []) as Array<{ result_data: StoredMatchResult }>)
    .map(m => m.result_data)
    .filter(Boolean);

  // ── 4. Update KO pools from today's results ───────────────────────────────
  let r32Pool   = [...gs.r32_pool];
  let r16Pool   = [...gs.r16_pool];
  let qfPool    = [...gs.qf_pool];
  let sfPool    = [...gs.sf_pool];
  let finalPool = [...gs.final_pool];
  let thirdPool = [...gs.third_pool];
  let champion  = gs.champion_id;
  let eliminated = [...gs.eliminated];

  for (const r of todayResults) {
    if (!r.winnerId || !r.phase) continue;
    const p = r.phase;
    if (p === 'R32'   && !r16Pool.includes(r.winnerId))   r16Pool.push(r.winnerId);
    if (p === 'R16'   && !qfPool.includes(r.winnerId))    qfPool.push(r.winnerId);
    if (p === 'QF'    && !sfPool.includes(r.winnerId))    sfPool.push(r.winnerId);
    if (p === 'SF') {
      if (!finalPool.includes(r.winnerId)) finalPool.push(r.winnerId);
      if (r.loserId && !thirdPool.includes(r.loserId)) thirdPool.push(r.loserId);
    }
    if (p === 'Final' && r.winnerId) {
      champion = r.winnerId;
      if (r.loserId && !eliminated.includes(r.loserId)) eliminated.push(r.loserId);
    }
    // KO loser → eliminated (except SF loser who goes to 3rd place match)
    if (r.loserId && p !== 'Groups' && p !== 'SF' && p !== '3rd' && !eliminated.includes(r.loserId)) {
      eliminated.push(r.loserId);
    }
  }

  // ── 5. Last group day → compute KO qualifiers (competition-agnostic) ──────
  if (gs.current_phase === 'Groups') {
    const { count: remainingGroup } = await adm(admin)
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('competition_id', competitionId)
      .eq('phase', 'Groups')
      .is('processed_at', null)
      .not('api_status', 'in', '("PST","SUSP","CANC","ABD")');

    if ((remainingGroup ?? 1) === 0) {
      // All group matches done — get next phase
      const { data: nextDayRow } = await adm(admin)
        .from('competition_days')
        .select('phase')
        .eq('competition_id', competitionId)
        .eq('day_index', dayIndex + 1)
        .maybeSingle();

      const nextPhase = (nextDayRow as { phase: string } | null)?.phase ?? 'R16';

      // Load all group results
      const { data: allGroupRaw } = await adm(admin)
        .from('matches')
        .select('day_index, result_data')
        .eq('competition_id', competitionId)
        .eq('phase', 'Groups')
        .not('processed_at', 'is', null);

      const allGroupResults: Record<number, StoredMatchResult[]> = {};
      for (const m of (allGroupRaw ?? []) as Array<{ day_index: number; result_data: StoredMatchResult }>) {
        if (!m.result_data) continue;
        if (!allGroupResults[m.day_index]) allGroupResults[m.day_index] = [];
        allGroupResults[m.day_index].push(m.result_data);
      }

      const { qualifiers, newEliminated } = await buildKOQualifiers(
        competitionId, allGroupResults, eliminated, nextPhase,
      );

      eliminated = newEliminated;

      // Fill the right pool based on next phase
      if (nextPhase === 'R32') r32Pool = qualifiers;
      else                     r16Pool = qualifiers;

      // Liquidate non-qualifiers
      const qualSet = new Set(qualifiers);
      for (const id of eliminated) {
        if (!qualSet.has(id)) {
          await adm(admin).rpc('liquidate_competition_eliminated', {
            p_competition_id: competitionId,
            p_team_id:        id,
            p_day_index:      dayIndex,
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

  // ── 7. Advance competition_game_state ────────────────────────────────────
  await adm(admin)
    .from('competition_game_state')
    .update({
      current_day_index: dayIndex + 1,
      current_phase:     nextPhase,
      champion_id:       champion,
      eliminated,
      r32_pool:          r32Pool,
      r16_pool:          r16Pool,
      qf_pool:           qfPool,
      sf_pool:           sfPool,
      final_pool:        finalPool,
      third_pool:        thirdPool,
      updated_at:        new Date().toISOString(),
    })
    .eq('competition_id', competitionId);

  console.log(`[advance-phase] Competition ${competitionId}: day ${dayIndex} → ${dayIndex + 1} (${nextPhase})`);
}
