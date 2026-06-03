import { createAdminClient } from '@/lib/supabase/admin';
import Link from 'next/link';

type Competition = {
  id:           number;
  name:         string;
  season:       number;
  start_date:   string | null;
  is_active:    boolean;
  league_id:    number;
  last_sync_at: string | null;
};

type GameState = {
  competition_id:    number;
  current_day_index: number;
  current_phase:     string;
  champion_id:       string | null;
  advancing:         boolean;
};

type CountRow = { competition_id: number };

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any;

  const [
    { data: competitions },
    { data: gameStates },
    { data: teamCounts },
    { data: matchCounts },
    { data: dayCounts },
  ] = await Promise.all([
    adm.from('competitions')
      .select('id, name, season, start_date, is_active, league_id, last_sync_at')
      .order('id', { ascending: false }),
    adm.from('competition_game_state')
      .select('competition_id, current_day_index, current_phase, champion_id, advancing'),
    adm.from('competition_teams').select('competition_id'),
    adm.from('matches').select('competition_id'),
    adm.from('competition_days').select('competition_id'),
  ]);

  const stateMap = Object.fromEntries(
    ((gameStates ?? []) as GameState[]).map(gs => [gs.competition_id, gs]),
  );
  const teamCount  = (teamCounts  as CountRow[] ?? []).reduce<Record<number,number>>((a, r) => { a[r.competition_id] = (a[r.competition_id] ?? 0) + 1; return a; }, {});
  const matchCount = (matchCounts as CountRow[] ?? []).reduce<Record<number,number>>((a, r) => { a[r.competition_id] = (a[r.competition_id] ?? 0) + 1; return a; }, {});
  const dayCount   = (dayCounts   as CountRow[] ?? []).reduce<Record<number,number>>((a, r) => { a[r.competition_id] = (a[r.competition_id] ?? 0) + 1; return a; }, {});

  const cell:  React.CSSProperties = { padding: '10px 10px', fontSize: 12, color: '#ccc', verticalAlign: 'middle' };
  const hcell: React.CSSProperties = { padding: '8px 10px', fontSize: 10, color: '#555', textAlign: 'left', letterSpacing: 1, borderBottom: '1px solid #222' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <h1 style={{ color: '#FFDB00', margin: 0, fontSize: 20, fontFamily: 'monospace' }}>COMPÉTITIONS</h1>
        <Link href="/admin/competitions/new">
          <button style={{
            padding: '7px 14px', background: '#FFDB00', color: '#000',
            border: 'none', cursor: 'pointer', fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
          }}>
            + NOUVELLE
          </button>
        </Link>
      </div>

      {(!competitions || (competitions as Competition[]).length === 0) ? (
        <div style={{ color: '#555', fontSize: 13 }}>Aucune compétition.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['ID', 'NOM', 'SAISON', 'LEAGUE', 'STATUT', 'PHASE', 'JOUR', 'ÉQUIPES', 'MATCHES', 'JOURS', 'LAST SYNC', 'CHAMPION', ''].map(h => (
                <th key={h} style={hcell}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(competitions as Competition[]).map(c => {
              const gs  = stateMap[c.id] as GameState | undefined;
              const sync = c.last_sync_at
                ? new Date(c.last_sync_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                : '—';
              return (
                <tr key={c.id} style={{ borderBottom: '1px solid #111' }}>
                  <td style={{ ...cell, color: '#444', fontSize: 11 }}>{c.id}</td>
                  <td style={{ ...cell, fontWeight: 600, color: '#fff' }}>{c.name}</td>
                  <td style={{ ...cell, textAlign: 'center' }}>{c.season}</td>
                  <td style={{ ...cell, textAlign: 'center', color: '#888' }}>{c.league_id}</td>
                  <td style={{ ...cell, textAlign: 'center' }}>
                    <span style={{ color: c.is_active ? '#00FF87' : '#444', fontWeight: 700, fontSize: 11 }}>
                      {c.is_active ? '● ACTIVE' : '○ OFF'}
                    </span>
                  </td>
                  <td style={{ ...cell, textAlign: 'center', color: '#a855f7' }}>{gs?.current_phase ?? '—'}</td>
                  <td style={{ ...cell, textAlign: 'center' }}>{gs?.current_day_index ?? '—'}</td>
                  <td style={{ ...cell, textAlign: 'center', color: (teamCount[c.id] ?? 0) > 0 ? '#00FF87' : '#444' }}>
                    {teamCount[c.id] ?? 0}
                  </td>
                  <td style={{ ...cell, textAlign: 'center', color: (matchCount[c.id] ?? 0) > 0 ? '#00FF87' : '#444' }}>
                    {matchCount[c.id] ?? 0}
                  </td>
                  <td style={{ ...cell, textAlign: 'center', color: (dayCount[c.id] ?? 0) > 0 ? '#00FF87' : '#444' }}>
                    {dayCount[c.id] ?? 0}
                  </td>
                  <td style={{ ...cell, fontSize: 10, color: '#555' }}>{sync}</td>
                  <td style={{ ...cell, textAlign: 'center', color: gs?.champion_id ? '#FFDB00' : '#333' }}>
                    {gs?.champion_id ?? '—'}
                  </td>
                  <td style={{ ...cell, textAlign: 'center' }}>
                    <Link
                      href={`/admin/competitions/${c.id}`}
                      style={{ color: '#FFDB00', textDecoration: 'none', fontSize: 11, fontFamily: 'monospace' }}
                    >
                      GÉRER →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
