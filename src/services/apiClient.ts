import type {
  BenutzerVideoPraeferenzen,
  CoachNotiz,
  FrameTelestration,
  PlayBreakdownDaten,
  PlayEintrag,
  PublicShareAnsichtDaten,
  PublicShareLinkInfo,
  QuellenModus,
  SichtbarkeitsStufe,
  SmartPlaylist,
  TeamTaggingSchema,
  TelestrationElement,
  VideoKategorie,
  VideoReelEintrag,
} from '../types/video';

async function pluginRequest<T>(
  teamId: string,
  pfad: string,
  init: RequestInit = {}
): Promise<T> {
  const cleanPath = pfad.startsWith('/') ? pfad : `/${pfad}`;
  const res = await fetch(`/api/v1/plugins/video-analysis/teams/${encodeURIComponent(teamId)}${cleanPath}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { fehler?: string };
    throw new Error(body.fehler ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const videoApi = {
  holeReels(teamId: string, season: string): Promise<{ reels: VideoReelEintrag[] }> {
    return pluginRequest(teamId, `/reels?season=${encodeURIComponent(season)}`);
  },

  holeReelDetails(
    teamId: string,
    reelId: string
  ): Promise<{
    reel: VideoReelEintrag;
    plays: PlayEintrag[];
    telestrations: FrameTelestration[];
    notes: CoachNotiz[];
  }> {
    return pluginRequest(teamId, `/reels/${encodeURIComponent(reelId)}`);
  },

  erstelleReel(
    teamId: string,
    payload: {
      bundle?: unknown;
      title?: string;
      category?: VideoKategorie;
      eventDate?: string;
      season?: string;
      visibility?: SichtbarkeitsStufe;
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
    }
  ): Promise<{ reelId: string; accessId: string }> {
    return pluginRequest(teamId, '/reels', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  aktualisiereReel(
    teamId: string,
    reelId: string,
    patch: { title?: string; category?: VideoKategorie; visibility?: SichtbarkeitsStufe }
  ): Promise<{ ok: boolean }> {
    return pluginRequest(teamId, `/reels/${encodeURIComponent(reelId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  loescheReel(teamId: string, reelId: string): Promise<{ ok: boolean; refCount: number }> {
    return pluginRequest(teamId, `/reels/${encodeURIComponent(reelId)}`, {
      method: 'DELETE',
    });
  },

  erstellePlay(
    teamId: string,
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
    return pluginRequest(teamId, `/reels/${encodeURIComponent(reelId)}/plays`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  aktualisierePlay(
    teamId: string,
    playId: string,
    patch: {
      playNumber?: number;
      breakdown?: PlayBreakdownDaten;
      angleOffsets?: Record<string, { startMs?: number; endMs?: number; offsetMs?: number | null }>;
    }
  ): Promise<{ ok: boolean }> {
    return pluginRequest(teamId, `/plays/${encodeURIComponent(playId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  loeschePlay(teamId: string, playId: string): Promise<{ ok: boolean }> {
    return pluginRequest(teamId, `/plays/${encodeURIComponent(playId)}`, {
      method: 'DELETE',
    });
  },

  speichereTelestration(
    teamId: string,
    playId: string,
    payload: {
      reelId: string;
      angleCode: string;
      frameIndex: number;
      elements: TelestrationElement[];
    }
  ): Promise<{ ok: boolean; updatedAt: string }> {
    return pluginRequest(teamId, `/plays/${encodeURIComponent(playId)}/telestrations`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  erstelleNotiz(
    teamId: string,
    playId: string,
    payload: Omit<CoachNotiz, 'id' | 'authorUuid' | 'authorName' | 'createdAt' | 'updatedAt'>
  ): Promise<{ id: string }> {
    return pluginRequest(teamId, `/plays/${encodeURIComponent(playId)}/notes`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  aktualisiereNotiz(
    teamId: string,
    noteId: string,
    patch: Partial<Pick<CoachNotiz, 'text' | 'status' | 'cornerPosition'>>
  ): Promise<{ ok: boolean }> {
    return pluginRequest(teamId, `/notes/${encodeURIComponent(noteId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  loescheNotiz(teamId: string, noteId: string): Promise<{ ok: boolean }> {
    return pluginRequest(teamId, `/notes/${encodeURIComponent(noteId)}`, {
      method: 'DELETE',
    });
  },

  holeSchema(teamId: string): Promise<{ schema: TeamTaggingSchema }> {
    return pluginRequest(teamId, '/schema');
  },

  speichereSchema(
    teamId: string,
    schema: Pick<TeamTaggingSchema, 'fields' | 'dictionary'>
  ): Promise<{ schema: TeamTaggingSchema }> {
    return pluginRequest(teamId, '/schema', {
      method: 'PUT',
      body: JSON.stringify(schema),
    });
  },

  holePraeferenzen(teamId: string): Promise<{ prefs: BenutzerVideoPraeferenzen }> {
    return pluginRequest(teamId, '/prefs');
  },

  speicherePraeferenzen(
    teamId: string,
    prefs: Partial<BenutzerVideoPraeferenzen>
  ): Promise<{ prefs: BenutzerVideoPraeferenzen }> {
    return pluginRequest(teamId, '/prefs', {
      method: 'PUT',
      body: JSON.stringify(prefs),
    });
  },

  holePlaylists(teamId: string, season: string): Promise<{ playlists: SmartPlaylist[] }> {
    return pluginRequest(teamId, `/playlists?season=${encodeURIComponent(season)}`);
  },

  erstellePlaylist(
    teamId: string,
    payload: Omit<SmartPlaylist, 'id' | 'teamId' | 'createdBy' | 'createdAt' | 'updatedAt'>
  ): Promise<{ id: string }> {
    return pluginRequest(teamId, '/playlists', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  loeschePlaylist(teamId: string, playlistId: string): Promise<{ ok: boolean }> {
    return pluginRequest(teamId, `/playlists/${encodeURIComponent(playlistId)}`, {
      method: 'DELETE',
    });
  },

  teileAnTeam(
    teamId: string,
    reelId: string,
    payload: { targetTeamId: string; allowedFields: string[]; season?: string }
  ): Promise<{ accessId: string }> {
    return pluginRequest(teamId, `/reels/${encodeURIComponent(reelId)}/share-team`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  holeShareLinks(teamId: string, reelId: string): Promise<{ links: PublicShareLinkInfo[] }> {
    return pluginRequest(teamId, `/reels/${encodeURIComponent(reelId)}/share-links`);
  },

  erstelleShareLink(
    teamId: string,
    reelId: string,
    payload: { label: string; allowedFields: string[]; expiresInDays: number }
  ): Promise<{ link: PublicShareLinkInfo }> {
    return pluginRequest(teamId, `/reels/${encodeURIComponent(reelId)}/share-links`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  widerrufeShareLink(teamId: string, linkId: string): Promise<{ ok: boolean }> {
    return pluginRequest(teamId, `/share-links/${encodeURIComponent(linkId)}`, {
      method: 'DELETE',
    });
  },

  async ladeDateiZuS3(
    teamId: string,
    file: File,
    objectPath: string,
    onProgress?: (prozent: number) => void
  ): Promise<{ key: string }> {
    const CHUNK_SIZE = 5 * 1024 * 1024;
    if (file.size <= CHUNK_SIZE) {
      const { url, key } = await pluginRequest<{ url: string; key: string }>(
        teamId,
        '/s3/presign-upload',
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
        throw new Error(`S3-Upload fehlgeschlagen (HTTP ${putRes.status})`);
      }
      onProgress?.(100);
      return { key };
    }

    const init = await pluginRequest<{ uploadId: string; key: string }>(
      teamId,
      '/s3/multipart/init',
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

        const { url } = await pluginRequest<{ url: string }>(teamId, '/s3/multipart/part', {
          method: 'POST',
          body: JSON.stringify({
            objectPath,
            uploadId: init.uploadId,
            partNumber,
          }),
        });

        const partRes = await fetch(url, { method: 'PUT', body: chunk });
        if (!partRes.ok) {
          throw new Error(`Multipart-Teil ${partNumber} fehlgeschlagen (HTTP ${partRes.status})`);
        }
        const etag = partRes.headers.get('ETag') ?? `"part-${partNumber}"`;
        parts.push({ partNumber, etag });
        onProgress?.(Math.round((partNumber / totalParts) * 100));
      }

      const done = await pluginRequest<{ key: string }>(teamId, '/s3/multipart/complete', {
        method: 'POST',
        body: JSON.stringify({
          objectPath,
          uploadId: init.uploadId,
          parts,
        }),
      });
      return { key: done.key };
    } catch (err) {
      await pluginRequest(teamId, '/s3/multipart/abort', {
        method: 'POST',
        body: JSON.stringify({ objectPath, uploadId: init.uploadId }),
      }).catch(() => undefined);
      throw err;
    }
  },

  async holeOeffentlichenShare(
    token: string
  ): Promise<{ status: number; data?: PublicShareAnsichtDaten; fehler?: string }> {
    const res = await fetch(
      `/api/v1/public/plugins/video-analysis/share/${encodeURIComponent(token)}`
    );
    const body = (await res.json().catch(() => ({}))) as PublicShareAnsichtDaten & {
      fehler?: string;
    };
    if (!res.ok) {
      return { status: res.status, fehler: body.fehler };
    }
    return { status: 200, data: body };
  },
};
