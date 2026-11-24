import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { videoApi } from '../services/apiClient';
import { STANDARD_HOTKEYS } from '../services/frameAndHotkeys';
import { erstelleStandardTeamSchema } from '../services/taggingEngine';
import type {
  BenutzerVideoPraeferenzen,
  CoachNotiz,
  FrameTelestration,
  PlayEintrag,
  SmartPlaylist,
  TeamTaggingSchema,
  VideoReelEintrag,
} from '../types/video';

interface VideoAnalysisContextWert {
  reels: VideoReelEintrag[];
  laedtReels: boolean;
  fehler: string | null;
  aktivesReel: VideoReelEintrag | null;
  aktivePlays: PlayEintrag[];
  telestrations: FrameTelestration[];
  notizen: CoachNotiz[];
  teamSchema: TeamTaggingSchema | null;
  userPrefs: BenutzerVideoPraeferenzen | null;
  playlists: SmartPlaylist[];
  uploadModalOffen: boolean;
  aktiverPlaylistFilterIds: string[] | null;
  setUploadModalOffen: (offen: boolean) => void;
  setAktiverPlaylistFilterIds: (ids: string[] | null) => void;
  setFehler: (msg: string | null) => void;
  ladeBasisDaten: (teamId: string, season: string, userUuid: string) => Promise<void>;
  oeffneReel: (teamId: string, reelId: string) => Promise<void>;
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

export function VideoAnalysisProvider({ children }: { children: ReactNode }) {
  const [reels, setReels] = useState<VideoReelEintrag[]>([]);
  const [laedtReels, setLaedtReels] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
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
        const [reelsRes, schemaRes, prefsRes, plRes] = await Promise.all([
          videoApi.holeReels(teamId, season),
          videoApi.holeSchema(teamId),
          videoApi.holePraeferenzen(teamId),
          videoApi.holePlaylists(teamId, season),
        ]);
        setReels(reelsRes.reels);
        setTeamSchema(schemaRes.schema);
        setUserPrefs(prefsRes.prefs);
        setPlaylists(plRes.playlists);
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
    []
  );

  const oeffneReel = useCallback(async (teamId: string, reelId: string) => {
    setFehler(null);
    try {
      const detail = await videoApi.holeReelDetails(teamId, reelId);
      setAktivesReel(detail.reel);
      setAktivePlays(detail.plays);
      setTelestrations(detail.telestrations);
      setNotizen(detail.notes);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Reel konnte nicht geladen werden.');
    }
  }, []);

  return (
    <VideoAnalysisContext.Provider
      value={{
        reels,
        laedtReels,
        fehler,
        aktivesReel,
        aktivePlays,
        telestrations,
        notizen,
        teamSchema,
        userPrefs,
        playlists,
        uploadModalOffen,
        aktiverPlaylistFilterIds,
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
