-- Template milik brand (masukan tester lewat Brian, 2026-08-11: "client dapat
-- membuat template sendiri dan menyimpan template yang mereka setup").
--
-- BERBEDA dari template bawaan di lib/templates.ts, dan perbedaannya memang
-- disengaja: template bawaan adalah keputusan kreatif KAMI — ikut versi kode,
-- ditinjau lewat diff, sama untuk semua brand. Yang ini data milik BRAND, jadi
-- tempatnya di database dan lingkupnya per-organisasi.
CREATE TABLE IF NOT EXISTS org_templates (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  note TEXT,
  kind TEXT NOT NULL,
  format TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  quality_tier TEXT NOT NULL,
  hook_level TEXT NOT NULL,
  hook_family TEXT,
  variant_count INTEGER NOT NULL,
  -- Avatar ikut disimpan: brand yang sudah menemukan presenter cocok tidak mau
  -- memilih ulang tiap kampanye. Kolomnya nullable supaya template lama tetap
  -- sah saat kami menambah pilihan avatar baru.
  creator_category TEXT,
  avatar_gender TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_templates_org ON org_templates(org_id, created_at DESC);
