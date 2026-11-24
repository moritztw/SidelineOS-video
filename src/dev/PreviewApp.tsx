import { useEffect, useMemo, useState } from 'react';
import type {
  BenutzerKonto,
  PluginLaufzeitKontext,
  PluginSettingsKontext,
  S3Konfiguration,
  TeamKontext,
  TeamRolle,
} from '@sidelineos/plugin-sdk';
import plugin from '../client';
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

function installierePreviewFetchBridge(speicher: SpeicherZustand) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
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
      const plays = speicher.plays.filter((p) => p.reelId === link.reelId);
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
          allowedFields: link.allowedFields,
          plays,
          expiresAt: link.expiresAt,
        }),
        { status: 200 }
      );
    }

    const sub = urlStr.slice(prefix.length).split('?')[0];

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
        angles: b?.angles ?? ['SIDELINE'],
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

    if (method === 'GET' && sub.startsWith('/reels/') && !sub.endsWith('/share-links')) {
      const reelId = decodeURIComponent(sub.slice('/reels/'.length));
      const reel = speicher.reels.find((r) => r.id === reelId);
      if (!reel) return new Response(JSON.stringify({ fehler: 'Nicht gefunden.' }), { status: 404 });
      return new Response(
        JSON.stringify({
          reel,
          plays: speicher.plays.filter((p) => p.reelId === reelId),
          telestrations: speicher.telestrations.filter((t) => t.reelId === reelId),
          notes: speicher.notizen.filter((n) => n.reelId === reelId),
        }),
        { status: 200 }
      );
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

    return new Response(JSON.stringify({ ok: true, id: `id-${Date.now()}` }), { status: 200 });
  };
  return () => {
    window.fetch = originalFetch;
  };
}

export function PreviewApp() {
  const [speicher] = useState<SpeicherZustand>(() => erstelleLeerenSpeicher());
  const [rolle, setRolle] = useState<TeamRolle>('TEAM_ADMIN');
  const [saison, setSaison] = useState('2026');
  const [tab, setTab] = useState(plugin.defaultTab);
  const [ansicht, setAnsicht] = useState<'plugin' | 'settings' | 'share'>('plugin');
  const [shareToken, setShareToken] = useState<string | null>(null);

  useEffect(() => installierePreviewFetchBridge(speicher), [speicher]);

  const tabs = useMemo(
    () => plugin.getTabs({ teamRolle: rolle, locale: 'de' }),
    [rolle]
  );

  const laufzeitCtx: PluginLaufzeitKontext = {
    team: INITIAL_TEAM,
    aktiveTeamAnsicht: rolle,
    gewaehlteSaison: saison,
    benutzer: INITIAL_USER,
    locale: 'de',
    aktuellerTab: tab,
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
    <div className="min-h-screen bg-[#0B0E11] text-[#E6EDF3]">
      <header className="sticky top-0 z-30 border-b border-[#232933] bg-[#0B0E11]/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-6 px-6">
          <div className="flex items-center gap-3 shrink-0">
            <span className="font-display text-base font-bold text-white">
              Sideline<span className="text-[#F59E0B]">OS</span>
            </span>
            <span className="text-[#36404F]">/</span>
            <span className="text-xs font-medium text-[#8B949E]">{plugin.manifest.name}</span>
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
                    ? 'bg-[#232933] text-white'
                    : 'text-[#8B949E] hover:text-white'
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
                  ? 'bg-[#232933] text-white'
                  : 'text-[#8B949E] hover:text-white'
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
              className="rounded-md border border-[#232933] bg-[#13171D] px-2 py-1 text-xs text-white"
            >
              <option value="2026">2026</option>
              <option value="2025">2025</option>
              <option value="ALL">Alle</option>
            </select>
            <select
              aria-label="Rolle testen"
              value={rolle}
              onChange={(e) => setRolle(e.target.value as TeamRolle)}
              className="rounded-md border border-[#232933] bg-[#13171D] px-2 py-1 text-xs text-white"
            >
              <option value="TEAM_ADMIN">Team Admin</option>
              <option value="COACH">Coach</option>
              <option value="PLAYER">Spieler</option>
            </select>
            {PrimaerAktion && (
              <PrimaerAktion
                ctx={laufzeitCtx}
                className="rounded-md bg-[#F59E0B] px-3.5 py-1.5 text-xs font-semibold text-[#0B0E11] hover:bg-[#FBBF24] whitespace-nowrap shrink-0"
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
          plugin.renderMainView(laufzeitCtx)
        )}
      </main>
    </div>
  );

  return Provider ? <Provider>{content}</Provider> : content;
}
