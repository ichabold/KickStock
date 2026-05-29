/**
 * league_1.ts — API-Football name → KickStock team ID mapping for FIFA World Cup.
 *
 * league_id = 1 (FIFA World Cup, any season)
 *
 * Key   = exact team name returned by API-Football (fixture.teams.home/away.name)
 * Value = KickStock team ID (3-letter uppercase, FIFA alpha-3 standard where possible)
 *
 * How to validate before launch:
 *   pnpm tsx scripts/validate-team-mapping.ts --league=1 --season=2026
 *
 * This file covers the 48 qualified teams for 2026 based on the current draw.
 * It also includes 2022 team names so the pipeline can be tested on past data.
 */

export const LEAGUE_1_MAPPING: Record<string, string> = {

  // ── CONCACAF (8 teams) ─────────────────────────────────────────────────────
  'United States':          'USA',
  'Mexico':                 'MEX',
  'Canada':                 'CAN',
  'Costa Rica':             'CRC',
  'Panama':                 'PAN',
  'Jamaica':                'JAM',
  'Honduras':               'HON',
  'Trinidad and Tobago':    'TTO',

  // ── CONMEBOL (6 teams) ────────────────────────────────────────────────────
  'Brazil':                 'BRA',
  'Argentina':              'ARG',
  'Uruguay':                'URU',
  'Colombia':               'COL',
  'Ecuador':                'ECU',
  'Paraguay':               'PAR',

  // ── UEFA (16 teams) ───────────────────────────────────────────────────────
  'France':                 'FRA',
  'Spain':                  'ESP',
  'England':                'ENG',
  'Germany':                'GER',
  'Portugal':               'POR',
  'Netherlands':            'NED',
  'Belgium':                'BEL',
  'Italy':                  'ITA',
  'Croatia':                'CRO',
  'Switzerland':            'SUI',
  'Austria':                'AUT',
  'Denmark':                'DEN',
  'Turkey':                 'TUR',
  'Scotland':               'SCO',
  'Serbia':                 'SRB',
  'Ukraine':                'UKR',

  // ── CAF (9 teams) ─────────────────────────────────────────────────────────
  'Morocco':                'MAR',
  'Senegal':                'SEN',
  "Ivory Coast":            'CIV',
  "Côte d'Ivoire":          'CIV',    // alternate name
  'Egypt':                  'EGY',
  'Nigeria':                'NGA',
  'Ghana':                  'GHA',
  'Cameroon':               'CMR',
  'Mali':                   'MLI',
  'South Africa':           'RSA',

  // ── AFC (8 teams) ─────────────────────────────────────────────────────────
  'Japan':                  'JPN',
  'South Korea':            'KOR',
  'Korea Republic':         'KOR',    // alternate (API-Football uses this)
  'Iran':                   'IRN',
  'IR Iran':                'IRN',    // alternate (API-Football uses this)
  'Saudi Arabia':           'KSA',
  'Australia':              'AUS',
  'Qatar':                  'QAT',
  'Uzbekistan':             'UZB',

  // ── OFC (1 team) ──────────────────────────────────────────────────────────
  'New Zealand':            'NZL',

  // ── Playoff teams (to be confirmed) ───────────────────────────────────────
  'Indonesia':              'IDN',
  'Chile':                  'CHI',
  'Venezuela':              'VEN',
  'Bolivia':                'BOL',
  'Peru':                   'PER',
  'Tunisia':                'TUN',
  'Algeria':                'ALG',
  'DR Congo':               'COD',
  'Zambia':                 'ZAM',
  'Cape Verde':             'CPV',
  'Czechia':                'CZE',
  'Czech Republic':         'CZE',   // alternate
  'Poland':                 'POL',
  'Norway':                 'NOR',
  'Hungary':                'HUN',
  'Romania':                'ROU',
  'Sweden':                 'SWE',
  'Greece':                 'GRE',
  'Slovakia':               'SVK',
  'Bosnia':                 'BIH',
  'Bosnia and Herzegovina': 'BIH',   // alternate
  'Kosovo':                 'KOS',
  'Iceland':                'ISL',
  'China':                  'CHN',
  'Iraq':                   'IRQ',
  'Oman':                   'OMA',
  'Bahrain':                'BHR',
  'United Arab Emirates':   'UAE',
  'Jordan':                 'JOR',
  'Kuwait':                 'KWT',
  'Cuba':                   'CUB',
  'Guatemala':              'GUA',
  'El Salvador':            'SLV',
  'Haiti':                  'HAI',
  'Curaçao':                'CUW',
  'Curacao':                'CUW',   // alternate (no accent)
  'New Caledonia':          'NCL',
  'Tahiti':                 'TAH',
  'Solomon Islands':        'SOL',
  'Vanuatu':                'VAN',
  'Fiji':                   'FIJ',
  'Papua New Guinea':       'PNG',
  'Vietnam':                'VNM',
  'Thailand':               'THA',
  'Philippines':            'PHI',
  'India':                  'IND',
};
