-- SidelineOS-video (video-analysis) Migration 002
-- Anmerkungs-Autoren, Zielgruppen-Farb-Sharing (#1, #2) & Public-Share Metadaten-Option (#8)

ALTER TABLE mod_video_telestrations
  ADD COLUMN IF NOT EXISTS author_name TEXT NOT NULL DEFAULT '';

ALTER TABLE mod_video_notes
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'ALL_PLAYERS'
  CHECK (
    visibility IN ('COACHES_ONLY', 'ALL_PLAYERS', 'UNIT_OFFENSE', 'UNIT_DEFENSE', 'UNIT_SPECIAL_TEAMS')
  );

ALTER TABLE mod_video_notes
  ADD COLUMN IF NOT EXISTS color TEXT;

ALTER TABLE mod_video_team_schemas
  ADD COLUMN IF NOT EXISTS annotation_sharing_json JSONB;

ALTER TABLE mod_video_share_links
  ADD COLUMN IF NOT EXISTS include_metadata BOOLEAN NOT NULL DEFAULT TRUE;
