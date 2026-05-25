-- KickStock · Seed 001 · Initial game data
-- Run AFTER all migrations (001–005).

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. GROUPS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSERT INTO groups (code, name) VALUES
  ('A','Groupe A'),('B','Groupe B'),('C','Groupe C'),('D','Groupe D'),
  ('E','Groupe E'),('F','Groupe F'),('G','Groupe G'),('H','Groupe H'),
  ('I','Groupe I'),('J','Groupe J'),('K','Groupe K'),('L','Groupe L')
ON CONFLICT (code) DO NOTHING;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. NATIONS — update existing rows (already inserted by seed.sql)
--    Sets current_price = initial_price and group_code = grp letter
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UPDATE nations SET
  current_price = initial_price,
  group_code    = grp
WHERE current_price IS NULL OR group_code IS NULL;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. GAME_STATE singleton
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSERT INTO game_state (id, current_day_index, current_phase)
VALUES (1, 0, 'Groups')
ON CONFLICT (id) DO NOTHING;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. NATION_PRICES — initial prices at day 0 (triggers will set current_price)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSERT INTO nation_prices (nation_id, price, day_index)
SELECT id, initial_price, 0 FROM nations
ON CONFLICT (nation_id, day_index) DO NOTHING;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. MATCHES — 72 group-stage matches (KO matches added dynamically by API)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSERT INTO matches (id, day_index, nation_a, nation_b, venue, phase) VALUES
-- Day 0 · Jun 11
('m_0_0',  0, 'MEX','RSA','Azteca, Mexico City','Groups'),
('m_0_1',  0, 'KOR','CZE','Akron, Guadalajara','Groups'),
-- Day 1 · Jun 12
('m_1_0',  1, 'CAN','BIH','BMO Field, Toronto','Groups'),
('m_1_1',  1, 'USA','PAR','SoFi Stadium, LA','Groups'),
-- Day 2 · Jun 13
('m_2_0',  2, 'QAT','SUI','Levi''s, Santa Clara','Groups'),
('m_2_1',  2, 'BRA','MAR','MetLife, New York','Groups'),
('m_2_2',  2, 'HAI','SCO','Gillette, Boston','Groups'),
-- Day 3 · Jun 14
('m_3_0',  3, 'AUS','TUR','BC Place, Vancouver','Groups'),
('m_3_1',  3, 'GER','CUW','NRG, Houston','Groups'),
('m_3_2',  3, 'NED','JPN','AT&T, Dallas','Groups'),
('m_3_3',  3, 'CIV','ECU','Lincoln, Phila.','Groups'),
('m_3_4',  3, 'SWE','TUN','BBVA, Monterrey','Groups'),
-- Day 4 · Jun 15
('m_4_0',  4, 'ESP','CPV','Benz, Atlanta','Groups'),
('m_4_1',  4, 'BEL','EGY','Lumen, Seattle','Groups'),
('m_4_2',  4, 'KSA','URU','Hard Rock, Miami','Groups'),
('m_4_3',  4, 'IRN','NZL','SoFi, LA','Groups'),
-- Day 5 · Jun 16
('m_5_0',  5, 'FRA','SEN','MetLife, New York','Groups'),
('m_5_1',  5, 'IRQ','NOR','Gillette, Boston','Groups'),
('m_5_2',  5, 'ARG','ALG','Arrowhead, KC','Groups'),
-- Day 6 · Jun 17
('m_6_0',  6, 'AUT','JOR','Levi''s, Santa Clara','Groups'),
('m_6_1',  6, 'POR','COD','NRG, Houston','Groups'),
('m_6_2',  6, 'ENG','CRO','AT&T, Dallas','Groups'),
('m_6_3',  6, 'GHA','PAN','BMO, Toronto','Groups'),
('m_6_4',  6, 'UZB','COL','Azteca, Mexico City','Groups'),
-- Day 7 · Jun 18
('m_7_0',  7, 'CZE','RSA','Benz, Atlanta','Groups'),
('m_7_1',  7, 'SUI','BIH','SoFi, LA','Groups'),
('m_7_2',  7, 'CAN','QAT','BC Place, Vancouver','Groups'),
('m_7_3',  7, 'MEX','KOR','Akron, Guadalajara','Groups'),
-- Day 8 · Jun 19
('m_8_0',  8, 'USA','AUS','Lumen, Seattle','Groups'),
('m_8_1',  8, 'SCO','MAR','Gillette, Boston','Groups'),
('m_8_2',  8, 'BRA','HAI','Lincoln, Phila.','Groups'),
('m_8_3',  8, 'TUR','PAR','Levi''s, Santa Clara','Groups'),
-- Day 9 · Jun 20
('m_9_0',  9, 'NED','SWE','NRG, Houston','Groups'),
('m_9_1',  9, 'GER','CIV','BMO, Toronto','Groups'),
('m_9_2',  9, 'ECU','CUW','Arrowhead, KC','Groups'),
-- Day 10 · Jun 21
('m_10_0',10, 'TUN','JPN','BBVA, Monterrey','Groups'),
('m_10_1',10, 'ESP','KSA','Benz, Atlanta','Groups'),
('m_10_2',10, 'BEL','IRN','SoFi, LA','Groups'),
('m_10_3',10, 'URU','CPV','Hard Rock, Miami','Groups'),
('m_10_4',10, 'NZL','EGY','BC Place, Vancouver','Groups'),
-- Day 11 · Jun 22
('m_11_0',11, 'ARG','AUT','AT&T, Dallas','Groups'),
('m_11_1',11, 'FRA','IRQ','Lincoln, Phila.','Groups'),
('m_11_2',11, 'NOR','SEN','MetLife, New York','Groups'),
('m_11_3',11, 'JOR','ALG','Levi''s, Santa Clara','Groups'),
-- Day 12 · Jun 23
('m_12_0',12, 'POR','UZB','NRG, Houston','Groups'),
('m_12_1',12, 'ENG','GHA','Gillette, Boston','Groups'),
('m_12_2',12, 'PAN','CRO','BMO, Toronto','Groups'),
('m_12_3',12, 'COL','COD','Akron, Guadalajara','Groups'),
-- Day 13 · Jun 24 🔥 (simultaneous group deciders)
('m_13_0',13, 'SUI','CAN','BC Place','Groups'),
('m_13_1',13, 'BIH','QAT','Lumen','Groups'),
('m_13_2',13, 'SCO','BRA','Hard Rock','Groups'),
('m_13_3',13, 'MAR','HAI','Benz','Groups'),
('m_13_4',13, 'CZE','MEX','Azteca','Groups'),
('m_13_5',13, 'RSA','KOR','BBVA','Groups'),
-- Day 14 · Jun 25 🔥
('m_14_0',14, 'CUW','CIV','Lincoln','Groups'),
('m_14_1',14, 'ECU','GER','MetLife','Groups'),
('m_14_2',14, 'JPN','SWE','AT&T','Groups'),
('m_14_3',14, 'TUN','NED','Arrowhead','Groups'),
('m_14_4',14, 'TUR','USA','SoFi','Groups'),
('m_14_5',14, 'PAR','AUS','Levi''s','Groups'),
-- Day 15 · Jun 26 🔥
('m_15_0',15, 'NOR','FRA','Gillette','Groups'),
('m_15_1',15, 'SEN','IRQ','BMO','Groups'),
('m_15_2',15, 'CPV','KSA','NRG','Groups'),
('m_15_3',15, 'URU','ESP','Akron','Groups'),
('m_15_4',15, 'EGY','IRN','Lumen','Groups'),
('m_15_5',15, 'NZL','BEL','BC Place','Groups'),
-- Day 16 · Jun 27 🔥
('m_16_0',16, 'PAN','ENG','MetLife','Groups'),
('m_16_1',16, 'CRO','GHA','Lincoln','Groups'),
('m_16_2',16, 'COL','POR','Hard Rock','Groups'),
('m_16_3',16, 'COD','UZB','Benz','Groups'),
('m_16_4',16, 'ALG','AUT','Arrowhead','Groups'),
('m_16_5',16, 'JOR','ARG','AT&T','Groups')
ON CONFLICT (id) DO NOTHING;
