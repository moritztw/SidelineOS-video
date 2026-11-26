import { useEffect, useMemo, useState } from 'react';
import type {
  BenutzerKonto,
  PluginLaufzeitKontext,
  PluginSettingsKontext,
  S3Konfiguration,
  SpielerUnit,
  TeamKontext,
  TeamRolle,
} from '@sidelineos/plugin-sdk';
import plugin from '../client';
import {
  bereinigeAnmerkungsKonfig,
  filtereTelestrationElementeFuerBenutzer,
  istAnmerkungFuerBenutzerSichtbar,
} from '../services/annotationVisibility';
import { STANDARD_HOTKEYS } from '../services/frameAndHotkeys';
import { erstelleStandardTeamSchema } from '../services/taggingEngine';
import type {
  BenutzerVideoPraeferenzen,
  CoachNotiz,
  FrameTelestration,
  PlayEintrag,
  PublicShareLinkInfo,
  SmartPlaylist,
  TeamTaggingSchema,
  VideoReelEintrag,
} from '../types/video';

interface SpeicherZustand {
  reels: VideoReelEintrag[];
  plays: PlayEintrag[];
  telestrations: FrameTelestration[];
  notizen: CoachNotiz[];
  schema: TeamTaggingSchema;
  prefs: BenutzerVideoPraeferenzen;
  playlists: SmartPlaylist[];
  shareLinks: Array<PublicShareLinkInfo & { token: string }>;
}

const INITIAL_TEAM: TeamKontext = {
  id: 'team-demo-1',
  name: 'Munich Eagles',
  kurzname: 'MUC',
  aktiveSaison: '2026',
  saisons: ['2026', '2025'],
  aktivierteModule: ['video-analysis'],
  customProfilFelder: [],
};

const INITIAL_USER: BenutzerKonto = {
  uuid: 'user-coach-1',
  benutzername: 'hc_mueller',
  vollerName: 'Coach Müller',
  email: 'coach@munich-eagles.de',
  istSysadmin: true,
  erstelltAm: '2026-01-10T10:00:00.000Z',
  preferredLocale: 'de',
  customProfilWerte: {},
};

const INITIAL_S3: S3Konfiguration = {
  endpoint: 'https://s3.eu-central-1.example.invalid',
  region: 'eu-central-1',
  bucket: 'sidelineos-media',
  accessKey: 'AKIA...',
  forcePathStyle: true,
  cleanupRetentionDays: 14,
  konfiguriert: true,
};

function erstelleLeerenSpeicher(): SpeicherZustand {
  return {
    reels: [],
    plays: [],
    telestrations: [],
    notizen: [],
    schema: erstelleStandardTeamSchema(INITIAL_TEAM.id),
    prefs: {
      userUuid: INITIAL_USER.uuid,
      hotkeys: STANDARD_HOTKEYS,
      defaultCorner: 'top-right',
      defaultPlaybackRate: 1,
      autoStopEnabled: true,
      updatedAt: new Date().toISOString(),
    },
    playlists: [],
    shareLinks: [],
  };
}

function installierePreviewFetchBridge(
  speicher: SpeicherZustand,
  getKontext: () => { rolle: TeamRolle; userUnits: SpielerUnit[] }
) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const prefix = `/api/v1/plugins/video-analysis/teams/${INITIAL_TEAM.id}`;
    const publicPrefix = '/api/v1/public/plugins/video-analysis/share/';

    if (!urlStr.startsWith(prefix) && !urlStr.startsWith(publicPrefix)) {
      return originalFetch(input, init);
    }

    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (urlStr.startsWith(publicPrefix)) {
      const token = decodeURIComponent(urlStr.slice(publicPrefix.length));
      const link = speicher.shareLinks.find((l) => l.token === token);
      if (!link) {
        return new Response(JSON.stringify({ fehler: 'Link nicht gefunden.' }), { status: 404 });
      }
      if (link.revokedAt || new Date(link.expiresAt).getTime() <= Date.now()) {
        return new Response(JSON.stringify({ fehler: 'Link abgelaufen.' }), { status: 410 });
      }
      const reel = speicher.reels.find((r) => r.id === link.reelId);
      const plays = speicher.plays
        .filter((p) => p.reelId === link.reelId)
        .map((p) => ({
          ...p,
          breakdown:
            link.includeMetadata === false
              ? {}
              : link.allowedFields
                ? Object.fromEntries(
                    Object.entries(p.breakdown).filter(([k]) => link.allowedFields!.includes(k))
                  )
                : p.breakdown,
        }));
      const hatStreamUrl = plays.some((p) =>
        Object.values(p.sources).some((s) => Boolean(s.streamUrl))
      );
      return new Response(
        JSON.stringify({
          reel: {
            id: reel?.id ?? link.reelId,
            title: reel?.title ?? 'Geteiltes Reel',
            category: reel?.category ?? 'GAME',
            eventDate: reel?.eventDate ?? '2026-11-14',
            season: reel?.saison ?? '2026',
            angles: reel?.angles ?? ['SIDELINE'],
          },
          allowedFields: link.includeMetadata === false ? [] : link.allowedFields,
          includeMetadata: link.includeMetadata !== false,
          s3DownloadVerfuegbar: hatStreamUrl,
          plays,
          expiresAt: link.expiresAt,
        }),
        { status: 200 }
      );
    }

    const sub = urlStr.slice(prefix.length).split('?')[0];
    const { rolle, userUnits } = getKontext();
    const sharingKonfig = bereinigeAnmerkungsKonfig(speicher.schema.annotationSharing);

    if (method === 'GET' && sub === '/reels') {
      return new Response(JSON.stringify({ reels: speicher.reels }), { status: 200 });
    }
    if (method === 'POST' && sub === '/reels') {
      const reelId = `reel-${Date.now()}`;
      const b = body.bundle;
      const title = b?.reel?.title ?? body.title ?? 'Neues Reel';
      const playsInput = b?.plays ?? body.plays ?? [];
      const neuReel: VideoReelEintrag = {
        id: reelId,
        accessId: `acc-${Date.now()}`,
        teamId: INITIAL_TEAM.id,
        saison: (b?.reel?.event_date ?? body.eventDate ?? '2026-11-14').slice(0, 4),
        title,
        category: b?.reel?.category ?? body.category ?? 'GAME',
        eventDate: b?.reel?.event_date ?? body.eventDate ?? '2026-11-14',
        visibility: b?.reel?.visibility ?? body.visibility ?? 'COACHES_ONLY',
        angles: b?.angles ?? body.angles ?? ['SIDELINE'],
        playCount: playsInput.length,
        createdBy: INITIAL_USER.uuid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      speicher.reels = [neuReel, ...speicher.reels];
      for (let i = 0; i < playsInput.length; i += 1) {
        const p = playsInput[i];
        speicher.plays.push({
          id: `play-${Date.now()}-${i}`,
          reelId,
          playNumber: p.play_number ?? p.playNumber ?? i + 1,
          sortOrder: i + 1,
          breakdown: p.breakdown ?? {},
          sources: Object.fromEntries(
            Object.entries(p.sources ?? {}).map(([ang, s]: [string, any]) => [
              ang,
              {
                id: `ang-${Date.now()}-${ang}`,
                angleCode: ang,
                sourceMode: s.source_mode ?? s.sourceMode ?? 'CLIP_FILE',
                s3Key: s.s3Key ?? s.file ?? '',
                fileName: s.file ?? s.fileName ?? 'clip.mp4',
                fileSizeBytes: s.fileSizeBytes ?? 0,
                startMs: s.start_ms ?? s.startMs ?? 0,
                endMs: s.end_ms ?? s.endMs ?? 12000,
                offsetMs: s.offset_ms ?? s.offsetMs ?? null,
              },
            ])
          ),
        });
      }
      return new Response(JSON.stringify({ reelId, accessId: neuReel.accessId }), { status: 201 });
    }

    // GET /reels/:reelId/share-links & POST /reels/:reelId/share-links
    const shareLinksMatch = sub.match(/^\/reels\/([^/]+)\/share-links$/);
    if (shareLinksMatch) {
      const reelId = decodeURIComponent(shareLinksMatch[1]);
      if (method === 'GET') {
        return new Response(
          JSON.stringify({
            links: speicher.shareLinks.filter((l) => l.reelId === reelId),
          }),
          { status: 200 }
        );
      }
      if (method === 'POST') {
        const token = `demo_${Date.now().toString(36)}`;
        const tage = Math.min(90, Math.max(1, Number(body.expiresInDays) || 14));
        const expiresAt = new Date(Date.now() + tage * 86400 * 1000).toISOString();
        const neu = {
          id: `sl-${Date.now()}`,
          reelId,
          label: String(body.label ?? 'Public Share'),
          token,
          allowedFields: Array.isArray(body.allowedFields) ? body.allowedFields : null,
          includeMetadata: body.includeMetadata !== false,
          expiresAt,
          revokedAt: null,
          createdAt: new Date().toISOString(),
        };
        speicher.shareLinks.unshift(neu);
        return new Response(
          JSON.stringify({
            id: neu.id,
            token,
            publicPath: `/public/video-share/${token}`,
            expiresAt,
            includeMetadata: neu.includeMetadata,
          }),
          { status: 201 }
        );
      }
    }

    const revokeMatch = sub.match(/^\/share-links\/([^/]+)$/);
    if (revokeMatch && method === 'DELETE') {
      const linkId = decodeURIComponent(revokeMatch[1]);
      speicher.shareLinks = speicher.shareLinks.map((l) =>
        l.id === linkId ? { ...l, revokedAt: new Date().toISOString() } : l
      );
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // POST /reels/:reelId/angles (#7)
    const addAngleMatch = sub.match(/^\/reels\/([^/]+)\/angles$/);
    if (addAngleMatch && method === 'POST') {
      const reelId = decodeURIComponent(addAngleMatch[1]);
      const reel = speicher.reels.find((r) => r.id === reelId);
      if (!reel) return new Response(JSON.stringify({ fehler: 'Nicht gefunden.' }), { status: 404 });
      const angleCode = String(body.angleCode ?? 'ENDZONE').toUpperCase();
      if (!reel.angles.includes(angleCode)) {
        reel.angles = [...reel.angles, angleCode];
      }

      if (body.mode === 'FULL_TAPE' && body.tape) {
        let ersterPlay = speicher.plays.find((p) => p.reelId === reelId);
        if (!ersterPlay) {
          ersterPlay = {
            id: `play-${Date.now()}`,
            reelId,
            playNumber: 1,
            sortOrder: 1,
            breakdown: { odk: 'O', play_number: 1 },
            sources: {},
          };
          speicher.plays.push(ersterPlay);
          reel.playCount += 1;
        }
        ersterPlay.sources[angleCode] = {
          id: `ang-${Date.now()}`,
          angleCode,
          sourceMode: 'TIME_SLICE',
          s3Key: body.tape.s3Key ?? '',
          fileName: body.tape.fileName ?? 'tape.mp4',
          fileSizeBytes: body.tape.fileSizeBytes ?? 0,
          startMs: body.tape.startMs ?? 0,
          endMs: body.tape.endMs ?? 25000,
          offsetMs: body.tape.offsetMs ?? null,
        };
        return new Response(
          JSON.stringify({ ok: true, angleCode, mode: 'FULL_TAPE', assignedCount: 1 }),
          { status: 201 }
        );
      }

      const assignments = Array.isArray(body.assignments) ? body.assignments : [];
      let assignedCount = 0;
      for (const item of assignments) {
        let targetPlay = item.playId
          ? speicher.plays.find((p) => p.id === item.playId && p.reelId === reelId)
          : undefined;
        if (!targetPlay && item.createNewPlay !== false) {
          const nextNr =
            speicher.plays
              .filter((p) => p.reelId === reelId)
              .reduce((m, p) => Math.max(m, p.playNumber), 0) + 1;
          targetPlay = {
            id: `play-${Date.now()}-${assignedCount}`,
            reelId,
            playNumber: nextNr,
            sortOrder: nextNr,
            breakdown: { odk: 'O', play_number: nextNr },
            sources: {},
          };
          speicher.plays.push(targetPlay);
          reel.playCount += 1;
        }
        if (targetPlay) {
          targetPlay.sources[angleCode] = {
            id: `ang-${Date.now()}-${assignedCount}`,
            angleCode,
            sourceMode: 'CLIP_FILE',
            s3Key: item.s3Key ?? '',
            fileName: item.fileName ?? 'clip.mp4',
            fileSizeBytes: item.fileSizeBytes ?? 0,
            startMs: item.startMs ?? 0,
            endMs: item.endMs ?? 12000,
            offsetMs: item.offsetMs ?? null,
          };
          assignedCount += 1;
        }
      }
      return new Response(
        JSON.stringify({ ok: true, angleCode, mode: 'CLIPS', assignedCount }),
        { status: 201 }
      );
    }

    // POST /reels/:reelId/plays
    const addPlayMatch = sub.match(/^\/reels\/([^/]+)\/plays$/);
    if (addPlayMatch && method === 'POST') {
      const reelId = decodeURIComponent(addPlayMatch[1]);
      const id = `play-${Date.now()}`;
      const reel = speicher.reels.find((r) => r.id === reelId);
      const nr =
        body.playNumber ??
        speicher.plays
          .filter((p) => p.reelId === reelId)
          .reduce((m, p) => Math.max(m, p.playNumber), 0) + 1;
      const neuPlay: PlayEintrag = {
        id,
        reelId,
        playNumber: nr,
        sortOrder: nr,
        breakdown: body.breakdown ?? { odk: 'O', play_number: nr },
        sources: Object.fromEntries(
          Object.entries(body.sources ?? {}).map(([ang, s]: [string, any]) => [
            ang,
            {
              id: `ang-${Date.now()}-${ang}`,
              angleCode: ang,
              sourceMode: s.sourceMode ?? 'CLIP_FILE',
              s3Key: s.s3Key ?? '',
              fileName: s.fileName ?? 'clip.mp4',
              fileSizeBytes: s.fileSizeBytes ?? 0,
              startMs: s.startMs ?? 0,
              endMs: s.endMs ?? 12000,
              offsetMs: s.offsetMs ?? null,
            },
          ])
        ),
      };
      speicher.plays.push(neuPlay);
      if (reel) reel.playCount = speicher.plays.filter((p) => p.reelId === reelId).length;
      return new Response(JSON.stringify({ id }), { status: 201 });
    }

    // GET / PATCH / DELETE /reels/:reelId
    const reelMatch = sub.match(/^\/reels\/([^/]+)$/);
    if (reelMatch) {
      const reelId = decodeURIComponent(reelMatch[1]);
      if (method === 'GET') {
        const reel = speicher.reels.find((r) => r.id === reelId);
        if (!reel) return new Response(JSON.stringify({ fehler: 'Nicht gefunden.' }), { status: 404 });
        const filteredTel = speicher.telestrations
          .filter((t) => t.reelId === reelId)
          .map((t) => ({
            ...t,
            elements: filtereTelestrationElementeFuerBenutzer(
              t.elements,
              rolle,
              userUnits,
              sharingKonfig.enabled
            ),
          }))
          .filter((t) => t.elements.length > 0);
        const filteredNotizen = speicher.notizen.filter(
          (n) =>
            n.reelId === reelId &&
            (rolle === 'COACH' || rolle === 'TEAM_ADMIN' || n.status === 'PUBLISHED') &&
            istAnmerkungFuerBenutzerSichtbar(n.visibility, rolle, userUnits, sharingKonfig.enabled)
        );
        return new Response(
          JSON.stringify({
            reel,
            plays: speicher.plays.filter((p) => p.reelId === reelId),
            telestrations: filteredTel,
            notes: filteredNotizen,
          }),
          { status: 200 }
        );
      }
      if (method === 'PATCH') {
        speicher.reels = speicher.reels.map((r) =>
          r.id === reelId
            ? {
                ...r,
                ...(body.title ? { title: String(body.title) } : {}),
                ...(body.category ? { category: body.category } : {}),
                ...(body.eventDate ? { eventDate: String(body.eventDate) } : {}),
                ...(body.season ? { saison: String(body.season) } : {}),
                ...(body.visibility ? { visibility: body.visibility } : {}),
                updatedAt: new Date().toISOString(),
              }
            : r
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (method === 'DELETE') {
        speicher.reels = speicher.reels.filter((r) => r.id !== reelId);
        speicher.plays = speicher.plays.filter((p) => p.reelId !== reelId);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
    }

    // PATCH / DELETE /plays/:playId
    const playMatch = sub.match(/^\/plays\/([^/]+)$/);
    if (playMatch) {
      const playId = decodeURIComponent(playMatch[1]);
      if (method === 'PATCH') {
        speicher.plays = speicher.plays.map((p) => {
          if (p.id !== playId) return p;
          const nextSources = { ...p.sources };
          if (body.angleOffsets) {
            for (const [ang, cfg] of Object.entries<any>(body.angleOffsets)) {
              if (nextSources[ang]) {
                nextSources[ang] = {
                  ...nextSources[ang],
                  ...(cfg.offsetMs !== undefined ? { offsetMs: cfg.offsetMs } : {}),
                  ...(cfg.startMs !== undefined ? { startMs: cfg.startMs } : {}),
                  ...(cfg.endMs !== undefined ? { endMs: cfg.endMs } : {}),
                };
              }
            }
          }
          if (body.upsertSources) {
            for (const [ang, src] of Object.entries<any>(body.upsertSources)) {
              nextSources[ang] = {
                id: nextSources[ang]?.id ?? `ang-${Date.now()}-${ang}`,
                angleCode: ang,
                sourceMode: src.sourceMode ?? 'TIME_SLICE',
                s3Key: src.s3Key ?? '',
                fileName: src.fileName ?? 'clip.mp4',
                fileSizeBytes: src.fileSizeBytes ?? 0,
                startMs: src.startMs ?? 0,
                endMs: src.endMs ?? 12000,
                offsetMs: src.offsetMs ?? null,
              };
            }
          }
          return {
            ...p,
            breakdown: body.breakdown ?? p.breakdown,
            sources: nextSources,
          };
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (method === 'DELETE') {
        speicher.plays = speicher.plays.filter((p) => p.id !== playId);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
    }

    // PUT /plays/:playId/telestrations
    const telMatch = sub.match(/^\/plays\/([^/]+)\/telestrations$/);
    if (telMatch && method === 'PUT') {
      const playId = decodeURIComponent(telMatch[1]);
      const frameIndex = Number(body.frameIndex) || 0;
      const angleCode = String(body.angleCode ?? 'SIDELINE');
      speicher.telestrations = speicher.telestrations.filter(
        (t) => !(t.playId === playId && t.angleCode === angleCode && t.frameIndex === frameIndex)
      );
      if (Array.isArray(body.elements) && body.elements.length > 0) {
        speicher.telestrations.push({
          id: `tel-${Date.now()}`,
          reelId: body.reelId,
          playId,
          angleCode,
          frameIndex,
          elements: body.elements,
          authorUuid: INITIAL_USER.uuid,
          authorName: INITIAL_USER.vollerName,
          updatedAt: new Date().toISOString(),
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // POST /plays/:playId/notes
    const playNotesMatch = sub.match(/^\/plays\/([^/]+)\/notes$/);
    if (playNotesMatch && method === 'POST') {
      const playId = decodeURIComponent(playNotesMatch[1]);
      const id = `note-${Date.now()}`;
      speicher.notizen.push({
        id,
        reelId: body.reelId,
        playId,
        angleCode: body.angleCode ?? 'SIDELINE',
        frameIndex: Number(body.frameIndex) || 0,
        text: String(body.text ?? ''),
        status: body.status ?? 'PUBLISHED',
        cornerPosition: body.cornerPosition ?? 'top-right',
        visibility: body.visibility ?? 'ALL_PLAYERS',
        color: body.color,
        authorUuid: INITIAL_USER.uuid,
        authorName: INITIAL_USER.vollerName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return new Response(JSON.stringify({ id }), { status: 201 });
    }

    // PATCH / DELETE /notes/:noteId
    const noteMatch = sub.match(/^\/notes\/([^/]+)$/);
    if (noteMatch) {
      const noteId = decodeURIComponent(noteMatch[1]);
      if (method === 'PATCH') {
        speicher.notizen = speicher.notizen.map((n) =>
          n.id === noteId
            ? {
                ...n,
                ...(body.text !== undefined ? { text: body.text } : {}),
                ...(body.status !== undefined ? { status: body.status } : {}),
                ...(body.cornerPosition !== undefined ? { cornerPosition: body.cornerPosition } : {}),
                ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
                ...(body.color !== undefined ? { color: body.color } : {}),
                updatedAt: new Date().toISOString(),
              }
            : n
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (method === 'DELETE') {
        speicher.notizen = speicher.notizen.filter((n) => n.id !== noteId);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
    }

    if (method === 'GET' && sub === '/schema') {
      return new Response(JSON.stringify({ schema: speicher.schema }), { status: 200 });
    }
    if (method === 'PUT' && sub === '/schema') {
      speicher.schema = { ...speicher.schema, ...body, updatedAt: new Date().toISOString() };
      return new Response(JSON.stringify({ schema: speicher.schema }), { status: 200 });
    }
    if (method === 'GET' && sub === '/prefs') {
      return new Response(JSON.stringify({ prefs: speicher.prefs }), { status: 200 });
    }
    if (method === 'PUT' && sub === '/prefs') {
      speicher.prefs = { ...speicher.prefs, ...body, updatedAt: new Date().toISOString() };
      return new Response(JSON.stringify({ prefs: speicher.prefs }), { status: 200 });
    }
    if (method === 'GET' && sub === '/playlists') {
      return new Response(JSON.stringify({ playlists: speicher.playlists }), { status: 200 });
    }
    if (method === 'POST' && sub === '/playlists') {
      const id = `pl-${Date.now()}`;
      speicher.playlists.unshift({
        id,
        teamId: INITIAL_TEAM.id,
        ...body,
        createdBy: INITIAL_USER.uuid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return new Response(JSON.stringify({ id }), { status: 201 });
    }
    const delPlMatch = sub.match(/^\/playlists\/([^/]+)$/);
    if (delPlMatch && method === 'DELETE') {
      const plId = decodeURIComponent(delPlMatch[1]);
      speicher.playlists = speicher.playlists.filter((p) => p.id !== plId);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ ok: true, id: `id-${Date.now()}` }), { status: 200 });
  };
  return () => {
    window.fetch = originalFetch;
  };
}

export function PreviewApp() {
  const [speicher] = useState<SpeicherZustand>(() => erstelleLeerenSpeicher());
  const [rolle, setRolle] = useState<TeamRolle>('TEAM_ADMIN');
  const [unitPreset, setUnitPreset] = useState<'ALL' | 'OFFENSE' | 'DEFENSE' | 'SPECIAL_TEAMS' | 'NONE'>('OFFENSE');
  const [saison, setSaison] = useState('2026');
  const [tab, setTab] = useState(plugin.defaultTab);
  const [ansicht, setAnsicht] = useState<'plugin' | 'settings' | 'share'>('plugin');
  const [shareToken, setShareToken] = useState<string | null>(null);

  const userUnits = useMemo<SpielerUnit[]>(() => {
    if (unitPreset === 'ALL') return ['OFFENSE', 'DEFENSE', 'SPECIAL_TEAMS'];
    if (unitPreset === 'NONE') return [];
    return [unitPreset];
  }, [unitPreset]);

  useEffect(
    () => installierePreviewFetchBridge(speicher, () => ({ rolle, userUnits })),
    [speicher, rolle, userUnits]
  );

  const tabs = useMemo(
    () => plugin.getTabs?.({ teamRolle: rolle, locale: 'de' }) ?? [],
    [rolle]
  );

  const laufzeitCtx: PluginLaufzeitKontext = {
    team: INITIAL_TEAM,
    aktiveTeamAnsicht: rolle,
    userUnits,
    gewaehlteSaison: saison,
    benutzer: INITIAL_USER,
    locale: 'de',
    aktuellerTab: tab ?? plugin.defaultTab ?? 'library',
    onTabWechseln: (next) => {
      setAnsicht('plugin');
      setTab(next);
    },
    onTeamSettingsOeffnen: () => setAnsicht('settings'),
    onZurueckZurStartseite: () => setAnsicht('plugin'),
    onPublicShareOeffnen: (tok) => {
      setShareToken(tok);
      setAnsicht('share');
    },
  };

  const settingsCtx: PluginSettingsKontext = {
    team: INITIAL_TEAM,
    benutzer: INITIAL_USER,
    aktiveTeamAnsicht: rolle,
    s3Konfig: INITIAL_S3,
    locale: 'de',
  };

  const Provider = plugin.Provider;
  const PrimaerAktion = plugin.PrimaerAktion;

  const content = (
    <div className="min-h-screen bg-sl-canvas text-sl-primary">
      <header className="sticky top-0 z-30 border-b border-sl-border bg-sl-canvas/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-6 px-6">
          <div className="flex items-center gap-3 shrink-0">
            <span className="font-display text-base font-bold text-sl-heading">
              Sideline<span className="text-sl-accent">OS</span>
            </span>
            <span className="text-sl-border-strong">/</span>
            <span className="text-xs font-medium text-sl-muted">{plugin.manifest.name}</span>
          </div>

          <nav className="flex items-center gap-1">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setAnsicht('plugin');
                  setTab(item.id);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                  ansicht === 'plugin' && tab === item.id
                    ? 'bg-sl-elevated text-sl-heading'
                    : 'text-sl-muted hover:text-sl-heading'
                }`}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAnsicht('settings')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                ansicht === 'settings'
                  ? 'bg-sl-elevated text-sl-heading'
                  : 'text-sl-muted hover:text-sl-heading'
              }`}
            >
              Einstellungen
            </button>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <select
              aria-label="Saison wählen"
              value={saison}
              onChange={(e) => setSaison(e.target.value)}
              className="rounded-md border border-sl-border bg-sl-surface px-2 py-1 text-xs text-sl-heading"
            >
              <option value="2026">2026</option>
              <option value="2025">2025</option>
              <option value="ALL">Alle</option>
            </select>
            <select
              aria-label="Rolle testen"
              value={rolle}
              onChange={(e) => setRolle(e.target.value as TeamRolle)}
              className="rounded-md border border-sl-border bg-sl-surface px-2 py-1 text-xs text-sl-heading"
            >
              <option value="TEAM_ADMIN">Team Admin</option>
              <option value="COACH">Coach</option>
              <option value="PLAYER">Spieler</option>
            </select>
            {rolle === 'PLAYER' && (
              <select
                aria-label="Spieler-Unit testen"
                value={unitPreset}
                onChange={(e) => setUnitPreset(e.target.value as typeof unitPreset)}
                className="rounded-md border border-sl-border bg-sl-surface px-2 py-1 text-xs text-sl-heading"
              >
                <option value="OFFENSE">Unit: Offense</option>
                <option value="DEFENSE">Unit: Defense</option>
                <option value="SPECIAL_TEAMS">Unit: Special Teams</option>
                <option value="ALL">Alle Units</option>
                <option value="NONE">Keine Unit</option>
              </select>
            )}
            {PrimaerAktion && (
              <PrimaerAktion
                ctx={laufzeitCtx}
                className="rounded-md bg-sl-accent px-3.5 py-1.5 text-xs font-semibold text-sl-accent-contrast hover:bg-sl-accent-hover whitespace-nowrap shrink-0"
              />
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] p-6">
        {ansicht === 'share' && shareToken && plugin.renderPublicShareView ? (
          plugin.renderPublicShareView({
            token: shareToken,
            locale: 'de',
            onSchliessen: () => setAnsicht('plugin'),
          })
        ) : ansicht === 'settings' ? (
          <div className="space-y-6">
            {plugin.settingsPanels?.user && <plugin.settingsPanels.user ctx={settingsCtx} />}
            {plugin.settingsPanels?.team && <plugin.settingsPanels.team ctx={settingsCtx} />}
            {plugin.settingsPanels?.sysadmin && (
              <plugin.settingsPanels.sysadmin ctx={settingsCtx} />
            )}
          </div>
        ) : (
          plugin.renderMainView?.(laufzeitCtx)
        )}
      </main>
    </div>
  );

  return Provider ? <Provider>{content}</Provider> : content;
}
