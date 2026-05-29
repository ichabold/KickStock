#!/usr/bin/env tsx
/**
 * validate-team-mapping.ts — Validates the team mapping file against API-Football.
 *
 * Usage:
 *   pnpm tsx scripts/validate-team-mapping.ts --league=1 --season=2026
 *   pnpm tsx scripts/validate-team-mapping.ts --league=1 --season=2022   (test on past data)
 *
 * Requires: API_FOOTBALL_KEY in environment (or .env.local)
 *
 * Output:
 *   ✅ 47/48 teams mapped
 *   ❌  1 missing:
 *      → "Ivory Coast" (API id 34) — add to league_1.ts as "Ivory Coast": "CIV"
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { LEAGUE_1_MAPPING } from '../apps/web/lib/team-mapping/league_1';

// Load .env.local from the web app
config({ path: resolve(__dirname, '../apps/web/.env.local') });

// ── Args ──────────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const league  = args.find(a => a.startsWith('--league='))?.split('=')[1]  ?? '1';
const season  = args.find(a => a.startsWith('--season='))?.split('=')[1] ?? '2026';

// ── Mappings per league ───────────────────────────────────────────────────────
const MAPPINGS: Record<string, Record<string, string>> = {
  '1': LEAGUE_1_MAPPING,
};

const mapping = MAPPINGS[league];
if (!mapping) {
  console.error(`❌ No mapping found for league ${league}. Create apps/web/lib/team-mapping/league_${league}.ts`);
  process.exit(1);
}

// ── Fetch from API ────────────────────────────────────────────────────────────
async function fetchTeams(): Promise<Array<{ team: { id: number; name: string } }>> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    console.error('❌ API_FOOTBALL_KEY not set in apps/web/.env.local');
    process.exit(1);
  }

  const url = `https://v3.football.api-sports.io/fixtures?league=${league}&season=${season}`;
  const res = await fetch(url, {
    headers: {
      'x-rapidapi-key':  key,
      'x-rapidapi-host': 'v3.football.api-sports.io',
    },
  });

  if (!res.ok) {
    console.error(`❌ API error ${res.status}:`, await res.text());
    process.exit(1);
  }

  const data = await res.json() as {
    response?: Array<{ teams: { home: { id: number; name: string }; away: { id: number; name: string } } }>;
    errors?: unknown;
  };

  if (data.errors && Object.keys(data.errors as object).length > 0) {
    console.error('❌ API errors:', data.errors);
    process.exit(1);
  }

  // Extract unique teams from fixtures
  const teamMap = new Map<number, string>();
  for (const fixture of data.response ?? []) {
    teamMap.set(fixture.teams.home.id, fixture.teams.home.name);
    teamMap.set(fixture.teams.away.id, fixture.teams.away.name);
  }

  return [...teamMap.entries()].map(([id, name]) => ({ team: { id, name } }));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔍 Validating league ${league}, season ${season}...\n`);

  const apiTeams = await fetchTeams();
  console.log(`📡 API returned ${apiTeams.length} unique teams\n`);

  const ok:      Array<{ apiName: string; id: string }> = [];
  const missing: Array<{ apiName: string; apiId: number }> = [];

  for (const { team } of apiTeams) {
    const id = mapping[team.name];
    if (id) {
      ok.push({ apiName: team.name, id });
    } else {
      missing.push({ apiName: team.name, apiId: team.id });
    }
  }

  // Report
  console.log(`✅ ${ok.length}/${apiTeams.length} teams mapped`);

  if (missing.length > 0) {
    console.log(`\n❌ ${missing.length} teams NOT in mapping:\n`);
    for (const { apiName, apiId } of missing) {
      console.log(`   → "${apiName}" (API id ${apiId})`);
      console.log(`      Add to league_${league}.ts: "${apiName}": "XXX",\n`);
    }
    process.exit(1);
  } else {
    console.log(`\n🎉 All teams mapped! Ready for league ${league} season ${season}.\n`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
