-- 029_backfill_div_key.sql
-- Backfill existing competition_days rows created before the dividend
-- rework (see 028): Final no longer pays a dividend on its own, and the
-- 3rd-place match now pays the 'champion'-adjacent '3rd' bonus (25%).

UPDATE competition_days SET div_key = NULL  WHERE phase = 'Final';
UPDATE competition_days SET div_key = '3rd' WHERE phase = '3rd';
