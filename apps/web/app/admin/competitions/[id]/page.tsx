import { createAdminClient } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';
import CompetitionActions from './CompetitionActions';
import TeamEditor from './TeamEditor';
import { DayDeleteButton, DayAddForm } from './DayManager';

type Team = {
  team_id: string;
  group_code: string | null;
  strength: number;
  initial_price: number;
  current_price: number;
  teams: { name: string; flag_emoji: string | null };
};

type Day = {
  day_index:  number;
  full_label: string;
  date_label: string;
  phase:      string;
  is_ko:      boolean;
  div_key:    string | null;
};

type Match = {
  fixture_id: number;
  nation_a: string;
  nation_b: string;
  scheduled_at: string;
  phase: string;
  day_index: number;
  api_status: string | null;
  score_a: number | null;
  score_b: number | null;
  processed_at: string | null;
  venue: string | null;
};

export const dynamic = 'force-dynamic';

export default async function CompetitionPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any;

  const [{ data: comp }, { data: gs }, { data: teams }, { data: matches }, { data: days }] = await Promise.all([
    adm.from('competitions').select('*').eq('id', id).single(),
    adm.from('competition_game_state')
      .select('current_day_index, current_phase, advancing, champion_id, eliminated')
      .eq('competition_id', id).single(),
    adm.from('competition_teams')
      .select('team_id, group_code, strength, initial_price, current_price, teams(name, flag_emoji)')
      .eq('competition_id', id)
      .order('group_code').order('team_id'),
    adm.from('matches')
      .select('fixture_id, nation_a, nation_b, scheduled_at, phase, day_index, api_status, score_a, score_b, processed_at, venue')
      .eq('competition_id', id)
      .order('day_index').order('scheduled_at')
      .limit(50),
    adm.from('competition_days')
      .select('day_index, full_label, date_label, phase, is_ko, div_key')
      .eq('competition_id', id)
      .order('day_index', { ascending: true }),
  ]);

  if (!comp) notFound();

  const dayMatches = gs
    ? (matches as Match[] ?? []).filter(m => m.day_index === gs.current_day_index)
    : [];

  const sectionStyle: React.CSSProperties = {
    marginBottom: 40,
    padding: 20,
    background: '#111',
    border: '1px solid #222',
  };
  const h2Style: React.CSSProperties = {
    color: '#FFDB00', fontSize: 14, margin: '0 0 16px', letterSpacing: 1,
  };
  const tdStyle: React.CSSProperties = { padding: '7px 10px', color: '#ccc', fontSize: 12 };
  const thStyle: React.CSSProperties = { padding: '7px 10px', color: '#666', fontSize: 11, textAlign: 'left' };

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ color: '#FFDB00', margin: 0, fontSize: 18 }}>{comp.name}</h1>
        <span style={{ color: comp.is_active ? '#00FF87' : '#555', fontSize: 12 }}>
          {comp.is_active ? '● ACTIVE' : '○ INACTIVE'}
        </span>
      </div>

      {/* ── Section A — Métadonnées ────────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>A · MÉTADONNÉES</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}>
          {[
            ['ID',       comp.id],
            ['Nom',      comp.name],
            ['Saison',   comp.season],
            ['League ID',comp.league_id],
            ['Début',    comp.start_date],
            ['Fin',      comp.end_date],
          ].map(([label, val]) => (
            <div key={String(label)}>
              <div style={{ color: '#555', fontSize: 10, marginBottom: 2 }}>{label}</div>
              <div style={{ color: '#fff', fontSize: 13 }}>{String(val)}</div>
            </div>
          ))}
        </div>
        <CompetitionActions
          competitionId={id}
          isActive={comp.is_active}
          currentDayIndex={gs?.current_day_index ?? 0}
        />
      </div>

      {/* ── Section B — État de jeu ────────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>B · ÉTAT DE JEU</h2>
        {gs ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {[
              ['Jour',        gs.current_day_index],
              ['Phase',       gs.current_phase],
              ['Advancing',   gs.advancing ? '🔒 OUI' : '✓ NON'],
              ['Champion',    gs.champion_id ?? '—'],
              ['Éliminés',    Array.isArray(gs.eliminated) ? gs.eliminated.length : 0],
            ].map(([label, val]) => (
              <div key={String(label)}>
                <div style={{ color: '#555', fontSize: 10, marginBottom: 2 }}>{label}</div>
                <div style={{ color: '#fff', fontSize: 13 }}>{String(val)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: '#555', fontSize: 13 }}>Aucun état de jeu initialisé.</div>
        )}
      </div>

      {/* ── Section C — Équipes ────────────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>C · ÉQUIPES ({teams?.length ?? 0})</h2>
        {(!teams || teams.length === 0) ? (
          <div style={{ color: '#555', fontSize: 13 }}>Aucune équipe enregistrée.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #222' }}>
                <th style={thStyle}>Flag</th>
                <th style={thStyle}>ID</th>
                <th style={thStyle}>Nom</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Groupe</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Force</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Prix init.</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Prix actuel</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Δ%</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Éditer</th>
              </tr>
            </thead>
            <tbody>
              {(teams as Team[]).map(t => {
                const delta = t.initial_price > 0
                  ? (((t.current_price - t.initial_price) / t.initial_price) * 100).toFixed(1)
                  : '0.0';
                const deltaNum = parseFloat(delta);
                return (
                  <tr key={t.team_id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={tdStyle}>{t.teams?.flag_emoji ?? ''}</td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: '#fff' }}>{t.team_id}</td>
                    <td style={tdStyle}>{t.teams?.name ?? '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{t.group_code ?? '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{t.strength}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{t.initial_price} KC</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{t.current_price} KC</td>
                    <td style={{
                      ...tdStyle, textAlign: 'center',
                      color: deltaNum > 0 ? '#00FF87' : deltaNum < 0 ? '#ff4444' : '#555',
                    }}>
                      {deltaNum >= 0 ? '+' : ''}{delta}%
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <TeamEditor
                        competitionId={id}
                        teamId={t.team_id}
                        strength={t.strength}
                        groupCode={t.group_code}
                        initialPrice={t.initial_price}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Section D — Matchs du jour courant ────────────────────────────────── */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>
          D · MATCHS — JOUR {gs?.current_day_index ?? '?'} · {gs?.current_phase ?? '—'}
        </h2>
        {dayMatches.length === 0 ? (
          <div style={{ color: '#555', fontSize: 13 }}>Aucun match pour ce jour.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #222' }}>
                <th style={thStyle}>Fixture ID</th>
                <th style={thStyle}>Équipes</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Score</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Phase</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Statut API</th>
                <th style={thStyle}>Prévu</th>
                <th style={thStyle}>Traité</th>
              </tr>
            </thead>
            <tbody>
              {dayMatches.map(m => (
                <tr key={m.fixture_id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ ...tdStyle, color: '#555' }}>{m.fixture_id}</td>
                  <td style={{ ...tdStyle, color: '#fff' }}>
                    {m.nation_a} <span style={{ color: '#555' }}>vs</span> {m.nation_b}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600 }}>
                    {m.score_a !== null ? `${m.score_a}–${m.score_b}` : '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{m.phase}</td>
                  <td style={{ ...tdStyle, textAlign: 'center', color: m.api_status === 'FT' ? '#00FF87' : '#888' }}>
                    {m.api_status ?? '—'}
                  </td>
                  <td style={{ ...tdStyle, color: '#555' }}>
                    {m.scheduled_at ? new Date(m.scheduled_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '—'}
                  </td>
                  <td style={{ ...tdStyle, color: m.processed_at ? '#00FF87' : '#555' }}>
                    {m.processed_at ? '✓' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {/* ── Section E — Journées (competition_days) ────────────────────────── */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>E · JOURNÉES ({days?.length ?? 0})</h2>
        {(!days || days.length === 0) ? (
          <div style={{ color: '#555', fontSize: 13, marginBottom: 16 }}>
            Aucune journée. Utiliser Sync Fixtures ou ajouter manuellement.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 16 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #222' }}>
                <th style={thStyle}>Day</th>
                <th style={thStyle}>Label complet</th>
                <th style={thStyle}>Label court</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Phase</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>KO?</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>div_key</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Suppr.</th>
              </tr>
            </thead>
            <tbody>
              {(days as Day[]).map(d => (
                <tr key={d.day_index} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ ...tdStyle, color: '#FFDB00', fontWeight: 700 }}>{d.day_index}</td>
                  <td style={tdStyle}>{d.full_label}</td>
                  <td style={tdStyle}>{d.date_label}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{d.phase}</td>
                  <td style={{ ...tdStyle, textAlign: 'center', color: d.is_ko ? '#FFDB00' : '#555' }}>
                    {d.is_ko ? 'KO' : '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center', color: d.div_key ? '#00FF87' : '#555' }}>
                    {d.div_key ?? '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <DayDeleteButton competitionId={id} dayIndex={d.day_index} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <DayAddForm competitionId={id} />
      </div>
    </div>
  );
}
