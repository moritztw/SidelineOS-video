import crypto from 'node:crypto';
import type {
  PluginBackendKontext,
  PluginDbScope,
  PluginStorageScope,
  SidelineBackendPlugin,
} from '@sidelineos/plugin-sdk';
import sql001 from '../migrations/001_video_schema.sql';
import sql002 from '../migrations/002_video_annotations_and_sharing.sql';
import sql003 from '../migrations/003_sdk_v2_club_sharing_and_seasons.sql';
import manifest from '../plugin.json';
import {
  bereinigeAnmerkungsKonfig,
  filtereTelestrationElementeFuerBenutzer,
  istAnmerkungFuerBenutzerSichtbar,
  istStaffOderAdminRolle,
  normalisiereSichtbarkeit,
} from './services/annotationVisibility';
import { validiereSidelineBundle } from './services/bundleSchema';
import { STANDARD_HOTKEYS, bereinigeHotkeyBelegung } from './services/frameAndHotkeys';
import {
  ergaenzeTeamWoerterbuch,
  erstelleStandardTeamSchema,
  filtereBreakdownAufFelder,
} from './services/taggingEngine';
import type {
  AnmerkungsFreigabeKonfig,
  BenutzerVideoPraeferenzen,
  ClubReelUebersicht,
  ClubTeamInfo,
  CoachNotiz,
  PlayBreakdownDaten,
  PlayEintrag,
  PlayWinkelQuelle,
  PluginSaisonEintrag,
  PublicShareAnsichtDaten,
  QuellenModus,
  ReelAccessMode,
  ReelShareScope,
  SichtbarkeitsStufe,
  SmartPlaylist,
  TaggingFeldKonfig,
  TeamReelFreigabeEintrag,
  TeamTaggingSchema,
  TelestrationElement,
  VideoKategorie,
  VideoReelEintrag,
} from './types/video';

type RouteAntwort = { status: number; body: unknown };

const READ_ONLY_ANTWORT: RouteAntwort = {
  status: 409,
  body: {
    fehler: 'Dieses Team ist archiviert (Nur-Lese-Modus). Änderungen sind gesperrt.',
    code: 'TEAM_ARCHIVED_READ_ONLY',
  },
};

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

function bereinigeStorageObjektPfad(rohPfad: unknown, prefix: string): string | null {
  if (typeof rohPfad !== 'string') return null;
  const bereinigt = rohPfad.trim().replace(/^\/+/, '');
  if (!bereinigt || bereinigt.includes('..') || bereinigt.includes('\\')) return null;
  if (prefix && bereinigt.startsWith(prefix)) {
    return bereinigt.slice(prefix.length);
  }
  return bereinigt;
}

function parseJson<T>(wert: unknown, fallback: T): T {
  if (wert === null || wert === undefined) return fallback;
  if (typeof wert === 'string') {
    try {
      return JSON.parse(wert) as T;
    } catch {
      return fallback;
    }
  }
  return wert as T;
}

function normalisierePfad(rawPath: string): string {
  const bereinigt = rawPath.replace(/\/+$/, '');
  return bereinigt || '/';
}

function mappeStorageFehler(err: unknown): RouteAntwort {
  const obj = err as { status?: number; statusCode?: number; code?: string; message?: string };
  const code = obj?.code ?? '';
  const status = obj?.status ?? obj?.statusCode ?? 0;
  if (status === 413 || code === 'STORAGE_QUOTA_EXCEEDED' || /quota/i.test(obj?.message ?? '')) {
    return {
      status: 413,
      body: {
        fehler:
          'Speicherlimit des Vereins erreicht (HTTP 413). Bitte Speicher freigeben oder Kontingent erhöhen.',
        code: 'STORAGE_QUOTA_EXCEEDED',
      },
    };
  }
  if (status === 409 || code === 'TEAM_ARCHIVED_READ_ONLY') {
    return READ_ONLY_ANTWORT;
  }
  return {
    status: status >= 400 && status < 600 ? status : 500,
    body: { fehler: obj?.message ?? 'Storage-Operation fehlgeschlagen.' },
  };
}

function istSchreibMethode(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

function istClubAdminKontext(ctx: PluginBackendKontext): boolean {
  return ctx.clubRolle === 'CLUB_ADMIN' || ctx.user.istSysadmin;
}

function istTeamAdminKontext(ctx: PluginBackendKontext): boolean {
  return ctx.effektiveTeamRolle === 'TEAM_ADMIN' || istClubAdminKontext(ctx);
}

async function registriereAktuellesTeam(ctx: PluginBackendKontext): Promise<void> {
  if (!ctx.club || !ctx.team) return;
  try {
    await ctx.db.query(
      `INSERT INTO mod_video_club_teams (club_id, team_id, team_name, team_slug, team_status, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (club_id, team_id) DO UPDATE SET
         team_name = EXCLUDED.team_name,
         team_slug = EXCLUDED.team_slug,
         team_status = EXCLUDED.team_status,
         last_seen_at = EXCLUDED.last_seen_at`,
      [
        ctx.club.id,
        ctx.team.id,
        ctx.team.name,
        ctx.team.slug ?? '',
        ctx.team.status ?? 'ACTIVE',
        new Date().toISOString(),
      ]
    );
  } catch {
    // Fallback bei sehr minimalen Test-DB-Mocks ohne mod_video_club_teams
  }
}

async function ladeOderErstelleSaisons(
  db: PluginDbScope,
  teamId: string,
  clubId: string
): Promise<{ seasons: PluginSaisonEintrag[]; activeSeason: string }> {
  const res = await db.query<{
    id: string;
    club_id: string;
    team_id: string;
    name: string;
    is_active: boolean;
    sort_order: number;
    created_at: string;
  }>(
    `SELECT id, club_id, team_id, name, is_active, sort_order, created_at
     FROM mod_video_seasons
     WHERE team_id = $1
     ORDER BY sort_order DESC, name DESC`,
    [teamId]
  );

  if (res.rows.length > 0) {
    const seasons: PluginSaisonEintrag[] = res.rows.map((r) => ({
      id: r.id,
      clubId: r.club_id || clubId,
      teamId: r.team_id,
      name: r.name,
      isActive: Boolean(r.is_active),
      sortOrder: Number(r.sort_order ?? 0),
      createdAt: r.created_at,
    }));
    const aktiv = seasons.find((s) => s.isActive)?.name ?? seasons[0].name;
    return { seasons, activeSeason: aktiv };
  }

  const standardJahr = String(new Date().getFullYear());
  const id = `ssn-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    await db.query(
      `INSERT INTO mod_video_seasons (id, club_id, team_id, name, is_active, sort_order, created_at)
       VALUES ($1, $2, $3, $4, TRUE, 100, $5)
       ON CONFLICT (team_id, name) DO NOTHING`,
      [id, clubId, teamId, standardJahr, now]
    );
  } catch {
    // Fallback bei Mocks
  }
  return {
    seasons: [
      {
        id,
        clubId,
        teamId,
        name: standardJahr,
        isActive: true,
        sortOrder: 100,
        createdAt: now,
      },
    ],
    activeSeason: standardJahr,
  };
}

async function ladeTeamSchema(db: PluginDbScope, teamId: string): Promise<TeamTaggingSchema> {
  const res = await db.query<{
    team_id: string;
    active_fields_json: unknown;
    custom_fields_json: unknown;
    dictionary_json: unknown;
    annotation_sharing_json: unknown;
    updated_at: string;
  }>(
    `SELECT team_id, active_fields_json, custom_fields_json, dictionary_json, annotation_sharing_json, updated_at
     FROM mod_video_team_schemas WHERE team_id = $1 LIMIT 1`,
    [teamId]
  );

  const basis = erstelleStandardTeamSchema(teamId);
  if (res.rows.length === 0) {
    return {
      ...basis,
      annotationSharing: bereinigeAnmerkungsKonfig(null),
    };
  }
  const row = res.rows[0];
  const savedFields = parseJson(row.active_fields_json, basis.fields);
  const customFields = parseJson<TeamTaggingSchema['fields']>(row.custom_fields_json, []);
  const dict = parseJson<Record<string, string[]>>(row.dictionary_json, basis.dictionary);
  const annotationSharing = bereinigeAnmerkungsKonfig(
    parseJson<Partial<AnmerkungsFreigabeKonfig> | null>(row.annotation_sharing_json, null)
  );

  const mergedFields = Array.isArray(savedFields) && savedFields.length > 0 ? [...savedFields] : [...basis.fields];
  const existingKeys = new Set(mergedFields.map((f) => f.key));
  for (const cf of customFields) {
    if (!existingKeys.has(cf.key)) {
      mergedFields.push({ ...cf, custom: true });
      existingKeys.add(cf.key);
    }
  }

  return {
    teamId,
    fields: mergedFields,
    dictionary: dict,
    annotationSharing,
    updatedAt: row.updated_at ?? basis.updatedAt,
  };
}

async function speichereTeamSchemaFelderUndDict(
  db: PluginDbScope,
  teamId: string,
  schema: TeamTaggingSchema,
  now: string
): Promise<void> {
  await db.query(
    `INSERT INTO mod_video_team_schemas (
       team_id, active_fields_json, custom_fields_json, dictionary_json, annotation_sharing_json, updated_at
     ) VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6)
     ON CONFLICT (team_id) DO UPDATE SET
       active_fields_json = EXCLUDED.active_fields_json,
       custom_fields_json = EXCLUDED.custom_fields_json,
       dictionary_json = EXCLUDED.dictionary_json,
       annotation_sharing_json = EXCLUDED.annotation_sharing_json,
       updated_at = EXCLUDED.updated_at`,
    [
      teamId,
      JSON.stringify(schema.fields),
      JSON.stringify(schema.fields.filter((f) => f.custom)),
      JSON.stringify(schema.dictionary),
      JSON.stringify(bereinigeAnmerkungsKonfig(schema.annotationSharing)),
      now,
    ]
  );
}

async function ladePlaysFuerReel(
  db: PluginDbScope,
  reelId: string,
  teamId: string,
  allowedFields: string[] | null,
  storage?: Pick<PluginStorageScope, 'prefix' | 'getSignedDownloadUrl'>
): Promise<PlayEintrag[]> {
  const playsRes = await db.query<{
    id: string;
    reel_id: string;
    play_number: number;
    sort_order: number;
    breakdown_json: unknown;
  }>(
    `SELECT id, reel_id, play_number, sort_order, breakdown_json
     FROM mod_video_plays
     WHERE reel_id = $1 AND team_id = $2
     ORDER BY sort_order ASC, play_number ASC`,
    [reelId, teamId]
  );

  if (playsRes.rows.length === 0) return [];

  const anglesRes = await db.query<{
    id: string;
    play_id: string;
    angle_code: string;
    source_mode: QuellenModus;
    s3_key: string;
    file_name: string;
    file_size_bytes: number;
    start_ms: number;
    end_ms: number;
    offset_ms: number | null;
  }>(
    `SELECT id, play_id, angle_code, source_mode, s3_key, file_name, file_size_bytes, start_ms, end_ms, offset_ms
     FROM mod_video_play_angles
     WHERE reel_id = $1
     ORDER BY angle_code ASC`,
    [reelId]
  );

  const urlCache = new Map<string, string>();
  const anglesByPlay = new Map<string, Record<string, PlayWinkelQuelle>>();

  for (const row of anglesRes.rows) {
    let streamUrl: string | undefined;
    if (storage && row.s3_key) {
      const objPath = bereinigeStorageObjektPfad(row.s3_key, storage.prefix) ?? row.s3_key;
      if (urlCache.has(objPath)) {
        streamUrl = urlCache.get(objPath);
      } else {
        try {
          const signed = await storage.getSignedDownloadUrl({
            objectPath: objPath,
            expiresInSeconds: 1800,
          });
          streamUrl = signed.url;
          urlCache.set(objPath, signed.url);
        } catch {
          streamUrl = undefined;
        }
      }
    }

    const bucket = anglesByPlay.get(row.play_id) ?? {};
    bucket[row.angle_code] = {
      id: row.id,
      angleCode: row.angle_code,
      sourceMode: row.source_mode,
      s3Key: row.s3_key,
      fileName: row.file_name,
      fileSizeBytes: Number(row.file_size_bytes ?? 0),
      startMs: Number(row.start_ms ?? 0),
      endMs: Number(row.end_ms ?? 0),
      offsetMs: row.offset_ms === null ? null : Number(row.offset_ms),
      ...(streamUrl ? { streamUrl } : {}),
    };
    anglesByPlay.set(row.play_id, bucket);
  }

  return playsRes.rows.map((p) => {
    const rohBreakdown = parseJson<PlayBreakdownDaten>(p.breakdown_json, {});
    const breakdown = allowedFields
      ? filtereBreakdownAufFelder(rohBreakdown, allowedFields)
      : rohBreakdown;
    return {
      id: p.id,
      reelId: p.reel_id,
      playNumber: Number(p.play_number),
      sortOrder: Number(p.sort_order),
      breakdown,
      sources: anglesByPlay.get(p.id) ?? {},
    };
  });
}

/**
 * Klont Spielzug-Referenzen (Zero-Copy: identische s3_key-Verweise, kein Speicher-Duplikat)
 * vom Quell-Team in ein Ziel-Team, wenn dieses `OWN_BREAKDOWN`-Rechte erhält.
 */
async function klonePlaysZeroCopyFuerTeam(
  db: PluginDbScope,
  reelId: string,
  sourceTeamId: string,
  targetTeamId: string,
  allowedFields: string[] | null,
  now: string
): Promise<void> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM mod_video_plays WHERE reel_id = $1 AND team_id = $2 LIMIT 1`,
    [reelId, targetTeamId]
  );
  if (existing.rows.length > 0) return;

  const quellPlays = await ladePlaysFuerReel(db, reelId, sourceTeamId, allowedFields);
  for (const qp of quellPlays) {
    const neuePlayId = `play-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO mod_video_plays (id, reel_id, team_id, play_number, sort_order, breakdown_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)`,
      [neuePlayId, reelId, targetTeamId, qp.playNumber, qp.sortOrder, JSON.stringify(qp.breakdown ?? {}), now]
    );
    for (const [angleCode, src] of Object.entries(qp.sources)) {
      await db.query(
        `INSERT INTO mod_video_play_angles (
           id, play_id, reel_id, angle_code, source_mode, s3_key, file_name, file_size_bytes, start_ms, end_ms, offset_ms
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          `ang-${crypto.randomUUID()}`,
          neuePlayId,
          reelId,
          angleCode,
          src.sourceMode,
          src.s3Key,
          src.fileName,
          src.fileSizeBytes,
          src.startMs,
          src.endMs,
          src.offsetMs ?? null,
        ]
      );
    }
  }
}

interface GeloesterReelZugriff {
  accessId: string;
  reelId: string;
  teamId: string;
  clubId: string;
  ownerTeamId: string;
  ownerTeamName: string;
  season: string;
  title: string;
  category: VideoKategorie;
  eventDate: string;
  visibility: SichtbarkeitsStufe;
  shareScope: ReelShareScope;
  clubWideAccessMode: Exclude<ReelAccessMode, 'OWNER'>;
  accessMode: ReelAccessMode;
  sharedFromTeamId: string | null;
  sharedFromTeamName: string | null;
  allowedFields: string[] | null;
  refCount: number;
  totalSizeBytes: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  istVirtuellerClubZugriff: boolean;
}

async function loeseReelZugriffFuerTeamAuf(
  ctx: PluginBackendKontext,
  reelId: string
): Promise<GeloesterReelZugriff | null> {
  if (!ctx.team) return null;

  const mediaRes = await ctx.db.query<{
    id: string;
    ref_count: number;
    owner_club_id: string;
    owner_team_id: string;
    owner_team_name: string;
    share_scope: ReelShareScope;
    club_wide_access_mode: Exclude<ReelAccessMode, 'OWNER'>;
    total_size_bytes: number;
    created_by: string;
    created_at: string;
  }>(
    `SELECT id, ref_count, owner_club_id, owner_team_id, owner_team_name, share_scope,
            club_wide_access_mode, total_size_bytes, created_by, created_at
     FROM mod_video_media_reels
     WHERE id = $1 LIMIT 1`,
    [reelId]
  );

  const directRes = await ctx.db.query<{
    id: string;
    reel_id: string;
    team_id: string;
    club_id: string;
    season: string;
    title: string;
    category: VideoKategorie;
    event_date: string;
    visibility: SichtbarkeitsStufe;
    access_mode: ReelAccessMode;
    shared_from_team_id: string | null;
    shared_from_team_name: string | null;
    allowed_fields_json: unknown;
    created_by: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, reel_id, team_id, club_id, season, title, category, event_date, visibility,
            access_mode, shared_from_team_id, shared_from_team_name, allowed_fields_json,
            created_by, created_at, updated_at
     FROM mod_video_team_reel_access
     WHERE reel_id = $1 AND team_id = $2 LIMIT 1`,
    [reelId, ctx.team.id]
  );

  const media = mediaRes.rows[0];

  if (directRes.rows.length > 0) {
    const acc = directRes.rows[0];
    const accessMode: ReelAccessMode =
      acc.access_mode || (acc.shared_from_team_id ? 'READ_ONLY' : 'OWNER');
    return {
      accessId: acc.id,
      reelId: acc.reel_id,
      teamId: acc.team_id,
      clubId: acc.club_id || media?.owner_club_id || ctx.club?.id || '',
      ownerTeamId: media?.owner_team_id || acc.shared_from_team_id || acc.team_id,
      ownerTeamName: media?.owner_team_name || acc.shared_from_team_name || ctx.team.name,
      season: acc.season,
      title: acc.title,
      category: acc.category,
      eventDate: acc.event_date,
      visibility: normalisiereSichtbarkeit(acc.visibility),
      shareScope: (media?.share_scope as ReelShareScope) || 'TEAM_ONLY',
      clubWideAccessMode: (media?.club_wide_access_mode as Exclude<ReelAccessMode, 'OWNER'>) || 'READ_ONLY',
      accessMode,
      sharedFromTeamId: acc.shared_from_team_id,
      sharedFromTeamName: acc.shared_from_team_name,
      allowedFields: parseJson<string[] | null>(acc.allowed_fields_json, null),
      refCount: Number(media?.ref_count ?? 1),
      totalSizeBytes: Number(media?.total_size_bytes ?? 0),
      createdBy: acc.created_by,
      createdAt: acc.created_at,
      updatedAt: acc.updated_at,
      istVirtuellerClubZugriff: false,
    };
  }

  // Vereinsweite Freigabe (CLUB_WIDE) innerhalb desselben Vereins prüfen
  if (media && media.share_scope === 'CLUB_WIDE' && ctx.club && media.owner_club_id === ctx.club.id) {
    const ownerAccRes = await ctx.db.query<{
      id: string;
      team_id: string;
      season: string;
      title: string;
      category: VideoKategorie;
      event_date: string;
      visibility: SichtbarkeitsStufe;
      created_by: string;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, team_id, season, title, category, event_date, visibility, created_by, created_at, updated_at
       FROM mod_video_team_reel_access
       WHERE reel_id = $1 AND (access_mode = 'OWNER' OR shared_from_team_id IS NULL)
       LIMIT 1`,
      [reelId]
    );
    if (ownerAccRes.rows.length > 0) {
      const ownerAcc = ownerAccRes.rows[0];
      const mode: Exclude<ReelAccessMode, 'OWNER'> =
        media.club_wide_access_mode === 'OWN_BREAKDOWN' ? 'OWN_BREAKDOWN' : 'READ_ONLY';
      return {
        accessId: `club-virtual-${reelId}-${ctx.team.id}`,
        reelId,
        teamId: ctx.team.id,
        clubId: ctx.club.id,
        ownerTeamId: media.owner_team_id || ownerAcc.team_id,
        ownerTeamName: media.owner_team_name || 'Verein',
        season: ownerAcc.season,
        title: ownerAcc.title,
        category: ownerAcc.category,
        eventDate: ownerAcc.event_date,
        visibility: normalisiereSichtbarkeit(ownerAcc.visibility),
        shareScope: 'CLUB_WIDE',
        clubWideAccessMode: mode,
        accessMode: mode,
        sharedFromTeamId: media.owner_team_id || ownerAcc.team_id,
        sharedFromTeamName: media.owner_team_name || 'Verein',
        allowedFields: null,
        refCount: Number(media.ref_count ?? 1),
        totalSizeBytes: Number(media.total_size_bytes ?? 0),
        createdBy: ownerAcc.created_by,
        createdAt: ownerAcc.created_at,
        updatedAt: ownerAcc.updated_at,
        istVirtuellerClubZugriff: true,
      };
    }
  }

  return null;
}

function darfBenutzerReelSehen(ctx: PluginBackendKontext, zugriff: GeloesterReelZugriff): boolean {
  if (zugriff.shareScope === 'PRIVATE_ADMIN') {
    return (
      ctx.user.uuid === zugriff.createdBy ||
      istTeamAdminKontext(ctx) ||
      istClubAdminKontext(ctx)
    );
  }
  if (istStaffOderAdminRolle(ctx.effektiveTeamRolle) || istClubAdminKontext(ctx)) {
    return true;
  }
  return istAnmerkungFuerBenutzerSichtbar(
    zugriff.visibility,
    ctx.effektiveTeamRolle,
    ctx.userGroups,
    true
  );
}

function darfBenutzerReelBearbeiten(ctx: PluginBackendKontext, zugriff: GeloesterReelZugriff): boolean {
  if (ctx.isReadOnly) return false;
  if (!istStaffOderAdminRolle(ctx.effektiveTeamRolle) && !istClubAdminKontext(ctx)) return false;
  return zugriff.accessMode === 'OWNER' || zugriff.accessMode === 'OWN_BREAKDOWN';
}

async function aktualisiereReelFreigabeLogik(
  ctx: PluginBackendKontext,
  reelId: string,
  payload: {
    shareScope?: ReelShareScope;
    clubWideAccessMode?: Exclude<ReelAccessMode, 'OWNER'>;
    sharedTeams?: Array<{
      teamId: string;
      teamName?: string;
      accessMode: Exclude<ReelAccessMode, 'OWNER'>;
      allowedFields?: string[] | null;
    }>;
  }
): Promise<RouteAntwort> {
  const mediaRes = await ctx.db.query<{
    id: string;
    owner_club_id: string;
    owner_team_id: string;
    owner_team_name: string;
  }>(
    `SELECT id, owner_club_id, owner_team_id, owner_team_name
     FROM mod_video_media_reels WHERE id = $1 LIMIT 1`,
    [reelId]
  );
  if (mediaRes.rows.length === 0) {
    return { status: 404, body: { fehler: 'Video-Reel nicht gefunden.' } };
  }
  const media = mediaRes.rows[0];
  const clubId = media.owner_club_id || ctx.club?.id || '';

  if (ctx.club && media.owner_club_id && media.owner_club_id !== ctx.club.id) {
    return { status: 403, body: { fehler: 'Reel gehört zu einem anderen Verein.' } };
  }

  const ownerAccRes = await ctx.db.query<{
    id: string;
    team_id: string;
    season: string;
    title: string;
    category: VideoKategorie;
    event_date: string;
    visibility: SichtbarkeitsStufe;
    created_by: string;
  }>(
    `SELECT id, team_id, season, title, category, event_date, visibility, created_by
     FROM mod_video_team_reel_access
     WHERE reel_id = $1 AND (access_mode = 'OWNER' OR shared_from_team_id IS NULL)
     LIMIT 1`,
    [reelId]
  );
  if (ownerAccRes.rows.length === 0) {
    return { status: 404, body: { fehler: 'Eigentümer-Eintrag des Reels nicht gefunden.' } };
  }
  const ownerAcc = ownerAccRes.rows[0];
  const ownerTeamId = media.owner_team_id || ownerAcc.team_id;
  const ownerTeamName = media.owner_team_name || ctx.team?.name || ownerTeamId;

  const erlaubteScopes: ReelShareScope[] = [
    'PRIVATE_ADMIN',
    'TEAM_ONLY',
    'CLUB_WIDE',
    'SELECTED_TEAMS',
  ];
  const shareScope: ReelShareScope =
    payload.shareScope && erlaubteScopes.includes(payload.shareScope)
      ? payload.shareScope
      : 'TEAM_ONLY';
  const clubWideAccessMode: Exclude<ReelAccessMode, 'OWNER'> =
    payload.clubWideAccessMode === 'OWN_BREAKDOWN' ? 'OWN_BREAKDOWN' : 'READ_ONLY';

  const now = new Date().toISOString();

  await ctx.db.query(
    `UPDATE mod_video_media_reels
     SET share_scope = $1,
         club_wide_access_mode = $2,
         owner_club_id = COALESCE(NULLIF(owner_club_id, ''), $3),
         owner_team_id = COALESCE(NULLIF(owner_team_id, ''), $4),
         owner_team_name = COALESCE(NULLIF(owner_team_name, ''), $5)
     WHERE id = $6`,
    [shareScope, clubWideAccessMode, clubId, ownerTeamId, ownerTeamName, reelId]
  );

  // Ziel-Teams für SELECTED_TEAMS synchronisieren; bei PRIVATE_ADMIN / TEAM_ONLY entfernen
  const bestehendeShares = await ctx.db.query<{
    id: string;
    team_id: string;
    access_mode: ReelAccessMode;
  }>(
    `SELECT id, team_id, access_mode
     FROM mod_video_team_reel_access
     WHERE reel_id = $1 AND team_id <> $2`,
    [reelId, ownerTeamId]
  );

  if (shareScope === 'SELECTED_TEAMS') {
    const gewuenscht = new Map<
      string,
      { teamName?: string; accessMode: Exclude<ReelAccessMode, 'OWNER'>; allowedFields?: string[] | null }
    >();
    for (const st of payload.sharedTeams ?? []) {
      const tid = (st.teamId ?? '').trim();
      if (!tid || tid === ownerTeamId) continue;
      gewuenscht.set(tid, {
        teamName: st.teamName,
        accessMode: st.accessMode === 'OWN_BREAKDOWN' ? 'OWN_BREAKDOWN' : 'READ_ONLY',
        allowedFields: st.allowedFields ?? null,
      });
    }

    // Entfernte Teams bereinigen
    for (const alt of bestehendeShares.rows) {
      if (!gewuenscht.has(alt.team_id)) {
        await ctx.db.query(`DELETE FROM mod_video_team_reel_access WHERE id = $1`, [alt.id]);
      }
    }

    // Neue / geänderte Teams anlegen oder aktualisieren
    const altByTeam = new Map(bestehendeShares.rows.map((r) => [r.team_id, r]));
    for (const [targetTeamId, cfg] of gewuenscht.entries()) {
      const vorhanden = altByTeam.get(targetTeamId);
      if (vorhanden) {
        await ctx.db.query(
          `UPDATE mod_video_team_reel_access
           SET access_mode = $1, allowed_fields_json = $2::jsonb, updated_at = $3
           WHERE id = $4`,
          [
            cfg.accessMode,
            cfg.allowedFields ? JSON.stringify(cfg.allowedFields) : null,
            now,
            vorhanden.id,
          ]
        );
      } else {
        await ctx.db.query(
          `INSERT INTO mod_video_team_reel_access (
             id, team_id, club_id, reel_id, season, title, category, event_date, visibility,
             access_mode, shared_from_team_id, shared_from_team_name, allowed_fields_json,
             created_by, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ALL_MEMBERS', $9, $10, $11, $12::jsonb, $13, $14, $14)`,
          [
            `acc-${crypto.randomUUID()}`,
            targetTeamId,
            clubId,
            reelId,
            ownerAcc.season,
            ownerAcc.title,
            ownerAcc.category,
            ownerAcc.event_date,
            cfg.accessMode,
            ownerTeamId,
            ownerTeamName,
            cfg.allowedFields ? JSON.stringify(cfg.allowedFields) : null,
            ctx.user.uuid,
            now,
          ]
        );
      }

      if (cfg.accessMode === 'OWN_BREAKDOWN') {
        await klonePlaysZeroCopyFuerTeam(
          ctx.db,
          reelId,
          ownerTeamId,
          targetTeamId,
          cfg.allowedFields ?? null,
          now
        );
      }
    }
  } else if (shareScope === 'PRIVATE_ADMIN' || shareScope === 'TEAM_ONLY') {
    for (const alt of bestehendeShares.rows) {
      await ctx.db.query(`DELETE FROM mod_video_team_reel_access WHERE id = $1`, [alt.id]);
    }
  }

  // Zero-Copy ref_count exakt mit Anzahl der Zugriffszeilen abgleichen
  const countRes = await ctx.db.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM mod_video_team_reel_access WHERE reel_id = $1`,
    [reelId]
  );
  const refCount = Math.max(1, Number(countRes.rows[0]?.cnt ?? 1));
  await ctx.db.query(`UPDATE mod_video_media_reels SET ref_count = $1 WHERE id = $2`, [
    refCount,
    reelId,
  ]);

  return { status: 200, body: { ok: true, refCount } };
}

export const backendPlugin: SidelineBackendPlugin = {
  manifest: manifest as SidelineBackendPlugin['manifest'],
  migrations: [
    { name: '001_video_schema.sql', sql: sql001 },
    { name: '002_video_annotations_and_sharing.sql', sql: sql002 },
    { name: '003_sdk_v2_club_sharing_and_seasons.sql', sql: sql003 },
  ],

  async handleRequest(req, ctx): Promise<RouteAntwort> {
    const pfad = normalisierePfad(req.path);
    const method = req.method.toUpperCase();
    const istStaffOderAdmin = istStaffOderAdminRolle(ctx.effektiveTeamRolle);
    const istTeamAdmin = istTeamAdminKontext(ctx);
    const istClubAdmin = istClubAdminKontext(ctx);

    if (ctx.club && ctx.team) {
      await registriereAktuellesTeam(ctx);
    }

    // --- 0. Benutzer-Präferenzen (Account-/Team-übergreifend, auch bei archiviertem Team erlaubt) ---
    if (method === 'GET' && pfad === '/prefs') {
      const res = await ctx.db.query<{
        user_uuid: string;
        hotkeys_json: unknown;
        default_corner: BenutzerVideoPraeferenzen['defaultCorner'];
        default_playback_rate: number;
        auto_stop_enabled: boolean;
        updated_at: string;
      }>(
        `SELECT user_uuid, hotkeys_json, default_corner, default_playback_rate, auto_stop_enabled, updated_at
         FROM mod_video_user_prefs WHERE user_uuid = $1 LIMIT 1`,
        [ctx.user.uuid]
      );
      if (res.rows.length === 0) {
        return {
          status: 200,
          body: {
            prefs: {
              userUuid: ctx.user.uuid,
              hotkeys: STANDARD_HOTKEYS,
              defaultCorner: 'top-right',
              defaultPlaybackRate: 1,
              autoStopEnabled: true,
              updatedAt: new Date().toISOString(),
            } satisfies BenutzerVideoPraeferenzen,
          },
        };
      }
      const row = res.rows[0];
      return {
        status: 200,
        body: {
          prefs: {
            userUuid: row.user_uuid,
            hotkeys: bereinigeHotkeyBelegung(parseJson(row.hotkeys_json, {})),
            defaultCorner: row.default_corner ?? 'top-right',
            defaultPlaybackRate: Number(row.default_playback_rate ?? 1),
            autoStopEnabled: Boolean(row.auto_stop_enabled),
            updatedAt: row.updated_at,
          } satisfies BenutzerVideoPraeferenzen,
        },
      };
    }

    if (method === 'PUT' && pfad === '/prefs') {
      const body = (req.body ?? {}) as Partial<BenutzerVideoPraeferenzen>;
      const hotkeys = bereinigeHotkeyBelegung(body.hotkeys);
      const defaultCorner = body.defaultCorner ?? 'top-right';
      const defaultPlaybackRate = Number(body.defaultPlaybackRate ?? 1);
      const autoStopEnabled = body.autoStopEnabled !== false;
      const now = new Date().toISOString();

      await ctx.db.query(
        `INSERT INTO mod_video_user_prefs (
           user_uuid, hotkeys_json, default_corner, default_playback_rate, auto_stop_enabled, updated_at
         ) VALUES ($1, $2::jsonb, $3, $4, $5, $6)
         ON CONFLICT (user_uuid) DO UPDATE SET
           hotkeys_json = EXCLUDED.hotkeys_json,
           default_corner = EXCLUDED.default_corner,
           default_playback_rate = EXCLUDED.default_playback_rate,
           auto_stop_enabled = EXCLUDED.auto_stop_enabled,
           updated_at = EXCLUDED.updated_at`,
        [
          ctx.user.uuid,
          JSON.stringify(hotkeys),
          defaultCorner,
          defaultPlaybackRate,
          autoStopEnabled,
          now,
        ]
      );
      return {
        status: 200,
        body: {
          prefs: {
            userUuid: ctx.user.uuid,
            hotkeys,
            defaultCorner,
            defaultPlaybackRate,
            autoStopEnabled,
            updatedAt: now,
          },
        },
      };
    }

    // --- 1. Vereinsweite Endpunkte (Club-Scope & Vereins-Team-Liste, #10) ---
    if (method === 'GET' && pfad === '/club/teams') {
      if (!ctx.club) {
        return { status: 400, body: { fehler: 'Kein Vereins-Kontext vorhanden.' } };
      }
      const res = await ctx.db.query<{
        club_id: string;
        team_id: string;
        team_name: string;
        team_slug: string;
        team_status: 'ACTIVE' | 'ARCHIVED';
        last_seen_at: string;
      }>(
        `SELECT club_id, team_id, team_name, team_slug, team_status, last_seen_at
         FROM mod_video_club_teams
         WHERE club_id = $1
         ORDER BY team_name ASC`,
        [ctx.club.id]
      );
      const teams: ClubTeamInfo[] = res.rows.map((r) => ({
        clubId: r.club_id,
        teamId: r.team_id,
        teamName: r.team_name,
        teamSlug: r.team_slug,
        teamStatus: r.team_status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
        lastSeenAt: r.last_seen_at,
      }));
      return { status: 200, body: { teams } };
    }

    if (method === 'GET' && pfad === '/club/reels') {
      if (!ctx.club) {
        return { status: 400, body: { fehler: 'Kein Vereins-Kontext vorhanden.' } };
      }
      if (!istClubAdmin) {
        return {
          status: 403,
          body: { fehler: 'Nur Vereins-Admins dürfen alle Videos des Vereins verwalten.' },
        };
      }

      const [teamsRes, mediaRes] = await Promise.all([
        ctx.db.query<{
          club_id: string;
          team_id: string;
          team_name: string;
          team_slug: string;
          team_status: 'ACTIVE' | 'ARCHIVED';
          last_seen_at: string;
        }>(
          `SELECT club_id, team_id, team_name, team_slug, team_status, last_seen_at
           FROM mod_video_club_teams
           WHERE club_id = $1
           ORDER BY team_name ASC`,
          [ctx.club.id]
        ),
        ctx.db.query<{
          reel_id: string;
          owner_club_id: string;
          owner_team_id: string;
          owner_team_name: string;
          share_scope: ReelShareScope;
          club_wide_access_mode: Exclude<ReelAccessMode, 'OWNER'>;
          ref_count: number;
          total_size_bytes: number;
          season: string;
          title: string;
          category: VideoKategorie;
          event_date: string;
          visibility: SichtbarkeitsStufe;
          created_by: string;
          created_at: string;
          updated_at: string;
        }>(
          `SELECT m.id AS reel_id, m.owner_club_id, m.owner_team_id, m.owner_team_name,
                  m.share_scope, m.club_wide_access_mode, m.ref_count, m.total_size_bytes,
                  a.season, a.title, a.category, a.event_date, a.visibility,
                  a.created_by, a.created_at, a.updated_at
           FROM mod_video_media_reels m
           JOIN mod_video_team_reel_access a
             ON a.reel_id = m.id AND (a.access_mode = 'OWNER' OR a.shared_from_team_id IS NULL)
           WHERE m.owner_club_id = $1 OR a.club_id = $1
           ORDER BY a.event_date DESC, a.created_at DESC`,
          [ctx.club.id]
        ),
      ]);

      const teamMap = new Map(teamsRes.rows.map((t) => [t.team_id, t.team_name]));
      const reels: ClubReelUebersicht[] = [];

      for (const row of mediaRes.rows) {
        const [sharesRes, metaRes] = await Promise.all([
          ctx.db.query<{
            team_id: string;
            access_mode: ReelAccessMode;
            allowed_fields_json: unknown;
          }>(
            `SELECT team_id, access_mode, allowed_fields_json
             FROM mod_video_team_reel_access
             WHERE reel_id = $1 AND team_id <> $2`,
            [row.reel_id, row.owner_team_id]
          ),
          ctx.db.query<{ play_count: number; angle_code: string | null }>(
            `SELECT COUNT(DISTINCT p.id)::int AS play_count,
                    STRING_AGG(DISTINCT ang.angle_code, ',') AS angle_code
             FROM mod_video_plays p
             LEFT JOIN mod_video_play_angles ang ON ang.play_id = p.id
             WHERE p.reel_id = $1 AND p.team_id = $2`,
            [row.reel_id, row.owner_team_id]
          ),
        ]);

        const sharedTeams: TeamReelFreigabeEintrag[] = sharesRes.rows.map((s) => ({
          teamId: s.team_id,
          teamName: teamMap.get(s.team_id) ?? s.team_id,
          accessMode: s.access_mode === 'OWN_BREAKDOWN' ? 'OWN_BREAKDOWN' : 'READ_ONLY',
          allowedFields: parseJson<string[] | null>(s.allowed_fields_json, null),
        }));

        const rawAngles = metaRes.rows[0]?.angle_code ?? '';
        const angles = rawAngles ? rawAngles.split(',').filter(Boolean) : ['SIDELINE'];

        reels.push({
          reelId: row.reel_id,
          ownerClubId: row.owner_club_id || ctx.club.id,
          ownerTeamId: row.owner_team_id,
          ownerTeamName: row.owner_team_name || teamMap.get(row.owner_team_id) || row.owner_team_id,
          season: row.season,
          title: row.title,
          category: row.category,
          eventDate: row.event_date,
          visibility: normalisiereSichtbarkeit(row.visibility),
          shareScope: (row.share_scope as ReelShareScope) || 'TEAM_ONLY',
          clubWideAccessMode:
            row.club_wide_access_mode === 'OWN_BREAKDOWN' ? 'OWN_BREAKDOWN' : 'READ_ONLY',
          sharedTeams,
          refCount: Number(row.ref_count ?? 1),
          totalSizeBytes: Number(row.total_size_bytes ?? 0),
          playCount: Number(metaRes.rows[0]?.play_count ?? 0),
          angles,
          createdBy: row.created_by,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      }

      const teams: ClubTeamInfo[] = teamsRes.rows.map((r) => ({
        clubId: r.club_id,
        teamId: r.team_id,
        teamName: r.team_name,
        teamSlug: r.team_slug,
        teamStatus: r.team_status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
        lastSeenAt: r.last_seen_at,
      }));

      return {
        status: 200,
        body: {
          reels,
          teams,
          speicher: ctx.club.speicher ?? null,
        },
      };
    }

    const clubSharingMatch = pfad.match(/^\/club\/reels\/([^/]+)\/sharing$/);
    if (method === 'PATCH' && clubSharingMatch) {
      if (!istClubAdmin) {
        return {
          status: 403,
          body: { fehler: 'Nur Vereins-Admins dürfen vereinsweite Freigaben ändern.' },
        };
      }
      const reelId = decodeURIComponent(clubSharingMatch[1]);
      return aktualisiereReelFreigabeLogik(ctx, reelId, (req.body ?? {}) as never);
    }

    const clubDeleteMatch = pfad.match(/^\/club\/reels\/([^/]+)$/);
    if (method === 'DELETE' && clubDeleteMatch) {
      if (!istClubAdmin) {
        return {
          status: 403,
          body: { fehler: 'Nur Vereins-Admins dürfen Reels vereinsweit löschen.' },
        };
      }
      const reelId = decodeURIComponent(clubDeleteMatch[1]);
      const objRes = await ctx.db.query<{ s3_key: string; file_size_bytes: number }>(
        `SELECT DISTINCT s3_key, file_size_bytes FROM mod_video_play_angles WHERE reel_id = $1`,
        [reelId]
      );
      if (ctx.storage) {
        for (const obj of objRes.rows) {
          const p = bereinigeStorageObjektPfad(obj.s3_key, ctx.storage.prefix);
          if (p) {
            await ctx.storage.deleteObject(p, Number(obj.file_size_bytes ?? 0)).catch(() => undefined);
          }
        }
      }
      await ctx.db.query(`DELETE FROM mod_video_media_reels WHERE id = $1`, [reelId]);
      return { status: 200, body: { ok: true } };
    }

    // --- Ab hier ist ein aktiver Team-Kontext erforderlich ---
    if (!ctx.team) {
      return {
        status: 400,
        body: { fehler: 'Für diese Route ist ein aktiver Team-Kontext erforderlich.' },
      };
    }

    // Globaler Archiv-Lesemodus-Schutz (HTTP 409) für alle mutierenden Team-Routen
    if (ctx.isReadOnly && istSchreibMethode(method)) {
      return READ_ONLY_ANTWORT;
    }

    const teamId = ctx.team.id;
    const clubId = ctx.club?.id ?? ctx.team.clubId ?? '';

    // --- 2. Plugin-Saisons (SDK v2.0) ---
    if (method === 'GET' && pfad === '/seasons') {
      const daten = await ladeOderErstelleSaisons(ctx.db, teamId, clubId);
      return { status: 200, body: daten };
    }

    if (method === 'POST' && pfad === '/seasons') {
      if (!istStaffOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Staff oder Team-Admins dürfen Saisons anlegen.' } };
      }
      const body = (req.body ?? {}) as { name?: string; setActive?: boolean };
      const name = (body.name ?? '').trim();
      if (!name || name.length > 40) {
        return { status: 400, body: { fehler: 'Gültiger Saison-Name erforderlich (1–40 Zeichen).' } };
      }
      const id = `ssn-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const setActive = body.setActive !== false;

      if (setActive) {
        await ctx.db.query(`UPDATE mod_video_seasons SET is_active = FALSE WHERE team_id = $1`, [
          teamId,
        ]);
      }

      await ctx.db.query(
        `INSERT INTO mod_video_seasons (id, club_id, team_id, name, is_active, sort_order, created_at)
         VALUES ($1, $2, $3, $4, $5, 100, $6)
         ON CONFLICT (team_id, name) DO UPDATE SET is_active = EXCLUDED.is_active`,
        [id, clubId, teamId, name, setActive, now]
      );

      return {
        status: 201,
        body: {
          season: {
            id,
            clubId,
            teamId,
            name,
            isActive: setActive,
            sortOrder: 100,
            createdAt: now,
          } satisfies PluginSaisonEintrag,
        },
      };
    }

    const seasonMatch = pfad.match(/^\/seasons\/([^/]+)$/);
    if (method === 'PATCH' && seasonMatch) {
      if (!istStaffOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Staff oder Team-Admins dürfen die aktive Saison ändern.' } };
      }
      const seasonId = decodeURIComponent(seasonMatch[1]);
      await ctx.db.query(`UPDATE mod_video_seasons SET is_active = FALSE WHERE team_id = $1`, [
        teamId,
      ]);
      await ctx.db.query(
        `UPDATE mod_video_seasons SET is_active = TRUE WHERE id = $1 AND team_id = $2`,
        [seasonId, teamId]
      );
      return { status: 200, body: { ok: true } };
    }

    // --- 3. Team-Tagging-Schema, Lernendes Wörterbuch & Gruppen-Farbcodes ---
    if (method === 'GET' && pfad === '/schema') {
      const schema = await ladeTeamSchema(ctx.db, teamId);
      return { status: 200, body: { schema } };
    }

    if (method === 'PUT' && pfad === '/schema') {
      if (!istStaffOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Staff oder Team-Admins dürfen das Schema anpassen.' } };
      }
      const body = (req.body ?? {}) as Partial<TeamTaggingSchema>;
      const aktuell = await ladeTeamSchema(ctx.db, teamId);
      const neueFelder = Array.isArray(body.fields) ? body.fields : aktuell.fields;
      const neuesDict =
        body.dictionary && typeof body.dictionary === 'object'
          ? body.dictionary
          : aktuell.dictionary;

      let wurdeGeloescht = false;
      for (const [key, altListe] of Object.entries(aktuell.dictionary)) {
        const neuListe = new Set((neuesDict[key] ?? []).map((x) => x.toLowerCase()));
        if (altListe.some((e) => !neuListe.has(e.toLowerCase()))) {
          wurdeGeloescht = true;
          break;
        }
      }
      if (wurdeGeloescht && !istTeamAdmin) {
        return {
          status: 403,
          body: { fehler: 'Nur Team- oder Vereins-Admins dürfen Einträge aus dem Wörterbuch löschen.' },
        };
      }

      const aktuelleFreigabe = bereinigeAnmerkungsKonfig(aktuell.annotationSharing);
      const neueFreigabe =
        body.annotationSharing !== undefined
          ? bereinigeAnmerkungsKonfig(body.annotationSharing)
          : aktuelleFreigabe;

      const freigabeGeaendert =
        JSON.stringify(neueFreigabe) !== JSON.stringify(aktuelleFreigabe);
      if (freigabeGeaendert && !istTeamAdmin) {
        return {
          status: 403,
          body: { fehler: 'Nur Team- oder Vereins-Admins dürfen Gruppen-Farbcodes ändern.' },
        };
      }

      const now = new Date().toISOString();
      const neuesSchema: TeamTaggingSchema = {
        teamId,
        fields: neueFelder,
        dictionary: neuesDict,
        annotationSharing: neueFreigabe,
        updatedAt: now,
      };
      await speichereTeamSchemaFelderUndDict(ctx.db, teamId, neuesSchema, now);
      return { status: 200, body: { schema: neuesSchema } };
    }

    // --- 4. Storage Presigned & Multipart-Upload-Proxy (SDK v2.0 ctx.storage inkl. Quota) ---
    if (method === 'POST' && (pfad === '/storage/presign-upload' || pfad === '/s3/presign-upload')) {
      if (!istStaffOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Staff oder Team-Admins dürfen Videos hochladen.' } };
      }
      if (!ctx.storage) {
        return { status: 503, body: { fehler: 'Storage-Broker ist im Core nicht konfiguriert.' } };
      }
      const body = (req.body ?? {}) as {
        objectPath?: string;
        contentType?: string;
        fileSizeBytes?: number;
      };
      const objPath = bereinigeStorageObjektPfad(body.objectPath, ctx.storage.prefix);
      if (!objPath) return { status: 400, body: { fehler: 'Ungültiger objectPath.' } };
      try {
        const signed = await ctx.storage.getSignedUploadUrl({
          objectPath: objPath,
          contentType: body.contentType,
          fileSizeBytes: body.fileSizeBytes,
        });
        return { status: 200, body: signed };
      } catch (err) {
        return mappeStorageFehler(err);
      }
    }

    if (method === 'POST' && (pfad === '/storage/multipart/init' || pfad === '/s3/multipart/init')) {
      if (!istStaffOderAdmin || !ctx.storage) {
        return {
          status: istStaffOderAdmin ? 503 : 403,
          body: { fehler: 'Storage-Upload nicht verfügbar.' },
        };
      }
      const body = (req.body ?? {}) as {
        objectPath?: string;
        contentType?: string;
        fileSizeBytes?: number;
      };
      const objPath = bereinigeStorageObjektPfad(body.objectPath, ctx.storage.prefix);
      if (!objPath) return { status: 400, body: { fehler: 'Ungültiger objectPath.' } };
      try {
        const init = await ctx.storage.initiateMultipartUpload({
          objectPath: objPath,
          contentType: body.contentType,
          fileSizeBytes: body.fileSizeBytes,
        });
        return { status: 200, body: init };
      } catch (err) {
        return mappeStorageFehler(err);
      }
    }

    if (method === 'POST' && (pfad === '/storage/multipart/part' || pfad === '/s3/multipart/part')) {
      if (!istStaffOderAdmin || !ctx.storage) {
        return {
          status: istStaffOderAdmin ? 503 : 403,
          body: { fehler: 'Storage-Upload nicht verfügbar.' },
        };
      }
      const body = (req.body ?? {}) as { objectPath?: string; uploadId?: string; partNumber?: number };
      const objPath = bereinigeStorageObjektPfad(body.objectPath, ctx.storage.prefix);
      if (!objPath || !body.uploadId || !body.partNumber) {
        return { status: 400, body: { fehler: 'objectPath, uploadId und partNumber erforderlich.' } };
      }
      try {
        const part = await ctx.storage.getSignedMultipartPartUrl({
          objectPath: objPath,
          uploadId: body.uploadId,
          partNumber: Number(body.partNumber),
        });
        return { status: 200, body: part };
      } catch (err) {
        return mappeStorageFehler(err);
      }
    }

    if (
      method === 'POST' &&
      (pfad === '/storage/multipart/complete' || pfad === '/s3/multipart/complete')
    ) {
      if (!istStaffOderAdmin || !ctx.storage) {
        return {
          status: istStaffOderAdmin ? 503 : 403,
          body: { fehler: 'Storage-Upload nicht verfügbar.' },
        };
      }
      const body = (req.body ?? {}) as {
        objectPath?: string;
        uploadId?: string;
        parts?: Array<{ partNumber: number; etag: string }>;
      };
      const objPath = bereinigeStorageObjektPfad(body.objectPath, ctx.storage.prefix);
      if (!objPath || !body.uploadId || !Array.isArray(body.parts)) {
        return { status: 400, body: { fehler: 'Ungültige Multipart-Abschlussdaten.' } };
      }
      try {
        const ergebnis = await ctx.storage.completeMultipartUpload({
          objectPath: objPath,
          uploadId: body.uploadId,
          parts: body.parts,
        });
        return { status: 200, body: ergebnis };
      } catch (err) {
        return mappeStorageFehler(err);
      }
    }

    if (method === 'POST' && (pfad === '/storage/multipart/abort' || pfad === '/s3/multipart/abort')) {
      if (!istStaffOderAdmin || !ctx.storage) {
        return {
          status: istStaffOderAdmin ? 503 : 403,
          body: { fehler: 'Storage-Upload nicht verfügbar.' },
        };
      }
      const body = (req.body ?? {}) as { objectPath?: string; uploadId?: string };
      const objPath = bereinigeStorageObjektPfad(body.objectPath, ctx.storage.prefix);
      if (!objPath || !body.uploadId) {
        return { status: 400, body: { fehler: 'objectPath und uploadId erforderlich.' } };
      }
      await ctx.storage.abortMultipartUpload({ objectPath: objPath, uploadId: body.uploadId });
      return { status: 200, body: { ok: true } };
    }

    // --- 5. Reels Liste (inkl. Vereinsweiter Freigaben) & Import (+ optional Hudl CSV Custom-Felder) ---
    if (method === 'GET' && pfad === '/reels') {
      const seasonQuery = typeof req.query.season === 'string' ? req.query.season : 'ALL';

      const directRows = await ctx.db.query<{
        id: string;
        reel_id: string;
        team_id: string;
        club_id: string;
        season: string;
        title: string;
        category: VideoKategorie;
        event_date: string;
        visibility: SichtbarkeitsStufe;
        access_mode: ReelAccessMode;
        shared_from_team_id: string | null;
        shared_from_team_name: string | null;
        allowed_fields_json: unknown;
        created_by: string;
        created_at: string;
        updated_at: string;
        owner_team_id: string | null;
        owner_team_name: string | null;
        share_scope: ReelShareScope | null;
        club_wide_access_mode: Exclude<ReelAccessMode, 'OWNER'> | null;
        ref_count: number | null;
        total_size_bytes: number | null;
      }>(
        `SELECT a.id, a.reel_id, a.team_id, a.club_id, a.season, a.title, a.category, a.event_date,
                a.visibility, a.access_mode, a.shared_from_team_id, a.shared_from_team_name,
                a.allowed_fields_json, a.created_by, a.created_at, a.updated_at,
                m.owner_team_id, m.owner_team_name, m.share_scope, m.club_wide_access_mode,
                m.ref_count, m.total_size_bytes
         FROM mod_video_team_reel_access a
         LEFT JOIN mod_video_media_reels m ON m.id = a.reel_id
         WHERE a.team_id = $1 AND ($2 = 'ALL' OR a.season = $2)
         ORDER BY a.event_date DESC, a.created_at DESC`,
        [teamId, seasonQuery]
      );

      const geseheneReelIds = new Set<string>();
      const kandidaten: GeloesterReelZugriff[] = [];

      for (const row of directRows.rows) {
        geseheneReelIds.add(row.reel_id);
        const accessMode: ReelAccessMode =
          row.access_mode || (row.shared_from_team_id ? 'READ_ONLY' : 'OWNER');
        kandidaten.push({
          accessId: row.id,
          reelId: row.reel_id,
          teamId: row.team_id,
          clubId: row.club_id || clubId,
          ownerTeamId: row.owner_team_id || row.shared_from_team_id || row.team_id,
          ownerTeamName: row.owner_team_name || row.shared_from_team_name || ctx.team.name,
          season: row.season,
          title: row.title,
          category: row.category,
          eventDate: row.event_date,
          visibility: normalisiereSichtbarkeit(row.visibility),
          shareScope: (row.share_scope as ReelShareScope) || 'TEAM_ONLY',
          clubWideAccessMode:
            row.club_wide_access_mode === 'OWN_BREAKDOWN' ? 'OWN_BREAKDOWN' : 'READ_ONLY',
          accessMode,
          sharedFromTeamId: row.shared_from_team_id,
          sharedFromTeamName: row.shared_from_team_name,
          allowedFields: parseJson<string[] | null>(row.allowed_fields_json, null),
          refCount: Number(row.ref_count ?? 1),
          totalSizeBytes: Number(row.total_size_bytes ?? 0),
          createdBy: row.created_by,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          istVirtuellerClubZugriff: false,
        });
      }

      // Zusätzlich alle CLUB_WIDE-Reels aus demselben Verein laden, die noch keinen direkten Zugriffseintrag haben
      if (clubId) {
        const clubWideRows = await ctx.db.query<{
          reel_id: string;
          owner_team_id: string;
          owner_team_name: string;
          club_wide_access_mode: Exclude<ReelAccessMode, 'OWNER'>;
          ref_count: number;
          total_size_bytes: number;
          season: string;
          title: string;
          category: VideoKategorie;
          event_date: string;
          visibility: SichtbarkeitsStufe;
          created_by: string;
          created_at: string;
          updated_at: string;
        }>(
          `SELECT m.id AS reel_id, m.owner_team_id, m.owner_team_name, m.club_wide_access_mode,
                  m.ref_count, m.total_size_bytes,
                  a.season, a.title, a.category, a.event_date, a.visibility,
                  a.created_by, a.created_at, a.updated_at
           FROM mod_video_media_reels m
           JOIN mod_video_team_reel_access a
             ON a.reel_id = m.id AND (a.access_mode = 'OWNER' OR a.shared_from_team_id IS NULL)
           WHERE m.owner_club_id = $1
             AND m.share_scope = 'CLUB_WIDE'
             AND m.owner_team_id <> $2
             AND ($3 = 'ALL' OR a.season = $3)
           ORDER BY a.event_date DESC, a.created_at DESC`,
          [clubId, teamId, seasonQuery]
        );

        for (const row of clubWideRows.rows) {
          if (geseheneReelIds.has(row.reel_id)) continue;
          const mode: Exclude<ReelAccessMode, 'OWNER'> =
            row.club_wide_access_mode === 'OWN_BREAKDOWN' ? 'OWN_BREAKDOWN' : 'READ_ONLY';
          kandidaten.push({
            accessId: `club-virtual-${row.reel_id}-${teamId}`,
            reelId: row.reel_id,
            teamId,
            clubId,
            ownerTeamId: row.owner_team_id,
            ownerTeamName: row.owner_team_name || row.owner_team_id,
            season: row.season,
            title: row.title,
            category: row.category,
            eventDate: row.event_date,
            visibility: normalisiereSichtbarkeit(row.visibility),
            shareScope: 'CLUB_WIDE',
            clubWideAccessMode: mode,
            accessMode: mode,
            sharedFromTeamId: row.owner_team_id,
            sharedFromTeamName: row.owner_team_name || row.owner_team_id,
            allowedFields: null,
            refCount: Number(row.ref_count ?? 1),
            totalSizeBytes: Number(row.total_size_bytes ?? 0),
            createdBy: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            istVirtuellerClubZugriff: true,
          });
        }
      }

      const reels: VideoReelEintrag[] = [];
      for (const k of kandidaten) {
        if (!darfBenutzerReelSehen(ctx, k)) continue;
        const playTeamId =
          k.accessMode === 'READ_ONLY' || k.istVirtuellerClubZugriff ? k.ownerTeamId : teamId;

        const metaRes = await ctx.db.query<{ play_count: number; angle_code: string | null }>(
          `SELECT COUNT(DISTINCT p.id)::int AS play_count,
                  STRING_AGG(DISTINCT ang.angle_code, ',') AS angle_code
           FROM mod_video_plays p
           LEFT JOIN mod_video_play_angles ang ON ang.play_id = p.id
           WHERE p.reel_id = $1 AND p.team_id = $2`,
          [k.reelId, playTeamId]
        );
        const rawAngles = metaRes.rows[0]?.angle_code ?? '';
        const angles = rawAngles ? rawAngles.split(',').filter(Boolean) : ['SIDELINE'];

        reels.push({
          id: k.reelId,
          accessId: k.accessId,
          teamId: k.teamId,
          clubId: k.clubId,
          saison: k.season,
          title: k.title,
          category: k.category,
          eventDate: k.eventDate,
          visibility: k.visibility,
          angles,
          playCount: Number(metaRes.rows[0]?.play_count ?? 0),
          sharedFromTeamId: k.sharedFromTeamId,
          sharedFromTeamName: k.sharedFromTeamName,
          allowedFields: k.allowedFields,
          shareScope: k.shareScope,
          clubWideAccessMode: k.clubWideAccessMode,
          accessMode: k.accessMode,
          canEdit: darfBenutzerReelBearbeiten(ctx, k),
          canManageSharing:
            !ctx.isReadOnly && (istClubAdmin || (k.accessMode === 'OWNER' && istStaffOderAdmin)),
          refCount: k.refCount,
          totalSizeBytes: k.totalSizeBytes,
          createdBy: k.createdBy,
          createdAt: k.createdAt,
          updatedAt: k.updatedAt,
        });
      }

      return { status: 200, body: { reels } };
    }

    if (method === 'POST' && pfad === '/reels') {
      if (!istStaffOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Staff oder Team-Admins dürfen Reels anlegen.' } };
      }

      const body = (req.body ?? {}) as {
        bundle?: unknown;
        title?: string;
        category?: VideoKategorie;
        eventDate?: string;
        season?: string;
        visibility?: SichtbarkeitsStufe;
        shareScope?: ReelShareScope;
        clubWideAccessMode?: Exclude<ReelAccessMode, 'OWNER'>;
        newCustomFields?: TaggingFeldKonfig[];
        plays?: Array<{
          playNumber: number;
          breakdown?: PlayBreakdownDaten;
          sources: Record<
            string,
            {
              fileName: string;
              s3Key: string;
              sourceMode: QuellenModus;
              startMs: number;
              endMs: number;
              offsetMs?: number | null;
              fileSizeBytes?: number;
            }
          >;
        }>;
      };

      const saisonDaten = await ladeOderErstelleSaisons(ctx.db, teamId, clubId);
      let title = (body.title ?? '').trim();
      let category: VideoKategorie = body.category ?? 'GAME';
      let eventDate = body.eventDate ?? new Date().toISOString().slice(0, 10);
      let visibility: SichtbarkeitsStufe = normalisiereSichtbarkeit(body.visibility ?? 'STAFF_ONLY');
      const season = (body.season ?? saisonDaten.activeSeason) || eventDate.slice(0, 4);
      const shareScope: ReelShareScope = body.shareScope ?? 'TEAM_ONLY';
      const clubWideAccessMode: Exclude<ReelAccessMode, 'OWNER'> =
        body.clubWideAccessMode === 'OWN_BREAKDOWN' ? 'OWN_BREAKDOWN' : 'READ_ONLY';
      let playsInput = body.plays ?? [];

      if (body.bundle !== undefined) {
        const validiert = validiereSidelineBundle(body.bundle);
        if (!validiert.ok) {
          return { status: 400, body: { fehler: validiert.fehler.join(' ') } };
        }
        const b = validiert.bundle;
        title = b.reel.title.trim();
        category = b.reel.category;
        eventDate = b.reel.event_date;
        visibility = normalisiereSichtbarkeit(b.reel.visibility ?? 'STAFF_ONLY');
        playsInput = b.plays.map((p) => ({
          playNumber: p.play_number,
          breakdown: p.breakdown ?? {},
          sources: Object.fromEntries(
            Object.entries(p.sources).map(([angle, src]) => [
              angle,
              {
                fileName: src.file,
                s3Key: `${ctx.storage?.prefix ?? `clubs/${clubId}/teams/${teamId}/video/`}${src.file}`,
                sourceMode: src.source_mode ?? 'CLIP_FILE',
                startMs: src.start_ms,
                endMs: src.end_ms,
                offsetMs: src.offset_ms ?? null,
              },
            ])
          ),
        }));
      }

      if (!title) {
        return { status: 400, body: { fehler: 'Titel des Video-Reels ist erforderlich.' } };
      }

      const uniqueKeysSize = new Map<string, number>();
      for (const p of playsInput) {
        for (const src of Object.values(p.sources ?? {})) {
          if (src.s3Key && !uniqueKeysSize.has(src.s3Key)) {
            uniqueKeysSize.set(src.s3Key, Number(src.fileSizeBytes ?? 0));
          }
        }
      }
      const totalSizeBytes = Array.from(uniqueKeysSize.values()).reduce((sum, n) => sum + n, 0);

      const reelId = `reel-${crypto.randomUUID()}`;
      const accessId = `acc-${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      await ctx.db.query(
        `INSERT INTO mod_video_media_reels (
           id, ref_count, owner_club_id, owner_team_id, owner_team_name,
           share_scope, club_wide_access_mode, total_size_bytes, created_by, created_at
         ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          reelId,
          clubId,
          teamId,
          ctx.team.name,
          shareScope,
          clubWideAccessMode,
          totalSizeBytes,
          ctx.user.uuid,
          now,
        ]
      );

      await ctx.db.query(
        `INSERT INTO mod_video_team_reel_access (
           id, team_id, club_id, reel_id, season, title, category, event_date, visibility,
           access_mode, created_by, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'OWNER', $10, $11, $11)`,
        [accessId, teamId, clubId, reelId, season, title, category, eventDate, visibility, ctx.user.uuid, now]
      );

      let aktuellesSchema = await ladeTeamSchema(ctx.db, teamId);
      let schemaGeaendert = false;

      if (Array.isArray(body.newCustomFields) && body.newCustomFields.length > 0) {
        const existingKeys = new Set(aktuellesSchema.fields.map((f) => f.key));
        const ergaenzte = [...aktuellesSchema.fields];
        for (const nf of body.newCustomFields) {
          if (nf.key && !existingKeys.has(nf.key)) {
            ergaenzte.push({ ...nf, custom: true, aktiv: true });
            existingKeys.add(nf.key);
            schemaGeaendert = true;
          }
        }
        aktuellesSchema = { ...aktuellesSchema, fields: ergaenzte };
      }

      for (let idx = 0; idx < playsInput.length; idx += 1) {
        const p = playsInput[idx];
        const playId = `play-${crypto.randomUUID()}`;
        const breakdown = p.breakdown ?? {};
        await ctx.db.query(
          `INSERT INTO mod_video_plays (id, reel_id, team_id, play_number, sort_order, breakdown_json, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)`,
          [playId, reelId, teamId, p.playNumber || idx + 1, idx + 1, JSON.stringify(breakdown), now]
        );

        for (const [feldKey, feldWert] of Object.entries(breakdown)) {
          if (typeof feldWert === 'string' && feldWert.trim()) {
            const aktualisiert = ergaenzeTeamWoerterbuch(aktuellesSchema, feldKey, feldWert);
            if (aktualisiert !== aktuellesSchema) {
              aktuellesSchema = aktualisiert;
              schemaGeaendert = true;
            }
          }
        }

        for (const [angleCode, src] of Object.entries(p.sources ?? {})) {
          await ctx.db.query(
            `INSERT INTO mod_video_play_angles (
               id, play_id, reel_id, angle_code, source_mode, s3_key, file_name, file_size_bytes, start_ms, end_ms, offset_ms
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              `ang-${crypto.randomUUID()}`,
              playId,
              reelId,
              angleCode,
              src.sourceMode ?? 'CLIP_FILE',
              src.s3Key,
              src.fileName,
              Number(src.fileSizeBytes ?? 0),
              Number(src.startMs ?? 0),
              Number(src.endMs ?? 0),
              src.offsetMs === undefined ? null : src.offsetMs,
            ]
          );
        }
      }

      if (schemaGeaendert) {
        await speichereTeamSchemaFelderUndDict(ctx.db, teamId, aktuellesSchema, now);
      }

      if (visibility !== 'STAFF_ONLY' && shareScope !== 'PRIVATE_ADMIN') {
        await ctx.notifications?.send({
          eventType: 'video.reel_published',
          title: `Neues Video freigegeben: ${title}`,
          message: `${ctx.user.vollerName} hat ein neues Video-Reel (${playsInput.length} Spielzüge) veröffentlicht.`,
          linkPath: '/library',
          priority: 'info',
        });
      }

      return { status: 201, body: { reelId, accessId } };
    }

    // --- 5b. Reel-Sharing-Verwaltung (Owner-Team Staff/Admin oder Club-Admin, #10) ---
    const reelSharingMatch = pfad.match(/^\/reels\/([^/]+)\/sharing$/);
    if (method === 'PATCH' && reelSharingMatch) {
      const reelId = decodeURIComponent(reelSharingMatch[1]);
      const zugriff = await loeseReelZugriffFuerTeamAuf(ctx, reelId);
      if (!zugriff) {
        return { status: 404, body: { fehler: 'Video-Reel nicht gefunden.' } };
      }
      if (!istClubAdmin && !(zugriff.accessMode === 'OWNER' && istStaffOderAdmin)) {
        return {
          status: 403,
          body: { fehler: 'Nur das Eigentümer-Team (Staff/Admin) oder Vereins-Admins dürfen Freigaben ändern.' },
        };
      }
      return aktualisiereReelFreigabeLogik(ctx, reelId, (req.body ?? {}) as never);
    }

    // --- 5c. Nachträglicher Hudl CSV Breakdown Bulk-Import (#9) ---
    const csvImportMatch = pfad.match(/^\/reels\/([^/]+)\/breakdown-import$/);
    if (method === 'POST' && csvImportMatch) {
      const reelId = decodeURIComponent(csvImportMatch[1]);
      const zugriff = await loeseReelZugriffFuerTeamAuf(ctx, reelId);
      if (!zugriff) {
        return { status: 404, body: { fehler: 'Video-Reel nicht gefunden.' } };
      }
      if (!darfBenutzerReelBearbeiten(ctx, zugriff)) {
        return {
          status: 403,
          body: { fehler: 'Keine Bearbeitungsrechte für dieses Reel (Nur-Lese-Freigabe).' },
        };
      }

      const body = (req.body ?? {}) as {
        playPatches?: Array<{
          playId?: string;
          playNumber: number;
          breakdown: PlayBreakdownDaten;
        }>;
        newCustomFields?: TaggingFeldKonfig[];
      };

      const patches = Array.isArray(body.playPatches) ? body.playPatches : [];
      const newFields = Array.isArray(body.newCustomFields) ? body.newCustomFields : [];
      const now = new Date().toISOString();

      let aktuellesSchema = await ladeTeamSchema(ctx.db, teamId);
      let schemaGeaendert = false;
      let addedFields = 0;

      if (newFields.length > 0) {
        const existingKeys = new Set(aktuellesSchema.fields.map((f) => f.key));
        const ergaenzte = [...aktuellesSchema.fields];
        for (const nf of newFields) {
          if (nf.key && !existingKeys.has(nf.key)) {
            ergaenzte.push({ ...nf, custom: true, aktiv: true });
            existingKeys.add(nf.key);
            schemaGeaendert = true;
            addedFields += 1;
          }
        }
        aktuellesSchema = { ...aktuellesSchema, fields: ergaenzte };
      }

      let updatedPlays = 0;
      for (const patch of patches) {
        const breakdown = patch.breakdown ?? {};
        if (patch.playId) {
          await ctx.db.query(
            `UPDATE mod_video_plays
             SET breakdown_json = $1::jsonb, updated_at = $2
             WHERE id = $3 AND reel_id = $4 AND team_id = $5`,
            [JSON.stringify(breakdown), now, patch.playId, reelId, teamId]
          );
          updatedPlays += 1;
        } else if (typeof patch.playNumber === 'number') {
          await ctx.db.query(
            `UPDATE mod_video_plays
             SET breakdown_json = $1::jsonb, updated_at = $2
             WHERE reel_id = $3 AND team_id = $4 AND play_number = $5`,
            [JSON.stringify(breakdown), now, reelId, teamId, patch.playNumber]
          );
          updatedPlays += 1;
        }

        for (const [feldKey, feldWert] of Object.entries(breakdown)) {
          if (typeof feldWert === 'string' && feldWert.trim()) {
            const aktualisiert = ergaenzeTeamWoerterbuch(aktuellesSchema, feldKey, feldWert);
            if (aktualisiert !== aktuellesSchema) {
              aktuellesSchema = aktualisiert;
              schemaGeaendert = true;
            }
          }
        }
      }

      if (schemaGeaendert) {
        await speichereTeamSchemaFelderUndDict(ctx.db, teamId, aktuellesSchema, now);
      }

      return { status: 200, body: { ok: true, updatedPlays, addedFields } };
    }

    // --- 6. Reel Details / Update / Delete + Zero-Copy Storage Cleanup ---
    const reelMatch = pfad.match(/^\/reels\/([^/]+)$/);
    if (reelMatch) {
      const reelId = decodeURIComponent(reelMatch[1]);
      let zugriff = await loeseReelZugriffFuerTeamAuf(ctx, reelId);
      if (!zugriff) {
        return { status: 404, body: { fehler: 'Video-Reel nicht gefunden.' } };
      }
      if (!darfBenutzerReelSehen(ctx, zugriff)) {
        return { status: 403, body: { fehler: 'Keine Sichtbarkeitsberechtigung für dieses Reel.' } };
      }

      if (method === 'GET') {
        // Falls vereinsweit mit OWN_BREAKDOWN und das Team noch keinen eigenen Zugriffseintrag hat -> lazy Zero-Copy materialisieren
        if (
          zugriff.istVirtuellerClubZugriff &&
          zugriff.accessMode === 'OWN_BREAKDOWN' &&
          !ctx.isReadOnly
        ) {
          const now = new Date().toISOString();
          const newAccId = `acc-${crypto.randomUUID()}`;
          await ctx.db.query(
            `INSERT INTO mod_video_team_reel_access (
               id, team_id, club_id, reel_id, season, title, category, event_date, visibility,
               access_mode, shared_from_team_id, shared_from_team_name, created_by, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ALL_MEMBERS', 'OWN_BREAKDOWN', $9, $10, $11, $12, $12)`,
            [
              newAccId,
              teamId,
              clubId,
              reelId,
              zugriff.season,
              zugriff.title,
              zugriff.category,
              zugriff.eventDate,
              zugriff.ownerTeamId,
              zugriff.ownerTeamName,
              ctx.user.uuid,
              now,
            ]
          );
          await klonePlaysZeroCopyFuerTeam(ctx.db, reelId, zugriff.ownerTeamId, teamId, null, now);
          await ctx.db.query(
            `UPDATE mod_video_media_reels SET ref_count = ref_count + 1 WHERE id = $1`,
            [reelId]
          );
          zugriff = {
            ...zugriff,
            accessId: newAccId,
            refCount: zugriff.refCount + 1,
            istVirtuellerClubZugriff: false,
          };
        }

        const quellTeamFuerDaten =
          zugriff.accessMode === 'READ_ONLY' || zugriff.istVirtuellerClubZugriff
            ? zugriff.ownerTeamId
            : teamId;

        const [plays, teamSchema, sharesRes, clubTeamsRes] = await Promise.all([
          ladePlaysFuerReel(
            ctx.db,
            reelId,
            quellTeamFuerDaten,
            zugriff.allowedFields,
            ctx.storage
          ),
          ladeTeamSchema(ctx.db, teamId),
          ctx.db.query<{
            team_id: string;
            access_mode: ReelAccessMode;
            allowed_fields_json: unknown;
          }>(
            `SELECT team_id, access_mode, allowed_fields_json
             FROM mod_video_team_reel_access
             WHERE reel_id = $1 AND team_id <> $2`,
            [reelId, zugriff.ownerTeamId]
          ),
          clubId
            ? ctx.db.query<{ team_id: string; team_name: string }>(
                `SELECT team_id, team_name FROM mod_video_club_teams WHERE club_id = $1`,
                [clubId]
              )
            : Promise.resolve({ rows: [] as Array<{ team_id: string; team_name: string }>, rowCount: 0 }),
        ]);

        const teamNameMap = new Map(clubTeamsRes.rows.map((t) => [t.team_id, t.team_name]));
        const sharingEnabled = teamSchema.annotationSharing?.enabled !== false;
        const istLesendeFreigabe = zugriff.accessMode === 'READ_ONLY';

        const [telRes, notesRes] = await Promise.all([
          ctx.db.query<{
            id: string;
            play_id: string;
            angle_code: string;
            frame_index: number;
            elements_json: unknown;
            created_by: string;
            author_name: string;
            updated_at: string;
          }>(
            `SELECT id, play_id, angle_code, frame_index, elements_json, created_by, author_name, updated_at
             FROM mod_video_telestrations
             WHERE reel_id = $1 AND team_id = $2`,
            [reelId, quellTeamFuerDaten]
          ),
          ctx.db.query<{
            id: string;
            play_id: string;
            angle_code: string;
            frame_index: number;
            text: string;
            status: CoachNotiz['status'];
            visibility: SichtbarkeitsStufe;
            color: string | null;
            corner_position: CoachNotiz['cornerPosition'];
            author_uuid: string;
            author_name: string;
            created_at: string;
            updated_at: string;
          }>(
            `SELECT id, play_id, angle_code, frame_index, text, status, visibility, color, corner_position, author_uuid, author_name, created_at, updated_at
             FROM mod_video_notes
             WHERE reel_id = $1 AND team_id = $2
             ORDER BY frame_index ASC, created_at ASC`,
            [reelId, quellTeamFuerDaten]
          ),
        ]);

        const effektiveRolleFuerFilter = istLesendeFreigabe ? 'MEMBER' : ctx.effektiveTeamRolle;

        const notes: CoachNotiz[] = notesRes.rows
          .filter(
            (n) =>
              (!istLesendeFreigabe && istStaffOderAdmin) ||
              (n.status === 'PUBLISHED' &&
                istAnmerkungFuerBenutzerSichtbar(
                  n.visibility,
                  effektiveRolleFuerFilter,
                  ctx.userGroups,
                  sharingEnabled
                ))
          )
          .map((n) => ({
            id: n.id,
            reelId,
            playId: n.play_id,
            angleCode: n.angle_code,
            frameIndex: Number(n.frame_index),
            text: n.text,
            status: n.status,
            visibility: normalisiereSichtbarkeit(n.visibility),
            color: n.color ?? undefined,
            cornerPosition: n.corner_position,
            authorUuid: n.author_uuid,
            authorName: n.author_name,
            createdAt: n.created_at,
            updatedAt: n.updated_at,
          }));

        const telestrations = telRes.rows
          .map((t) => {
            const alleElemente = parseJson<TelestrationElement[]>(t.elements_json, []);
            const sichtbareElemente = filtereTelestrationElementeFuerBenutzer(
              alleElemente,
              effektiveRolleFuerFilter,
              ctx.userGroups,
              sharingEnabled
            );
            return {
              id: t.id,
              reelId,
              playId: t.play_id,
              angleCode: t.angle_code,
              frameIndex: Number(t.frame_index),
              elements: sichtbareElemente,
              authorUuid: t.created_by,
              authorName: t.author_name || undefined,
              updatedAt: t.updated_at,
            };
          })
          .filter((t) => (!istLesendeFreigabe && istStaffOderAdmin) || t.elements.length > 0);

        const anglesSet = new Set<string>();
        plays.forEach((p) => Object.keys(p.sources).forEach((a) => anglesSet.add(a)));

        const sharedTeams: TeamReelFreigabeEintrag[] = sharesRes.rows.map((s) => ({
          teamId: s.team_id,
          teamName: teamNameMap.get(s.team_id) ?? s.team_id,
          accessMode: s.access_mode === 'OWN_BREAKDOWN' ? 'OWN_BREAKDOWN' : 'READ_ONLY',
          allowedFields: parseJson<string[] | null>(s.allowed_fields_json, null),
        }));

        return {
          status: 200,
          body: {
            reel: {
              id: zugriff.reelId,
              accessId: zugriff.accessId,
              teamId: zugriff.teamId,
              clubId: zugriff.clubId,
              saison: zugriff.season,
              title: zugriff.title,
              category: zugriff.category,
              eventDate: zugriff.eventDate,
              visibility: zugriff.visibility,
              angles: anglesSet.size > 0 ? Array.from(anglesSet) : ['SIDELINE'],
              playCount: plays.length,
              sharedFromTeamId: zugriff.sharedFromTeamId,
              sharedFromTeamName: zugriff.sharedFromTeamName,
              allowedFields: zugriff.allowedFields,
              shareScope: zugriff.shareScope,
              clubWideAccessMode: zugriff.clubWideAccessMode,
              accessMode: zugriff.accessMode,
              canEdit: darfBenutzerReelBearbeiten(ctx, zugriff),
              canManageSharing:
                !ctx.isReadOnly &&
                (istClubAdmin || (zugriff.accessMode === 'OWNER' && istStaffOderAdmin)),
              refCount: zugriff.refCount,
              totalSizeBytes: zugriff.totalSizeBytes,
              sharedTeams,
              createdBy: zugriff.createdBy,
              createdAt: zugriff.createdAt,
              updatedAt: zugriff.updatedAt,
            } satisfies VideoReelEintrag,
            plays,
            telestrations,
            notes,
          },
        };
      }

      if (method === 'PATCH') {
        if (!darfBenutzerReelBearbeiten(ctx, zugriff)) {
          return {
            status: 403,
            body: { fehler: 'Keine Bearbeitungsrechte für dieses Video-Reel.' },
          };
        }
        const body = (req.body ?? {}) as {
          title?: string;
          category?: VideoKategorie;
          eventDate?: string;
          season?: string;
          visibility?: SichtbarkeitsStufe;
        };
        const bereinigterTitel = body.title !== undefined ? body.title.trim() : null;
        if (bereinigterTitel !== null && !bereinigterTitel) {
          return { status: 400, body: { fehler: 'Titel des Video-Reels darf nicht leer sein.' } };
        }
        const now = new Date().toISOString();
        await ctx.db.query(
          `UPDATE mod_video_team_reel_access
           SET title = COALESCE($1, title),
               category = COALESCE($2, category),
               event_date = COALESCE($3, event_date),
               season = COALESCE($4, season),
               visibility = COALESCE($5, visibility),
               updated_at = $6
           WHERE id = $7 AND team_id = $8`,
          [
            bereinigterTitel,
            body.category ?? null,
            body.eventDate ?? null,
            body.season ?? null,
            body.visibility ? normalisiereSichtbarkeit(body.visibility) : null,
            now,
            zugriff.accessId,
            teamId,
          ]
        );
        return { status: 200, body: { ok: true, updatedAt: now } };
      }

      if (method === 'DELETE') {
        if (!istStaffOderAdmin && !istClubAdmin) {
          return { status: 403, body: { fehler: 'Nur Staff oder Admins dürfen Reels entfernen.' } };
        }
        if (zugriff.istVirtuellerClubZugriff) {
          return {
            status: 403,
            body: {
              fehler:
                'Vereinsweit geteilte Reels können nur vom Eigentümer-Team oder einem Vereins-Admin entfernt werden.',
            },
          };
        }

        await ctx.db.query(
          `DELETE FROM mod_video_team_reel_access WHERE id = $1 AND team_id = $2`,
          [zugriff.accessId, teamId]
        );

        const refRes = await ctx.db.query<{ ref_count: number }>(
          `UPDATE mod_video_media_reels
           SET ref_count = GREATEST(0, ref_count - 1)
           WHERE id = $1
           RETURNING ref_count`,
          [reelId]
        );
        const neuerRefCount = Number(refRes.rows[0]?.ref_count ?? 0);

        if (neuerRefCount <= 0) {
          const objRes = await ctx.db.query<{ s3_key: string; file_size_bytes: number }>(
            `SELECT DISTINCT s3_key, file_size_bytes FROM mod_video_play_angles WHERE reel_id = $1`,
            [reelId]
          );
          if (ctx.storage) {
            for (const row of objRes.rows) {
              const p = bereinigeStorageObjektPfad(row.s3_key, ctx.storage.prefix);
              if (p) {
                await ctx.storage
                  .deleteObject(p, Number(row.file_size_bytes ?? 0))
                  .catch(() => undefined);
              }
            }
          }
          await ctx.db.query(`DELETE FROM mod_video_media_reels WHERE id = $1`, [reelId]);
        } else {
          // Nur Team-eigene Breakdowns & Anmerkungen entfernen, physische Dateien bleiben für die übrigen Referenzen erhalten
          await ctx.db.query(`DELETE FROM mod_video_plays WHERE reel_id = $1 AND team_id = $2`, [
            reelId,
            teamId,
          ]);
          await ctx.db.query(
            `DELETE FROM mod_video_telestrations WHERE reel_id = $1 AND team_id = $2`,
            [reelId, teamId]
          );
          await ctx.db.query(`DELETE FROM mod_video_notes WHERE reel_id = $1 AND team_id = $2`, [
            reelId,
            teamId,
          ]);
        }

        return { status: 200, body: { ok: true, refCount: neuerRefCount } };
      }
    }

    // --- 6b. Nachträglichen Kamera-Angle hinzufügen (#7) ---
    const anglesAddMatch = pfad.match(/^\/reels\/([^/]+)\/angles$/);
    if (method === 'POST' && anglesAddMatch) {
      const reelId = decodeURIComponent(anglesAddMatch[1]);
      const zugriff = await loeseReelZugriffFuerTeamAuf(ctx, reelId);
      if (!zugriff) {
        return { status: 404, body: { fehler: 'Video-Reel nicht gefunden.' } };
      }
      if (!darfBenutzerReelBearbeiten(ctx, zugriff)) {
        return { status: 403, body: { fehler: 'Keine Bearbeitungsrechte für dieses Reel.' } };
      }

      const body = (req.body ?? {}) as {
        angleCode?: string;
        mode?: 'CLIPS' | 'FULL_TAPE';
        assignments?: Array<{
          playId?: string;
          playNumber?: number;
          createNewPlay?: boolean;
          fileName: string;
          s3Key: string;
          startMs?: number;
          endMs?: number;
          offsetMs?: number | null;
          fileSizeBytes?: number;
        }>;
        tape?: {
          fileName: string;
          s3Key: string;
          startMs?: number;
          endMs: number;
          offsetMs?: number | null;
          fileSizeBytes?: number;
        };
      };

      const angleCode = (body.angleCode ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
      if (!angleCode) {
        return { status: 400, body: { fehler: 'Gültiger Winkel-Code (z. B. ENDZONE) erforderlich.' } };
      }
      const now = new Date().toISOString();
      let zusaetzlicheBytes = 0;

      const upsertPlayAngle = async (
        playId: string,
        src: {
          sourceMode: QuellenModus;
          s3Key: string;
          fileName: string;
          fileSizeBytes?: number;
          startMs?: number;
          endMs?: number;
          offsetMs?: number | null;
        }
      ) => {
        await ctx.db.query(
          `DELETE FROM mod_video_play_angles WHERE play_id = $1 AND angle_code = $2`,
          [playId, angleCode]
        );
        await ctx.db.query(
          `INSERT INTO mod_video_play_angles (
             id, play_id, reel_id, angle_code, source_mode, s3_key, file_name, file_size_bytes, start_ms, end_ms, offset_ms
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            `ang-${crypto.randomUUID()}`,
            playId,
            reelId,
            angleCode,
            src.sourceMode,
            src.s3Key,
            src.fileName,
            Number(src.fileSizeBytes ?? 0),
            Number(src.startMs ?? 0),
            Number(src.endMs ?? 0),
            src.offsetMs === undefined ? null : src.offsetMs,
          ]
        );
      };

      let zugeordnet = 0;

      if (body.mode === 'FULL_TAPE') {
        if (!body.tape?.s3Key || !body.tape?.fileName) {
          return { status: 400, body: { fehler: 'Videodatei für das durchgehende Tape fehlt.' } };
        }
        const ersterPlayRes = await ctx.db.query<{ id: string }>(
          `SELECT id FROM mod_video_plays WHERE reel_id = $1 AND team_id = $2 ORDER BY sort_order ASC, play_number ASC LIMIT 1`,
          [reelId, teamId]
        );
        let targetPlayId = ersterPlayRes.rows[0]?.id;
        if (!targetPlayId) {
          targetPlayId = `play-${crypto.randomUUID()}`;
          await ctx.db.query(
            `INSERT INTO mod_video_plays (id, reel_id, team_id, play_number, sort_order, breakdown_json, created_at, updated_at)
             VALUES ($1, $2, $3, 1, 1, $4::jsonb, $5, $5)`,
            [targetPlayId, reelId, teamId, JSON.stringify({ odk: 'O', play_number: 1 }), now]
          );
        }
        await upsertPlayAngle(targetPlayId, {
          sourceMode: 'TIME_SLICE',
          s3Key: body.tape.s3Key,
          fileName: body.tape.fileName,
          fileSizeBytes: body.tape.fileSizeBytes,
          startMs: body.tape.startMs ?? 0,
          endMs: body.tape.endMs,
          offsetMs: body.tape.offsetMs ?? null,
        });
        zusaetzlicheBytes += Number(body.tape.fileSizeBytes ?? 0);
        zugeordnet = 1;
      } else {
        const assignments = Array.isArray(body.assignments) ? body.assignments : [];
        if (assignments.length === 0) {
          return { status: 400, body: { fehler: 'Mindestens ein Clip muss zugeordnet werden.' } };
        }
        const maxRes = await ctx.db.query<{ max_nr: number }>(
          `SELECT COALESCE(MAX(play_number), 0)::int AS max_nr FROM mod_video_plays WHERE reel_id = $1 AND team_id = $2`,
          [reelId, teamId]
        );
        let nextPlayNr = Number(maxRes.rows[0]?.max_nr ?? 0) + 1;

        for (const item of assignments) {
          let targetPlayId = item.playId;
          if (!targetPlayId || item.createNewPlay) {
            targetPlayId = `play-${crypto.randomUUID()}`;
            const nr = item.playNumber ?? nextPlayNr;
            nextPlayNr = Math.max(nextPlayNr, nr + 1);
            await ctx.db.query(
              `INSERT INTO mod_video_plays (id, reel_id, team_id, play_number, sort_order, breakdown_json, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $4, $5::jsonb, $6, $6)`,
              [targetPlayId, reelId, teamId, nr, JSON.stringify({ odk: 'O', play_number: nr }), now]
            );
          }
          await upsertPlayAngle(targetPlayId, {
            sourceMode: 'CLIP_FILE',
            s3Key: item.s3Key,
            fileName: item.fileName,
            fileSizeBytes: item.fileSizeBytes,
            startMs: item.startMs ?? 0,
            endMs: item.endMs ?? 12000,
            offsetMs: item.offsetMs ?? null,
          });
          zusaetzlicheBytes += Number(item.fileSizeBytes ?? 0);
          zugeordnet += 1;
        }
      }

      if (zusaetzlicheBytes > 0) {
        await ctx.db.query(
          `UPDATE mod_video_media_reels SET total_size_bytes = total_size_bytes + $1 WHERE id = $2`,
          [zusaetzlicheBytes, reelId]
        );
      }
      await ctx.db.query(
        `UPDATE mod_video_team_reel_access SET updated_at = $1 WHERE reel_id = $2 AND team_id = $3`,
        [now, reelId, teamId]
      );

      return { status: 201, body: { ok: true, angleCode, assignedCount: zugeordnet } };
    }

    // --- 7. Plays anlegen / Breakdown & Sync aktualisieren ---
    const playsCreateMatch = pfad.match(/^\/reels\/([^/]+)\/plays$/);
    if (method === 'POST' && playsCreateMatch) {
      const reelId = decodeURIComponent(playsCreateMatch[1]);
      const zugriff = await loeseReelZugriffFuerTeamAuf(ctx, reelId);
      if (!zugriff || !darfBenutzerReelBearbeiten(ctx, zugriff)) {
        return { status: 403, body: { fehler: 'Keine Bearbeitungsrechte für Spielzüge dieses Reels.' } };
      }
      const body = (req.body ?? {}) as {
        playNumber?: number;
        breakdown?: PlayBreakdownDaten;
        sources?: Record<
          string,
          {
            fileName: string;
            s3Key: string;
            sourceMode: QuellenModus;
            startMs: number;
            endMs: number;
            offsetMs?: number | null;
          }
        >;
      };
      const playId = `play-${crypto.randomUUID()}`;
      const playNumber = Number(body.playNumber ?? 1);
      const now = new Date().toISOString();

      await ctx.db.query(
        `INSERT INTO mod_video_plays (id, reel_id, team_id, play_number, sort_order, breakdown_json, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4, $5::jsonb, $6, $6)`,
        [playId, reelId, teamId, playNumber, JSON.stringify(body.breakdown ?? {}), now]
      );

      for (const [angleCode, src] of Object.entries(body.sources ?? {})) {
        await ctx.db.query(
          `INSERT INTO mod_video_play_angles (
             id, play_id, reel_id, angle_code, source_mode, s3_key, file_name, start_ms, end_ms, offset_ms
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            `ang-${crypto.randomUUID()}`,
            playId,
            reelId,
            angleCode,
            src.sourceMode ?? 'CLIP_FILE',
            src.s3Key,
            src.fileName,
            Number(src.startMs ?? 0),
            Number(src.endMs ?? 0),
            src.offsetMs === undefined ? null : src.offsetMs,
          ]
        );
      }
      return { status: 201, body: { id: playId } };
    }

    const playMatch = pfad.match(/^\/plays\/([^/]+)$/);
    if (playMatch) {
      if (!istStaffOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Staff oder Team-Admins dürfen Spielzüge bearbeiten.' } };
      }
      const playId = decodeURIComponent(playMatch[1]);
      if (method === 'PATCH') {
        const body = (req.body ?? {}) as {
          playNumber?: number;
          breakdown?: PlayBreakdownDaten;
          angleOffsets?: Record<string, { startMs?: number; endMs?: number; offsetMs?: number | null }>;
          upsertSources?: Record<
            string,
            {
              fileName: string;
              s3Key: string;
              sourceMode: QuellenModus;
              startMs: number;
              endMs: number;
              offsetMs?: number | null;
              fileSizeBytes?: number;
            }
          >;
        };
        const now = new Date().toISOString();
        if (body.breakdown !== undefined || body.playNumber !== undefined) {
          await ctx.db.query(
            `UPDATE mod_video_plays
             SET play_number = COALESCE($1, play_number),
                 breakdown_json = COALESCE($2::jsonb, breakdown_json),
                 updated_at = $3
             WHERE id = $4 AND team_id = $5`,
            [
              body.playNumber ?? null,
              body.breakdown ? JSON.stringify(body.breakdown) : null,
              now,
              playId,
              teamId,
            ]
          );
        }
        if (body.angleOffsets) {
          for (const [angleCode, patch] of Object.entries(body.angleOffsets)) {
            await ctx.db.query(
              `UPDATE mod_video_play_angles
               SET start_ms = COALESCE($1, start_ms),
                   end_ms = COALESCE($2, end_ms),
                   offset_ms = $3
               WHERE play_id = $4 AND angle_code = $5`,
              [
                patch.startMs ?? null,
                patch.endMs ?? null,
                patch.offsetMs === undefined ? null : patch.offsetMs,
                playId,
                angleCode,
              ]
            );
          }
        }
        if (body.upsertSources) {
          const playRow = await ctx.db.query<{ reel_id: string }>(
            `SELECT reel_id FROM mod_video_plays WHERE id = $1 AND team_id = $2 LIMIT 1`,
            [playId, teamId]
          );
          const targetReelId = playRow.rows[0]?.reel_id;
          if (targetReelId) {
            for (const [angleCode, src] of Object.entries(body.upsertSources)) {
              await ctx.db.query(
                `DELETE FROM mod_video_play_angles WHERE play_id = $1 AND angle_code = $2`,
                [playId, angleCode]
              );
              await ctx.db.query(
                `INSERT INTO mod_video_play_angles (
                   id, play_id, reel_id, angle_code, source_mode, s3_key, file_name, file_size_bytes, start_ms, end_ms, offset_ms
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [
                  `ang-${crypto.randomUUID()}`,
                  playId,
                  targetReelId,
                  angleCode,
                  src.sourceMode ?? 'TIME_SLICE',
                  src.s3Key,
                  src.fileName,
                  Number(src.fileSizeBytes ?? 0),
                  Number(src.startMs ?? 0),
                  Number(src.endMs ?? 0),
                  src.offsetMs === undefined ? null : src.offsetMs,
                ]
              );
            }
          }
        }
        return { status: 200, body: { ok: true } };
      }
      if (method === 'DELETE') {
        await ctx.db.query(`DELETE FROM mod_video_plays WHERE id = $1 AND team_id = $2`, [
          playId,
          teamId,
        ]);
        return { status: 200, body: { ok: true } };
      }
    }

    // --- 8. Telestrationen & Notizen ---
    const telMatch = pfad.match(/^\/plays\/([^/]+)\/telestrations$/);
    if (method === 'PUT' && telMatch) {
      if (!istStaffOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Staff oder Admins dürfen Telestrations speichern.' } };
      }
      const playId = decodeURIComponent(telMatch[1]);
      const body = (req.body ?? {}) as {
        reelId?: string;
        angleCode?: string;
        frameIndex?: number;
        elements?: TelestrationElement[];
      };
      if (!body.reelId || !body.angleCode || typeof body.frameIndex !== 'number') {
        return { status: 400, body: { fehler: 'reelId, angleCode und frameIndex erforderlich.' } };
      }
      const zugriff = await loeseReelZugriffFuerTeamAuf(ctx, body.reelId);
      if (zugriff && !darfBenutzerReelBearbeiten(ctx, zugriff)) {
        return { status: 403, body: { fehler: 'Nur-Lese-Freigabe: Zeichnungen sind gesperrt.' } };
      }

      const now = new Date().toISOString();
      const id = `tel-${crypto.randomUUID()}`;
      const angereicherteElemente = (body.elements ?? []).map((el) => ({
        ...el,
        visibility: el.visibility ? normalisiereSichtbarkeit(el.visibility) : 'ALL_MEMBERS',
        authorUuid: el.authorUuid ?? ctx.user.uuid,
        authorName: el.authorName ?? ctx.user.vollerName,
      }));
      await ctx.db.query(
        `INSERT INTO mod_video_telestrations (
           id, team_id, reel_id, play_id, angle_code, frame_index, elements_json, created_by, author_name, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
         ON CONFLICT (team_id, play_id, angle_code, frame_index) DO UPDATE SET
           elements_json = EXCLUDED.elements_json,
           created_by = EXCLUDED.created_by,
           author_name = EXCLUDED.author_name,
           updated_at = EXCLUDED.updated_at`,
        [
          id,
          teamId,
          body.reelId,
          playId,
          body.angleCode,
          Math.max(0, Math.round(body.frameIndex)),
          JSON.stringify(angereicherteElemente),
          ctx.user.uuid,
          ctx.user.vollerName,
          now,
        ]
      );
      return { status: 200, body: { ok: true, updatedAt: now } };
    }

    const noteCreateMatch = pfad.match(/^\/plays\/([^/]+)\/notes$/);
    if (method === 'POST' && noteCreateMatch) {
      if (!istStaffOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Staff oder Admins dürfen Notizen erstellen.' } };
      }
      const playId = decodeURIComponent(noteCreateMatch[1]);
      const body = (req.body ?? {}) as Partial<CoachNotiz>;
      if (!body.reelId || !body.angleCode || typeof body.frameIndex !== 'number' || !body.text?.trim()) {
        return { status: 400, body: { fehler: 'reelId, angleCode, frameIndex und text erforderlich.' } };
      }
      const zugriff = await loeseReelZugriffFuerTeamAuf(ctx, body.reelId);
      if (zugriff && !darfBenutzerReelBearbeiten(ctx, zugriff)) {
        return { status: 403, body: { fehler: 'Nur-Lese-Freigabe: Notizen sind gesperrt.' } };
      }

      const id = `note-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      await ctx.db.query(
        `INSERT INTO mod_video_notes (
           id, team_id, reel_id, play_id, angle_code, frame_index, text, status, visibility, color, corner_position, author_uuid, author_name, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)`,
        [
          id,
          teamId,
          body.reelId,
          playId,
          body.angleCode,
          Math.max(0, Math.round(body.frameIndex)),
          body.text.trim(),
          body.status ?? 'DRAFT',
          normalisiereSichtbarkeit(body.visibility ?? 'ALL_MEMBERS'),
          body.color ?? null,
          body.cornerPosition ?? 'top-right',
          ctx.user.uuid,
          ctx.user.vollerName,
          now,
        ]
      );
      return { status: 201, body: { id } };
    }

    const noteMatch = pfad.match(/^\/notes\/([^/]+)$/);
    if (noteMatch) {
      if (!istStaffOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Staff oder Admins dürfen Notizen bearbeiten.' } };
      }
      const noteId = decodeURIComponent(noteMatch[1]);
      if (method === 'PATCH') {
        const body = (req.body ?? {}) as Partial<CoachNotiz>;
        const now = new Date().toISOString();
        await ctx.db.query(
          `UPDATE mod_video_notes
           SET text = COALESCE($1, text),
               status = COALESCE($2, status),
               visibility = COALESCE($3, visibility),
               color = COALESCE($4, color),
               corner_position = COALESCE($5, corner_position),
               updated_at = $6
           WHERE id = $7 AND team_id = $8`,
          [
            body.text ?? null,
            body.status ?? null,
            body.visibility ? normalisiereSichtbarkeit(body.visibility) : null,
            body.color ?? null,
            body.cornerPosition ?? null,
            now,
            noteId,
            teamId,
          ]
        );
        return { status: 200, body: { ok: true } };
      }
      if (method === 'DELETE') {
        await ctx.db.query(`DELETE FROM mod_video_notes WHERE id = $1 AND team_id = $2`, [
          noteId,
          teamId,
        ]);
        return { status: 200, body: { ok: true } };
      }
    }

    // --- 9. Smart Playlists ---
    if (method === 'GET' && pfad === '/playlists') {
      const season = typeof req.query.season === 'string' ? req.query.season : 'ALL';
      const res = await ctx.db.query<{
        id: string;
        team_id: string;
        name: string;
        description: string;
        season: string;
        match_mode: 'ALL' | 'ANY';
        rules_json: unknown;
        play_ids_json: unknown;
        created_by: string;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT * FROM mod_video_playlists
         WHERE team_id = $1 AND ($2 = 'ALL' OR season = $2)
         ORDER BY updated_at DESC`,
        [teamId, season]
      );
      const playlists: SmartPlaylist[] = res.rows.map((r) => ({
        id: r.id,
        teamId: r.team_id,
        name: r.name,
        description: r.description,
        season: r.season,
        matchMode: r.match_mode,
        rules: parseJson(r.rules_json, []),
        playIds: parseJson(r.play_ids_json, []),
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
      return { status: 200, body: { playlists } };
    }

    if (method === 'POST' && pfad === '/playlists') {
      if (!istStaffOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Staff oder Admins dürfen Playlists speichern.' } };
      }
      const body = (req.body ?? {}) as Partial<SmartPlaylist>;
      const name = (body.name ?? '').trim();
      if (!name) return { status: 400, body: { fehler: 'Name der Playlist erforderlich.' } };
      const saisonDaten = await ladeOderErstelleSaisons(ctx.db, teamId, clubId);
      const id = `pl-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      await ctx.db.query(
        `INSERT INTO mod_video_playlists (
           id, team_id, name, description, season, match_mode, rules_json, play_ids_json, created_by, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $10)`,
        [
          id,
          teamId,
          name,
          body.description ?? '',
          body.season ?? saisonDaten.activeSeason,
          body.matchMode === 'ANY' ? 'ANY' : 'ALL',
          JSON.stringify(body.rules ?? []),
          JSON.stringify(body.playIds ?? []),
          ctx.user.uuid,
          now,
        ]
      );
      return { status: 201, body: { id } };
    }

    const playlistMatch = pfad.match(/^\/playlists\/([^/]+)$/);
    if (playlistMatch && method === 'DELETE') {
      if (!istStaffOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Staff oder Admins dürfen Playlists löschen.' } };
      }
      await ctx.db.query(`DELETE FROM mod_video_playlists WHERE id = $1 AND team_id = $2`, [
        decodeURIComponent(playlistMatch[1]),
        teamId,
      ]);
      return { status: 200, body: { ok: true } };
    }

    // --- 10. Einzel-Team-Sharing (abwärtskompatibel + accessMode) & Öffentliche Share-Links ---
    const shareTeamMatch = pfad.match(/^\/reels\/([^/]+)\/share-team$/);
    if (method === 'POST' && shareTeamMatch) {
      if (!istStaffOderAdmin && !istClubAdmin) {
        return { status: 403, body: { fehler: 'Nur Staff oder Admins dürfen Reels teilen.' } };
      }
      const reelId = decodeURIComponent(shareTeamMatch[1]);
      const body = (req.body ?? {}) as {
        targetTeamId?: string;
        accessMode?: Exclude<ReelAccessMode, 'OWNER'>;
        allowedFields?: string[];
        season?: string;
      };
      const targetTeamId = (body.targetTeamId ?? '').trim();
      if (!targetTeamId) {
        return { status: 400, body: { fehler: 'Ziel-Team (targetTeamId) erforderlich.' } };
      }
      const sourceAcc = await ctx.db.query<{
        season: string;
        title: string;
        category: VideoKategorie;
        event_date: string;
      }>(
        `SELECT season, title, category, event_date FROM mod_video_team_reel_access
         WHERE reel_id = $1 AND team_id = $2 LIMIT 1`,
        [reelId, teamId]
      );
      if (sourceAcc.rows.length === 0) {
        return { status: 404, body: { fehler: 'Quell-Reel nicht gefunden.' } };
      }
      const src = sourceAcc.rows[0];
      const accessMode: Exclude<ReelAccessMode, 'OWNER'> =
        body.accessMode === 'OWN_BREAKDOWN' ? 'OWN_BREAKDOWN' : 'READ_ONLY';
      const accessId = `acc-${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      await ctx.db.query(
        `INSERT INTO mod_video_team_reel_access (
           id, team_id, club_id, reel_id, season, title, category, event_date, visibility,
           access_mode, shared_from_team_id, shared_from_team_name, allowed_fields_json,
           created_by, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ALL_MEMBERS', $9, $10, $11, $12::jsonb, $13, $14, $14)`,
        [
          accessId,
          targetTeamId,
          clubId,
          reelId,
          body.season ?? src.season,
          src.title,
          src.category,
          src.event_date,
          accessMode,
          teamId,
          ctx.team.name,
          body.allowedFields ? JSON.stringify(body.allowedFields) : null,
          ctx.user.uuid,
          now,
        ]
      );

      if (accessMode === 'OWN_BREAKDOWN') {
        await klonePlaysZeroCopyFuerTeam(
          ctx.db,
          reelId,
          teamId,
          targetTeamId,
          body.allowedFields ?? null,
          now
        );
      }

      await ctx.db.query(
        `UPDATE mod_video_media_reels
         SET ref_count = ref_count + 1,
             share_scope = CASE WHEN share_scope = 'CLUB_WIDE' THEN 'CLUB_WIDE' ELSE 'SELECTED_TEAMS' END
         WHERE id = $1`,
        [reelId]
      );
      return { status: 201, body: { accessId } };
    }

    const shareLinksMatch = pfad.match(/^\/reels\/([^/]+)\/share-links$/);
    if (shareLinksMatch) {
      if (!istStaffOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Staff oder Admins dürfen öffentliche Share-Links verwalten.' } };
      }
      const reelId = decodeURIComponent(shareLinksMatch[1]);
      if (method === 'GET') {
        const res = await ctx.db.query<{
          id: string;
          reel_id: string;
          label: string;
          allowed_fields_json: unknown;
          include_metadata: boolean;
          expires_at: string;
          revoked_at: string | null;
          created_at: string;
        }>(
          `SELECT id, reel_id, label, allowed_fields_json, include_metadata, expires_at, revoked_at, created_at
           FROM mod_video_share_links
           WHERE team_id = $1 AND reel_id = $2
           ORDER BY created_at DESC`,
          [teamId, reelId]
        );
        return {
          status: 200,
          body: {
            links: res.rows.map((r) => ({
              id: r.id,
              reelId: r.reel_id,
              label: r.label,
              allowedFields: parseJson<string[]>(r.allowed_fields_json, []),
              includeMetadata: r.include_metadata !== false,
              expiresAt: r.expires_at,
              revokedAt: r.revoked_at,
              createdAt: r.created_at,
            })),
          },
        };
      }
      if (method === 'POST') {
        const accRes = await ctx.db.query<{ id: string }>(
          `SELECT id FROM mod_video_team_reel_access WHERE reel_id = $1 AND team_id = $2 LIMIT 1`,
          [reelId, teamId]
        );
        if (accRes.rows.length === 0) {
          return { status: 404, body: { fehler: 'Reel nicht gefunden.' } };
        }
        const body = (req.body ?? {}) as {
          label?: string;
          allowedFields?: string[];
          includeMetadata?: boolean;
          expiresInDays?: number;
        };
        const includeMetadata = body.includeMetadata !== false;
        const allowedFields = includeMetadata ? (body.allowedFields ?? []) : [];
        const tage = Math.max(1, Math.min(90, Math.round(Number(body.expiresInDays ?? 7))));
        const token = crypto.randomBytes(24).toString('base64url');
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + tage * 86_400_000).toISOString();
        const id = `shl-${crypto.randomUUID()}`;
        const now = new Date().toISOString();

        await ctx.db.query(
          `INSERT INTO mod_video_share_links (
             id, team_id, access_id, reel_id, token_hash, label, allowed_fields_json, include_metadata, expires_at, created_by, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)`,
          [
            id,
            teamId,
            accRes.rows[0].id,
            reelId,
            tokenHash,
            (body.label ?? 'Öffentlicher Scouting-Link').trim(),
            JSON.stringify(allowedFields),
            includeMetadata,
            expiresAt,
            ctx.user.uuid,
            now,
          ]
        );
        return {
          status: 201,
          body: {
            link: {
              id,
              reelId,
              label: (body.label ?? 'Öffentlicher Scouting-Link').trim(),
              token,
              allowedFields,
              includeMetadata,
              expiresAt,
              createdAt: now,
            },
          },
        };
      }
    }

    const shareRevokeMatch = pfad.match(/^\/share-links\/([^/]+)$/);
    if (method === 'DELETE' && shareRevokeMatch) {
      if (!istStaffOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Staff oder Admins dürfen Share-Links widerrufen.' } };
      }
      const id = decodeURIComponent(shareRevokeMatch[1]);
      await ctx.db.query(
        `UPDATE mod_video_share_links SET revoked_at = $1 WHERE id = $2 AND team_id = $3`,
        [new Date().toISOString(), id, teamId]
      );
      return { status: 200, body: { ok: true } };
    }

    return { status: 404, body: { fehler: `Unbekannte Video-Route: ${method} ${pfad}` } };
  },

  async handlePublicRequest(req, db, publicCtx): Promise<RouteAntwort> {
    const pfad = normalisierePfad(req.path);
    const match = pfad.match(/^\/share\/([^/]+)$/);
    if (req.method.toUpperCase() !== 'GET' || !match) {
      return { status: 404, body: { fehler: 'Öffentlicher Endpunkt nicht gefunden.' } };
    }

    const token = decodeURIComponent(match[1]);
    const tokenHash = hashToken(token);
    const linkRes = await db.query<{
      id: string;
      team_id: string;
      access_id: string;
      reel_id: string;
      allowed_fields_json: unknown;
      include_metadata: boolean;
      expires_at: string;
      revoked_at: string | null;
    }>(
      `SELECT id, team_id, access_id, reel_id, allowed_fields_json, include_metadata, expires_at, revoked_at
       FROM mod_video_share_links
       WHERE token_hash = $1 LIMIT 1`,
      [tokenHash]
    );

    if (linkRes.rows.length === 0) {
      return { status: 404, body: { fehler: 'Freigabe-Link nicht gefunden.' } };
    }
    const link = linkRes.rows[0];
    if (link.revoked_at || new Date(link.expires_at).getTime() <= Date.now()) {
      return {
        status: 410,
        body: { fehler: 'Dieser Freigabe-Link ist abgelaufen oder widerrufen.' },
      };
    }

    const accRes = await db.query<{
      reel_id: string;
      title: string;
      category: VideoKategorie;
      event_date: string;
      season: string;
    }>(
      `SELECT reel_id, title, category, event_date, season
       FROM mod_video_team_reel_access
       WHERE id = $1 LIMIT 1`,
      [link.access_id]
    );
    if (accRes.rows.length === 0) {
      return { status: 404, body: { fehler: 'Zugehöriges Reel existiert nicht mehr.' } };
    }
    const acc = accRes.rows[0];
    const includeMetadata = link.include_metadata !== false;
    const allowedFields = includeMetadata ? parseJson<string[]>(link.allowed_fields_json, []) : [];

    // Offizielle SDK v2.0 Signierung für Public-Share-Downloads
    let publicStorage: Pick<PluginStorageScope, 'prefix' | 'getSignedDownloadUrl'> | undefined;
    if (publicCtx?.getSignedDownloadUrlForTeam) {
      const signer = publicCtx.getSignedDownloadUrlForTeam;
      publicStorage = {
        prefix: '',
        getSignedDownloadUrl: ({ objectPath, expiresInSeconds }) =>
          signer({ teamId: link.team_id, objectPath, expiresInSeconds }),
      };
    }

    // Strikt ohne Coach-Notizen oder Telestrationen ausliefern
    const plays = await ladePlaysFuerReel(
      db,
      link.reel_id,
      link.team_id,
      allowedFields,
      publicStorage
    );
    const hatStreamUrls = plays.some((p) => Object.values(p.sources).some((s) => Boolean(s.streamUrl)));

    const anglesSet = new Set<string>();
    plays.forEach((p) => Object.keys(p.sources).forEach((a) => anglesSet.add(a)));

    return {
      status: 200,
      body: {
        reel: {
          id: acc.reel_id,
          title: acc.title,
          category: acc.category,
          eventDate: acc.event_date,
          season: acc.season,
          angles: anglesSet.size > 0 ? Array.from(anglesSet) : ['SIDELINE'],
        },
        allowedFields,
        includeMetadata,
        s3DownloadVerfuegbar: hatStreamUrls,
        plays,
        expiresAt: link.expires_at,
      } satisfies PublicShareAnsichtDaten,
    };
  },
};

export default backendPlugin;
