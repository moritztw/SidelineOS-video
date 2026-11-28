import type { ClubSpeicherStatus } from '@sidelineos/plugin-sdk';
import type {
  BenutzerVideoPraeferenzen,
  ClubReelUebersicht,
  ClubTeamInfo,
  CoachNotiz,
  FrameTelestration,
  PlayBreakdownDaten,
  PlayEintrag,
  PluginSaisonEintrag,
  PublicShareAnsichtDaten,
  PublicShareLinkInfo,
  QuellenModus,
  ReelAccessMode,
  ReelShareScope,
  SichtbarkeitsStufe,
  SmartPlaylist,
  TaggingFeldKonfig,
  TeamTaggingSchema,
  TelestrationElement,
  VideoKategorie,
  VideoReelEintrag,
} from '../types/video';

export type ApiFetchFn = (subPfad: string, init?: RequestInit) => Promise<Response>;

export class VideoApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'VideoApiError';
    this.status = status;
    this.code = code;
  }
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      fehler?: string;
      error?: string;
      code?: string;
    };
    const code = body.code;
    if (res.status === 413 || code === 'STORAGE_QUOTA_EXCEEDED') {
      throw new VideoApiError(
        body.fehler ??
          'Speicherlimit des Vereins erreicht (HTTP 413). Bitte Speicher freigeben oder Kontingent erhöhen.',
        413,
        'STORAGE_QUOTA_EXCEEDED'
      );
    }
    if (res.status === 409 || code === 'TEAM_ARCHIVED_READ_ONLY') {
      throw new VideoApiError(
        body.fehler ?? 'Dieses Team ist archiviert (Nur-Lese-Modus). Änderungen sind gesperrt.',
        409,
        'TEAM_ARCHIVED_READ_ONLY'
      );
    }
    throw new VideoApiError(body.fehler ?? body.error ?? `HTTP ${res.status}`, res.status, code);
  }
  return (await res.json()) as T;
}

async function callApi<T>(apiFetch: ApiFetchFn, pfad: string, init: RequestInit = {}): Promise<T> {
  const cleanPath = pfad.startsWith('/') ? pfad : `/${pfad}`;
  const res = await apiFetch(cleanPath, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  return parseJsonResponse<T>(res);
}

/**
 * SDK v2.0 API-Client: Nutzt ausschließlich das vom Core injizierte `ctx.apiFetch(subPfad, init)`.
 * Kein hartkodierter `/api/v1/...`-Pfad mehr!
 */
export function erstelleVideoApi(apiFetch: ApiFetchFn) {
  return {
    // --- Saisons (Plugin-Entität in SDK v2.0) ---
    holeSaisons(): Promise<{ seasons: PluginSaisonEintrag[]; activeSeason: string }> {
      return callApi(apiFetch, '/seasons');
    },

    erstelleSaison(payload: {
      name: string;
      setActive?: boolean;
    }): Promise<{ season: PluginSaisonEintrag }> {
      return callApi(apiFetch, '/seasons', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    setzeAktiveSaison(seasonId: string): Promise<{ ok: boolean }> {
      return callApi(apiFetch, `/seasons/${encodeURIComponent(seasonId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: true }),
      });
    },

    // --- Team-Reels ---
    holeReels(season: string): Promise<{ reels: VideoReelEintrag[] }> {
      return callApi(apiFetch, `/reels?season=${encodeURIComponent(season)}`);
    },

    holeReelDetails(reelId: string): Promise<{
      reel: VideoReelEintrag;
      plays: PlayEintrag[];
      telestrations: FrameTelestration[];
      notes: CoachNotiz[];
    }> {
      return callApi(apiFetch, `/reels/${encodeURIComponent(reelId)}`);
    },

    erstelleReel(payload: {
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
    }): Promise<{ reelId: string; accessId: string }> {
      return callApi(apiFetch, '/reels', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    aktualisiereReel(
      reelId: string,
      patch: {
        title?: string;
        category?: VideoKategorie;
        eventDate?: string;
        season?: string;
        visibility?: SichtbarkeitsStufe;
      }
    ): Promise<{ ok: boolean; updatedAt?: string }> {
      return callApi(apiFetch, `/reels/${encodeURIComponent(reelId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
    },

    importiereHudlCsvBulk(
      reelId: string,
      payload: {
        playPatches: Array<{
          playId?: string;
          playNumber: number;
          breakdown: PlayBreakdownDaten;
        }>;
        newCustomFields?: TaggingFeldKonfig[];
      }
    ): Promise<{ ok: boolean; updatedPlays: number; addedFields: number }> {
      return callApi(apiFetch, `/reels/${encodeURIComponent(reelId)}/breakdown-import`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    aktualisiereReelFreigabe(
      reelId: string,
      payload: {
        shareScope: ReelShareScope;
        clubWideAccessMode?: Exclude<ReelAccessMode, 'OWNER'>;
        sharedTeams?: Array<{
          teamId: string;
          teamName?: string;
          accessMode: Exclude<ReelAccessMode, 'OWNER'>;
          allowedFields?: string[] | null;
        }>;
      }
    ): Promise<{ ok: boolean; refCount: number }> {
      return callApi(apiFetch, `/reels/${encodeURIComponent(reelId)}/sharing`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },

    fuegeAngleHinzu(
      reelId: string,
      payload: {
        angleCode: string;
        mode: 'CLIPS' | 'FULL_TAPE';
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
      }
    ): Promise<{ ok: boolean; angleCode: string; assignedCount: number }> {
      return callApi(apiFetch, `/reels/${encodeURIComponent(reelId)}/angles`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    loescheReel(reelId: string): Promise<{ ok: boolean; refCount: number }> {
      return callApi(apiFetch, `/reels/${encodeURIComponent(reelId)}`, {
        method: 'DELETE',
      });
    },

    // --- Plays ---
    erstellePlay(
      reelId: string,
      payload: {
        playNumber: number;
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
      }
    ): Promise<{ id: string }> {
      return callApi(apiFetch, `/reels/${encodeURIComponent(reelId)}/plays`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    aktualisierePlay(
      playId: string,
      patch: {
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
      }
    ): Promise<{ ok: boolean }> {
      return callApi(apiFetch, `/plays/${encodeURIComponent(playId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
    },

    loeschePlay(playId: string): Promise<{ ok: boolean }> {
      return callApi(apiFetch, `/plays/${encodeURIComponent(playId)}`, {
        method: 'DELETE',
      });
    },

    // --- Telestrations & Notizen ---
    speichereTelestration(
      playId: string,
      payload: {
        reelId: string;
        angleCode: string;
        frameIndex: number;
        elements: TelestrationElement[];
      }
    ): Promise<{ ok: boolean; updatedAt: string }> {
      return callApi(apiFetch, `/plays/${encodeURIComponent(playId)}/telestrations`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    },

    erstelleNotiz(
      playId: string,
      payload: Omit<CoachNotiz, 'id' | 'authorUuid' | 'authorName' | 'createdAt' | 'updatedAt'>
    ): Promise<{ id: string }> {
      return callApi(apiFetch, `/plays/${encodeURIComponent(playId)}/notes`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    aktualisiereNotiz(
      noteId: string,
      patch: Partial<Pick<CoachNotiz, 'text' | 'status' | 'visibility' | 'color' | 'cornerPosition'>>
    ): Promise<{ ok: boolean }> {
      return callApi(apiFetch, `/notes/${encodeURIComponent(noteId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
    },

    loescheNotiz(noteId: string): Promise<{ ok: boolean }> {
      return callApi(apiFetch, `/notes/${encodeURIComponent(noteId)}`, {
        method: 'DELETE',
      });
    },

    // --- Schema & Präferenzen ---
    holeSchema(): Promise<{ schema: TeamTaggingSchema }> {
      return callApi(apiFetch, '/schema');
    },

    speichereSchema(
      schema: Pick<TeamTaggingSchema, 'fields' | 'dictionary' | 'annotationSharing'>
    ): Promise<{ schema: TeamTaggingSchema }> {
      return callApi(apiFetch, '/schema', {
        method: 'PUT',
        body: JSON.stringify(schema),
      });
    },

    holePraeferenzen(): Promise<{ prefs: BenutzerVideoPraeferenzen }> {
      return callApi(apiFetch, '/prefs');
    },

    speicherePraeferenzen(
      prefs: Partial<BenutzerVideoPraeferenzen>
    ): Promise<{ prefs: BenutzerVideoPraeferenzen }> {
      return callApi(apiFetch, '/prefs', {
        method: 'PUT',
        body: JSON.stringify(prefs),
      });
    },

    // --- Smart Playlists ---
    holePlaylists(season: string): Promise<{ playlists: SmartPlaylist[] }> {
      return callApi(apiFetch, `/playlists?season=${encodeURIComponent(season)}`);
    },

    erstellePlaylist(
      payload: Omit<SmartPlaylist, 'id' | 'teamId' | 'createdBy' | 'createdAt' | 'updatedAt'>
    ): Promise<{ id: string }> {
      return callApi(apiFetch, '/playlists', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    loeschePlaylist(playlistId: string): Promise<{ ok: boolean }> {
      return callApi(apiFetch, `/playlists/${encodeURIComponent(playlistId)}`, {
        method: 'DELETE',
      });
    },

    // --- Club-Scope & Vereins-Teams (#10) ---
    holeClubTeams(): Promise<{ teams: ClubTeamInfo[] }> {
      return callApi(apiFetch, '/club/teams');
    },

    holeClubReels(): Promise<{
      reels: ClubReelUebersicht[];
      teams: ClubTeamInfo[];
      speicher?: ClubSpeicherStatus | null;
    }> {
      return callApi(apiFetch, '/club/reels');
    },

    aktualisiereClubReelFreigabe(
      reelId: string,
      payload: {
        shareScope: ReelShareScope;
        clubWideAccessMode?: Exclude<ReelAccessMode, 'OWNER'>;
        sharedTeams?: Array<{
          teamId: string;
          teamName?: string;
          accessMode: Exclude<ReelAccessMode, 'OWNER'>;
          allowedFields?: string[] | null;
        }>;
      }
    ): Promise<{ ok: boolean; refCount: number }> {
      return callApi(apiFetch, `/club/reels/${encodeURIComponent(reelId)}/sharing`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },

    loescheClubReel(reelId: string): Promise<{ ok: boolean }> {
      return callApi(apiFetch, `/club/reels/${encodeURIComponent(reelId)}`, {
        method: 'DELETE',
      });
    },

    // --- Team-Sharing & Public Links ---
    teileAnTeam(
      reelId: string,
      payload: {
        targetTeamId: string;
        targetTeamName?: string;
        accessMode?: Exclude<ReelAccessMode, 'OWNER'>;
        allowedFields: string[];
        season?: string;
      }
    ): Promise<{ accessId: string }> {
      return callApi(apiFetch, `/reels/${encodeURIComponent(reelId)}/share-team`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    holeShareLinks(reelId: string): Promise<{ links: PublicShareLinkInfo[] }> {
      return callApi(apiFetch, `/reels/${encodeURIComponent(reelId)}/share-links`);
    },

    erstelleShareLink(
      reelId: string,
      payload: {
        label: string;
        allowedFields: string[];
        includeMetadata?: boolean;
        expiresInDays: number;
      }
    ): Promise<{ link: PublicShareLinkInfo }> {
      return callApi(apiFetch, `/reels/${encodeURIComponent(reelId)}/share-links`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    widerrufeShareLink(linkId: string): Promise<{ ok: boolean }> {
      return callApi(apiFetch, `/share-links/${encodeURIComponent(linkId)}`, {
        method: 'DELETE',
      });
    },

    // --- Storage Presign / Multipart Upload (SDK v2.0 ctx.storage inkl. fileSizeBytes Quota) ---
    async ladeDateiZuStorage(
      file: File,
      objectPath: string,
      onProgress?: (prozent: number) => void
    ): Promise<{ key: string }> {
      const CHUNK_SIZE = 5 * 1024 * 1024;
      if (file.size <= CHUNK_SIZE) {
        const { url, key } = await callApi<{ url: string; key: string }>(
          apiFetch,
          '/storage/presign-upload',
          {
            method: 'POST',
            body: JSON.stringify({
              objectPath,
              contentType: file.type || 'video/mp4',
              fileSizeBytes: file.size,
            }),
          }
        );
        const putRes = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'video/mp4' },
          body: file,
        });
        if (!putRes.ok) {
          throw new VideoApiError(`Storage-Upload fehlgeschlagen (HTTP ${putRes.status})`, putRes.status);
        }
        onProgress?.(100);
        return { key };
      }

      const init = await callApi<{ uploadId: string; key: string }>(
        apiFetch,
        '/storage/multipart/init',
        {
          method: 'POST',
          body: JSON.stringify({
            objectPath,
            contentType: file.type || 'video/mp4',
            fileSizeBytes: file.size,
          }),
        }
      );

      const totalParts = Math.ceil(file.size / CHUNK_SIZE);
      const parts: Array<{ partNumber: number; etag: string }> = [];

      try {
        for (let i = 0; i < totalParts; i += 1) {
          const partNumber = i + 1;
          const start = i * CHUNK_SIZE;
          const end = Math.min(file.size, start + CHUNK_SIZE);
          const chunk = file.slice(start, end);

          const { url } = await callApi<{ url: string }>(apiFetch, '/storage/multipart/part', {
            method: 'POST',
            body: JSON.stringify({
              objectPath,
              uploadId: init.uploadId,
              partNumber,
            }),
          });

          const partRes = await fetch(url, { method: 'PUT', body: chunk });
          if (!partRes.ok) {
            throw new VideoApiError(
              `Multipart-Teil ${partNumber} fehlgeschlagen (HTTP ${partRes.status})`,
              partRes.status
            );
          }
          const etag = partRes.headers.get('ETag') ?? `"part-${partNumber}"`;
          parts.push({ partNumber, etag });
          onProgress?.(Math.round((partNumber / totalParts) * 100));
        }

        const done = await callApi<{ key: string }>(apiFetch, '/storage/multipart/complete', {
          method: 'POST',
          body: JSON.stringify({
            objectPath,
            uploadId: init.uploadId,
            parts,
          }),
        });
        return { key: done.key };
      } catch (err) {
        await callApi(apiFetch, '/storage/multipart/abort', {
          method: 'POST',
          body: JSON.stringify({ objectPath, uploadId: init.uploadId }),
        }).catch(() => undefined);
        throw err;
      }
    },
  };
}

export type VideoApiClient = ReturnType<typeof erstelleVideoApi>;

export async function holeOeffentlichenShare(
  token: string
): Promise<{ status: number; data?: PublicShareAnsichtDaten; fehler?: string }> {
  const res = await fetch(
    `/api/v2/public/plugins/video-analysis/share/${encodeURIComponent(token)}`
  );
  const body = (await res.json().catch(() => ({}))) as PublicShareAnsichtDaten & {
    fehler?: string;
  };
  if (!res.ok) {
    return { status: res.status, fehler: body.fehler };
  }
  return { status: 200, data: body };
}
