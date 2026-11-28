import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { erstelleVideoApi, type ApiFetchFn, type VideoApiClient } from '../services/apiClient';
import { STANDARD_HOTKEYS } from '../services/frameAndHotkeys';
import { erstelleStandardTeamSchema } from '../services/taggingEngine';
import type {
  BenutzerVideoPraeferenzen,
  ClubTeamInfo,
  CoachNotiz,
  FrameTelestration,
  PlayEintrag,
  PluginSaisonEintrag,
  SmartPlaylist,
  TeamTaggingSchema,
  VideoReelEintrag,
} from '../types/video';

interface VideoAnalysisContextWert {
  api: VideoApiClient;
  reels: VideoReelEintrag[];
  laedtReels: boolean;
  fehler: string | null;
  seasons: PluginSaisonEintrag[];
  gewaehlteSaison: string;
  clubTeams: ClubTeamInfo[];
  aktivesReel: VideoReelEintrag | null;
  aktivePlays: PlayEintrag[];
  telestrations: FrameTelestration[];
  notizen: CoachNotiz[];
  teamSchema: TeamTaggingSchema | null;
  userPrefs: BenutzerVideoPraeferenzen | null;
  playlists: SmartPlaylist[];
  uploadModalOffen: boolean;
  aktiverPlaylistFilterIds: string[] | null;
  setGewaehlteSaison: (saison: string) => void;
  setSeasons: (seasons: PluginSaisonEintrag[]) => void;
  setUploadModalOffen: (offen: boolean) => void;
  setAktiverPlaylistFilterIds: (ids: string[] | null) => void;
  setFehler: (msg: string | null) => void;
  ladeBasisDaten: (teamId: string, season: string, userUuid: string) => Promise<void>;
  oeffneReel: (reelId: string) => Promise<void>;
  aktualisierePlaysLokal: (updater: (alt: PlayEintrag[]) => PlayEintrag[]) => void;
  aktualisiereTelestrationsLokal: (
    updater: (alt: FrameTelestration[]) => FrameTelestration[]
  ) => void;
  aktualisiereNotizenLokal: (updater: (alt: CoachNotiz[]) => CoachNotiz[]) => void;
  setTeamSchema: (schema: TeamTaggingSchema) => void;
  setUserPrefs: (prefs: BenutzerVideoPraeferenzen) => void;
  setPlaylists: (playlists: SmartPlaylist[]) => void;
  setReels: (updater: (alt: VideoReelEintrag[]) => VideoReelEintrag[]) => void;
}

const VideoAnalysisContext = createContext<VideoAnalysisContextWert | null>(null);

export function VideoAnalysisProvider({
  apiFetch,
  children,
}: {
  apiFetch: ApiFetchFn;
  children: ReactNode;
}) {
  const api = useMemo(() => erstelleVideoApi(apiFetch), [apiFetch]);

  const [reels, setReels] = useState<VideoReelEintrag[]>([]);
  const [laedtReels, setLaedtReels] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<PluginSaisonEintrag[]>([]);
  const [gewaehlteSaison, setGewaehlteSaison] = useState<string>('ALL');
  const [clubTeams, setClubTeams] = useState<ClubTeamInfo[]>([]);
  const [aktivesReel, setAktivesReel] = useState<VideoReelEintrag | null>(null);
  const [aktivePlays, setAktivePlays] = useState<PlayEintrag[]>([]);
  const [telestrations, setTelestrations] = useState<FrameTelestration[]>([]);
  const [notizen, setNotizen] = useState<CoachNotiz[]>([]);
  const [teamSchema, setTeamSchema] = useState<TeamTaggingSchema | null>(null);
  const [userPrefs, setUserPrefs] = useState<BenutzerVideoPraeferenzen | null>(null);
  const [playlists, setPlaylists] = useState<SmartPlaylist[]>([]);
  const [uploadModalOffen, setUploadModalOffen] = useState(false);
  const [aktiverPlaylistFilterIds, setAktiverPlaylistFilterIds] = useState<string[] | null>(null);

  const ladeBasisDaten = useCallback(
    async (teamId: string, season: string, userUuid: string) => {
      setLaedtReels(true);
      setFehler(null);
      try {
        const [reelsRes, schemaRes, prefsRes, plRes, seasonsRes, clubTeamsRes] = await Promise.all([
          api.holeReels(season),
          api.holeSchema(),
          api.holePraeferenzen(),
          api.holePlaylists(season),
          api.holeSaisons().catch(() => ({ seasons: [] as PluginSaisonEintrag[] })),
          api.holeClubTeams().catch(() => ({ teams: [] as ClubTeamInfo[] })),
        ]);
        setReels(reelsRes.reels);
        setTeamSchema(schemaRes.schema);
        setUserPrefs(prefsRes.prefs);
        setPlaylists(plRes.playlists);
        setSeasons(seasonsRes.seasons);
        setClubTeams(clubTeamsRes.teams);
      } catch (err) {
        setFehler(err instanceof Error ? err.message : 'Fehler beim Laden der Videodaten.');
        setTeamSchema((alt) => alt ?? erstelleStandardTeamSchema(teamId));
        setUserPrefs(
          (alt) =>
            alt ?? {
              userUuid,
              hotkeys: STANDARD_HOTKEYS,
              defaultCorner: 'top-right',
              defaultPlaybackRate: 1,
              autoStopEnabled: true,
              updatedAt: new Date().toISOString(),
            }
        );
      } finally {
        setLaedtReels(false);
      }
    },
    [api]
  );

  const oeffneReel = useCallback(
    async (reelId: string) => {
      setFehler(null);
      try {
        const detail = await api.holeReelDetails(reelId);
        setAktivesReel(detail.reel);
        setAktivePlays(detail.plays);
        setTelestrations(detail.telestrations);
        setNotizen(detail.notes);
      } catch (err) {
        setFehler(err instanceof Error ? err.message : 'Reel konnte nicht geladen werden.');
      }
    },
    [api]
  );

  return (
    <VideoAnalysisContext.Provider
      value={{
        api,
        reels,
        laedtReels,
        fehler,
        seasons,
        gewaehlteSaison,
        clubTeams,
        aktivesReel,
        aktivePlays,
        telestrations,
        notizen,
        teamSchema,
        userPrefs,
        playlists,
        uploadModalOffen,
        aktiverPlaylistFilterIds,
        setGewaehlteSaison,
        setSeasons,
        setUploadModalOffen,
        setAktiverPlaylistFilterIds,
        setFehler,
        ladeBasisDaten,
        oeffneReel,
        aktualisierePlaysLokal: setAktivePlays,
        aktualisiereTelestrationsLokal: setTelestrations,
        aktualisiereNotizenLokal: setNotizen,
        setTeamSchema,
        setUserPrefs,
        setPlaylists,
        setReels,
      }}
    >
      {children}
    </VideoAnalysisContext.Provider>
  );
}

export function useVideoAnalysis(): VideoAnalysisContextWert {
  const ctx = useContext(VideoAnalysisContext);
  if (!ctx) {
    throw new Error('useVideoAnalysis muss innerhalb von VideoAnalysisProvider verwendet werden.');
  }
  return ctx;
}
