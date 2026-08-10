-- Video Promosi: hook-intensity toggle (normal/medium/crazy) + avatar
-- selection (Brian 2026-08-10). hook_id points into the curated
-- lib/promo/hook-library.ts library (app-level lookup, not FK'd — the
-- library is code, not a table). avatar_* mirrors lib/promo/avatar.ts's
-- AvatarChoice: either a preset persona id, or a description produced by
-- Gemini vision from an uploaded photo (never the raw photo itself).
ALTER TABLE promo_jobs ADD COLUMN hook_id TEXT;
ALTER TABLE promo_jobs ADD COLUMN avatar_kind TEXT;
ALTER TABLE promo_jobs ADD COLUMN avatar_preset_id TEXT;
ALTER TABLE promo_jobs ADD COLUMN avatar_custom_description TEXT;
