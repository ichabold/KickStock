-- 011_fix_matches_fk.sql
--
-- matches.nation_a / nation_b referenced nations(id) (legacy hardcoded table).
-- Since API integration (010), the source of truth is teams(id).
-- Denmark, Tunisia and other WC2022 teams don't exist in nations → FK violation.
--
-- This migration replaces both FKs to reference teams(id) instead.

-- Drop legacy FKs that referenced nations(id) (old offline engine table).
-- Existing offline simulation rows in matches reference WC2026 nation IDs (AUT, etc.)
-- which don't exist in the new teams table → can't add FK to teams(id) without NOT VALID.
-- Application-level integrity is guaranteed: sync-fixtures upserts teams before RPC.
ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_nation_a_fkey,
  DROP CONSTRAINT IF EXISTS matches_nation_b_fkey;
