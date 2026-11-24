-- SidelineOS-video (video-analysis) Isoliertes Plugin-Schema
-- Alle Tabellen folgen dem Pflicht-Präfix mod_video_* im Schema plugin_video_analysis

CREATE TABLE IF NOT EXISTS mod_video_media_reels (
  id TEXT PRIMARY KEY,
  ref_count INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mod_video_team_reel_access (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  reel_id TEXT NOT NULL REFERENCES mod_video_media_reels(id) ON DELETE CASCADE,
  season TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('GAME', 'PRACTICE', 'SCOUTING', 'SELF_SCOUT', 'CUSTOM')),
  event_date TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'COACHES_ONLY' CHECK (
    visibility IN ('COACHES_ONLY', 'ALL_PLAYERS', 'UNIT_OFFENSE', 'UNIT_DEFENSE', 'UNIT_SPECIAL_TEAMS')
  ),
  shared_from_team_id TEXT,
  shared_from_team_name TEXT,
  allowed_fields_json JSONB,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_video_access_team_season
  ON mod_video_team_reel_access (team_id, season, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_mod_video_access_reel
  ON mod_video_team_reel_access (reel_id);

CREATE TABLE IF NOT EXISTS mod_video_plays (
  id TEXT PRIMARY KEY,
  reel_id TEXT NOT NULL REFERENCES mod_video_media_reels(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  play_number INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  breakdown_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_video_plays_reel_team
  ON mod_video_plays (reel_id, team_id, sort_order, play_number);

CREATE TABLE IF NOT EXISTS mod_video_play_angles (
  id TEXT PRIMARY KEY,
  play_id TEXT NOT NULL REFERENCES mod_video_plays(id) ON DELETE CASCADE,
  reel_id TEXT NOT NULL REFERENCES mod_video_media_reels(id) ON DELETE CASCADE,
  angle_code TEXT NOT NULL,
  source_mode TEXT NOT NULL DEFAULT 'CLIP_FILE' CHECK (source_mode IN ('CLIP_FILE', 'TIME_SLICE')),
  s3_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  start_ms INTEGER NOT NULL DEFAULT 0,
  end_ms INTEGER NOT NULL DEFAULT 0,
  offset_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_video_angles_play
  ON mod_video_play_angles (play_id, angle_code);

CREATE TABLE IF NOT EXISTS mod_video_telestrations (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  reel_id TEXT NOT NULL REFERENCES mod_video_media_reels(id) ON DELETE CASCADE,
  play_id TEXT NOT NULL REFERENCES mod_video_plays(id) ON DELETE CASCADE,
  angle_code TEXT NOT NULL,
  frame_index INTEGER NOT NULL,
  elements_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, play_id, angle_code, frame_index)
);

CREATE INDEX IF NOT EXISTS idx_mod_video_telestrations_play
  ON mod_video_telestrations (team_id, play_id, angle_code, frame_index);

CREATE TABLE IF NOT EXISTS mod_video_notes (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  reel_id TEXT NOT NULL REFERENCES mod_video_media_reels(id) ON DELETE CASCADE,
  play_id TEXT NOT NULL REFERENCES mod_video_plays(id) ON DELETE CASCADE,
  angle_code TEXT NOT NULL,
  frame_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  corner_position TEXT NOT NULL DEFAULT 'top-right' CHECK (
    corner_position IN ('top-left', 'top-right', 'bottom-left', 'bottom-right')
  ),
  author_uuid TEXT NOT NULL,
  author_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_video_notes_play
  ON mod_video_notes (team_id, play_id, angle_code, frame_index);

CREATE TABLE IF NOT EXISTS mod_video_team_schemas (
  team_id TEXT PRIMARY KEY,
  active_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  custom_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  dictionary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mod_video_user_prefs (
  user_uuid TEXT PRIMARY KEY,
  hotkeys_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_corner TEXT NOT NULL DEFAULT 'top-right',
  default_playback_rate NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  auto_stop_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mod_video_playlists (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  season TEXT NOT NULL,
  match_mode TEXT NOT NULL DEFAULT 'ALL' CHECK (match_mode IN ('ALL', 'ANY')),
  rules_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  play_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_video_playlists_team
  ON mod_video_playlists (team_id, season);

CREATE TABLE IF NOT EXISTS mod_video_share_links (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  access_id TEXT NOT NULL REFERENCES mod_video_team_reel_access(id) ON DELETE CASCADE,
  reel_id TEXT NOT NULL REFERENCES mod_video_media_reels(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  allowed_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_video_share_links_team
  ON mod_video_share_links (team_id, reel_id);
