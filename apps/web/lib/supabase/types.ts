// ── Auto-generated types from Supabase schema ─────────────────────────────
// Re-run `npx supabase gen types typescript` to refresh after schema changes.

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          country: string | null;
          tut_seen: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          username: string;
          country?: string | null;
          tut_seen?: boolean;
          created_at?: string;
        };
        Update: {
          username?: string;
          country?: string | null;
          tut_seen?: boolean;
        };
      };
      portfolios: {
        Row: {
          id: string;
          user_id: string;
          cash: number;
          best_score: number | null;
          day_index: number;
          div_paid: Json;
          eliminated: Json;
          r32_pool: Json;
          champion: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          cash?: number;
          best_score?: number | null;
          day_index?: number;
        };
        Update: {
          cash?: number;
          best_score?: number | null;
          day_index?: number;
          div_paid?: Json;
          eliminated?: Json;
          r32_pool?: Json;
          champion?: string | null;
        };
      };
      positions: {
        Row: {
          id: string;
          user_id: string;
          nation_id: string;
          quantity: number;
        };
        Insert: {
          user_id: string;
          nation_id: string;
          quantity: number;
        };
        Update: {
          quantity?: number;
        };
      };
      trades: {
        Row: {
          id: string;
          user_id: string;
          nation_id: string;
          mode: 'buy' | 'sell';
          quantity: number;
          price: number;
          tax: number;
          net_amount: number;
          day_index: number;
          created_at: string;
        };
        Insert: {
          user_id: string;
          nation_id: string;
          mode: 'buy' | 'sell';
          quantity: number;
          price: number;
          tax?: number;
          net_amount: number;
          day_index: number;
        };
        Update: never;
      };
      // ── Phase 3 tables ──────────────────────────────────────────────────────
      competitions: {
        Row: {
          id: string;
          code: string;
          name: string;
          status: 'waiting' | 'active' | 'finished';
          mode: 'manual' | 'realtime';
          day_index: number;
          prices: Json;
          eliminated: string[];
          match_results: Json;
          champion: string | null;
          r32_pool: string[];
          r16_pool: string[];
          qf_pool: string[];
          sf_pool: string[];
          final_pool: string[];
          third_pool: string[];
          advancing_lock: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          name: string;
          status?: 'waiting' | 'active' | 'finished';
          mode?: 'manual' | 'realtime';
        };
        Update: {
          status?: 'waiting' | 'active' | 'finished';
          day_index?: number;
          prices?: Json;
          eliminated?: string[];
          match_results?: Json;
          champion?: string | null;
          r32_pool?: string[];
          r16_pool?: string[];
          qf_pool?: string[];
          sf_pool?: string[];
          final_pool?: string[];
          third_pool?: string[];
          advancing_lock?: boolean;
          updated_at?: string;
        };
      };
      competition_players: {
        Row: {
          id: string;
          competition_id: string;
          user_id: string;
          cash: number;
          portfolio: Json;
          avg_cost: Json;
          best_score: number | null;
          joined_at: string;
        };
        Insert: {
          competition_id: string;
          user_id: string;
          cash?: number;
        };
        Update: {
          cash?: number;
          portfolio?: Json;
          avg_cost?: Json;
          best_score?: number | null;
        };
      };
      competition_trades: {
        Row: {
          id: string;
          competition_id: string;
          user_id: string;
          nation_id: string;
          mode: 'buy' | 'sell';
          quantity: number;
          price: number;
          tax: number;
          net_amount: number;
          day_index: number;
          created_at: string;
        };
        Insert: {
          competition_id: string;
          user_id: string;
          nation_id: string;
          mode: 'buy' | 'sell';
          quantity: number;
          price: number;
          tax?: number;
          net_amount: number;
          day_index: number;
        };
        Update: never;
      };
    };
    Views: {
      leaderboard: {
        Row: {
          id: string;
          username: string;
          country: string | null;
          best_score: number | null;
          updated_at: string;
        };
      };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
