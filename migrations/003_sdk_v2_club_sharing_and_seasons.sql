-- SidelineOS-video (video-analysis) Migration 003
-- SDK v2.0: Vereinsweite Videoverwaltung (#10), Zero-Copy-Freigabelogik,
-- Plugin-Saisons und sportartagnostische dynamische Gruppen-Sichtbarkeiten.

-- 1. Bekannte Teams pro Verein (leichtgewichtige Referenz ohne privilegierte Core-Capabilities)
CREATE TABLE IF NOT EXISTS mod_video_club_teams (
  club_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  team_slug TEXT NOT NULL DEFAULT '',
  team_status TEXT NOT NULL DEFAULT 'ACTIVE',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (club_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_mod_video_club_teams_club
  ON mod_video_club_teams (club_id, team_name);

-- 2. Plugin-verwaltete Saisons (SDK v2.0: Core-Teams besitzen keine eigenen Saison-Felder mehr)
CREATE TABLE IF NOT EXISTS mod_video_seasons (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL DEFAULT '',
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, name)
);

CREATE INDEX IF NOT EXISTS idx_mod_video_seasons_team
  ON mod_video_seasons (team_id, sort_order DESC, name DESC);

-- 3. Vereins-Kontext & globale Freigabe-Metadaten auf Medien-Reels (#10)
ALTER TABLE mod_video_media_reels
  ADD COLUMN IF NOT EXISTS owner_club_id TEXT NOT NULL DEFAULT '';

ALTER TABLE mod_video_media_reels
  ADD COLUMN IF NOT EXISTS owner_team_id TEXT NOT NULL DEFAULT '';

ALTER TABLE mod_video_media_reels
  ADD COLUMN IF NOT EXISTS owner_team_name TEXT NOT NULL DEFAULT '';

ALTER TABLE mod_video_media_reels
  ADD COLUMN IF NOT EXISTS share_scope TEXT NOT NULL DEFAULT 'TEAM_ONLY';

ALTER TABLE mod_video_media_reels
  ADD COLUMN IF NOT EXISTS club_wide_access_mode TEXT NOT NULL DEFAULT 'READ_ONLY';

ALTER TABLE mod_video_media_reels
  ADD COLUMN IF NOT EXISTS total_size_bytes BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_mod_video_media_reels_club
  ON mod_video_media_reels (owner_club_id, created_at DESC);

-- 4. Vereins-Kontext & Zugriffsmodus (OWNER / READ_ONLY / OWN_BREAKDOWN) auf Team-Zugriffen
ALTER TABLE mod_video_team_reel_access
  ADD COLUMN IF NOT EXISTS club_id TEXT NOT NULL DEFAULT '';

ALTER TABLE mod_video_team_reel_access
  ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'OWNER';

CREATE INDEX IF NOT EXISTS idx_mod_video_access_club
  ON mod_video_team_reel_access (club_id, reel_id);

-- 5. Alte Football-spezifische CHECK-Constraints auf visibility entfernen,
--    damit dynamische Gruppen (GROUP:<name>) sowie STAFF_ONLY / ALL_MEMBERS gespeichert werden können.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname, conrelid::regclass AS tbl
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN (
        'mod_video_team_reel_access'::regclass,
        'mod_video_notes'::regclass
      )
      AND pg_get_constraintdef(oid) ILIKE '%visibility%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', c.tbl, c.conname);
  END LOOP;
END
$$;
