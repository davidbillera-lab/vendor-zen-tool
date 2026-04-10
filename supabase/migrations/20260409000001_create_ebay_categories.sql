-- ebay_categories: full eBay category tree cache
-- Populated by sync-ebay-categories edge function (eBay Taxonomy API)
-- Used by suggest-ebay-category for local FTS matching + as reference for generate-listing

CREATE TABLE IF NOT EXISTS ebay_categories (
  id          TEXT PRIMARY KEY,          -- eBay category ID (e.g. "177005")
  name        TEXT NOT NULL,             -- "Kitchen & Steak Knives"
  parent_id   TEXT,                      -- parent category ID (null for root)
  path        TEXT,                      -- breadcrumb: "Home & Garden > Kitchen > Knives"
  level       INTEGER,                   -- depth (1 = top-level)
  is_leaf     BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Fast leaf-category lookup
CREATE INDEX IF NOT EXISTS idx_ebay_categories_leaf
  ON ebay_categories(is_leaf) WHERE is_leaf = TRUE;

-- Full-text search across name + full path (enables substring matching)
CREATE INDEX IF NOT EXISTS idx_ebay_categories_fts
  ON ebay_categories
  USING gin(to_tsvector('english', name || ' ' || COALESCE(path, '')));

-- Exact name search (case-insensitive prefix)
CREATE INDEX IF NOT EXISTS idx_ebay_categories_name_lower
  ON ebay_categories(lower(name));

-- ── Seed with all known-good JSG leaf categories ─────────────────────────────
-- These are verified against live eBay listings. Update via sync-ebay-categories
-- for the full tree. This seed ensures the table is useful immediately.

INSERT INTO ebay_categories (id, name, parent_id, path, level, is_leaf) VALUES
  -- Knives & cutlery
  ('177005', 'Kitchen & Steak Knives',           '20637', 'Home & Garden > Kitchen, Dining & Bar > Flatware, Knives & Cutlery > Kitchen & Steak Knives', 4, TRUE),
  ('20637',  'Flatware, Knives & Cutlery',        '20625', 'Home & Garden > Kitchen, Dining & Bar > Flatware, Knives & Cutlery', 3, FALSE),
  ('20625',  'Kitchen, Dining & Bar',             '11700', 'Home & Garden > Kitchen, Dining & Bar', 2, FALSE),
  ('11700',  'Home & Garden',                     NULL,    'Home & Garden', 1, FALSE),
  -- Model kits
  ('31787',  'Military & Aircraft Model Kits',    '51028', 'Toys & Hobbies > Models & Kits > Military & Aircraft Model Kits', 3, TRUE),
  ('37278',  'Ship/Boat Model Kits',              '51028', 'Toys & Hobbies > Models & Kits > Ship/Boat Model Kits', 3, TRUE),
  ('51023',  'Car/Truck Model Kits',              '51028', 'Toys & Hobbies > Models & Kits > Car/Truck Model Kits', 3, TRUE),
  ('19063',  'Figure Model Kits',                 '51028', 'Toys & Hobbies > Models & Kits > Figure Model Kits', 3, TRUE),
  ('51028',  'Models & Kits',                     '1188',  'Toys & Hobbies > Models & Kits', 2, FALSE),
  ('1188',   'Toys & Hobbies',                    NULL,    'Toys & Hobbies', 1, FALSE),
  -- Model trains
  ('262318', 'HO Scale Model Trains',             '180232','Toys & Hobbies > Model Trains > HO Scale', 3, TRUE),
  ('47006',  'N Scale Model Trains',              '180232','Toys & Hobbies > Model Trains > N Scale', 3, TRUE),
  ('47004',  'O Scale Model Trains',              '180232','Toys & Hobbies > Model Trains > O Scale', 3, TRUE),
  ('47002',  'G Scale Model Trains',              '180232','Toys & Hobbies > Model Trains > G Scale', 3, TRUE),
  ('4748',   'Model Train Accessories',           '180232','Toys & Hobbies > Model Trains > Accessories', 3, TRUE),
  -- Bedding
  ('20668',  'Blankets & Throws',                 '20601', 'Home & Garden > Bedding > Blankets & Throws', 3, TRUE),
  ('133704', 'Throws',                            '20601', 'Home & Garden > Bedding > Throws', 3, TRUE),
  ('20677',  'Bed Pillows',                       '20601', 'Home & Garden > Bedding > Bed Pillows', 3, TRUE),
  ('20672',  'Comforters & Sets',                 '20601', 'Home & Garden > Bedding > Comforters & Sets', 3, TRUE),
  ('20675',  'Sheet Sets',                        '20601', 'Home & Garden > Bedding > Sheet Sets', 3, TRUE),
  -- Cameras
  ('11724',  'Camcorders & Video Cameras',        '625',   'Cameras & Photo > Camcorders & Video Cameras', 2, TRUE),
  ('15230',  'Vintage Cameras',                   '625',   'Cameras & Photo > Vintage Cameras', 2, TRUE),
  ('31388',  'Digital Cameras',                   '625',   'Cameras & Photo > Digital Cameras', 2, TRUE),
  ('30106',  'Camera Lenses',                     '625',   'Cameras & Photo > Camera Lenses', 2, TRUE),
  -- Jewelry & watches
  ('31387',  'Wristwatches',                      '281',   'Jewelry & Watches > Watches, Parts & Accessories > Wristwatches', 3, TRUE),
  ('67681',  'Fine Rings',                        '281',   'Jewelry & Watches > Fine Jewelry > Rings', 3, TRUE),
  ('67652',  'Fine Necklaces & Pendants',         '281',   'Jewelry & Watches > Fine Jewelry > Necklaces & Pendants', 3, TRUE),
  ('10968',  'Fashion Jewelry',                   '281',   'Jewelry & Watches > Fashion Jewelry', 2, TRUE),
  ('48579',  'Vintage Jewelry',                   '281',   'Jewelry & Watches > Vintage & Antique Jewelry', 2, TRUE),
  -- Clothing - Men
  ('57990',  'Men''s Casual Shirts',              '11450', 'Clothing, Shoes & Accessories > Men > Men''s Clothing > Shirts', 4, TRUE),
  ('57991',  'Men''s Dress Shirts',               '11450', 'Clothing, Shoes & Accessories > Men > Men''s Clothing > Shirts', 4, TRUE),
  ('11483',  'Men''s Jeans',                      '11450', 'Clothing, Shoes & Accessories > Men > Men''s Clothing > Jeans', 4, TRUE),
  ('11484',  'Men''s Sweaters',                   '11450', 'Clothing, Shoes & Accessories > Men > Men''s Clothing > Sweaters', 4, TRUE),
  ('57989',  'Men''s Dress Pants',                '11450', 'Clothing, Shoes & Accessories > Men > Men''s Clothing > Pants', 4, TRUE),
  ('3001',   'Men''s Suits & Blazers',            '11450', 'Clothing, Shoes & Accessories > Men > Men''s Clothing > Suits', 4, TRUE),
  -- Clothing - Women
  ('63862',  'Women''s Coats & Jackets',          '11450', 'Clothing, Shoes & Accessories > Women > Women''s Clothing > Coats & Jackets', 4, TRUE),
  ('53159',  'Women''s Tops & Blouses',           '11450', 'Clothing, Shoes & Accessories > Women > Women''s Clothing > Tops', 4, TRUE),
  ('63861',  'Women''s Dresses',                  '11450', 'Clothing, Shoes & Accessories > Women > Women''s Clothing > Dresses', 4, TRUE),
  ('11554',  'Women''s Jeans',                    '11450', 'Clothing, Shoes & Accessories > Women > Women''s Clothing > Jeans', 4, TRUE),
  ('63866',  'Women''s Sweaters',                 '11450', 'Clothing, Shoes & Accessories > Women > Women''s Clothing > Sweaters', 4, TRUE),
  -- Shoes
  ('15709',  'Men''s Athletic Shoes',             '11450', 'Clothing, Shoes & Accessories > Men > Men''s Shoes > Athletic Shoes', 4, TRUE),
  ('24087',  'Men''s Loafers & Slip-Ons',         '11450', 'Clothing, Shoes & Accessories > Men > Men''s Shoes > Loafers', 4, TRUE),
  ('53120',  'Men''s Dress Shoes',                '11450', 'Clothing, Shoes & Accessories > Men > Men''s Shoes > Dress Shoes', 4, TRUE),
  ('55793',  'Women''s Pumps & Heels',            '11450', 'Clothing, Shoes & Accessories > Women > Women''s Shoes > Heels', 4, TRUE),
  ('45333',  'Women''s Flats',                    '11450', 'Clothing, Shoes & Accessories > Women > Women''s Shoes > Flats', 4, TRUE),
  ('95672',  'Women''s Athletic Shoes',           '11450', 'Clothing, Shoes & Accessories > Women > Women''s Shoes > Athletic Shoes', 4, TRUE),
  -- Bags
  ('169291', 'Women''s Shoulder Bags & Totes',    '169285','Clothing, Shoes & Accessories > Women > Handbags & Purses', 3, TRUE),
  ('169285', 'Women''s Handbags',                 '11450', 'Clothing, Shoes & Accessories > Women > Handbags & Purses', 3, FALSE),
  ('4250',   'Men''s Bags',                       '11450', 'Clothing, Shoes & Accessories > Men > Bags & Backpacks', 3, TRUE),
  -- Art
  ('360',    'Art Prints',                        '550',   'Art > Prints > Art Prints', 3, TRUE),
  ('551',    'Paintings',                         '550',   'Art > Paintings', 2, TRUE),
  ('60628',  'Sculptures & Carvings',             '550',   'Art > Sculptures & Carvings', 2, TRUE),
  ('158658', 'Mixed Media & Collage Art',         '550',   'Art > Mixed Media & Collage Art', 2, TRUE),
  -- Collectibles & Home Décor
  ('162032', 'Decorative Collectible Figurines',  '1',     'Collectibles > Decorative Collectibles > Figurines', 3, TRUE),
  ('36018',  'Decorative Plates & Platters',      '1',     'Collectibles > Decorative Collectibles > Plates', 3, TRUE),
  -- Home
  ('112581', 'Table Lamps',                       '11700', 'Home & Garden > Lighting > Table Lamps', 3, TRUE),
  ('20706',  'Floor Lamps',                       '11700', 'Home & Garden > Lighting > Floor Lamps', 3, TRUE),
  ('45510',  'Area Rugs',                         '11700', 'Home & Garden > Rugs & Carpets > Area Rugs', 3, TRUE),
  ('20580',  'Mirrors',                           '11700', 'Home & Garden > Home Décor > Mirrors', 3, TRUE),
  ('20562',  'Clocks',                            '11700', 'Home & Garden > Clocks', 2, TRUE),
  -- Electronics
  ('112529', 'Wireless/Bluetooth Headphones',     '293',   'Consumer Electronics > Portable Audio & Headphones > Headphones', 3, TRUE),
  ('139971', 'Video Game Consoles',               '1249',  'Video Games & Consoles > Video Game Consoles', 2, TRUE),
  -- Toys
  ('261068', 'Action Figures',                    '1188',  'Toys & Hobbies > Action Figures & Accessories', 2, TRUE),
  ('180349', 'Board & Traditional Games',         '1188',  'Toys & Hobbies > Games > Board & Traditional Games', 3, TRUE),
  -- Seasonal
  ('33164',  'Christmas Wreaths & Garlands',      '1',     'Collectibles > Holiday & Seasonal > Christmas > Wreaths', 4, TRUE),
  ('170091', 'Christmas Ornaments',               '1',     'Collectibles > Holiday & Seasonal > Christmas > Ornaments', 4, TRUE),
  ('170098', 'Christmas Stockings',               '1',     'Collectibles > Holiday & Seasonal > Christmas > Stockings', 4, TRUE),
  ('170083', 'Other Christmas Décor',             '1',     'Collectibles > Holiday & Seasonal > Christmas > Other', 4, TRUE),
  ('116022', 'Seasonal Home Décor',               '11700', 'Home & Garden > Seasonal Décor', 2, TRUE)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  parent_id = EXCLUDED.parent_id,
  path = EXCLUDED.path,
  level = EXCLUDED.level,
  is_leaf = EXCLUDED.is_leaf,
  synced_at = NOW();

-- Postgres function: suggest_ebay_category(query TEXT, limit INT)
-- Returns leaf categories ranked by FTS relevance against name + path.
-- Used by suggest-ebay-category edge function as local fallback.
CREATE OR REPLACE FUNCTION suggest_ebay_category(query TEXT, result_limit INT DEFAULT 5)
RETURNS TABLE (id TEXT, name TEXT, path TEXT, rank REAL) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.path,
    ts_rank(
      to_tsvector('english', c.name || ' ' || COALESCE(c.path, '')),
      plainto_tsquery('english', query)
    ) AS rank
  FROM ebay_categories c
  WHERE
    c.is_leaf = TRUE
    AND to_tsvector('english', c.name || ' ' || COALESCE(c.path, '')) @@ plainto_tsquery('english', query)
  ORDER BY rank DESC
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;
