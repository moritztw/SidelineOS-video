import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BenutzerKonto,
  ClubKontext,
  ClubRolle,
  PluginLaufzeitKontext,
  PluginSettingsPanelProps,
  TeamKontext,
  TeamRolle,
} from '@sidelineos/plugin-sdk';
import type { ApiFetchFn } from '../services/apiClient';
import plugin from '../client';
import {
  bereinigeAnmerkungsKonfig,
  filtereTelestrationElementeFuerBenutzer,
  istAnmerkungFuerBenutzerSichtbar,
  istStaffOderAdminRolle,
  normalisiereSichtbarkeit,
} from '../services/annotationVisibility';
import { STANDARD_HOTKEYS } from '../services/frameAndHotkeys';
import { erstelleStandardTeamSchema } from '../services/taggingEngine';
import type {
  BenutzerVideoPraeferenzen,
  ClubReelUebersicht,
  ClubTeamInfo,
  CoachNotiz,
  FrameTelestration,
  PlayBreakdownDaten,
  PlayEintrag,
  PluginSaisonEintrag,
  PublicShareLinkInfo,
  ReelAccessMode,
  ReelShareScope,
  SmartPlaylist,
  TeamReelFreigabeEintrag,
  TeamTaggingSchema,
  VideoReelEintrag,
} from '../types/video';

interface SpeicherZustand {
  seasonsByTeam: Record<string, PluginSaisonEintrag[]>;
  reels: VideoReelEintrag[];
  plays: PlayEintrag[];
  telestrations: FrameTelestration[];
  notizen: CoachNotiz[];
  schemaByTeam: Record<string, TeamTaggingSchema>;
  prefs: BenutzerVideoPraeferenzen;
  playlists: SmartPlaylist[];
  shareLinks: Array<PublicShareLinkInfo & { token: string }>;
}

const DEMO_CLUB: ClubKontext = {
  id: 'club-eagles',
  name: 'Munich Eagles e.V.',
  slug: 'munich-eagles',
  speicher: {
    nodeId: 'local-preview',
    usedBytes: 1_850_000_000,
    quotaBytes: 10_737_418_240,
    softLimitPercent: 80,
    auslastungProzent: 17,
    softLimitErreicht: false,
    hardLimitErreicht: false,
  },
  metadata: {},
  erstelltAm: '2026-01-10T10:00:00.000Z',
};

const DEMO_TEAMS: TeamKontext[] = [
  {
    id: 'team-seniors',
    clubId: DEMO_CLUB.id,
    name: 'Seniors (Herren)',
    slug: 'seniors',
    status: 'ACTIVE',
    akzentFarbe: '#D97706',
    metadata: {},
    erstelltAm: '2026-01-10T10:00:00.000Z',
  },
  {
    id: 'team-u19',
    clubId: DEMO_CLUB.id,
    name: 'U19 Juniors',
    slug: 'u19',
    status: 'ACTIVE',
    akzentFarbe: '#2563EB',
    metadata: {},
    erstelltAm: '2026-01-10T10:00:00.000Z',
  },
  {
    id: 'team-u16-archiv',
    clubId: DEMO_CLUB.id,
    name: 'U16 (Archiv 2024)',
    slug: 'u16-2024',
    status: 'ARCHIVED',
    akzentFarbe: '#64748B',
    metadata: {},
    erstelltAm: '2024-01-10T10:00:00.000Z',
  },
];

const CLUB_TEAM_INFOS: ClubTeamInfo[] = DEMO_TEAMS.map((t) => ({
  clubId: DEMO_CLUB.id,
  teamId: t.id,
  teamName: t.name,
  teamSlug: t.slug,
  teamStatus: t.status,
  lastSeenAt: '2026-11-28T10:00:00.000Z',
}));

const DEMO_USER: BenutzerKonto = {
  uuid: 'user-coach-1',
  benutzername: 'hc_mueller',
  vollerName: 'Coach Müller',
  email: 'coach@munich-eagles.de',
  istSysadmin: true,
  preferredLocale: 'de',
  metadata: {},
  erstelltAm: '2026-01-10T10:00:00.000Z',
};

function erstelleInitialSpeicher(): SpeicherZustand {
  const now = new Date().toISOString();
  const seasonsByTeam: Record<string, PluginSaisonEintrag[]> = {};
  const schemaByTeam: Record<string, TeamTaggingSchema> = {};

  for (const t of DEMO_TEAMS) {
    seasonsByTeam[t.id] = [
      { id: `ssn-${t.id}-2026`, clubId: DEMO_CLUB.id, teamId: t.id, name: '2026', isActive: true, sortOrder: 100, createdAt: now },
      { id: `ssn-${t.id}-2025`, clubId: DEMO_CLUB.id, teamId: t.id, name: '2025', isActive: false, sortOrder: 90, createdAt: now },
    ];
    schemaByTeam[t.id] = erstelleStandardTeamSchema(t.id);
  }

  return {
    seasonsByTeam,
    reels: [],
    plays: [],
    telestrations: [],
    notizen: [],
    schemaByTeam,
    prefs: {
      userUuid: DEMO_USER.uuid,
      hotkeys: STANDARD_HOTKEYS,
      defaultCorner: 'top-right',
      defaultPlaybackRate: 1,
      autoStopEnabled: true,
      updatedAt: now,
    },
    playlists: [],
    shareLinks: [],
  };
}

type RollenPreset = 'CLUB_ADMIN' | 'TEAM_ADMIN' | 'STAFF' | 'MEMBER';

export function PreviewApp() {
  const [speicher] = useState<SpeicherZustand>(() => erstelleInitialSpeicher());
  const [aktivesTeamId, setAktivesTeamId] = useState<string>(DEMO_TEAMS[0].id);
  const [rollenPreset, setRollenPreset] = useState<RollenPreset>('CLUB_ADMIN');
  const [gruppenPreset, setGruppenPreset] = useState<'ALL' | 'Offense' | 'Defense' | 'Special Teams' | 'NONE'>('Offense');
  const [aktiveRoute, setAktiveRoute] = useState<string>('library');
  const [ansicht, setAnsicht] = useState<'plugin' | 'settings' | 'share'>('plugin');
  const [settingsZiel, setSettingsZiel] = useState<'account' | 'club' | 'system'>('club');
  const [shareToken, setShareToken] = useState<string | null>(null);

  const aktivesTeam = useMemo(
    () => DEMO_TEAMS.find((t) => t.id === aktivesTeamId) ?? DEMO_TEAMS[0],
    [aktivesTeamId]
  );

  const clubRolle: ClubRolle = rollenPreset === 'CLUB_ADMIN' ? 'CLUB_ADMIN' : 'CLUB_MEMBER';
  const effektiveTeamRolle: TeamRolle =
    rollenPreset === 'CLUB_ADMIN' || rollenPreset === 'TEAM_ADMIN'
      ? 'TEAM_ADMIN'
      : rollenPreset === 'STAFF'
        ? 'STAFF'
        : 'MEMBER';
  const isReadOnly = aktivesTeam.status === 'ARCHIVED';

  const userGroups = useMemo<string[]>(() => {
    if (gruppenPreset === 'ALL') return ['Offense', 'Defense', 'Special Teams'];
    if (gruppenPreset === 'NONE') return [];
    return [gruppenPreset];
  }, [gruppenPreset]);

  const kontextRef = useRef({
    team: aktivesTeam,
    clubRolle,
    effektiveTeamRolle,
    userGroups,
    isReadOnly,
  });
  kontextRef.current = {
    team: aktivesTeam,
    clubRolle,
    effektiveTeamRolle,
    userGroups,
    isReadOnly,
  };

  // Öffentliche Share-Route & Mock-Presigned-PUT für Browser-Uploads abfangen
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (urlStr.startsWith('https://preview-storage.invalid/')) {
        return new Response(null, { status: 200 });
      }

      const publicPrefix = '/api/v2/public/plugins/video-analysis/share/';
      if (!urlStr.startsWith(publicPrefix)) {
        return originalFetch(input, init);
      }

      const token = decodeURIComponent(urlStr.slice(publicPrefix.length));
      const link = speicher.shareLinks.find((l) => l.token === token);
      if (!link) {
        return new Response(JSON.stringify({ fehler: 'Link nicht gefunden.' }), { status: 404 });
      }
      if (link.revokedAt || new Date(link.expiresAt).getTime() <= Date.now()) {
        return new Response(JSON.stringify({ fehler: 'Link abgelaufen oder widerrufen.' }), { status: 410 });
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
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, [speicher]);

  const apiFetch: ApiFetchFn = useCallback(
    async (subPfad, init) => {
      const { team, clubRolle: curClubRolle, effektiveTeamRolle: curRolle, userGroups: curGroups, isReadOnly: curRo } =
        kontextRef.current;
      const method = (init?.method ?? 'GET').toUpperCase();
      const pfad = (subPfad.startsWith('/') ? subPfad : `/${subPfad}`).split('?')[0];
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const istClubAdmin = curClubRolle === 'CLUB_ADMIN';
      const istStaff = istStaffOderAdminRolle(curRolle);
      const schema = speicher.schemaByTeam[team.id] ?? erstelleStandardTeamSchema(team.id);
      const sharingKonfig = bereinigeAnmerkungsKonfig(schema.annotationSharing);

      const jsonRes = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });

      // Prefs (immer erlaubt)
      if (method === 'GET' && pfad === '/prefs') return jsonRes({ prefs: speicher.prefs });
      if (method === 'PUT' && pfad === '/prefs') {
        speicher.prefs = { ...speicher.prefs, ...body, updatedAt: new Date().toISOString() };
        return jsonRes({ prefs: speicher.prefs });
      }

      // Club-Routen (#10)
      if (method === 'GET' && pfad === '/club/teams') {
        return jsonRes({ teams: CLUB_TEAM_INFOS });
      }
      if (method === 'GET' && pfad === '/club/reels') {
        if (!istClubAdmin) return jsonRes({ fehler: 'Nur für Vereins-Admins.' }, 403);
        const ownerReels = speicher.reels.filter((r) => (r.accessMode ?? 'OWNER') === 'OWNER');
        const clubReels: ClubReelUebersicht[] = ownerReels.map((r) => ({
          reelId: r.id,
          ownerClubId: DEMO_CLUB.id,
          ownerTeamId: r.teamId,
          ownerTeamName: DEMO_TEAMS.find((t) => t.id === r.teamId)?.name ?? r.teamId,
          season: r.saison,
          title: r.title,
          category: r.category,
          eventDate: r.eventDate,
          visibility: r.visibility,
          shareScope: r.shareScope ?? 'TEAM_ONLY',
          clubWideAccessMode: r.clubWideAccessMode ?? 'READ_ONLY',
          sharedTeams: r.sharedTeams ?? [],
          refCount: r.refCount ?? 1,
          totalSizeBytes: r.totalSizeBytes ?? 0,
          playCount: r.playCount,
          angles: r.angles,
          createdBy: r.createdBy,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }));
        return jsonRes({ reels: clubReels, teams: CLUB_TEAM_INFOS, speicher: DEMO_CLUB.speicher });
      }

      const clubShareMatch = pfad.match(/^\/club\/reels\/([^/]+)\/sharing$/);
      if (method === 'PATCH' && clubShareMatch) {
        if (!istClubAdmin) return jsonRes({ fehler: 'Nur für Vereins-Admins.' }, 403);
        const reelId = decodeURIComponent(clubShareMatch[1]);
        const target = speicher.reels.find((r) => r.id === reelId);
        if (!target) return jsonRes({ fehler: 'Nicht gefunden.' }, 404);
        target.shareScope = (body.shareScope as ReelShareScope) ?? target.shareScope ?? 'TEAM_ONLY';
        target.clubWideAccessMode = (body.clubWideAccessMode as Exclude<ReelAccessMode, 'OWNER'>) ?? 'READ_ONLY';
        target.sharedTeams = Array.isArray(body.sharedTeams ?? body.teamShares)
          ? (body.sharedTeams ?? body.teamShares).map((s: TeamReelFreigabeEintrag) => ({
              teamId: s.teamId,
              teamName: DEMO_TEAMS.find((t) => t.id === s.teamId)?.name ?? s.teamId,
              accessMode: s.accessMode === 'OWN_BREAKDOWN' ? 'OWN_BREAKDOWN' : 'READ_ONLY',
              allowedFields: s.allowedFields ?? null,
            }))
          : [];
        target.refCount = 1 + (target.sharedTeams?.length ?? 0);
        target.updatedAt = new Date().toISOString();
        return jsonRes({ ok: true, refCount: target.refCount });
      }

      const clubDelMatch = pfad.match(/^\/club\/reels\/([^/]+)$/);
      if (method === 'DELETE' && clubDelMatch) {
        if (!istClubAdmin) return jsonRes({ fehler: 'Nur für Vereins-Admins.' }, 403);
        const reelId = decodeURIComponent(clubDelMatch[1]);
        speicher.reels = speicher.reels.filter((r) => r.id !== reelId);
        speicher.plays = speicher.plays.filter((p) => p.reelId !== reelId);
        return jsonRes({ ok: true });
      }

      // Archiv-Schreibschutz (HTTP 409)
      if (curRo && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        return jsonRes(
          {
            fehler: 'Dieses Team ist archiviert (Nur-Lese-Modus). Änderungen sind gesperrt.',
            code: 'TEAM_ARCHIVED_READ_ONLY',
          },
          409
        );
      }

      // Storage Presigned Upload-URL
      if (method === 'POST' && (pfad === '/storage/presign-upload' || pfad === '/storage/upload-url')) {
        const objectPath = String(body.objectPath ?? `reels/${Date.now()}-${body.fileName ?? 'clip.mp4'}`);
        const key = `clubs/${DEMO_CLUB.id}/teams/${team.id}/video/${objectPath}`;
        return jsonRes({
          url: `https://preview-storage.invalid/${objectPath}`,
          uploadUrl: `https://preview-storage.invalid/${objectPath}`,
          key,
          s3Key: key,
          objectPath,
          expiresIn: 900,
        });
      }

      // Plugin-Saisons
      if (method === 'GET' && pfad === '/seasons') {
        const list = speicher.seasonsByTeam[team.id] ?? [];
        const active = list.find((s) => s.isActive)?.name ?? list[0]?.name ?? '2026';
        return jsonRes({ seasons: list, activeSeason: active });
      }
      if (method === 'POST' && pfad === '/seasons') {
        if (!istStaff) return jsonRes({ fehler: 'Nur Staff/Admins.' }, 403);
        const name = String(body.name ?? '').trim();
        const list = speicher.seasonsByTeam[team.id] ?? [];
        const setActive = body.setActive !== false;
        if (setActive) list.forEach((s) => (s.isActive = false));
        const neu: PluginSaisonEintrag = {
          id: `ssn-${Date.now()}`,
          clubId: DEMO_CLUB.id,
          teamId: team.id,
          name,
          isActive: setActive,
          sortOrder: 100,
          createdAt: new Date().toISOString(),
        };
        speicher.seasonsByTeam[team.id] = [neu, ...list.filter((s) => s.name !== name)];
        return jsonRes({ season: neu }, 201);
      }
      const seasonPatchMatch = pfad.match(/^\/seasons\/([^/]+)$/);
      if (method === 'PATCH' && seasonPatchMatch) {
        const id = decodeURIComponent(seasonPatchMatch[1]);
        const list = speicher.seasonsByTeam[team.id] ?? [];
        list.forEach((s) => (s.isActive = s.id === id));
        return jsonRes({ ok: true });
      }

      // Reels auflisten (inkl. Club-Wide & Selected Teams #10)
      if (method === 'GET' && pfad === '/reels') {
        const sichtbar: VideoReelEintrag[] = [];
        for (const r of speicher.reels) {
          const isOwnerTeam = r.teamId === team.id;
          const explicitShare = (r.sharedTeams ?? []).find((s) => s.teamId === team.id);
          const isClubWide = !isOwnerTeam && r.shareScope === 'CLUB_WIDE';
          if (!isOwnerTeam && !explicitShare && !isClubWide) continue;
          if (r.shareScope === 'PRIVATE_ADMIN' && !istClubAdmin) continue;

          const accessMode: ReelAccessMode = isOwnerTeam
            ? 'OWNER'
            : explicitShare
              ? explicitShare.accessMode
              : r.clubWideAccessMode ?? 'READ_ONLY';
          if (
            !istStaff &&
            !istClubAdmin &&
            !istAnmerkungFuerBenutzerSichtbar(r.visibility, curRolle, curGroups, sharingKonfig.enabled)
          ) {
            continue;
          }

          sichtbar.push({
            ...r,
            accessMode,
            sharedFromTeamId: isOwnerTeam ? null : r.teamId,
            sharedFromTeamName: isOwnerTeam
              ? null
              : DEMO_TEAMS.find((t) => t.id === r.teamId)?.name ?? r.teamId,
            canEdit: !curRo && (istClubAdmin || (istStaff && accessMode !== 'READ_ONLY')),
            canManageSharing: !curRo && (istClubAdmin || (isOwnerTeam && istStaff)),
          });
        }
        return jsonRes({ reels: sichtbar });
      }

      // Reel erstellen
      if (method === 'POST' && pfad === '/reels') {
        if (!istStaff && !istClubAdmin) return jsonRes({ fehler: 'Nur Staff/Admins.' }, 403);
        const reelId = `reel-${Date.now()}`;
        const b = body.bundle;
        const title = b?.reel?.title ?? body.title ?? 'Neues Reel';
        const playsInput = b?.plays ?? body.plays ?? [];
        const eventDate = b?.reel?.event_date ?? body.eventDate ?? '2026-11-14';
        const season = body.season ?? eventDate.slice(0, 4);
        const shareScope: ReelShareScope = body.shareScope ?? 'TEAM_ONLY';
        const totalSizeBytes = playsInput.reduce((sum: number, p: any) => {
          return (
            sum +
            Object.values<any>(p.sources ?? {}).reduce(
              (sSum, src) => sSum + Number(src?.fileSizeBytes ?? 0),
              0
            )
          );
        }, 0);

        const neuReel: VideoReelEintrag = {
          id: reelId,
          accessId: `acc-${Date.now()}`,
          teamId: team.id,
          clubId: DEMO_CLUB.id,
          saison: season,
          title,
          category: b?.reel?.category ?? body.category ?? 'GAME',
          eventDate,
          visibility: normalisiereSichtbarkeit(b?.reel?.visibility ?? body.visibility ?? 'STAFF_ONLY'),
          angles: b?.angles ?? body.angles ?? ['SIDELINE'],
          playCount: playsInput.length,
          shareScope,
          clubWideAccessMode: body.clubWideAccessMode ?? 'READ_ONLY',
          accessMode: 'OWNER',
          canEdit: true,
          canManageSharing: true,
          refCount: 1,
          totalSizeBytes,
          sharedTeams: [],
          createdBy: DEMO_USER.uuid,
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
        return jsonRes({ reelId, accessId: neuReel.accessId }, 201);
      }

      // Reel Freigabe (#10)
      const shareMatch = pfad.match(/^\/reels\/([^/]+)\/sharing$/);
      if (method === 'PATCH' && shareMatch) {
        const reelId = decodeURIComponent(shareMatch[1]);
        const target = speicher.reels.find((r) => r.id === reelId);
        if (!target) return jsonRes({ fehler: 'Nicht gefunden.' }, 404);
        target.shareScope = (body.shareScope as ReelShareScope) ?? target.shareScope ?? 'TEAM_ONLY';
        target.clubWideAccessMode = (body.clubWideAccessMode as Exclude<ReelAccessMode, 'OWNER'>) ?? 'READ_ONLY';
        target.sharedTeams = Array.isArray(body.sharedTeams ?? body.teamShares)
          ? (body.sharedTeams ?? body.teamShares).map((s: TeamReelFreigabeEintrag) => ({
              teamId: s.teamId,
              teamName: DEMO_TEAMS.find((t) => t.id === s.teamId)?.name ?? s.teamId,
              accessMode: s.accessMode === 'OWN_BREAKDOWN' ? 'OWN_BREAKDOWN' : 'READ_ONLY',
              allowedFields: s.allowedFields ?? null,
            }))
          : [];
        target.refCount = 1 + (target.sharedTeams?.length ?? 0);
        target.updatedAt = new Date().toISOString();
        return jsonRes({ ok: true, refCount: target.refCount });
      }

      // Bulk Hudl CSV Breakdown Import (#9)
      const csvImportMatch = pfad.match(/^\/reels\/([^/]+)\/breakdown-import$/);
      if (method === 'POST' && csvImportMatch) {
        const reelId = decodeURIComponent(csvImportMatch[1]);
        const patches: Array<{ playId?: string; playNumber: number; breakdown: PlayBreakdownDaten }> =
          Array.isArray(body.playPatches) ? body.playPatches : [];
        const newFields = Array.isArray(body.newCustomFields) ? body.newCustomFields : [];
        let updatedPlays = 0;

        for (const patch of patches) {
          const zielPlay = speicher.plays.find(
            (p) =>
              p.reelId === reelId &&
              (patch.playId ? p.id === patch.playId : p.playNumber === patch.playNumber)
          );
          if (zielPlay) {
            zielPlay.breakdown = { ...zielPlay.breakdown, ...(patch.breakdown ?? {}) };
            updatedPlays += 1;
          }
        }
        if (newFields.length > 0) {
          const existingKeys = new Set(schema.fields.map((f) => f.key));
          const merged = [...schema.fields];
          for (const nf of newFields) {
            if (nf.key && !existingKeys.has(nf.key)) {
              merged.push({ ...nf, custom: true, aktiv: true });
              existingKeys.add(nf.key);
            }
          }
          speicher.schemaByTeam[team.id] = {
            ...schema,
            fields: merged,
            updatedAt: new Date().toISOString(),
          };
        }
        return jsonRes({ ok: true, updatedPlays, addedFields: newFields.length });
      }

      // Public Share Links
      const shareLinksMatch = pfad.match(/^\/reels\/([^/]+)\/share-links$/);
      if (shareLinksMatch) {
        const reelId = decodeURIComponent(shareLinksMatch[1]);
        if (method === 'GET') {
          return jsonRes({ links: speicher.shareLinks.filter((l) => l.reelId === reelId) });
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
          return jsonRes(
            {
              id: neu.id,
              token,
              publicPath: `/public/video-share/${token}`,
              expiresAt,
              includeMetadata: neu.includeMetadata,
            },
            201
          );
        }
      }

      const revokeMatch = pfad.match(/^\/share-links\/([^/]+)$/);
      if (revokeMatch && method === 'DELETE') {
        const linkId = decodeURIComponent(revokeMatch[1]);
        speicher.shareLinks = speicher.shareLinks.map((l) =>
          l.id === linkId ? { ...l, revokedAt: new Date().toISOString() } : l
        );
        return jsonRes({ ok: true });
      }

      // Angles (#7)
      const addAngleMatch = pfad.match(/^\/reels\/([^/]+)\/angles$/);
      if (addAngleMatch && method === 'POST') {
        const reelId = decodeURIComponent(addAngleMatch[1]);
        const reel = speicher.reels.find((r) => r.id === reelId);
        if (!reel) return jsonRes({ fehler: 'Nicht gefunden.' }, 404);
        const angleCode = String(body.angleCode ?? 'ENDZONE').toUpperCase();
        if (!reel.angles.includes(angleCode)) reel.angles = [...reel.angles, angleCode];
        if (body.mode === 'FULL_TAPE' && body.tape) {
          let p0 = speicher.plays.find((p) => p.reelId === reelId);
          if (!p0) {
            p0 = {
              id: `play-${Date.now()}`,
              reelId,
              playNumber: 1,
              sortOrder: 1,
              breakdown: { odk: 'O', play_number: 1 },
              sources: {},
            };
            speicher.plays.push(p0);
            reel.playCount += 1;
          }
          p0.sources[angleCode] = {
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
          return jsonRes({ ok: true, angleCode, mode: 'FULL_TAPE', assignedCount: 1 }, 201);
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
        return jsonRes({ ok: true, angleCode, mode: 'CLIPS', assignedCount }, 201);
      }

      // Play anlegen
      const addPlayMatch = pfad.match(/^\/reels\/([^/]+)\/plays$/);
      if (addPlayMatch && method === 'POST') {
        const reelId = decodeURIComponent(addPlayMatch[1]);
        const id = `play-${Date.now()}`;
        const reel = speicher.reels.find((r) => r.id === reelId);
        const nr =
          body.playNumber ??
          speicher.plays
            .filter((p) => p.reelId === reelId)
            .reduce((m, p) => Math.max(m, p.playNumber), 0) + 1;
        speicher.plays.push({
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
        });
        if (reel) reel.playCount = speicher.plays.filter((p) => p.reelId === reelId).length;
        return jsonRes({ id }, 201);
      }

      // Reel Details / Update / Delete
      const reelMatch = pfad.match(/^\/reels\/([^/]+)$/);
      if (reelMatch) {
        const reelId = decodeURIComponent(reelMatch[1]);
        if (method === 'GET') {
          const reel = speicher.reels.find((r) => r.id === reelId);
          if (!reel) return jsonRes({ fehler: 'Nicht gefunden.' }, 404);
          const isOwnerTeam = reel.teamId === team.id;
          const explicitShare = (reel.sharedTeams ?? []).find((s) => s.teamId === team.id);
          const accessMode: ReelAccessMode = isOwnerTeam
            ? 'OWNER'
            : explicitShare
              ? explicitShare.accessMode
              : reel.clubWideAccessMode ?? 'READ_ONLY';
          const effektiveRolleFilter = accessMode === 'READ_ONLY' ? 'MEMBER' : curRolle;
          const filteredTel = speicher.telestrations
            .filter((t) => t.reelId === reelId)
            .map((t) => ({
              ...t,
              elements: filtereTelestrationElementeFuerBenutzer(
                t.elements,
                effektiveRolleFilter,
                curGroups,
                sharingKonfig.enabled
              ),
            }))
            .filter((t) => (accessMode !== 'READ_ONLY' && istStaff) || t.elements.length > 0);
          const filteredNotizen = speicher.notizen.filter(
            (n) =>
              n.reelId === reelId &&
              ((accessMode !== 'READ_ONLY' && istStaff) ||
                (n.status === 'PUBLISHED' &&
                  istAnmerkungFuerBenutzerSichtbar(
                    n.visibility,
                    effektiveRolleFilter,
                    curGroups,
                    sharingKonfig.enabled
                  )))
          );
          return jsonRes({
            reel: {
              ...reel,
              accessMode,
              canEdit: !curRo && (istClubAdmin || (istStaff && accessMode !== 'READ_ONLY')),
              canManageSharing: !curRo && (istClubAdmin || (isOwnerTeam && istStaff)),
            },
            plays: speicher.plays.filter((p) => p.reelId === reelId),
            telestrations: filteredTel,
            notes: filteredNotizen,
          });
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
                  ...(body.visibility ? { visibility: normalisiereSichtbarkeit(body.visibility) } : {}),
                  updatedAt: new Date().toISOString(),
                }
              : r
          );
          return jsonRes({ ok: true });
        }
        if (method === 'DELETE') {
          speicher.reels = speicher.reels.filter((r) => r.id !== reelId);
          speicher.plays = speicher.plays.filter((p) => p.reelId !== reelId);
          return jsonRes({ ok: true, refCount: 0 });
        }
      }

      // Plays PATCH / DELETE
      const playMatch = pfad.match(/^\/plays\/([^/]+)$/);
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
            return { ...p, breakdown: body.breakdown ?? p.breakdown, sources: nextSources };
          });
          return jsonRes({ ok: true });
        }
        if (method === 'DELETE') {
          speicher.plays = speicher.plays.filter((p) => p.id !== playId);
          return jsonRes({ ok: true });
        }
      }

      // Telestrations & Notizen
      const telMatch = pfad.match(/^\/plays\/([^/]+)\/telestrations$/);
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
            authorUuid: DEMO_USER.uuid,
            authorName: DEMO_USER.vollerName,
            updatedAt: new Date().toISOString(),
          });
        }
        return jsonRes({ ok: true });
      }

      const playNotesMatch = pfad.match(/^\/plays\/([^/]+)\/notes$/);
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
          visibility: normalisiereSichtbarkeit(body.visibility ?? 'ALL_MEMBERS'),
          color: body.color,
          authorUuid: DEMO_USER.uuid,
          authorName: DEMO_USER.vollerName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        return jsonRes({ id }, 201);
      }

      const noteMatch = pfad.match(/^\/notes\/([^/]+)$/);
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
                  ...(body.visibility !== undefined
                    ? { visibility: normalisiereSichtbarkeit(body.visibility) }
                    : {}),
                  ...(body.color !== undefined ? { color: body.color } : {}),
                  updatedAt: new Date().toISOString(),
                }
              : n
          );
          return jsonRes({ ok: true });
        }
        if (method === 'DELETE') {
          speicher.notizen = speicher.notizen.filter((n) => n.id !== noteId);
          return jsonRes({ ok: true });
        }
      }

      // Schema & Playlists
      if (method === 'GET' && pfad === '/schema') return jsonRes({ schema });
      if (method === 'PUT' && pfad === '/schema') {
        speicher.schemaByTeam[team.id] = {
          ...schema,
          ...body,
          updatedAt: new Date().toISOString(),
        };
        return jsonRes({ schema: speicher.schemaByTeam[team.id] });
      }
      if (method === 'GET' && pfad === '/playlists') {
        return jsonRes({ playlists: speicher.playlists.filter((p) => p.teamId === team.id) });
      }
      if (method === 'POST' && pfad === '/playlists') {
        const id = `pl-${Date.now()}`;
        speicher.playlists.unshift({
          id,
          teamId: team.id,
          ...body,
          createdBy: DEMO_USER.uuid,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        return jsonRes({ id }, 201);
      }
      const delPlMatch = pfad.match(/^\/playlists\/([^/]+)$/);
      if (delPlMatch && method === 'DELETE') {
        const plId = decodeURIComponent(delPlMatch[1]);
        speicher.playlists = speicher.playlists.filter((p) => p.id !== plId);
        return jsonRes({ ok: true });
      }

      return jsonRes({ ok: true });
    },
    [speicher]
  );

  const laufzeitCtx: PluginLaufzeitKontext = useMemo(
    () => ({
      pluginId: plugin.manifest.id,
      club: DEMO_CLUB,
      team: aktivesTeam,
      user: DEMO_USER,
      clubRolle,
      effektiveTeamRolle,
      userGroups,
      isReadOnly,
      locale: 'de',
      activeView: aktiveRoute,
      apiBaseUrl: `/api/v2/plugins/${plugin.manifest.id}/teams/${aktivesTeam.id}`,
      apiFetch,
      navigateToView: (segment: string) => {
        setAnsicht('plugin');
        setAktiveRoute(segment);
      },
    }),
    [aktivesTeam, clubRolle, effektiveTeamRolle, userGroups, isReadOnly, aktiveRoute, apiFetch]
  );

  const settingsProps: PluginSettingsPanelProps = useMemo(
    () => ({
      panelId:
        settingsZiel === 'account'
          ? 'video-hotkeys'
          : settingsZiel === 'club'
            ? 'video-schema'
            : 'video-storage',
      target: settingsZiel,
      club: DEMO_CLUB,
      team: aktivesTeam,
      user: DEMO_USER,
      locale: 'de',
      apiFetch,
      onContextRefresh: async () => undefined,
    }),
    [settingsZiel, aktivesTeam, apiFetch]
  );

  const sidebarGroups = plugin.manifest.navigation?.sidebarGroups ?? [];
  const HauptAnsicht = plugin.HauptAnsicht;
  const SettingsPanel = plugin.SettingsPanel;
  const OeffentlicheAnsicht = plugin.OeffentlicheAnsicht;

  return (
    <div className="min-h-screen bg-sl-canvas text-sl-primary flex flex-col">
      <header className="sticky top-0 z-30 border-b border-sl-border bg-sl-canvas/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="font-display text-base font-bold text-sl-heading">
              Sideline<span className="text-sl-accent">OS</span>
            </span>
            <span className="text-sl-border-strong">/</span>
            <span className="text-xs font-medium text-sl-muted">
              {plugin.manifest.name} (SDK v{plugin.manifest.sdkVersion})
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <select
              aria-label="Team wählen"
              value={aktivesTeamId}
              onChange={(e) => setAktivesTeamId(e.target.value)}
              className="rounded-md border border-sl-border bg-sl-surface px-2.5 py-1 text-xs text-sl-heading"
            >
              {DEMO_TEAMS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.status === 'ARCHIVED' ? ' (Read-Only)' : ''}
                </option>
              ))}
            </select>

            <select
              aria-label="Rolle testen"
              value={rollenPreset}
              onChange={(e) => setRollenPreset(e.target.value as RollenPreset)}
              className="rounded-md border border-sl-border bg-sl-surface px-2.5 py-1 text-xs text-sl-heading"
            >
              <option value="CLUB_ADMIN">Vereins-Admin</option>
              <option value="TEAM_ADMIN">Team-Admin</option>
              <option value="STAFF">Staff / Coach</option>
              <option value="MEMBER">Mitglied / Spieler</option>
            </select>

            {rollenPreset === 'MEMBER' && (
              <select
                aria-label="Benutzergruppe testen"
                value={gruppenPreset}
                onChange={(e) => setGruppenPreset(e.target.value as typeof gruppenPreset)}
                className="rounded-md border border-sl-border bg-sl-surface px-2.5 py-1 text-xs text-sl-heading"
              >
                <option value="Offense">Gruppe: Offense</option>
                <option value="Defense">Gruppe: Defense</option>
                <option value="Special Teams">Gruppe: Special Teams</option>
                <option value="ALL">Alle Gruppen</option>
                <option value="NONE">Keine Gruppe</option>
              </select>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1600px] flex-1">
        {/* SDK v2.0 4-stufige Sidebar-Vorschau */}
        <aside className="hidden w-56 shrink-0 border-r border-sl-border bg-sl-surface/40 p-4 md:flex md:flex-col md:gap-5">
          {sidebarGroups.map((gruppe) => {
            const sichtbareItems = gruppe.items.filter((item) => {
              if (item.requiredClubRoles?.length && !item.requiredClubRoles.includes(clubRolle)) {
                return false;
              }
              if (
                item.requiredTeamRoles?.length &&
                !item.requiredTeamRoles.includes(effektiveTeamRolle)
              ) {
                return false;
              }
              return true;
            });
            if (sichtbareItems.length === 0) return null;
            return (
              <div key={gruppe.id} className="space-y-1">
                <div className="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-sl-muted">
                  {gruppe.label}
                </div>
                {sichtbareItems.map((item) => {
                  const aktiv = ansicht === 'plugin' && aktiveRoute === item.routeSegment;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setAnsicht('plugin');
                        setAktiveRoute(item.routeSegment);
                      }}
                      className={`w-full rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                        aktiv
                          ? 'bg-sl-accent/15 text-sl-accent'
                          : 'text-sl-primary hover:bg-sl-elevated hover:text-sl-heading'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            );
          })}

          <div className="space-y-1 border-t border-sl-border pt-4">
            <div className="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-sl-muted">
              Einstellungen
            </div>
            {(
              [
                ['account', 'Account: Hotkeys'],
                ['club', 'Verein: Schema & Saisons'],
                ['system', 'System: Video-Speicher'],
              ] as const
            ).map(([ziel, label]) => (
              <button
                key={ziel}
                type="button"
                onClick={() => {
                  setSettingsZiel(ziel);
                  setAnsicht('settings');
                }}
                className={`w-full rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                  ansicht === 'settings' && settingsZiel === ziel
                    ? 'bg-sl-accent/15 text-sl-accent'
                    : 'text-sl-primary hover:bg-sl-elevated hover:text-sl-heading'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-5">
          {ansicht === 'share' && shareToken && OeffentlicheAnsicht ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => {
                  setShareToken(null);
                  setAnsicht('plugin');
                }}
                className="rounded border border-sl-border bg-sl-surface px-3 py-1 text-xs text-sl-heading"
              >
                Zurück zur Vorschau
              </button>
              <OeffentlicheAnsicht token={shareToken} locale="de" />
            </div>
          ) : ansicht === 'settings' && SettingsPanel ? (
            <SettingsPanel {...settingsProps} />
          ) : HauptAnsicht ? (
            <HauptAnsicht ctx={laufzeitCtx} />
          ) : null}
        </main>
      </div>
    </div>
  );
}
