// ── Auto-generated types from Supabase schema ─────────────────────────────
// Re-run `npx supabase gen types typescript` to refresh after schema changes.

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      // ── Phase 1 / Auth tables ─────────────────────────────────────────────
      profiles: {
        Row: {
          id: string;
          username: string;
          country: string | null;
          tut_seen: boolean;
          created_at: string;
        };
        Insert: { id: string; username: string; country?: string | null; tut_seen?: boolean; };
        Update: { username?: string; country?: string | null; tut_seen?: boolean; };
      };
      portfolios: {
        Row: {
          id: string;
          user_id: string | null;
          device_id: string | null;
          cash: number;
          best_score: number | null;
          day_index: number;
          div_paid: Json;
          eliminated: Json;
          r32_pool: Json;
          champion: string | null;
          avg_cost: Json;
          tx_log: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string | null;
          device_id?: string | null;
          cash?: number;
          best_score?: number | null;
          avg_cost?: Json;
          tx_log?: Json;
        };
        Update: {
          cash?: number;
          best_score?: number | null;
          avg_cost?: Json;
          tx_log?: Json;
          updated_at?: string;
        };
      };
      positions: {
        Row: { id: string; user_id: string; nation_id: string; quantity: number; };
        Insert: { user_id: string; nation_id: string; quantity: number; };
        Update: { quantity?: number; };
      };
      trades: {
        Row: {
          id: string; user_id: string; nation_id: string; mode: 'buy' | 'sell';
          quantity: number; price: number; tax: number; net_amount: number;
          day_index: number; created_at: string;
        };
        Insert: {
          user_id: string; nation_id: string; mode: 'buy' | 'sell';
          quantity: number; price: number; tax?: number; net_amount: number; day_index: number;
        };
        Update: never;
      };
      // ── Reference / Game tables ───────────────────────────────────────────
      groups: {
        Row: { code: string; name: string; };
        Insert: { code: string; name: string; };
        Update: { name?: string; };
      };
      nations: {
        Row: {
          id: string; name: string; flag: string;
          initial_price: number; current_price: number | null;
          conf: string; str: number; grp: string;
          group_code: string | null;
        };
        Insert: {
          id: string; name: string; flag: string;
          initial_price: number; conf: string; str: number; grp: string;
          current_price?: number | null; group_code?: string | null;
        };
        Update: { current_price?: number | null; group_code?: string | null; };
      };
      price_history: {
        Row: { id: string; nation_id: string; price: number; day_index: number; recorded_at: string; };
        Insert: { nation_id: string; price: number; day_index: number; };
        Update: never;
      };
      // ── Centralized engine tables (migration 005) ─────────────────────────
      game_state: {
        Row: {
          id: number;
          current_day_index: number;
          current_phase: string;
          champion_id: string | null;
          advancing: boolean;
          eliminated: string[];
          r32_pool: string[];
          r16_pool: string[];
          qf_pool: string[];
          sf_pool: string[];
          final_pool: string[];
          third_pool: string[];
          updated_at: string;
        };
        Insert: {
          id: number;
          current_day_index?: number;
          current_phase?: string;
          champion_id?: string | null;
          advancing?: boolean;
          eliminated?: string[];
          r32_pool?: string[];
          r16_pool?: string[];
          qf_pool?: string[];
          sf_pool?: string[];
          final_pool?: string[];
          third_pool?: string[];
        };
        Update: {
          current_day_index?: number;
          current_phase?: string;
          champion_id?: string | null;
          advancing?: boolean;
          eliminated?: string[];
          r32_pool?: string[];
          r16_pool?: string[];
          qf_pool?: string[];
          sf_pool?: string[];
          final_pool?: string[];
          third_pool?: string[];
          updated_at?: string;
        };
      };
      nation_prices: {
        Row: {
          id: number; nation_id: string; price: number;
          day_index: number; effective_at: string;
        };
        Insert: { nation_id: string; price: number; day_index: number; effective_at?: string; };
        Update: { price?: number; };
      };
      group_standings: {
        Row: {
          id: number; group_code: string; nation_id: string;
          mp: number; w: number; d: number; l: number;
          gf: number; ga: number; pts: number; day_index: number;
        };
        Insert: {
          group_code: string; nation_id: string; day_index: number;
          mp?: number; w?: number; d?: number; l?: number;
          gf?: number; ga?: number; pts?: number;
        };
        Update: {
          mp?: number; w?: number; d?: number; l?: number;
          gf?: number; ga?: number; pts?: number;
        };
      };
      knockout_pools: {
        Row: { id: number; round: string; nation_id: string; position: number; day_index: number; };
        Insert: { round: string; nation_id: string; position: number; day_index: number; };
        Update: never;
      };
      matches: {
        Row: {
          id: string; day_index: number;
          nation_a: string; nation_b: string; venue: string | null;
          phase: string; score_a: number | null; score_b: number | null;
          winner_id: string | null; is_upset: boolean;
          played_at: string | null; result_data: Json | null;
        };
        Insert: {
          id: string; day_index: number; nation_a: string; nation_b: string;
          venue?: string | null; phase: string;
          score_a?: number | null; score_b?: number | null;
          winner_id?: string | null; is_upset?: boolean;
          played_at?: string | null; result_data?: Json | null;
        };
        Update: {
          score_a?: number | null; score_b?: number | null;
          winner_id?: string | null; is_upset?: boolean;
          played_at?: string | null; result_data?: Json | null;
        };
      };
      holdings: {
        Row: {
          id: string; portfolio_id: string; nation_id: string;
          quantity: number; updated_at: string;
        };
        Insert: { portfolio_id: string; nation_id: string; quantity?: number; };
        Update: { quantity?: number; updated_at?: string; };
      };
      holdings_history: {
        Row: {
          id: number; holdings_id: string;
          quantity_before: number; quantity_after: number; delta: number;
          reason: string; created_at: string;
        };
        Insert: {
          holdings_id: string; quantity_before: number; quantity_after: number;
          delta: number; reason: string;
        };
        Update: never;
      };
      transactions: {
        Row: {
          id: string; portfolio_id: string; nation_id: string;
          type: 'buy' | 'sell'; quantity: number; price: number;
          fee: number; total: number; day_index: number; created_at: string;
        };
        Insert: {
          portfolio_id: string; nation_id: string; type: 'buy' | 'sell';
          quantity: number; price: number; fee?: number; total: number; day_index: number;
        };
        Update: never;
      };
      dividends: {
        Row: {
          id: string; portfolio_id: string; nation_id: string;
          round: string; amount: number; shares: number; day_index: number; created_at: string;
        };
        Insert: {
          portfolio_id: string; nation_id: string; round: string;
          amount: number; shares: number; day_index: number;
        };
        Update: { amount?: number; };
      };
      // ── Phase 3 competition tables (migration 004) ─────────────────────────
      competitions: {
        Row: {
          id: string; code: string; name: string;
          status: 'waiting' | 'active' | 'finished';
          mode: 'manual' | 'realtime'; is_official: boolean | null;
          day_index: number; prices: Json; eliminated: string[];
          match_results: Json; champion: string | null;
          r32_pool: string[]; r16_pool: string[];
          qf_pool: string[]; sf_pool: string[];
          final_pool: string[]; third_pool: string[];
          advancing_lock: boolean; created_by: string | null;
          created_at: string; updated_at: string;
        };
        Insert: { code: string; name: string; status?: 'waiting' | 'active' | 'finished'; mode?: 'manual' | 'realtime'; };
        Update: {
          status?: 'waiting' | 'active' | 'finished'; day_index?: number; prices?: Json;
          eliminated?: string[]; match_results?: Json; champion?: string | null;
          r32_pool?: string[]; r16_pool?: string[]; qf_pool?: string[];
          sf_pool?: string[]; final_pool?: string[]; third_pool?: string[];
          advancing_lock?: boolean; updated_at?: string;
        };
      };
      competition_players: {
        Row: {
          id: string; competition_id: string; user_id: string;
          cash: number; portfolio: Json; avg_cost: Json;
          best_score: number | null; joined_at: string;
        };
        Insert: { competition_id: string; user_id: string; cash?: number; };
        Update: { cash?: number; portfolio?: Json; avg_cost?: Json; best_score?: number | null; };
      };
      competition_trades: {
        Row: {
          id: string; competition_id: string; user_id: string;
          nation_id: string; mode: 'buy' | 'sell'; quantity: number;
          price: number; tax: number; net_amount: number; day_index: number; created_at: string;
        };
        Insert: {
          competition_id: string; user_id: string; nation_id: string;
          mode: 'buy' | 'sell'; quantity: number; price: number;
          tax?: number; net_amount: number; day_index: number;
        };
        Update: never;
      };
    };
    Views: {
      leaderboard: {
        Row: {
          id: string; username: string; country: string | null;
          best_score: number | null; updated_at: string;
        };
      };
      competition_leaderboard: {
        Row: {
          competition_id: string; user_id: string; username: string;
          country: string | null; cash: number; portfolio: Json;
          best_score: number | null; joined_at: string; total_value: number;
        };
      };
    };
    Functions: {
      get_or_create_portfolio: {
        Args: { p_device_id: string | null; p_user_id?: string | null };
        Returns: string;
      };
      execute_trade: {
        Args: {
          p_device_id: string | null;
          p_nation_id: string;
          p_mode: string;
          p_quantity: number;
          p_user_id?: string | null;
        };
        Returns: Json;
      };
      distribute_dividends: {
        Args: {
          p_nation_id: string;
          p_round: string;
          p_rate: number;
          p_price: number;
          p_day_index: number;
        };
        Returns: number;
      };
      liquidate_eliminated: {
        Args: { p_nation_id: string; p_day_index: number };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
  };
}
