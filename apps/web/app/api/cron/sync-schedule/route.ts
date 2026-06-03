/**
 * GET /api/cron/sync-schedule
 *
 * Seeds competition_days for KO phases (R32, R16, QF, SF, 3rd, Final)
 * based on the official WC2026 schedule.
 * API-Football ne publie pas les fixtures KO avant la fin de la phase de
 * groupe — ce cron comble ce manque avec les dates officielles connues.
 *
 * Idempotent: upsert sur (competition_id, day_index).
 * Security: requires Authorization: Bearer {CRON_SECRET}
 */

import { NextResponse }      from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (a: ReturnType<typeof createAdminClient>) => (a as any);

// ── WC2026 KO schedule (official FIFA calendar) ───────────────────────────────
// Dates used to compute day_index relative to competition.start_date
// The game engine expects exactly these numbers of days per phase:
//   R32: 6 days  (slices: r32_28[0,4], r32_29[4,10], r32_30[10,16],
//                          r32_1[16,22], r32_2[22,26], r32_3[26,32])
//   R16: 4 days  (slices: r16_1[0,4], r16_2[4,8], r16_3[8,12], r16_4[12,16])
//   QF:  2 days  (slices: qf_1[0,2], qf_2[2,4] — 4 matches total)
//   SF:  2 days  (slices: sf_1[0,2], sf_2[2,4])
//   3rd: 1 day
//   Final: 1 day

interface KoDay {
  date:       string;   // "YYYY-MM-DD"
  phase:      string;   // "R32" | "R16" | "QF" | "SF" | "3rd" | "Final"
  dateLabel:  string;   // "Jun 28"
  fullLabel:  string;   // "R32 · Sun Jun 28"
  divKey:     string | null;
}

const WC2026_KO_DAYS: KoDay[] = [
  // Round of 32 — June 28–July 3
  { date: '2026-06-28', phase: 'R32',   dateLabel: 'Jun 28', fullLabel: 'R32 · Sun Jun 28', divKey: 'r32' },
  { date: '2026-06-29', phase: 'R32',   dateLabel: 'Jun 29', fullLabel: 'R32 · Mon Jun 29', divKey: 'r32' },
  { date: '2026-06-30', phase: 'R32',   dateLabel: 'Jun 30', fullLabel: 'R32 · Tue Jun 30', divKey: 'r32' },
  { date: '2026-07-01', phase: 'R32',   dateLabel: 'Jul 1',  fullLabel: 'R32 · Wed Jul 1',  divKey: 'r32' },
  { date: '2026-07-02', phase: 'R32',   dateLabel: 'Jul 2',  fullLabel: 'R32 · Thu Jul 2',  divKey: 'r32' },
  { date: '2026-07-03', phase: 'R32',   dateLabel: 'Jul 3',  fullLabel: 'R32 · Fri Jul 3',  divKey: 'r32' },
  // Round of 16 — July 5–8
  { date: '2026-07-05', phase: 'R16',   dateLabel: 'Jul 5',  fullLabel: 'R16 · Sun Jul 5',  divKey: 'r16' },
  { date: '2026-07-06', phase: 'R16',   dateLabel: 'Jul 6',  fullLabel: 'R16 · Mon Jul 6',  divKey: 'r16' },
  { date: '2026-07-07', phase: 'R16',   dateLabel: 'Jul 7',  fullLabel: 'R16 · Tue Jul 7',  divKey: 'r16' },
  { date: '2026-07-08', phase: 'R16',   dateLabel: 'Jul 8',  fullLabel: 'R16 · Wed Jul 8',  divKey: 'r16' },
  // Quarter-finals — July 12–13
  { date: '2026-07-12', phase: 'QF',    dateLabel: 'Jul 12', fullLabel: 'QF · Sun Jul 12',  divKey: 'qf'  },
  { date: '2026-07-13', phase: 'QF',    dateLabel: 'Jul 13', fullLabel: 'QF · Mon Jul 13',  divKey: 'qf'  },
  // Semi-finals — July 16–17
  { date: '2026-07-16', phase: 'SF',    dateLabel: 'Jul 16', fullLabel: 'SF · Thu Jul 16',  divKey: 'sf'  },
  { date: '2026-07-17', phase: 'SF',    dateLabel: 'Jul 17', fullLabel: 'SF · Fri Jul 17',  divKey: 'sf'  },
  // 3rd place & Final — July 20–21
  { date: '2026-07-20', phase: '3rd',   dateLabel: 'Jul 20', fullLabel: '3rd · Mon Jul 20', divKey: null  },
  { date: '2026-07-21', phase: 'Final', dateLabel: 'Jul 21', fullLabel: 'Final · Tue Jul 21',divKey: 'final'},
];

function calcDayIndex(dateStr: string, startDate: string): number {
  const start = new Date(`${startDate}T05:00:00Z`);
  const d     = new Date(`${dateStr}T12:00:00Z`);
  return Math.max(0, Math.floor((d.getTime() - start.getTime()) / 86_400_000));
}

export async function GET(req: Request) {
  if (req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: competitions } = await adm(admin)
    .from('competitions')
    .select('id, name, start_date, league_id')
    .eq('is_active', true);

  if (!competitions?.length) {
    return Response.json({ message: 'No active competitions' });
  }

  // Also handle competition_id query param (from admin sync button)
  const url = new URL(req.url);
  const specificId = url.searchParams.get('competition_id');
  const targets = specificId
    ? (competitions as Array<{ id: number; name: string; start_date: string | null; league_id: number }>)
        .filter(c => c.id === parseInt(specificId, 10))
    : (competitions as Array<{ id: number; name: string; start_date: string | null; league_id: number }>);

  const results = [];

  for (const comp of targets) {
    if (!comp.start_date) {
      results.push({ competition: comp.name, skipped: 'no start_date' });
      continue;
    }

    // Only seed KO schedule for WC-format competitions (league_id=1 has known dates)
    // For other leagues, skip (no hardcoded schedule available)
    if (comp.league_id !== 1) {
      results.push({ competition: comp.name, skipped: 'non-WC league, no KO schedule known' });
      continue;
    }

    let upserted = 0;
    for (const koDay of WC2026_KO_DAYS) {
      const dayIndex = calcDayIndex(koDay.date, comp.start_date);

      const { error } = await adm(admin).from('competition_days').upsert(
        {
          competition_id: comp.id,
          day_index:      dayIndex,
          date_label:     koDay.dateLabel,
          full_label:     koDay.fullLabel,
          phase:          koDay.phase,
          is_ko:          true,
          div_key:        koDay.divKey,
        },
        { onConflict: 'competition_id,day_index', ignoreDuplicates: false },
      );
      if (error) {
        console.error(`[sync-schedule] ${comp.name} day ${dayIndex}:`, error.message);
      } else {
        upserted++;
      }
    }

    results.push({ competition: comp.name, upserted });
    console.log(`[sync-schedule] ${comp.name}: ${upserted} KO days upserted`);
  }

  return Response.json({ ok: true, results, ts: new Date().toISOString() });
}
