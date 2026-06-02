import { createAdminClient } from '@/lib/supabase/admin';
import Link from 'next/link';

type Competition = {
  id: number;
  name: string;
  season: number;
  start_date: string;
  end_date: string;
  is_active: boolean;
  league_id: number;
};

type GameState = {
  competition_id: number;
  current_day_index: number;
  current_phase: string;
  champion_id: string | null;
  advancing: boolean;
};

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any;

  const { data: competitions } = await adm
    .from('competitions')
    .select('id, name, season, start_date, end_date, is_active, league_id')
    .order('season', { ascending: false });

  const { data: gameStates } = await adm
    .from('competition_game_state')
    .select('competition_id, current_day_index, current_phase, champion_id, advancing');

  const stateMap = Object.fromEntries(
    ((gameStates ?? []) as GameState[]).map(gs => [gs.competition_id, gs]),
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <h1 style={{ color: '#FFDB00', margin: 0, fontSize: 20 }}>Compétitions</h1>
        <Link href="/admin/competitions/new">
          <button style={{
            padding: '7px 14px', background: '#FFDB00', color: '#000',
            border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'monospace', fontWeight: 700,
          }}>
            + NOUVELLE
          </button>
        </Link>
      </div>

      {(!competitions || competitions.length === 0) ? (
        <div style={{ color: '#555', fontSize: 13 }}>Aucune compétition. Crée-en une.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333', color: '#888' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Nom</th>
              <th style={{ textAlign: 'center' }}>Saison</th>
              <th style={{ textAlign: 'center' }}>League ID</th>
              <th style={{ textAlign: 'center' }}>Statut</th>
              <th style={{ textAlign: 'center' }}>Phase</th>
              <th style={{ textAlign: 'center' }}>Jour</th>
              <th style={{ textAlign: 'center' }}>Champion</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(competitions as Competition[]).map(c => {
              const gs = stateMap[c.id] as GameState | undefined;
              return (
                <tr key={c.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{c.name}</td>
                  <td style={{ textAlign: 'center', color: '#888' }}>{c.season}</td>
                  <td style={{ textAlign: 'center', color: '#888' }}>{c.league_id}</td>
                  <td style={{ textAlign: 'center', color: c.is_active ? '#00FF87' : '#555' }}>
                    {c.is_active ? '● ACTIVE' : '○ INACTIVE'}
                  </td>
                  <td style={{ textAlign: 'center', color: '#ccc' }}>{gs?.current_phase ?? '—'}</td>
                  <td style={{ textAlign: 'center', color: '#ccc' }}>{gs?.current_day_index ?? '—'}</td>
                  <td style={{ textAlign: 'center', color: gs?.champion_id ? '#FFDB00' : '#555' }}>
                    {gs?.champion_id ?? '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <Link
                      href={`/admin/competitions/${c.id}`}
                      style={{ color: '#FFDB00', textDecoration: 'none', fontSize: 12 }}
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
