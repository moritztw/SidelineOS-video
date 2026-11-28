export type VideoKategorie = 'GAME' | 'PRACTICE' | 'SCOUTING' | 'SELF_SCOUT' | 'CUSTOM';

/**
 * Sportartagnostische Anmerkungs- und Reel-Sichtbarkeit (SDK v2.0):
 * - STAFF_ONLY / COACHES_ONLY: Nur Team-Admins, Staff & Club-Admins
 * - ALL_MEMBERS / ALL_PLAYERS: Alle Teammitglieder
 * - GROUP:<Gruppenname>: Nur Mitglieder in ctx.userGroups mit passendem Namen
 * - UNIT_OFFENSE / UNIT_DEFENSE / UNIT_SPECIAL_TEAMS: Abwärtskompatible Legacy-Werte
 */
export type SichtbarkeitsStufe =
  | 'STAFF_ONLY'
  | 'ALL_MEMBERS'
  | `GROUP:${string}`
  | 'COACHES_ONLY'
  | 'ALL_PLAYERS'
  | 'UNIT_OFFENSE'
  | 'UNIT_DEFENSE'
  | 'UNIT_SPECIAL_TEAMS';

/**
 * Vereins- und Team-Freigabe-Umfang eines Video-Reels (#10):
 * - PRIVATE_ADMIN: Nur Uploader, Team-Admins & Club-Admins
 * - TEAM_ONLY: Standard — nur das Besitzer-Team
 * - CLUB_WIDE: Für alle Teams des Vereins sichtbar
 * - SELECTED_TEAMS: Gezielt für ausgewählte Unterteams freigegeben
 */
export type ReelShareScope = 'PRIVATE_ADMIN' | 'TEAM_ONLY' | 'CLUB_WIDE' | 'SELECTED_TEAMS';

/**
 * Rechte-Modus eines Teams auf einem Reel (#10):
 * - OWNER: Quell-Team (volle Kontrolle)
 * - READ_ONLY: Empfänger-Team darf ansehen & im Film Room abspielen, aber nicht bearbeiten
 * - OWN_BREAKDOWN: Empfänger-Team führt ein eigenes Breakdown & eigene Anmerkungen auf derselben Zero-Copy-Videodatei
 */
export type ReelAccessMode = 'OWNER' | 'READ_ONLY' | 'OWN_BREAKDOWN';

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

export interface GruppenFarbEintrag {
  group: string;
  label: string;
  color: string;
}

export interface AnmerkungsFreigabeKonfig {
  enabled: boolean;
  staffColor: string;
  allMembersColor: string;
  groupColors: GruppenFarbEintrag[];
  /** Abwärtskompatible Zuordnungstabelle (automatisch synchronisiert). */
  colorMap?: Record<string, string>;
}

export interface PluginSaisonEintrag {
  id: string;
  clubId: string;
  teamId: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface ClubTeamInfo {
  clubId: string;
  teamId: string;
  teamName: string;
  teamSlug: string;
  teamStatus: 'ACTIVE' | 'ARCHIVED';
  lastSeenAt: string;
}

export interface TeamReelFreigabeEintrag {
  teamId: string;
  teamName: string;
  accessMode: Exclude<ReelAccessMode, 'OWNER'>;
  allowedFields?: string[] | null;
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
  clubId?: string;
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
  shareScope?: ReelShareScope;
  clubWideAccessMode?: Exclude<ReelAccessMode, 'OWNER'>;
  accessMode?: ReelAccessMode;
  canEdit?: boolean;
  canManageSharing?: boolean;
  refCount?: number;
  totalSizeBytes?: number;
  sharedTeams?: TeamReelFreigabeEintrag[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClubReelUebersicht {
  reelId: string;
  ownerClubId: string;
  ownerTeamId: string;
  ownerTeamName: string;
  season: string;
  title: string;
  category: VideoKategorie;
  eventDate: string;
  visibility: SichtbarkeitsStufe;
  shareScope: ReelShareScope;
  clubWideAccessMode: Exclude<ReelAccessMode, 'OWNER'>;
  sharedTeams: TeamReelFreigabeEintrag[];
  refCount: number;
  totalSizeBytes: number;
  playCount: number;
  angles: WinkelCode[];
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

export type HudlCsvSpaltenAktion = 'map_existing' | 'create_custom' | 'ignore';

export interface HudlCsvSpaltenMapping {
  columnIndex: number;
  csvHeader: string;
  sampleValues: string[];
  action: HudlCsvSpaltenAktion;
  targetFieldKey?: string;
  customFieldLabel: string;
  customFieldType: 'text' | 'number';
}

export interface HudlCsvZeilenZuordnung {
  rowIndex: number;
  csvPlayNumber: number | null;
  matchedPlayId?: string;
  matchedPlayNumber: number | null;
  matchReason: 'play_number' | 'sequence' | 'unmatched';
}

export interface HudlCsvImportVorschau {
  delimiter: ',' | ';' | '\t';
  totalRows: number;
  matchedCount: number;
  unmatchedCount: number;
  playNumberColumnIndex: number | null;
  columns: HudlCsvSpaltenMapping[];
  rows: string[][];
  rowMatches: HudlCsvZeilenZuordnung[];
}

export interface HudlCsvImportErgebnis {
  newCustomFields: TaggingFeldKonfig[];
  playPatches: Array<{
    playId?: string;
    playNumber: number;
    breakdown: PlayBreakdownDaten;
  }>;
  matchedCount: number;
  unmatchedCount: number;
}
