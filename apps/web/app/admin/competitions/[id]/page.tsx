import { createAdminClient }                    from '@/lib/supabase/admin';
import { notFound }                              from 'next/navigation';
import CompetitionActions                        from './CompetitionActions';
import TeamEditor                                from './TeamEditor';
import { DayDeleteButton, DayAddForm }           from './DayManager';
import MatchEditor                               from './MatchEditor';
import TabBar, { type TabId }                    from './TabBar';

// ── Types ─────────────────────────────────────────────────────────────────────

type Team = {
  team_id:       string;
  group_code:    string | null;
  strength:      number;
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
  fixture_id:   number;
  nation_a:     string;
  nation_b:     string;
  scheduled_at: string | null;
  phase:        string;
  day_index:    number;
  api_status:   string | null;
  score_a:      number | null;
  score_b:      number | null;
  processed_at: string | null;
  venue:        string | null;
};

// ── Page ──────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';

export default async function CompetitionPage({
  params,
  searchParams,
}: {
  params:       { id: string };
  searchParams: { tab?: string };
}) {
  const id  = parseInt(params.id, 10);
  if (isNaN(id)) notFound();

  const tab: TabId = (['info', 'format', 'teams', 'matches'] as TabId[]).includes(
    searchParams.tab as TabId,
  )
    ? (searchParams.tab as TabId)
    : 'info';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any;

  const [{ data: comp }, { data: gs }, { data: teams }, { data: matches }, { data: days }] =
    await Promise.all([
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
        .order('day_index').order('scheduled_at'),
      adm.from('competition_days')
        .select('day_index, full_label, date_label, phase, is_ko, div_key')
        .eq('competition_id', id)
        .order('day_index', { ascending: true }),
    ]);

  if (!comp) notFound();

  // ── Shared styles ─────────────────────────────────────────────────────────
  const card: React.CSSProperties  = { marginBottom: 28, padding: 20, background: '#111', border: '1px solid #222' };
  const h2:   React.CSSProperties  = { color: '#FFDB00', fontSize: 13, margin: '0 0 16px', letterSpacing: 1, fontFamily: 'monospace' };
  const td:   React.CSSProperties  = { padding: '7px 10px', color: '#ccc', fontSize: 12 };
  const th:   React.CSSProperties  = { padding: '7px 10px', color: '#555', fontSize: 11, textAlign: 'left' };

  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString('fr-FR', {
          timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit',
          hour: '2-digit', minute: '2-digit',
        })
      : '—';

  // Group teams by group_code
  const teamsByGroup = (teams as Team[] ?? []).reduce<Record<string, Team[]>>((acc, t) => {
    const g = t.group_code ?? '—';
    if (!acc[g]) acc[g] = [];
    acc[g].push(t);
    return acc;
  }, {});
  const groupKeys = Object.keys(teamsByGroup).sort();

  // Group matches by day_index
  const matchesByDay = (matches as Match[] ?? []).reduce<Record<number, Match[]>>((acc, m) => {
    if (!acc[m.day_index]) acc[m.day_index] = [];
    acc[m.day_index].push(m);
    return acc;
  }, {});
  const dayKeys = Object.keys(matchesByDay).map(Number).sort((a, b) => a - b);

  const dayMap = Object.fromEntries((days as Day[] ?? []).map(d => [d.day_index, d]));

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <h1 style={{ color: '#FFDB00', margin: 0, fontSize: 18 }}>{comp.name}</h1>
        <span style={{ color: '#555', fontSize: 12 }}>#{comp.id} · {comp.season}</span>
        <span style={{ color: comp.is_active ? '#00FF87' : '#555', fontSize: 12 }}>
          {comp.is_active ? '● ACTIVE' : '○ INACTIVE'}
        </span>
      </div>

      <TabBar active={tab} />

      {/* ════════════════════════════════════════════════════════════════════════
          TAB — INFO
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === 'info' && (
        <>
          {/* Métadonnées */}
          <div style={card}>
            <h2 style={h2}>MÉTADONNÉES</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
              {([
                ['ID',        comp.id],
                ['League ID', comp.league_id],
                ['Saison',    comp.season],
                ['Début',     comp.start_date ?? '—'],
                ['Fin',       comp.end_date   ?? '—'],
                ['Équipes',   (teams as Team[])?.length ?? 0],
                ['Matches',   (matches as Match[])?.length ?? 0],
                ['Journées',  (days as Day[])?.length ?? 0],
              ] as [string, unknown][]).map(([label, val]) => (
                <div key={label}>
                  <div style={{ color: '#444', fontSize: 10, marginBottom: 3 }}>{label}</div>
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

          {/* État de jeu */}
          <div style={card}>
            <h2 style={h2}>ÉTAT DE JEU</h2>
            {gs ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
                {([
                  ['Jour courant', gs.current_day_index],
                  ['Phase',        gs.current_phase],
                  ['Avancement',   gs.advancing ? '🔒 En cours' : '✓ Libre'],
                  ['Champion',     gs.champion_id ?? '—'],
                  ['Éliminés',     Array.isArray(gs.eliminated) ? gs.eliminated.length : 0],
                ] as [string, unknown][]).map(([label, val]) => (
                  <div key={label}>
                    <div style={{ color: '#444', fontSize: 10, marginBottom: 3 }}>{label}</div>
                    <div style={{ color: '#fff', fontSize: 13 }}>{String(val)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: '#555', fontSize: 13 }}>Aucun état de jeu initialisé.</div>
            )}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          TAB — FORMAT (Groupes + Journées)
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === 'format' && (
        <>
          {/* Groupes */}
          <div style={card}>
            <h2 style={h2}>POULES</h2>
            {groupKeys.length === 0 ? (
              <div style={{ color: '#555', fontSize: 13 }}>
                Aucune équipe assignée à un groupe. Importe les équipes depuis l&apos;onglet Équipes.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
                {groupKeys.map(g => (
                  <div key={g} style={{ background: '#0d0d0d', border: '1px solid #222', padding: 14 }}>
                    <div style={{ color: '#FFDB00', fontSize: 11, fontWeight: 700, marginBottom: 10, letterSpacing: 1 }}>
                      {g === '—' ? 'SANS GROUPE' : `GROUPE ${g}`}
                    </div>
                    {teamsByGroup[g].map(t => (
                      <div key={t.team_id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 16 }}>{t.teams?.flag_emoji ?? ''}</span>
                        <span style={{ fontSize: 12, color: '#ccc' }}>{t.teams?.name ?? t.team_id}</span>
                        <span style={{ fontSize: 10, color: '#444', marginLeft: 'auto' }}>F{t.strength}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Journées / tours éliminatoires */}
          <div style={card}>
            <h2 style={h2}>JOURNÉES & TOURS ({(days as Day[])?.length ?? 0})</h2>
            {(!days || (days as Day[]).length === 0) ? (
              <div style={{ color: '#555', fontSize: 13, marginBottom: 16 }}>
                Aucune journée. Lance un Sync Fixtures depuis l&apos;onglet Info.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #222' }}>
                    {['Jour', 'Label complet', 'Court', 'Phase', 'Type', 'div_key', ''].map(h => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(days as Day[]).map(d => (
                    <tr key={d.day_index} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={{ ...td, color: '#FFDB00', fontWeight: 700 }}>{d.day_index}</td>
                      <td style={td}>{d.full_label}</td>
                      <td style={{ ...td, color: '#888' }}>{d.date_label}</td>
                      <td style={td}>{d.phase}</td>
                      <td style={{ ...td, color: d.is_ko ? '#FFDB00' : '#555' }}>
                        {d.is_ko ? 'KO' : 'Groupes'}
                      </td>
                      <td style={{ ...td, color: d.div_key ? '#00FF87' : '#444' }}>
                        {d.div_key ?? '—'}
                      </td>
                      <td style={td}>
                        <DayDeleteButton competitionId={id} dayIndex={d.day_index} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <DayAddForm competitionId={id} />
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          TAB — ÉQUIPES
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === 'teams' && (
        <div style={card}>
          <h2 style={h2}>ÉQUIPES ({(teams as Team[])?.length ?? 0})</h2>
          {(!teams || (teams as Team[]).length === 0) ? (
            <div style={{ color: '#555', fontSize: 13 }}>
              Aucune équipe. Lance un Import Teams depuis l&apos;onglet Info.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #222' }}>
                  {['', 'ID', 'Nom', 'Groupe', 'Force', 'Prix init.', 'Prix actuel', 'Δ%', ''].map(h => (
                    <th key={h} style={{ ...th, textAlign: h === '' ? 'center' : 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(teams as Team[]).map(t => {
                  const delta    = t.initial_price > 0
                    ? (((t.current_price - t.initial_price) / t.initial_price) * 100).toFixed(1)
                    : '0.0';
                  const deltaNum = parseFloat(delta);
                  return (
                    <tr key={t.team_id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={{ ...td, textAlign: 'center' }}>{t.teams?.flag_emoji ?? ''}</td>
                      <td style={{ ...td, fontWeight: 600, color: '#fff' }}>{t.team_id}</td>
                      <td style={td}>{t.teams?.name ?? '—'}</td>
                      <td style={{ ...td, color: t.group_code ? '#FFDB00' : '#444' }}>
                        {t.group_code ?? '—'}
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>{t.strength}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{t.initial_price} KC</td>
                      <td style={{ ...td, textAlign: 'center' }}>{t.current_price} KC</td>
                      <td style={{
                        ...td, textAlign: 'center',
                        color: deltaNum > 0 ? '#00FF87' : deltaNum < 0 ? '#ff4444' : '#555',
                      }}>
                        {deltaNum >= 0 ? '+' : ''}{delta}%
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
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
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          TAB — MATCHES
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === 'matches' && (
        <div>
          {(matches as Match[])?.length === 0 ? (
            <div style={{ ...card, color: '#555', fontSize: 13 }}>
              Aucun match. Lance un Sync Fixtures depuis l&apos;onglet Info.
            </div>
          ) : (
            dayKeys.map(dayIdx => {
              const day     = dayMap[dayIdx];
              const dayList = matchesByDay[dayIdx] ?? [];
              const done    = dayList.filter(m => m.processed_at).length;
              return (
                <div key={dayIdx} style={{ ...card }}>
                  <h2 style={{ ...h2, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span>JOUR {dayIdx}</span>
                    {day && (
                      <>
                        <span style={{ color: '#555', fontWeight: 400 }}>·</span>
                        <span style={{ color: '#888', fontWeight: 400 }}>{day.full_label}</span>
                        <span style={{
                          fontSize: 10, padding: '2px 8px',
                          background: day.is_ko ? '#1a1500' : '#0a1a0a',
                          border: `1px solid ${day.is_ko ? '#FFDB00' : '#00FF87'}`,
                          color:  day.is_ko ? '#FFDB00' : '#00FF87',
                        }}>
                          {day.phase}
                        </span>
                      </>
                    )}
                    <span style={{ marginLeft: 'auto', color: '#444', fontSize: 10, fontWeight: 400 }}>
                      {done}/{dayList.length} traités
                    </span>
                  </h2>

                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #222' }}>
                        {['ID', 'Équipes', 'Score', 'Date (Paris)', 'Statut', '✓', ''].map(h => (
                          <th key={h} style={th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dayList.map(m => (
                        <tr key={m.fixture_id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                          <td style={{ ...td, color: '#444' }}>{m.fixture_id}</td>
                          <td style={{ ...td, color: '#fff' }}>
                            {m.nation_a}
                            <span style={{ color: '#444', margin: '0 6px' }}>vs</span>
                            {m.nation_b}
                          </td>
                          <td style={{ ...td, fontWeight: 600, textAlign: 'center' }}>
                            {m.score_a !== null ? `${m.score_a}–${m.score_b}` : '—'}
                          </td>
                          <td style={{ ...td, color: '#888' }}>{fmtDate(m.scheduled_at)}</td>
                          <td style={{ ...td, color: m.api_status === 'FT' ? '#00FF87' : '#666' }}>
                            {m.api_status ?? '—'}
                          </td>
                          <td style={{ ...td, textAlign: 'center', color: m.processed_at ? '#00FF87' : '#333' }}>
                            {m.processed_at ? '✓' : '·'}
                          </td>
                          <td style={td}>
                            <MatchEditor
                              competitionId={id}
                              fixtureId={m.fixture_id}
                              scheduledAt={m.scheduled_at}
                              scoreA={m.score_a}
                              scoreB={m.score_b}
                              apiStatus={m.api_status}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
