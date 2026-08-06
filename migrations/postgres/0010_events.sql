-- Event funnel produk (lihat lib/schema.sql & app/api/events/route.ts).
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  anon_id TEXT,
  name TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_name_time ON events(name, created_at);
