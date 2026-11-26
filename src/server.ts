import crypto from 'node:crypto';
import type {
  PluginBackendKontext,
  PluginDbScope,
  PluginExportScopeResult,
  PluginS3Scope,
  PluginScopeItem,
  SidelineBackendPlugin,
} from '@sidelineos/plugin-sdk';
import sql001 from '../migrations/001_video_schema.sql';
import sql002 from '../migrations/002_video_annotations_and_sharing.sql';
import manifest from '../plugin.manifest.json';
import {
  bereinigeAnmerkungsKonfig,
  filtereTelestrationElementeFuerBenutzer,
  istAnmerkungFuerBenutzerSichtbar,
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
  CoachNotiz,
  PlayBreakdownDaten,
  PlayEintrag,
  PlayWinkelQuelle,
  PublicShareAnsichtDaten,
  QuellenModus,
  SichtbarkeitsStufe,
  SmartPlaylist,
  TeamTaggingSchema,
  TelestrationElement,
  VideoKategorie,
  VideoReelEintrag,
} from './types/video';

type RouteAntwort = { status: number; body: unknown };

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

function bereinigeS3ObjektPfad(rohPfad: unknown, prefix: string): string | null {
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

function istSpielerSichtbar(visibility: SichtbarkeitsStufe): boolean {
  return visibility !== 'COACHES_ONLY';
}

function normalisierePfad(rawPath: string): string {
  const bereinigt = rawPath.replace(/\/+$/, '');
  return bereinigt || '/';
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

  const mergedFields = Array.isArray(savedFields) && savedFields.length > 0 ? savedFields : basis.fields;
  const existingKeys = new Set(mergedFields.map((f) => f.key));
  for (const cf of customFields) {
    if (!existingKeys.has(cf.key)) {
      mergedFields.push({ ...cf, custom: true });
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

async function ladePlaysFuerReel(
  db: PluginDbScope,
  reelId: string,
  teamId: string,
  allowedFields: string[] | null,
  s3?: Pick<PluginS3Scope, 'prefix' | 'getSignedDownloadUrl'>
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
    if (s3 && row.s3_key) {
      const objPath = bereinigeS3ObjektPfad(row.s3_key, s3.prefix) ?? row.s3_key;
      if (urlCache.has(objPath)) {
        streamUrl = urlCache.get(objPath);
      } else {
        try {
          const signed = await s3.getSignedDownloadUrl({ objectPath: objPath, expiresInSeconds: 1800 });
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

export const backendPlugin: SidelineBackendPlugin = {
  manifest: manifest as SidelineBackendPlugin['manifest'],
  migrations: [
    {
      name: '001_video_schema.sql',
      sql: sql001,
    },
    {
      name: '002_video_annotations_and_sharing.sql',
      sql: sql002,
    },
  ],

  async handleRequest(req, ctx): Promise<RouteAntwort> {
    const pfad = normalisierePfad(req.path);
    const method = req.method.toUpperCase();
    const istCoachOderAdmin = ctx.teamRolle === 'COACH' || ctx.teamRolle === 'TEAM_ADMIN';

    // --- 1. Benutzer-Präferenzen (Hotkeys & Player-Defaults) ---
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

    // --- 2. Team-Tagging-Schema & Lernendes Wörterbuch ---
    if (method === 'GET' && pfad === '/schema') {
      const schema = await ladeTeamSchema(ctx.db, ctx.team.id);
      return { status: 200, body: { schema } };
    }

    if (method === 'PUT' && pfad === '/schema') {
      if (!istCoachOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Coaches oder Team Admins dürfen das Schema anpassen.' } };
      }
      const body = (req.body ?? {}) as Partial<TeamTaggingSchema>;
      const aktuell = await ladeTeamSchema(ctx.db, ctx.team.id);
      const neueFelder = Array.isArray(body.fields) ? body.fields : aktuell.fields;
      const neuesDict = body.dictionary && typeof body.dictionary === 'object' ? body.dictionary : aktuell.dictionary;

      // Prüfen, ob Wörterbuch-Einträge gelöscht wurden oder Custom-Felder strukturell geändert wurden
      let wurdeGeloescht = false;
      for (const [key, altListe] of Object.entries(aktuell.dictionary)) {
        const neuListe = new Set((neuesDict[key] ?? []).map((x) => x.toLowerCase()));
        if (altListe.some((e) => !neuListe.has(e.toLowerCase()))) {
          wurdeGeloescht = true;
          break;
        }
      }
      if (wurdeGeloescht && ctx.teamRolle !== 'TEAM_ADMIN') {
        return {
          status: 403,
          body: { fehler: 'Nur der Team Admin darf Einträge aus dem Team-Wörterbuch löschen.' },
        };
      }

      const customFelder = neueFelder.filter((f) => f.custom);
      const aktuelleFreigabe = bereinigeAnmerkungsKonfig(aktuell.annotationSharing);
      const neueFreigabe =
        body.annotationSharing !== undefined
          ? bereinigeAnmerkungsKonfig(body.annotationSharing)
          : aktuelleFreigabe;

      const freigabeGeaendert =
        JSON.stringify(neueFreigabe) !== JSON.stringify(aktuelleFreigabe);
      if (freigabeGeaendert && ctx.teamRolle !== 'TEAM_ADMIN') {
        return {
          status: 403,
          body: { fehler: 'Nur der Team Admin darf die Farb-Freigaben für Anmerkungen ändern.' },
        };
      }

      const now = new Date().toISOString();
      await ctx.db.query(
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
          ctx.team.id,
          JSON.stringify(neueFelder),
          JSON.stringify(customFelder),
          JSON.stringify(neuesDict),
          JSON.stringify(neueFreigabe),
          now,
        ]
      );
      return {
        status: 200,
        body: {
          schema: {
            teamId: ctx.team.id,
            fields: neueFelder,
            dictionary: neuesDict,
            annotationSharing: neueFreigabe,
            updatedAt: now,
          },
        },
      };
    }

    // --- 3. S3 Presigned & Multipart-Upload-Proxy ---
    if (method === 'POST' && pfad === '/s3/presign-upload') {
      if (!istCoachOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Coaches oder Team Admins dürfen Videos hochladen.' } };
      }
      if (!ctx.s3) {
        return { status: 503, body: { fehler: 'S3-Broker ist im Core nicht konfiguriert.' } };
      }
      const body = (req.body ?? {}) as { objectPath?: string; contentType?: string; fileSizeBytes?: number };
      const objPath = bereinigeS3ObjektPfad(body.objectPath, ctx.s3.prefix);
      if (!objPath) return { status: 400, body: { fehler: 'Ungültiger objectPath.' } };
      const signed = await ctx.s3.getSignedUploadUrl({
        objectPath: objPath,
        contentType: body.contentType,
        fileSizeBytes: body.fileSizeBytes,
      });
      return { status: 200, body: signed };
    }

    if (method === 'POST' && pfad === '/s3/multipart/init') {
      if (!istCoachOderAdmin || !ctx.s3) {
        return { status: istCoachOderAdmin ? 503 : 403, body: { fehler: 'S3-Upload nicht verfügbar.' } };
      }
      const body = (req.body ?? {}) as { objectPath?: string; contentType?: string; fileSizeBytes?: number };
      const objPath = bereinigeS3ObjektPfad(body.objectPath, ctx.s3.prefix);
      if (!objPath) return { status: 400, body: { fehler: 'Ungültiger objectPath.' } };
      const init = await ctx.s3.initiateMultipartUpload({
        objectPath: objPath,
        contentType: body.contentType,
        fileSizeBytes: body.fileSizeBytes,
      });
      return { status: 200, body: init };
    }

    if (method === 'POST' && pfad === '/s3/multipart/part') {
      if (!istCoachOderAdmin || !ctx.s3) {
        return { status: istCoachOderAdmin ? 503 : 403, body: { fehler: 'S3-Upload nicht verfügbar.' } };
      }
      const body = (req.body ?? {}) as { objectPath?: string; uploadId?: string; partNumber?: number };
      const objPath = bereinigeS3ObjektPfad(body.objectPath, ctx.s3.prefix);
      if (!objPath || !body.uploadId || !body.partNumber) {
        return { status: 400, body: { fehler: 'objectPath, uploadId und partNumber erforderlich.' } };
      }
      const part = await ctx.s3.getSignedMultipartPartUrl({
        objectPath: objPath,
        uploadId: body.uploadId,
        partNumber: Number(body.partNumber),
      });
      return { status: 200, body: part };
    }

    if (method === 'POST' && pfad === '/s3/multipart/complete') {
      if (!istCoachOderAdmin || !ctx.s3) {
        return { status: istCoachOderAdmin ? 503 : 403, body: { fehler: 'S3-Upload nicht verfügbar.' } };
      }
      const body = (req.body ?? {}) as {
        objectPath?: string;
        uploadId?: string;
        parts?: Array<{ partNumber: number; etag: string }>;
      };
      const objPath = bereinigeS3ObjektPfad(body.objectPath, ctx.s3.prefix);
      if (!objPath || !body.uploadId || !Array.isArray(body.parts)) {
        return { status: 400, body: { fehler: 'Ungültige Multipart-Abschlussdaten.' } };
      }
      const ergebnis = await ctx.s3.completeMultipartUpload({
        objectPath: objPath,
        uploadId: body.uploadId,
        parts: body.parts,
      });
      return { status: 200, body: ergebnis };
    }

    if (method === 'POST' && pfad === '/s3/multipart/abort') {
      if (!istCoachOderAdmin || !ctx.s3) {
        return { status: istCoachOderAdmin ? 503 : 403, body: { fehler: 'S3-Upload nicht verfügbar.' } };
      }
      const body = (req.body ?? {}) as { objectPath?: string; uploadId?: string };
      const objPath = bereinigeS3ObjektPfad(body.objectPath, ctx.s3.prefix);
      if (!objPath || !body.uploadId) {
        return { status: 400, body: { fehler: 'objectPath und uploadId erforderlich.' } };
      }
      await ctx.s3.abortMultipartUpload({ objectPath: objPath, uploadId: body.uploadId });
      return { status: 200, body: { ok: true } };
    }

    // --- 4. Reels Liste & Import ---
    if (method === 'GET' && pfad === '/reels') {
      const season = typeof req.query.season === 'string' ? req.query.season : ctx.team.aktiveSaison;
      const rows = await ctx.db.query<{
        id: string;
        reel_id: string;
        team_id: string;
        season: string;
        title: string;
        category: VideoKategorie;
        event_date: string;
        visibility: SichtbarkeitsStufe;
        shared_from_team_id: string | null;
        shared_from_team_name: string | null;
        allowed_fields_json: unknown;
        created_by: string;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT id, reel_id, team_id, season, title, category, event_date, visibility,
                shared_from_team_id, shared_from_team_name, allowed_fields_json,
                created_by, created_at, updated_at
         FROM mod_video_team_reel_access
         WHERE team_id = $1 AND ($2 = 'ALL' OR season = $2)
         ORDER BY event_date DESC, created_at DESC`,
        [ctx.team.id, season]
      );

      const reels: VideoReelEintrag[] = [];
      for (const row of rows.rows) {
        if (!istCoachOderAdmin && !istSpielerSichtbar(row.visibility)) {
          continue;
        }
        const metaRes = await ctx.db.query<{ play_count: number; angle_code: string | null }>(
          `SELECT COUNT(DISTINCT p.id)::int AS play_count,
                  STRING_AGG(DISTINCT a.angle_code, ',') AS angle_code
           FROM mod_video_plays p
           LEFT JOIN mod_video_play_angles a ON a.play_id = p.id
           WHERE p.reel_id = $1 AND p.team_id = $2`,
          [row.reel_id, ctx.team.id]
        );
        const rawAngles = metaRes.rows[0]?.angle_code ?? '';
        const angles = rawAngles ? rawAngles.split(',').filter(Boolean) : ['SIDELINE'];
        reels.push({
          id: row.reel_id,
          accessId: row.id,
          teamId: row.team_id,
          saison: row.season,
          title: row.title,
          category: row.category,
          eventDate: row.event_date,
          visibility: row.visibility,
          angles,
          playCount: Number(metaRes.rows[0]?.play_count ?? 0),
          sharedFromTeamId: row.shared_from_team_id,
          sharedFromTeamName: row.shared_from_team_name,
          allowedFields: parseJson<string[] | null>(row.allowed_fields_json, null),
          createdBy: row.created_by,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      }

      return { status: 200, body: { reels } };
    }

    if (method === 'POST' && pfad === '/reels') {
      if (!istCoachOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Coaches oder Team Admins dürfen Reels anlegen.' } };
      }

      const body = (req.body ?? {}) as {
        bundle?: unknown;
        title?: string;
        category?: VideoKategorie;
        eventDate?: string;
        season?: string;
        visibility?: SichtbarkeitsStufe;
        angles?: string[];
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

      let title = (body.title ?? '').trim();
      let category: VideoKategorie = body.category ?? 'GAME';
      let eventDate = body.eventDate ?? new Date().toISOString().slice(0, 10);
      let visibility: SichtbarkeitsStufe = body.visibility ?? 'COACHES_ONLY';
      const season = (body.season ?? eventDate.slice(0, 4)) || ctx.team.aktiveSaison;
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
        visibility = b.reel.visibility ?? 'COACHES_ONLY';
        playsInput = b.plays.map((p) => ({
          playNumber: p.play_number,
          breakdown: p.breakdown ?? {},
          sources: Object.fromEntries(
            Object.entries(p.sources).map(([angle, src]) => [
              angle,
              {
                fileName: src.file,
                s3Key: `${ctx.s3?.prefix ?? `teams/${ctx.team.id}/plugins/video-analysis/`}${src.file}`,
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

      const reelId = `reel-${crypto.randomUUID()}`;
      const accessId = `acc-${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      await ctx.db.query(
        `INSERT INTO mod_video_media_reels (id, ref_count, created_by, created_at)
         VALUES ($1, 1, $2, $3)`,
        [reelId, ctx.user.uuid, now]
      );

      await ctx.db.query(
        `INSERT INTO mod_video_team_reel_access (
           id, team_id, reel_id, season, title, category, event_date, visibility, created_by, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
        [accessId, ctx.team.id, reelId, season, title, category, eventDate, visibility, ctx.user.uuid, now]
      );

      let aktuellesSchema = await ladeTeamSchema(ctx.db, ctx.team.id);
      let schemaGeaendert = false;

      for (let idx = 0; idx < playsInput.length; idx += 1) {
        const p = playsInput[idx];
        const playId = `play-${crypto.randomUUID()}`;
        const breakdown = p.breakdown ?? {};
        await ctx.db.query(
          `INSERT INTO mod_video_plays (id, reel_id, team_id, play_number, sort_order, breakdown_json, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)`,
          [playId, reelId, ctx.team.id, p.playNumber || idx + 1, idx + 1, JSON.stringify(breakdown), now]
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
        await ctx.db.query(
          `INSERT INTO mod_video_team_schemas (team_id, active_fields_json, custom_fields_json, dictionary_json, updated_at)
           VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5)
           ON CONFLICT (team_id) DO UPDATE SET dictionary_json = EXCLUDED.dictionary_json, updated_at = EXCLUDED.updated_at`,
          [
            ctx.team.id,
            JSON.stringify(aktuellesSchema.fields),
            JSON.stringify(aktuellesSchema.fields.filter((f) => f.custom)),
            JSON.stringify(aktuellesSchema.dictionary),
            now,
          ]
        );
      }

      if (istSpielerSichtbar(visibility)) {
        await ctx.notifications?.send({
          eventType: 'video.reel_published',
          title: `Neues Video freigegeben: ${title}`,
          message: `${ctx.user.vollerName} hat ein neues Video-Reel (${playsInput.length} Spielzüge) veröffentlicht.`,
          linkPath: '/',
          priority: 'info',
        });
      }

      return { status: 201, body: { reelId, accessId } };
    }

    // --- 5. Reel Details / Update / Delete + S3-Cleanup ---
    const reelMatch = pfad.match(/^\/reels\/([^/]+)$/);
    if (reelMatch) {
      const reelId = decodeURIComponent(reelMatch[1]);
      const accRes = await ctx.db.query<{
        id: string;
        reel_id: string;
        team_id: string;
        season: string;
        title: string;
        category: VideoKategorie;
        event_date: string;
        visibility: SichtbarkeitsStufe;
        shared_from_team_id: string | null;
        shared_from_team_name: string | null;
        allowed_fields_json: unknown;
        created_by: string;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT * FROM mod_video_team_reel_access WHERE reel_id = $1 AND team_id = $2 LIMIT 1`,
        [reelId, ctx.team.id]
      );

      if (accRes.rows.length === 0) {
        return { status: 404, body: { fehler: 'Video-Reel nicht gefunden.' } };
      }
      const acc = accRes.rows[0];
      if (!istCoachOderAdmin && !istSpielerSichtbar(acc.visibility)) {
        return { status: 403, body: { fehler: 'Dieses Reel ist nur für Coaches freigegeben.' } };
      }

      if (method === 'GET') {
        const allowedFields = parseJson<string[] | null>(acc.allowed_fields_json, null);
        const [plays, teamSchema] = await Promise.all([
          ladePlaysFuerReel(ctx.db, reelId, ctx.team.id, allowedFields, ctx.s3),
          ladeTeamSchema(ctx.db, ctx.team.id),
        ]);
        const sharingEnabled = teamSchema.annotationSharing?.enabled !== false;

        const telRes = await ctx.db.query<{
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
          [reelId, ctx.team.id]
        );

        const notesRes = await ctx.db.query<{
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
          [reelId, ctx.team.id]
        );

        const notes: CoachNotiz[] = notesRes.rows
          .filter(
            (n) =>
              istCoachOderAdmin ||
              (n.status === 'PUBLISHED' &&
                istAnmerkungFuerBenutzerSichtbar(
                  n.visibility,
                  ctx.teamRolle,
                  ctx.userUnits,
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
            visibility: n.visibility ?? 'ALL_PLAYERS',
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
              ctx.teamRolle,
              ctx.userUnits,
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
          .filter((t) => istCoachOderAdmin || t.elements.length > 0);

        const anglesSet = new Set<string>();
        plays.forEach((p) => Object.keys(p.sources).forEach((a) => anglesSet.add(a)));

        return {
          status: 200,
          body: {
            reel: {
              id: acc.reel_id,
              accessId: acc.id,
              teamId: acc.team_id,
              saison: acc.season,
              title: acc.title,
              category: acc.category,
              eventDate: acc.event_date,
              visibility: acc.visibility,
              angles: anglesSet.size > 0 ? Array.from(anglesSet) : ['SIDELINE'],
              playCount: plays.length,
              sharedFromTeamId: acc.shared_from_team_id,
              sharedFromTeamName: acc.shared_from_team_name,
              allowedFields,
              createdBy: acc.created_by,
              createdAt: acc.created_at,
              updatedAt: acc.updated_at,
            } satisfies VideoReelEintrag,
            plays,
            telestrations,
            notes,
          },
        };
      }

      if (method === 'PATCH') {
        if (!istCoachOderAdmin) {
          return { status: 403, body: { fehler: 'Nur Coaches dürfen Reel-Einstellungen ändern.' } };
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
            body.visibility ?? null,
            now,
            acc.id,
            ctx.team.id,
          ]
        );
        return { status: 200, body: { ok: true, updatedAt: now } };
      }

      if (method === 'DELETE') {
        if (!istCoachOderAdmin) {
          return { status: 403, body: { fehler: 'Nur Coaches oder Team Admins dürfen Reels entfernen.' } };
        }
        await ctx.db.query(`DELETE FROM mod_video_team_reel_access WHERE id = $1 AND team_id = $2`, [
          acc.id,
          ctx.team.id,
        ]);

        const refRes = await ctx.db.query<{ ref_count: number }>(
          `UPDATE mod_video_media_reels
           SET ref_count = GREATEST(0, ref_count - 1)
           WHERE id = $1
           RETURNING ref_count`,
          [reelId]
        );
        const neuerRefCount = Number(refRes.rows[0]?.ref_count ?? 0);

        if (neuerRefCount <= 0) {
          const s3Res = await ctx.db.query<{ s3_key: string }>(
            `SELECT DISTINCT s3_key FROM mod_video_play_angles WHERE reel_id = $1`,
            [reelId]
          );
          const pfade = s3Res.rows
            .map((r) => bereinigeS3ObjektPfad(r.s3_key, ctx.s3?.prefix ?? ''))
            .filter((p): p is string => Boolean(p));

          if (pfade.length > 0 && ctx.cleanupQueue) {
            await ctx.cleanupQueue.enqueueOrphanedObjects(pfade, 'reel_deleted');
          }
          await ctx.db.query(`DELETE FROM mod_video_media_reels WHERE id = $1`, [reelId]);
        }

        return { status: 200, body: { ok: true, refCount: neuerRefCount } };
      }
    }

    // --- 5b. Nachträglichen Kamera-Angle hinzufügen (Einzelclips oder langes Tape, #7) ---
    const anglesAddMatch = pfad.match(/^\/reels\/([^/]+)\/angles$/);
    if (method === 'POST' && anglesAddMatch) {
      if (!istCoachOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Coaches dürfen weitere Kamera-Winkel hinzufügen.' } };
      }
      const reelId = decodeURIComponent(anglesAddMatch[1]);
      const accCheck = await ctx.db.query<{ id: string }>(
        `SELECT id FROM mod_video_team_reel_access WHERE reel_id = $1 AND team_id = $2 LIMIT 1`,
        [reelId, ctx.team.id]
      );
      if (accCheck.rows.length === 0) {
        return { status: 404, body: { fehler: 'Video-Reel nicht gefunden.' } };
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
          [reelId, ctx.team.id]
        );
        let targetPlayId = ersterPlayRes.rows[0]?.id;
        if (!targetPlayId) {
          targetPlayId = `play-${crypto.randomUUID()}`;
          await ctx.db.query(
            `INSERT INTO mod_video_plays (id, reel_id, team_id, play_number, sort_order, breakdown_json, created_at, updated_at)
             VALUES ($1, $2, $3, 1, 1, $4::jsonb, $5, $5)`,
            [targetPlayId, reelId, ctx.team.id, JSON.stringify({ odk: 'O', play_number: 1 }), now]
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
        zugeordnet = 1;
      } else {
        const assignments = Array.isArray(body.assignments) ? body.assignments : [];
        if (assignments.length === 0) {
          return { status: 400, body: { fehler: 'Mindestens ein Clip muss zugeordnet werden.' } };
        }
        const maxRes = await ctx.db.query<{ max_nr: number }>(
          `SELECT COALESCE(MAX(play_number), 0)::int AS max_nr FROM mod_video_plays WHERE reel_id = $1 AND team_id = $2`,
          [reelId, ctx.team.id]
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
              [targetPlayId, reelId, ctx.team.id, nr, JSON.stringify({ odk: 'O', play_number: nr }), now]
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
          zugeordnet += 1;
        }
      }

      await ctx.db.query(
        `UPDATE mod_video_team_reel_access SET updated_at = $1 WHERE reel_id = $2 AND team_id = $3`,
        [now, reelId, ctx.team.id]
      );

      return { status: 201, body: { ok: true, angleCode, assignedCount: zugeordnet } };
    }

    // --- 6. Plays anlegen / Breakdown & Sync aktualisieren ---
    const playsCreateMatch = pfad.match(/^\/reels\/([^/]+)\/plays$/);
    if (method === 'POST' && playsCreateMatch) {
      if (!istCoachOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Coaches dürfen Spielzüge anlegen.' } };
      }
      const reelId = decodeURIComponent(playsCreateMatch[1]);
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
        [playId, reelId, ctx.team.id, playNumber, JSON.stringify(body.breakdown ?? {}), now]
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
      if (!istCoachOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Coaches dürfen Spielzüge bearbeiten.' } };
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
              ctx.team.id,
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
            [playId, ctx.team.id]
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
          ctx.team.id,
        ]);
        return { status: 200, body: { ok: true } };
      }
    }

    // --- 7. Telestrationen & Coach-Notizen ---
    const telMatch = pfad.match(/^\/plays\/([^/]+)\/telestrations$/);
    if (method === 'PUT' && telMatch) {
      if (!istCoachOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Coaches dürfen Telestrations speichern.' } };
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
      const now = new Date().toISOString();
      const id = `tel-${crypto.randomUUID()}`;
      const angereicherteElemente = (body.elements ?? []).map((el) => ({
        ...el,
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
          ctx.team.id,
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
      if (!istCoachOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Coaches dürfen Notizen erstellen.' } };
      }
      const playId = decodeURIComponent(noteCreateMatch[1]);
      const body = (req.body ?? {}) as Partial<CoachNotiz>;
      if (!body.reelId || !body.angleCode || typeof body.frameIndex !== 'number' || !body.text?.trim()) {
        return { status: 400, body: { fehler: 'reelId, angleCode, frameIndex und text erforderlich.' } };
      }
      const id = `note-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      await ctx.db.query(
        `INSERT INTO mod_video_notes (
           id, team_id, reel_id, play_id, angle_code, frame_index, text, status, visibility, color, corner_position, author_uuid, author_name, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)`,
        [
          id,
          ctx.team.id,
          body.reelId,
          playId,
          body.angleCode,
          Math.max(0, Math.round(body.frameIndex)),
          body.text.trim(),
          body.status ?? 'DRAFT',
          body.visibility ?? 'ALL_PLAYERS',
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
      if (!istCoachOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Coaches dürfen Notizen bearbeiten.' } };
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
            body.visibility ?? null,
            body.color ?? null,
            body.cornerPosition ?? null,
            now,
            noteId,
            ctx.team.id,
          ]
        );
        return { status: 200, body: { ok: true } };
      }
      if (method === 'DELETE') {
        await ctx.db.query(`DELETE FROM mod_video_notes WHERE id = $1 AND team_id = $2`, [
          noteId,
          ctx.team.id,
        ]);
        return { status: 200, body: { ok: true } };
      }
    }

    // --- 8. Smart Playlists ---
    if (method === 'GET' && pfad === '/playlists') {
      const season = typeof req.query.season === 'string' ? req.query.season : ctx.team.aktiveSaison;
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
        [ctx.team.id, season]
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
      if (!istCoachOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Coaches dürfen Playlists speichern.' } };
      }
      const body = (req.body ?? {}) as Partial<SmartPlaylist>;
      const name = (body.name ?? '').trim();
      if (!name) return { status: 400, body: { fehler: 'Name der Playlist erforderlich.' } };
      const id = `pl-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      await ctx.db.query(
        `INSERT INTO mod_video_playlists (
           id, team_id, name, description, season, match_mode, rules_json, play_ids_json, created_by, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $10)`,
        [
          id,
          ctx.team.id,
          name,
          body.description ?? '',
          body.season ?? ctx.team.aktiveSaison,
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
      if (!istCoachOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Coaches dürfen Playlists löschen.' } };
      }
      await ctx.db.query(`DELETE FROM mod_video_playlists WHERE id = $1 AND team_id = $2`, [
        decodeURIComponent(playlistMatch[1]),
        ctx.team.id,
      ]);
      return { status: 200, body: { ok: true } };
    }

    // --- 9. Team-Sharing & Öffentliche /share/<token>-Links ---
    const shareTeamMatch = pfad.match(/^\/reels\/([^/]+)\/share-team$/);
    if (method === 'POST' && shareTeamMatch) {
      if (!istCoachOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Coaches dürfen Reels teilen.' } };
      }
      const reelId = decodeURIComponent(shareTeamMatch[1]);
      const body = (req.body ?? {}) as {
        targetTeamId?: string;
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
        [reelId, ctx.team.id]
      );
      if (sourceAcc.rows.length === 0) {
        return { status: 404, body: { fehler: 'Quell-Reel nicht gefunden.' } };
      }
      const src = sourceAcc.rows[0];
      const accessId = `acc-${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      await ctx.db.query(
        `INSERT INTO mod_video_team_reel_access (
           id, team_id, reel_id, season, title, category, event_date, visibility,
           shared_from_team_id, shared_from_team_name, allowed_fields_json, created_by, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'COACHES_ONLY', $8, $9, $10::jsonb, $11, $12, $12)`,
        [
          accessId,
          targetTeamId,
          reelId,
          body.season ?? src.season,
          src.title,
          src.category,
          src.event_date,
          ctx.team.id,
          ctx.team.name,
          JSON.stringify(body.allowedFields ?? []),
          ctx.user.uuid,
          now,
        ]
      );
      await ctx.db.query(
        `UPDATE mod_video_media_reels SET ref_count = ref_count + 1 WHERE id = $1`,
        [reelId]
      );
      return { status: 201, body: { accessId } };
    }

    const shareLinksMatch = pfad.match(/^\/reels\/([^/]+)\/share-links$/);
    if (shareLinksMatch) {
      if (!istCoachOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Coaches dürfen öffentliche Share-Links verwalten.' } };
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
          [ctx.team.id, reelId]
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
          [reelId, ctx.team.id]
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
            ctx.team.id,
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
      if (!istCoachOderAdmin) {
        return { status: 403, body: { fehler: 'Nur Coaches dürfen Share-Links widerrufen.' } };
      }
      const id = decodeURIComponent(shareRevokeMatch[1]);
      await ctx.db.query(
        `UPDATE mod_video_share_links SET revoked_at = $1 WHERE id = $2 AND team_id = $3`,
        [new Date().toISOString(), id, ctx.team.id]
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
      return { status: 410, body: { fehler: 'Dieser Freigabe-Link ist abgelaufen oder widerrufen.' } };
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

    // Vorwärtskompatible Read-Only S3-Signierung (greift automatisch sobald Core publicCtx liefert)
    let publicS3: Pick<PluginS3Scope, 'prefix' | 'getSignedDownloadUrl'> | undefined;
    if (publicCtx?.createTeamS3ReadScope) {
      publicS3 = publicCtx.createTeamS3ReadScope(link.team_id);
    } else if (publicCtx?.getSignedDownloadUrlForTeam) {
      const signer = publicCtx.getSignedDownloadUrlForTeam;
      publicS3 = {
        prefix: `teams/${link.team_id}/plugins/video-analysis/`,
        getSignedDownloadUrl: ({ objectPath, expiresInSeconds }) =>
          signer({ teamId: link.team_id, objectPath, expiresInSeconds }),
      };
    }

    // Strikt ohne Coach-Notizen oder Telestrationen ausliefern
    const plays = await ladePlaysFuerReel(db, link.reel_id, link.team_id, allowedFields, publicS3);
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

  async listExportableItems(ctx, options): Promise<PluginScopeItem[]> {
    const season = options?.season ?? ctx.team.aktiveSaison;
    const rows = await ctx.db.query<{
      reel_id: string;
      title: string;
      season: string;
      updated_at: string;
    }>(
      `SELECT reel_id, title, season, updated_at
       FROM mod_video_team_reel_access
       WHERE team_id = $1 AND ($2 = 'ALL' OR season = $2)
       ORDER BY event_date DESC`,
      [ctx.team.id, season]
    );
    return rows.rows.map((r) => ({
      id: r.reel_id,
      title: r.title,
      season: r.season,
      updatedAt: r.updated_at,
    }));
  },

  async exportScope(ctx, options): Promise<PluginExportScopeResult> {
    const season = options?.season ?? ctx.team.aktiveSaison;
    const items = await this.listExportableItems!(ctx, { season });
    const gefiltert = options?.itemIds
      ? items.filter((i) => options.itemIds!.includes(i.id))
      : items;

    const reelsExport = [];
    const assetKeys = new Set<string>();
    for (const item of gefiltert) {
      const plays = await ladePlaysFuerReel(ctx.db, item.id, ctx.team.id, null);
      plays.forEach((p) =>
        Object.values(p.sources).forEach((s) => {
          if (s.s3Key) assetKeys.add(s.s3Key);
        })
      );
      reelsExport.push({ item, plays });
    }

    return {
      schemaVersion: '1.0',
      pluginId: manifest.id,
      items: gefiltert,
      payload: { reels: reelsExport },
      assetKeys: Array.from(assetKeys),
    };
  },

  async importScope(ctx, bundle): Promise<{ imported: number; skipped: number }> {
    const payload = bundle.payload as {
      reels?: Array<{ item: PluginScopeItem; plays: PlayEintrag[] }>;
    };
    const eintraege = payload?.reels ?? [];
    let imported = 0;
    let skipped = 0;

    for (const eintrag of eintraege) {
      const existiert = await ctx.db.query<{ id: string }>(
        `SELECT id FROM mod_video_team_reel_access WHERE reel_id = $1 AND team_id = $2 LIMIT 1`,
        [eintrag.item.id, ctx.team.id]
      );
      if (existiert.rows.length > 0) {
        skipped += 1;
        continue;
      }
      const now = new Date().toISOString();
      await ctx.db.query(
        `INSERT INTO mod_video_media_reels (id, ref_count, created_by, created_at)
         VALUES ($1, 1, $2, $3) ON CONFLICT (id) DO NOTHING`,
        [eintrag.item.id, ctx.user.uuid, now]
      );
      await ctx.db.query(
        `INSERT INTO mod_video_team_reel_access (
           id, team_id, reel_id, season, title, category, event_date, visibility, created_by, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, 'GAME', $6, 'COACHES_ONLY', $7, $8, $8)`,
        [
          `acc-${crypto.randomUUID()}`,
          ctx.team.id,
          eintrag.item.id,
          eintrag.item.season ?? ctx.team.aktiveSaison,
          eintrag.item.title,
          now.slice(0, 10),
          ctx.user.uuid,
          now,
        ]
      );
      imported += 1;
    }

    return { imported, skipped };
  },
};

export default backendPlugin;
