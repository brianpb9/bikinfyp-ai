-- Rule-based virality checklist (v1, heuristic) — computed once in the
-- worker right after stitching (that's where ffprobe/duration access lives),
-- stored so the web API can serve it without needing ffmpeg itself.
ALTER TABLE promo_jobs ADD COLUMN virality_checklist TEXT;
