// ─── NATION ───────────────────────────────────────────────────────────────────
export interface Nation {
  id: string;
  name: string;
  flag: string;
  p: number;       // initial price in KC
  conf: string;    // confederation
  str: number;     // FIFA strength 0-100
  group: string;   // group letter A-L
}

// ─── MATCH ────────────────────────────────────────────────────────────────────
export interface Match {
  a: string;
  b: string;
  venue?: string;
}

export type MatchResult = 'A' | 'B' | 'draw';
export type KnockoutResult = 'A' | 'B';

export interface SimulatedMatch {
  res: KnockoutResult | 'draw';
  res90: MatchResult;
  isUpset: boolean;
  etRes: KnockoutResult | null;
  penWinner: KnockoutResult | null;
  penA: number;
  penB: number;
}

export interface Goal {
  team: 'A' | 'B';
  name: string;
  min: number;
}

// Result stored in state after a match is played
export interface StoredMatchResult {
  a: string;
  b: string;
  scoreA: number;
  scoreB: number;
  res: MatchResult;
  res90: MatchResult;
  isUpset: boolean;
  pA: number;
  pB: number;
  newPA: number;
  newPB: number;
  elimId: string | null;
  winnerId: string | null;
  loserId: string | null;
  venue?: string;
  goals: Goal[];
  etRes: KnockoutResult | null;
  penWinner: KnockoutResult | null;
  penA: number;
  penB: number;
  divCash: number;
  phase: string;
}

// ─── CALENDAR ─────────────────────────────────────────────────────────────────
export type Phase = 'Groups' | 'R32' | 'R16' | 'QF' | 'SF' | '3rd' | 'Final';

export interface CalendarDay {
  date: string;
  label: string;
  phase: Phase;
  isKO: boolean;
  divKey: string | null;
  dynamic?: string;
  matches: Match[];
}

// ─── TRANSACTION LOG ──────────────────────────────────────────────────────────
export interface TxEntry {
  dir: 'buy' | 'sell';
  flag: string;
  name: string;
  qty: number;
  price: number;
  day: number;
}

// ─── GAME STATE ───────────────────────────────────────────────────────────────
export interface Portfolio {
  [nationId: string]: number; // quantity held
}

export interface PriceHistory {
  [nationId: string]: number[];
}

export type NationFlash = { [nationId: string]: 'fu' | 'fd' | '' };

export interface GameState {
  cash: number;
  portfolio: Portfolio;
  avgCost: { [nationId: string]: number };
  prices: { [nationId: string]: number };
  priceHistory: PriceHistory;
  dayIndex: number;
  eliminated: string[];
  champion: string | null;
  matchResults: { [dayIndex: number]: StoredMatchResult[] };
  r32Pool: string[];
  r16Pool: string[];
  qfPool: string[];
  sfPool: string[];
  finalPool: string[];
  thirdPool: string[];
  txLog: TxEntry[];
  bestScore: number | null;
}

// ─── TRADE ────────────────────────────────────────────────────────────────────
export type TradeMode = 'buy' | 'sell';

export interface TradePayload {
  mode: TradeMode;
  nationId: string;
  quantity: number;
}

// ─── UI ───────────────────────────────────────────────────────────────────────
export type LayoutType = 'mobile' | 'browser';
export type TabId = 'schedule' | 'standings' | 'simulate' | 'market' | 'portfolio';
export type SortBy = 'default' | 'price_asc' | 'price_desc' | 'change' | 'held';
