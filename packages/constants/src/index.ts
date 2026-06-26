// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
export const TOKENS = {
  bg:       '#0A0A0A',
  s1:       '#111111',
  s2:       '#181818',
  text:     '#FFFFFF',
  muted:    '#888888',
  dim:      '#444444',
  ghost:    '#1A1A1A',
  border:   '#1E1E1E',
  borderHi: '#2E2E2E',
  gold:     '#FFDB00',
  goldDk:   '#B89800',
  gain:     '#00FF87',
  gainBg:   'rgba(0,255,135,0.07)',
  gainDk:   '#00662F',
  loss:     '#FF3B5C',
  lossBg:   'rgba(255,59,92,0.08)',
  lossDk:   '#7A1B2C',
  upset:    '#FF8800',
} as const;

export const MOBILE_BREAKPOINT = 600; // px

export const DIV_RATES: Record<string, number> = {
  r32: 0.10, r16: 0.15, qf: 0.20, sf: 0.30, '3rd': 0.25, champion: 0.50,
};

export const INIT_CASH = 10_000;
