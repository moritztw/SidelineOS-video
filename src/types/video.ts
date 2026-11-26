export type VideoKategorie = 'GAME' | 'PRACTICE' | 'SCOUTING' | 'SELF_SCOUT' | 'CUSTOM';

export type SichtbarkeitsStufe =
  | 'COACHES_ONLY'
  | 'ALL_PLAYERS'
  | 'UNIT_OFFENSE'
  | 'UNIT_DEFENSE'
  | 'UNIT_SPECIAL_TEAMS';

export type WinkelCode = 'SIDELINE' | 'ENDZONE' | 'TIGHT' | (string & {});

export type QuellenModus = 'CLIP_FILE' | 'TIME_SLICE';

export type EckPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type NotizStatus = 'DRAFT' | 'PUBLISHED';

export type TelestrationWerkzeug =
  | 'select'
  | 'freehand'
  | 'arrow'
  | 'line'
  | 'block_line'
  | 'dashed_line'
  | 'circle'
  | 'spotlight'
  | 'text';

export interface Punkt2D {
  x: number;
  y: number;
}

export interface TelestrationBasis {
  id: string;
  color: string;
  strokeWidth: number;
  visibility?: SichtbarkeitsStufe;
  authorUuid?: string;
  authorName?: string;
}

export interface TelestrationFreihand extends TelestrationBasis {
  type: 'freehand';
  points: Punkt2D[];
}

export interface TelestrationPfeil extends TelestrationBasis {
  type: 'arrow';
  start: Punkt2D;
  end: Punkt2D;
}

export interface TelestrationLinie extends TelestrationBasis {
  type: 'line' | 'block_line' | 'dashed_line';
  start: Punkt2D;
  end: Punkt2D;
}

export interface TelestrationKreis extends TelestrationBasis {
  type: 'circle';
  center: Punkt2D;
  radiusX: number;
  radiusY: number;
}

export interface TelestrationSpotlight extends TelestrationBasis {
  type: 'spotlight';
  center: Punkt2D;
  radius: number;
}

export interface TelestrationText extends TelestrationBasis {
  type: 'text';
  position: Punkt2D;
  text: string;
}

export type TelestrationElement =
  | TelestrationFreihand
  | TelestrationPfeil
  | TelestrationLinie
  | TelestrationKreis
  | TelestrationSpotlight
  | TelestrationText;

export interface FrameTelestration {
  id: string;
  reelId: string;
  playId: string;
  angleCode: WinkelCode;
  frameIndex: number;
  elements: TelestrationElement[];
  authorUuid?: string;
  authorName?: string;
  updatedAt: string;
}

export interface CoachNotiz {
  id: string;
  reelId: string;
  playId: string;
  angleCode: WinkelCode;
  frameIndex: number;
  text: string;
  status: NotizStatus;
  visibility?: SichtbarkeitsStufe;
  color?: string;
  cornerPosition: EckPosition;
  authorUuid: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnmerkungsFreigabeKonfig {
  enabled: boolean;
  colorMap: Record<SichtbarkeitsStufe, string>;
}

export interface PlayBreakdownDaten {
  odk?: 'O' | 'D' | 'K' | string;
  play_number?: number;
  down?: number;
  distance?: number;
  yard_line?: number;
  off_form?: string;
  off_strg?: 'R' | 'L' | 'Middle' | string;
  backfield?: string;
  motion?: string;
  off_pers?: string;
  off_play?: string;
  rpo?: string;
  play_dir?: 'R' | 'L' | 'Middle' | string;
  result?: string;
  gn_ls?: number;
  def_front?: string;
  def_str?: 'R' | 'L' | string;
  def_pers?: string;
  stunt?: string;
  blitz?: string;
  eff?: string;
  [customKey: string]: string | number | boolean | undefined;
}

export interface PlayWinkelQuelle {
  id: string;
  angleCode: WinkelCode;
  sourceMode: QuellenModus;
  s3Key: string;
  fileName: string;
  fileSizeBytes: number;
  startMs: number;
  endMs: number;
  offsetMs?: number | null;
  streamUrl?: string;
}

export interface PlayEintrag {
  id: string;
  reelId: string;
  playNumber: number;
  sortOrder: number;
  breakdown: PlayBreakdownDaten;
  sources: Record<string, PlayWinkelQuelle>;
}

export interface VideoReelEintrag {
  id: string;
  accessId: string;
  teamId: string;
  saison: string;
  title: string;
  category: VideoKategorie;
  eventDate: string;
  visibility: SichtbarkeitsStufe;
  angles: WinkelCode[];
  playCount: number;
  sharedFromTeamId?: string | null;
  sharedFromTeamName?: string | null;
  allowedFields?: string[] | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaggingFeldKonfig {
  key: string;
  label: string;
  gruppe: 'GENERAL' | 'OFFENSE' | 'DEFENSE' | 'CUSTOM';
  typ: 'text' | 'number' | 'select';
  aktiv: boolean;
  custom?: boolean;
  optionen?: string[];
}

export interface TeamTaggingSchema {
  teamId: string;
  fields: TaggingFeldKonfig[];
  dictionary: Record<string, string[]>;
  annotationSharing?: AnmerkungsFreigabeKonfig;
  updatedAt: string;
}

export type HotkeyScope = 'GLOBAL' | 'FILM_ROOM' | 'FAST_CUT';

export type HotkeyAktion =
  | 'playPause'
  | 'stepBack'
  | 'stepForward'
  | 'prevPlay'
  | 'nextPlay'
  | 'toggleFullscreen'
  | 'addNote'
  | 'toggleDraw'
  | 'deleteAnnotation'
  | 'toggleBreakdownOverlay'
  | 'markCut'
  | 'fastCutReverse'
  | 'fastCutPause'
  | 'fastCutForward';

export type HotkeyBelegung = Record<HotkeyAktion, string>;

export interface BenutzerVideoPraeferenzen {
  userUuid: string;
  hotkeys: HotkeyBelegung;
  defaultCorner: EckPosition;
  defaultPlaybackRate: number;
  autoStopEnabled: boolean;
  updatedAt: string;
}

export type PlaylistFilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'not_empty';

export interface PlaylistFilterRegel {
  id: string;
  fieldKey: string;
  operator: PlaylistFilterOperator;
  value: string;
}

export interface SmartPlaylist {
  id: string;
  teamId: string;
  name: string;
  description: string;
  season: string;
  matchMode: 'ALL' | 'ANY';
  rules: PlaylistFilterRegel[];
  playIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicShareLinkInfo {
  id: string;
  reelId: string;
  label: string;
  token?: string;
  allowedFields: string[];
  includeMetadata?: boolean;
  expiresAt: string;
  revokedAt?: string | null;
  createdAt: string;
}

export interface PublicShareAnsichtDaten {
  reel: {
    id: string;
    title: string;
    category: VideoKategorie;
    eventDate: string;
    season: string;
    angles: WinkelCode[];
  };
  allowedFields: string[];
  includeMetadata?: boolean;
  s3DownloadVerfuegbar?: boolean;
  plays: PlayEintrag[];
  expiresAt: string;
}

export interface SidelineBundleV1 {
  schema_version: '1.0';
  reel: {
    title: string;
    category: VideoKategorie;
    event_date: string;
    visibility?: SichtbarkeitsStufe;
  };
  angles: string[];
  plays: Array<{
    play_number: number;
    sources: Record<
      string,
      {
        file: string;
        source_mode?: QuellenModus;
        start_ms: number;
        end_ms: number;
        offset_ms?: number;
      }
    >;
    breakdown?: PlayBreakdownDaten;
    notes?: Array<{
      timestamp_ms: number;
      text: string;
      status?: NotizStatus;
    }>;
  }>;
}
