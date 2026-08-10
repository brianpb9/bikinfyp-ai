-- Organisasi (2026-08-11, dashboard enterprise/brand — F-ENT-01): konsep
-- MINIMAL, aditif murni. Tidak ada tabel lain yang berubah bentuk di
-- migration ini — org_id di tabel lain (0013) selalu nullable, NULL berarti
-- retail (perilaku lama, tidak berubah selamanya). role di org_members
-- HANYA label ("siapa dihubungi"), TIDAK PERNAH dicek untuk otorisasi di
-- MVP ini — RBAC granular sengaja ditunda ke v2.
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at TEXT NOT NULL
);

CREATE TABLE org_members (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  created_at TEXT NOT NULL,
  UNIQUE (org_id, user_id)
);
CREATE INDEX idx_org_members_org ON org_members(org_id);
CREATE INDEX idx_org_members_user ON org_members(user_id);
