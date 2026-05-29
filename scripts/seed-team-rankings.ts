#!/usr/bin/env tsx
/**
 * seed-team-rankings.ts — Seeds strength + initial_price from FIFA rankings.
 *
 * Run ONCE after sync-fixtures has populated teams + competition_teams.
 * Can be re-run to refresh before a competition starts (values frozen at J1).
 *
 * Usage:
 *   pnpm tsx scripts/seed-team-rankings.ts --league=1 --season=2026
 *   pnpm tsx scripts/seed-team-rankings.ts --league=1 --season=2026 --dry-run
 *
 * Requires: API_FOOTBALL_KEY + SUPABASE_* in apps/web/.env.local
 *
 * Fallback: if API doesn't return rankings (plan limitation),
 * provide a CSV at scripts/data/fifa-rankings.csv:
 *   rank,team_name,points
 *   1,France,1832
 *   2,Spain,1820
 *   ...
 */

import { config }     from 'dotenv';
import { resolve }    from 'path';
import { existsSync, readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(__dirname, '../apps/web/.env.local') });

// ── Args ──────────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const league  = parseInt(args.find(a => a.startsWith('--league='))?.split('=')[1]  ?? '1', 10);
const season  = parseInt(args.find(a => a.startsWith('--season='))?.split('=')[1] ?? '2026', 10);
const dryRun  = args.includes('--dry-run');

if (dryRun) console.log('🔵 DRY RUN — no DB writes\n');

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Derivation formulas ───────────────────────────────────────────────────────

/** Normalizes FIFA points to a strength value in [60, 95]. */
function calcStrength(points: number, allPoints: number[]): number {
  const min = Math.min(...allPoints);
  const max = Math.max(...allPoints);
  if (max === min) return 75; // fallback: all equal
  const raw = ((points - min) / (max - min)) * 35 + 60;
  return Math.round(Math.min(95, Math.max(60, raw)));
}

/** Maps rank among participants (1-based) to an initial price tier in KC. */
function calcInitialPrice(rankAmongParticipants: number): number {
  if (rankAmongParticipants <= 4)  return 250;
  if (rankAmongParticipants <= 12) return 200;
  if (rankAmongParticipants <= 24) return 150;
  if (rankAmongParticipants <= 36) return 120;
  return 100;
}

// ── Data sources ──────────────────────────────────────────────────────────────

interface RankingEntry {
  apiTeamId: number | null;
  teamName:  string;
  points:    number;
}

/** Try to get FIFA rankings from API-Football. */
async function fetchApiRankings(): Promise<RankingEntry[]> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY not set');

  const res = await fetch('https://v3.football.api-sports.io/teams/rankings/fifa', {
    headers: {
      'x-rapidapi-key':  key,
      'x-rapidapi-host': 'v3.football.api-sports.io',
    },
  });

  if (res.status === 403 || res.status === 401) {
    throw new Error(`API plan does not include FIFA rankings (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);

  const data = await res.json() as {
    response?: Array<{ team: { id: number; name: string }; points: number; ranking: number }>;
  };
  return (data.response ?? []).map(r => ({
    apiTeamId: r.team.id,
    teamName:  r.team.name,
    points:    r.points,
  }));
}

/** Fallback: read FIFA rankings from local CSV file. */
function readCsvRankings(): RankingEntry[] {
  const csvPath = resolve(__dirname, 'data/fifa-rankings.csv');
  if (!existsSync(csvPath)) {
    throw new Error(
      `Fallback CSV not found at ${csvPath}.\n` +
      `Download from https://www.fifa.com/ranking/men/ and save as:\n` +
      `  rank,team_name,points\n  1,France,1832\n  ...`
    );
  }

  const lines = readFileSync(csvPath, 'utf-8').trim().split('\n');
  // Skip header
  return lines.slice(1).map(line => {
    const parts = line.split(',');
    return {
      apiTeamId: null,
      teamName:  parts[1]?.trim() ?? '',
      points:    parseInt(parts[2]?.trim() ?? '0', 10),
    };
  }).filter(r => r.teamName && r.points > 0);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🏆 Seeding rankings for league ${league}, season ${season}...\n`);

  // ── 1. Load competition from DB ──────────────────────────────────────────
  const { data: comp } = await db
    .from('competitions')
    .select('id, name')
    .eq('league_id', league)
    .eq('season', season)
    .single();

  if (!comp) {
    console.error(`❌ Competition not found (league=${league}, season=${season})`);
    console.error('   Run sync-fixtures first.');
    process.exit(1);
  }
  console.log(`📌 Competition: ${comp.name} (id=${comp.id})\n`);

  // ── 2. Load competition teams from DB ────────────────────────────────────
  const { data: compTeamsRaw } = await db
    .from('competition_teams')
    .select('team_id, teams(api_team_id, name)')
    .eq('competition_id', comp.id);

  if (!compTeamsRaw || compTeamsRaw.length === 0) {
    console.error('❌ No teams found in DB for this competition.');
    console.error('   Run sync-fixtures first.');
    process.exit(1);
  }

  const compTeams = compTeamsRaw as Array<{
    team_id:  string;
    teams:    { api_team_id: number | null; name: string };
  }>;

  console.log(`👥 ${compTeams.length} teams in competition\n`);

  // ── 3. Get FIFA rankings ─────────────────────────────────────────────────
  let rankings: RankingEntry[];
  try {
    console.log('📡 Fetching FIFA rankings from API-Football...');
    rankings = await fetchApiRankings();
    console.log(`   ✅ ${rankings.length} teams in FIFA rankings\n`);
  } catch (err) {
    console.warn(`   ⚠️  API fallback: ${(err as Error).message}`);
    console.log('   📁 Trying local CSV fallback...');
    rankings = readCsvRankings();
    console.log(`   ✅ ${rankings.length} entries from CSV\n`);
  }

  // ── 4. Cross-reference teams with rankings ────────────────────────────────
  interface TeamWithRank {
    team_id:   string;
    teamName:  string;
    points:    number | null;
  }

  const teamsWithRanks: TeamWithRank[] = compTeams.map(ct => {
    // Match by api_team_id first, then by name
    const r = ct.teams.api_team_id
      ? rankings.find(r => r.apiTeamId === ct.teams.api_team_id)
      : rankings.find(r => r.teamName === ct.teams.name ||
                           r.teamName.toLowerCase() === ct.teams.name.toLowerCase());

    return {
      team_id:  ct.team_id,
      teamName: ct.teams.name,
      points:   r?.points ?? null,
    };
  });

  // ── 5. Report missing ────────────────────────────────────────────────────
  const missing = teamsWithRanks.filter(t => t.points === null);
  if (missing.length > 0) {
    console.warn(`⚠️  ${missing.length} teams without FIFA ranking (using defaults):`);
    for (const t of missing) console.warn(`   → ${t.team_id} (${t.teamName})`);
    console.log('   strength=75, initial_price=120 will be used for these teams\n');
  }

  // ── 6. Calculate strength + initial_price ────────────────────────────────
  const allPoints = teamsWithRanks.filter(t => t.points !== null).map(t => t.points!);

  // Sort by points descending (best team = rank 1)
  const ranked = [...teamsWithRanks]
    .filter(t => t.points !== null)
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0));

  const results: Array<{
    team_id:       string;
    name:          string;
    fifa_rank:     number | null;
    points:        number | null;
    strength:      number;
    initial_price: number;
  }> = [];

  for (const t of teamsWithRanks) {
    const rankAmongParticipants = t.points !== null
      ? ranked.findIndex(r => r.team_id === t.team_id) + 1
      : null;

    results.push({
      team_id:       t.team_id,
      name:          t.teamName,
      fifa_rank:     rankAmongParticipants,
      points:        t.points,
      strength:      t.points ? calcStrength(t.points, allPoints) : 75,
      initial_price: rankAmongParticipants ? calcInitialPrice(rankAmongParticipants) : 120,
    });
  }

  // Sort for display
  results.sort((a, b) => (a.fifa_rank ?? 999) - (b.fifa_rank ?? 999));

  // ── 7. Display table ─────────────────────────────────────────────────────
  console.log('───────────────────────────────────────────────────────────');
  console.log(' ID     Name                    Rank   Pts    Str   Price  ');
  console.log('───────────────────────────────────────────────────────────');
  for (const r of results) {
    const rank  = r.fifa_rank?.toString().padStart(3) ?? '  ?';
    const pts   = r.points?.toString().padStart(5)    ?? '    ?';
    const str   = r.strength.toString().padStart(3);
    const price = `${r.initial_price} KC`.padStart(7);
    const name  = r.name.padEnd(22).slice(0, 22);
    const id    = r.team_id.padEnd(6);
    console.log(` ${id} ${name} ${rank}  ${pts}  ${str}  ${price}`);
  }
  console.log('───────────────────────────────────────────────────────────\n');

  if (dryRun) {
    console.log('🔵 DRY RUN complete — no changes written.\n');
    return;
  }

  // ── 8. Write to DB ───────────────────────────────────────────────────────
  console.log('💾 Writing to database...');

  let updated = 0;
  for (const r of results) {
    // Update teams.strength
    await db.from('teams')
      .update({ strength: r.strength })
      .eq('id', r.team_id);

    // Update competition_teams.initial_price
    await db.from('competition_teams')
      .update({ initial_price: r.initial_price })
      .eq('team_id', r.team_id)
      .eq('competition_id', comp.id);

    updated++;
  }

  console.log(`✅ ${updated} teams updated.\n`);
  console.log('📝 Review values in the admin panel before J1. Edits are possible until the first match.\n');
}

main().catch(err => { console.error(err); process.exit(1); });
