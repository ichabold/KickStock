/**
 * check-advance-phase.ts — Advances a competition to the next day/phase
 * once all matches of the current day are processed.
 *
 * Called by sync-results after each processed result.
 * Idempotent: safe to call multiple times.
 * Competition-agnostic: works for WC2022, WC2026, or any other format.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { buildKOQualifiers, updateR32Bracket } from '@/lib/ko-qualifiers';
import { buildR16PoolFromR32Results } from '@kickstock/game-engine';
import type { StoredMatchResult } from '@kickstock/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

// Rebuilds the next-phase pool in the correct bracket order from a source pool
// and the match results of the completed phase. Each consecutive pair in
// sourcePool was a match; the winner of each pair goes into the next pool.
function buildPoolFromResults(
  sourcePool:   string[],
  matchResults: Record<number, StoredMatchResult[]>,
): string[] {
  const nextPool: string[] = [];
  for (let i = 0; i + 1 < sourcePool.length; i += 2) {
    const teamA = sourcePool[i];
    const teamB = sourcePool[i + 1];
    if (!teamA || !teamB) continue;
    let winner: string | null = null;
    outer: for (const results of Object.values(matchResults)) {
      for (const r of results) {
        if ((r.a === teamA && r.b === teamB) || (r.a === teamB && r.b === teamA)) {
          winner = r.winnerId ?? null;
          break outer;
        }
      }
    }
    if (winner) nextPool.push(winner);
  }
  return nextPool;
}

// ── KO match/day creation helpers ─────────────────────────────────────────────

const DIV_KEY_MAP: Record<string, string | null> = {
  R32: 'r32', R16: 'r16', QF: 'qf', SF: 'sf', Final: null, '3rd': '3rd',
};

// Matches per day for each KO phase (mirrors WC2026 schedule)
const MATCHES_PER_DAY: Record<string, number> = {
  R32: 4, R16: 4, QF: 2, SF: 1, Final: 1, '3rd': 1,
};

/**
 * Ensures competition_days rows exist for a KO phase.
 * Uses existing rows if present; creates sequential placeholder rows otherwise.
 * Returns the day_index values assigned to this phase (sorted ascending).
 */
async function ensureKoDaysExist(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  competitionId: number,
  phase: string,
  afterDayIndex: number,
): Promise<number[]> {
  const { data: existing } = await admin
    .from('competition_days')
    .select('day_index')
    .eq('competition_id', competitionId)
    .eq('phase', phase)
    .order('day_index', { ascending: true });

  if (existing && existing.length > 0) {
    return (existing as { day_index: number }[]).map(r => r.day_index);
  }

  // Derive the last used day_index across all phases for this competition
  const { data: lastRow } = await admin
    .from('competition_days')
    .select('day_index')
    .eq('competition_id', competitionId)
    .order('day_index', { ascending: false })
    .limit(1)
    .maybeSingle();

  const baseIdx = Math.max(afterDayIndex, (lastRow as { day_index: number } | null)?.day_index ?? afterDayIndex);

  const totalMatches = { R32: 16, R16: 8, QF: 4, SF: 2, '3rd': 1, Final: 1 }[phase] ?? 2;
  const mpd          = MATCHES_PER_DAY[phase] ?? 2;
  const numDays      = Math.ceil(totalMatches / mpd);
  const divKey       = DIV_KEY_MAP[phase] ?? null;

  const inserts = Array.from({ length: numDays }, (_, d) => ({
    competition_id: competitionId,
    day_index:  baseIdx + 1 + d,
    phase,
    is_ko:      true,
    full_label: `${phase} · Jour ${d + 1}`,
    date_label: `J${baseIdx + 1 + d}`,
    div_key:    divKey,
  }));

  await admin.from('competition_days').insert(inserts);
  return inserts.map(r => r.day_index);
}

/**
 * Creates matches for a KO phase from a pool of qualified teams if none exist yet.
 * Teams are paired sequentially: pool[0] vs pool[1], pool[2] vs pool[3], …
 * Matches are distributed evenly across the phase's competition_days.
 */
async function ensureKoMatchesExist(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  competitionId: number,
  phase: string,
  pool: string[],
  currentDayIndex: number,
): Promise<void> {
  if (pool.length < 2) return;

  const { count } = await admin
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('competition_id', competitionId)
    .eq('phase', phase);

  if ((count ?? 0) > 0) return; // already exist

  const dayIndexes = await ensureKoDaysExist(admin, competitionId, phase, currentDayIndex);
  const mpd        = MATCHES_PER_DAY[phase] ?? 2;

  const inserts = [];
  for (let i = 0; i + 1 < pool.length; i += 2) {
    const matchNum = Math.floor(i / 2);
    const dayIdx   = dayIndexes[Math.min(Math.floor(matchNum / mpd), dayIndexes.length - 1)];
    inserts.push({
      competition_id: competitionId,
      phase,
      nation_a:   pool[i],
      nation_b:   pool[i + 1],
      day_index:  dayIdx,
      api_status: 'NS',
      fixture_id: null,
    });
  }

  await admin.from('matches').insert(inserts);
  console.log(`[advance-phase] Created ${inserts.length} ${phase} matches for competition ${competitionId}`);
}

export async function checkAndAdvancePhase(
  competitionId: number,
  /** simulateMode=true: auto-create KO matches when missing (admin simulate only).
   *  simulateMode=false (default): never create placeholder matches — real fixtures
   *  come from API-Football via sync-fixtures and must not be pre-empted. */
  simulateMode = false,
): Promise<void> {
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

  // ── 4b. After a KO phase completes, rebuild pools in official bracket order ──
  // The incremental push above adds winners in calendar/processing order, but
  // buildMatchesForDay expects pools in bracket order. We rebuild each pool once
  // all matches of that phase are processed so upcoming match display is correct.
  if (gs.current_phase === 'R32' || gs.current_phase === 'R16' || gs.current_phase === 'QF') {
    const { count: remainingPhase } = await adm(admin)
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('competition_id', competitionId)
      .eq('phase', gs.current_phase)
      .is('processed_at', null)
      .not('api_status', 'in', '("PST","SUSP","CANC","ABD")');

    if ((remainingPhase ?? 1) === 0) {
      const { data: phaseRaw } = await adm(admin)
        .from('matches')
        .select('day_index, result_data')
        .eq('competition_id', competitionId)
        .eq('phase', gs.current_phase)
        .not('processed_at', 'is', null);

      const phaseResults: Record<number, StoredMatchResult[]> = {};
      for (const m of (phaseRaw ?? []) as Array<{ day_index: number; result_data: StoredMatchResult }>) {
        if (!m.result_data) continue;
        if (!phaseResults[m.day_index]) phaseResults[m.day_index] = [];
        phaseResults[m.day_index].push(m.result_data);
      }

      if (gs.current_phase === 'R32' && r32Pool.length >= 32) {
        r16Pool = buildR16PoolFromR32Results(r32Pool, phaseResults);
      } else if (gs.current_phase === 'R16' && r16Pool.length >= 16) {
        qfPool = buildPoolFromResults(r16Pool, phaseResults);
      } else if (gs.current_phase === 'QF' && qfPool.length >= 8) {
        sfPool = buildPoolFromResults(qfPool, phaseResults);
      }
    }
  }

  // ── 5. Group phase: incremental R32 placement + final qualifier computation ──
  if (gs.current_phase === 'Groups') {
    const { count: remainingGroup } = await adm(admin)
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('competition_id', competitionId)
      .eq('phase', 'Groups')
      .is('processed_at', null)
      .not('api_status', 'in', '("PST","SUSP","CANC","ABD")');

    // Load all group results so far (needed for both branches below)
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

    // Number of groups determines which qualification strategy applies.
    const { data: groupCodesRaw } = await adm(admin)
      .from('competition_teams')
      .select('group_code')
      .eq('competition_id', competitionId);

    const groupCount = new Set(
      ((groupCodesRaw ?? []) as Array<{ group_code: string | null }>)
        .map(r => r.group_code?.match(/Group ([A-Z])$/i)?.[1])
        .filter(Boolean)
    ).size;

    if (groupCount === 12) {
      // WC2026-style (12 groups → R32 + best-8-thirds): as soon as a group's
      // 3 matchdays are processed, its winner/runner are placed into their
      // official R32 slot(s) immediately. "Best 8 thirds" slots stay empty
      // until ALL groups are complete.
      const { r32Pool: updatedR32, eliminated: updatedElim, allGroupsComplete } =
        await updateR32Bracket(competitionId, allGroupResults, eliminated, r32Pool, dayIndex);

      r32Pool    = updatedR32;
      eliminated = updatedElim;

      // simulateMode only: ensure KO matches exist so the next simulate-day finds them.
      // In production, real fixtures come from API-Football via sync-fixtures — never pre-empt them.
      if (simulateMode && allGroupsComplete) {
        await ensureKoMatchesExist(adm(admin), competitionId, 'R32', r32Pool, dayIndex);
      }
    } else if ((remainingGroup ?? 1) === 0) {
      // Other formats (e.g. WC2022: 8 groups × top-2 → R16 direct).
      const { data: nextDayRow } = await adm(admin)
        .from('competition_days')
        .select('phase')
        .eq('competition_id', competitionId)
        .eq('day_index', dayIndex + 1)
        .maybeSingle();

      const nextPhase = (nextDayRow as { phase: string } | null)?.phase ?? 'R16';

      const { qualifiers, newEliminated } = await buildKOQualifiers(
        competitionId, allGroupResults, eliminated, nextPhase,
      );

      eliminated = newEliminated;

      // Fill the right pool based on next phase
      if (nextPhase === 'R32') r32Pool = qualifiers;
      else                     r16Pool = qualifiers;

      // Liquidate non-qualifiers
      const qualSet = new Set(qualifiers);
      const nonQualifiers = eliminated.filter(id => !qualSet.has(id));
      if (nonQualifiers.length > 0) {
        const { data: priceRowsRaw } = await adm(admin)
          .from('competition_teams')
          .select('team_id, current_price')
          .eq('competition_id', competitionId)
          .in('team_id', nonQualifiers);

        const priceRows = (priceRowsRaw ?? []) as Array<{ team_id: string; current_price: number | null }>;

        for (const id of nonQualifiers) {
          await adm(admin).rpc('liquidate_competition_eliminated', {
            p_competition_id: competitionId,
            p_team_id:        id,
            p_day_index:      dayIndex,
            p_price:          priceRows.find(p => p.team_id === id)?.current_price ?? 1,
          });
        }
      }

      // simulateMode only: ensure KO matches exist so the next simulate-day finds them.
      // In production, real fixtures come from API-Football via sync-fixtures — never pre-empt them.
      if (simulateMode) {
        await ensureKoMatchesExist(adm(admin), competitionId, nextPhase,
          nextPhase === 'R32' ? r32Pool : r16Pool, dayIndex);
      }
    }
  }

  // ── 5b. KO phase complete → create next KO phase matches (simulate only) ──
  if (simulateMode) {
    const KO_NEXT: Record<string, string> = { R32: 'R16', R16: 'QF', QF: 'SF' };
    const nextKoPhase = KO_NEXT[gs.current_phase];

    if (nextKoPhase) {
      const { count: remainingKo } = await adm(admin)
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('competition_id', competitionId)
        .eq('phase', gs.current_phase)
        .is('processed_at', null);

      if ((remainingKo ?? 1) === 0) {
        const poolForNext =
          nextKoPhase === 'R16' ? r16Pool :
          nextKoPhase === 'QF'  ? qfPool  :
          nextKoPhase === 'SF'  ? sfPool  : [];
        await ensureKoMatchesExist(adm(admin), competitionId, nextKoPhase, poolForNext, dayIndex);
      }
    }

    if (gs.current_phase === 'SF') {
      const { count: remainingSF } = await adm(admin)
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('competition_id', competitionId)
        .eq('phase', 'SF')
        .is('processed_at', null);

      if ((remainingSF ?? 1) === 0) {
        await ensureKoMatchesExist(adm(admin), competitionId, 'Final', finalPool, dayIndex);
        await ensureKoMatchesExist(adm(admin), competitionId, '3rd',   thirdPool, dayIndex);
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
