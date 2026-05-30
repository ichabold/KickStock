/**
 * team-iso2.ts — Maps KickStock team IDs (FIFA alpha-3) to ISO 3166-1 alpha-2 codes.
 *
 * Used by the normalizer to generate flag emojis from team IDs when
 * the API-Football logo URL doesn't contain a flag path (e.g. /football/teams/22.png).
 *
 * Entries cover all teams in league_1.ts (WC2022 + WC2026 candidates).
 */

export const TEAM_ID_TO_ISO2: Record<string, string> = {
  // ── CONCACAF ────────────────────────────────────────────────────────────────
  USA: 'US', MEX: 'MX', CAN: 'CA', CRC: 'CR', PAN: 'PA',
  JAM: 'JM', HON: 'HN', TTO: 'TT', CUB: 'CU', GUA: 'GT',
  SLV: 'SV', HAI: 'HT', CUW: 'CW',

  // ── CONMEBOL ─────────────────────────────────────────────────────────────────
  BRA: 'BR', ARG: 'AR', URU: 'UY', COL: 'CO', ECU: 'EC',
  PAR: 'PY', CHI: 'CL', VEN: 'VE', BOL: 'BO', PER: 'PE',

  // ── UEFA ─────────────────────────────────────────────────────────────────────
  FRA: 'FR', ESP: 'ES', ENG: 'GB', GER: 'DE', POR: 'PT',
  NED: 'NL', BEL: 'BE', ITA: 'IT', CRO: 'HR', SUI: 'CH',
  AUT: 'AT', DEN: 'DK', TUR: 'TR', SCO: 'GB', SRB: 'RS',
  UKR: 'UA', WAL: 'GB', POL: 'PL', NOR: 'NO', HUN: 'HU',
  ROU: 'RO', SWE: 'SE', GRE: 'GR', SVK: 'SK', BIH: 'BA',
  KOS: 'XK', ISL: 'IS', CZE: 'CZ',

  // ── CAF ──────────────────────────────────────────────────────────────────────
  MAR: 'MA', SEN: 'SN', CIV: 'CI', EGY: 'EG', NGA: 'NG',
  GHA: 'GH', CMR: 'CM', MLI: 'ML', RSA: 'ZA', TUN: 'TN',
  ALG: 'DZ', COD: 'CD', ZAM: 'ZM', CPV: 'CV',

  // ── AFC ──────────────────────────────────────────────────────────────────────
  JPN: 'JP', KOR: 'KR', IRN: 'IR', KSA: 'SA', AUS: 'AU',
  QAT: 'QA', UZB: 'UZ', CHN: 'CN', IRQ: 'IQ', OMA: 'OM',
  BHR: 'BH', UAE: 'AE', JOR: 'JO', KWT: 'KW', VNM: 'VN',
  THA: 'TH', PHI: 'PH', IND: 'IN', IDN: 'ID',

  // ── OFC ──────────────────────────────────────────────────────────────────────
  NZL: 'NZ', NCL: 'NC', TAH: 'PF', SOL: 'SB', VAN: 'VU',
  FIJ: 'FJ', PNG: 'PG',
};

/** Returns the flag emoji for a KickStock team ID, or null if unknown. */
export function teamIdToFlagEmoji(teamId: string): string | null {
  const iso2 = TEAM_ID_TO_ISO2[teamId];
  if (!iso2) return null;
  return [...iso2.toUpperCase()].map(c =>
    String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)
  ).join('');
}
