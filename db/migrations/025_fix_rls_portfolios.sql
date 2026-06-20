-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 025: Fix CRITIQUE-2 — portfolios_select_device exposes all guest portfolios.
--
-- The original policy (migration 005) allowed SELECT on any portfolio row
-- where device_id IS NOT NULL, meaning every anonymous portfolio was readable
-- by anyone who sent a Supabase anon request.
--
-- Fix: drop the overly-broad policy and replace it with one that only allows
-- a row if auth.uid() matches user_id (authenticated users see their own row)
-- OR the request comes from a service-role/SECURITY DEFINER context (RPCs).
-- Guest reads always go through SECURITY DEFINER RPCs — they never need direct
-- table access via the anon key.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DROP POLICY IF EXISTS "portfolios_select_device" ON portfolios;

-- portfolios_select_own already exists from migration 002; this migration only
-- removes the insecure device-based fallback. No new policy needed.
