-- =========================================================
-- Blinkit Dashboard – Supabase schema
-- Run this in Supabase SQL Editor (Dashboard → SQL → New query)
-- =========================================================

-- 1. Admin users table (for login)
CREATE TABLE IF NOT EXISTS admin_users (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,           -- bcrypt hash
  role        TEXT NOT NULL DEFAULT 'viewer',   -- 'admin' | 'viewer'
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 2. Inventory products (replaces data/latest.json → rows[])
CREATE TABLE IF NOT EXISTS inventory_products (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  upload_date         DATE NOT NULL,
  file_name           TEXT,
  item_id             TEXT NOT NULL,
  product_name        TEXT NOT NULL,
  brand_name          TEXT,
  warehouse_id        TEXT NOT NULL,
  warehouse_name      TEXT NOT NULL,
  total_stock_available INTEGER DEFAULT 0,
  units_sold_7        INTEGER DEFAULT 0,
  units_sold_15       INTEGER DEFAULT 0,
  units_sold_30       INTEGER DEFAULT 0,
  units_sold_45       INTEGER,          -- nullable – may not have history
  units_sold_60       INTEGER,          -- nullable
  incoming_inventory  INTEGER DEFAULT 0,
  stock_status        TEXT DEFAULT 'ok', -- 'ok' | 'low' | 'out'
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- 3. Snapshot history (replaces data/history.json)
CREATE TABLE IF NOT EXISTS snapshot_history (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_date       DATE NOT NULL,
  item_id             TEXT NOT NULL,
  warehouse_id        TEXT NOT NULL,
  product_name        TEXT,
  warehouse_name      TEXT,
  total_stock_available INTEGER DEFAULT 0,
  incoming_inventory  INTEGER DEFAULT 0,
  units_sold_7        INTEGER DEFAULT 0,
  units_sold_15       INTEGER DEFAULT 0,
  units_sold_30       INTEGER DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT now(),

  UNIQUE (snapshot_date, item_id, warehouse_id)
);

-- 4. Upload metadata (tracks latest upload info)
CREATE TABLE IF NOT EXISTS upload_meta (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  upload_date DATE NOT NULL,
  file_name   TEXT,
  row_count   INTEGER DEFAULT 0,
  uploaded_by UUID REFERENCES admin_users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_inventory_upload_date ON inventory_products (upload_date);
CREATE INDEX IF NOT EXISTS idx_snapshot_item_wh      ON snapshot_history (item_id, warehouse_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snapshot_date         ON snapshot_history (snapshot_date);
