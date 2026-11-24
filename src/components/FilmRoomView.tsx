import { useEffect, useMemo, useRef, useState } from 'react';
import type { PluginLaufzeitKontext } from '@sidelineos/plugin-sdk';
import { createPluginTranslator } from '@sidelineos/plugin-sdk';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Circle,
  Highlighter,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  MousePointer,
  Pause,
  Pencil,
  Play,
  SkipBack,
  SkipForward,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { useVideoAnalysis } from '../context/VideoAnalysisContext';
import { VIDEO_WOERTERBUCH } from '../i18n/woerterbuch';
import { videoApi } from '../services/apiClient';
import {
  FRAME_MS,
  STANDARD_HOTKEYS,
  findeUeberfahrenenAutoStopFrame,
  formatiereFrameTimecode,
  frameIndexZuMs,
  hatExaktenFrameTreffer,
  msZuFrameIndex,
  normalisiereTaste,
} from '../services/frameAndHotkeys';
import { erstelleStandardTeamSchema } from '../services/taggingEngine';
import type {
  CoachNotiz,
  EckPosition,
  NotizStatus,
  PlayBreakdownDaten,
  TelestrationElement,
  TelestrationWerkzeug,
  WinkelCode,
} from '../types/video';
import { BreakdownGrid } from './BreakdownGrid';
import { TelestrationCanvas } from './TelestrationCanvas';

const FARBEN = ['#F59E0B', '#EF4444', '#38BDF8', '#22C55E', '#FFFFFF'];

const ECKEN_KLASSEN: Record<EckPosition, string> = {
  'top-left': 'top-3 left-3',
  'top-right': 'top-3 right-3',
  'bottom-left': 'bottom-16 left-3',
  'bottom-right': 'bottom-16 right-3',
};

export function FilmRoomView({ ctx }: { ctx: PluginLaufzeitKontext }) {
  const t = createPluginTranslator(VIDEO_WOERTERBUCH, ctx.locale);
  const {
    aktivesReel,
    aktivePlays,
    telestrations,
    notizen,
    teamSchema,
    userPrefs,
    aktiverPlaylistFilterIds,
    setAktiverPlaylistFilterIds,
    aktualisierePlaysLokal,
    aktualisiereTelestrationsLokal,
    aktualisiereNotizenLokal,
    setTeamSchema,
  } = useVideoAnalysis();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const letzteMsRef = useRef(0);

  const istCoachOderAdmin =
    ctx.aktiveTeamAnsicht === 'COACH' || ctx.aktiveTeamAnsicht === 'TEAM_ADMIN';

  const sichtbarePlays = useMemo(() => {
    if (!aktiverPlaylistFilterIds) return aktivePlays;
    const set = new Set(aktiverPlaylistFilterIds);
    return aktivePlays.filter((p) => set.has(p.id));
  }, [aktivePlays, aktiverPlaylistFilterIds]);

  const [aktivesPlayId, setAktivesPlayId] = useState<string | null>(null);
  const [aktiverWinkel, setAktiverWinkel] = useState<WinkelCode>('SIDELINE');
  const [laeuft, setLaeuft] = useState(false);
  const [aktuelleMs, setAktuelleMs] = useState(0);
  const [realeClipDauerMs, setRealeClipDauerMs] = useState<number | null>(null);
  const [videoFehler, setVideoFehler] = useState<string | null>(null);
  const [tempo, setTempo] = useState<number>(userPrefs?.defaultPlaybackRate ?? 1);
  const [autoStop, setAutoStop] = useState<boolean>(userPrefs?.autoStopEnabled ?? true);
  const [istVollbild, setIstVollbild] = useState(false);
  const [werkzeug, setWerkzeug] = useState<TelestrationWerkzeug>('select');
  const [farbe, setFarbe] = useState('#F59E0B');
  const [selectedElId, setSelectedElId] = useState<string | null>(null);
  const [zeichenBarSichtbar, setZeichenBarSichtbar] = useState(true);
  const [notizEntwurfText, setNotizEntwurfText] = useState('');
  const [editNotizId, setEditNotizId] = useState<string | null>(null);

  const aktivesPlay = useMemo(
    () => sichtbarePlays.find((p) => p.id === aktivesPlayId) ?? sichtbarePlays[0] ?? null,
    [sichtbarePlays, aktivesPlayId]
  );

  useEffect(() => {
    if (sichtbarePlays.length > 0 && !sichtbarePlays.some((p) => p.id === aktivesPlayId)) {
      setAktivesPlayId(sichtbarePlays[0].id);
    }
  }, [sichtbarePlays, aktivesPlayId]);

  useEffect(() => {
    if (!aktivesPlay) return;
    if (!aktivesPlay.sources[aktiverWinkel]) {
      const ersterWinkel = Object.keys(aktivesPlay.sources)[0];
      if (ersterWinkel) setAktiverWinkel(ersterWinkel);
    }
  }, [aktivesPlay, aktiverWinkel]);

  const aktiveQuelle =
    aktivesPlay?.sources[aktiverWinkel] ??
    (aktivesPlay ? Object.values(aktivesPlay.sources)[0] : undefined);

  const playStartMs = aktiveQuelle?.startMs ?? 0;
  const gespeicherteDauerMs = Math.max(
    FRAME_MS,
    (aktiveQuelle?.endMs ?? 12000) - playStartMs
  );
  const effektiveDauerMs =
    aktiveQuelle?.sourceMode === 'TIME_SLICE'
      ? gespeicherteDauerMs
      : realeClipDauerMs ?? gespeicherteDauerMs;
  const playEndMs = playStartMs + effektiveDauerMs;
  const effektiverOffset = aktiveQuelle?.offsetMs ?? 0;
  const aktuellerFrame = msZuFrameIndex(aktuelleMs);

  // Video-Quelle gewechselt -> Metadaten-Dauer & Fehler zurücksetzen
  useEffect(() => {
    setRealeClipDauerMs(null);
    setVideoFehler(null);
  }, [aktiveQuelle?.streamUrl, aktivesPlay?.id, aktiverWinkel]);

  // Exakte Frame-Zuordnung für Zeichnungen & Coach-Notizen (kein Vorab-Aufblitzen!)
  const frameTelestration = useMemo(
    () =>
      telestrations.find(
        (tel) =>
          tel.playId === aktivesPlay?.id &&
          tel.angleCode === aktiverWinkel &&
          hatExaktenFrameTreffer(aktuelleMs, tel.frameIndex)
      ),
    [telestrations, aktivesPlay?.id, aktiverWinkel, aktuelleMs]
  );

  const frameNotizen = useMemo(
    () =>
      notizen.filter(
        (n) =>
          n.playId === aktivesPlay?.id &&
          n.angleCode === aktiverWinkel &&
          hatExaktenFrameTreffer(aktuelleMs, n.frameIndex) &&
          (istCoachOderAdmin || n.status === 'PUBLISHED')
      ),
    [notizen, aktivesPlay?.id, aktiverWinkel, aktuelleMs, istCoachOderAdmin]
  );

  const autoStopZielFrames = useMemo(() => {
    if (!aktivesPlay) return [];
    const frames = new Set<number>();
    telestrations.forEach((tel) => {
      if (tel.playId === aktivesPlay.id && tel.angleCode === aktiverWinkel && tel.elements.length > 0) {
        frames.add(tel.frameIndex);
      }
    });
    notizen.forEach((n) => {
      if (
        n.playId === aktivesPlay.id &&
        n.angleCode === aktiverWinkel &&
        (istCoachOderAdmin || n.status === 'PUBLISHED')
      ) {
        frames.add(n.frameIndex);
      }
    });
    return Array.from(frames);
  }, [telestrations, notizen, aktivesPlay, aktiverWinkel, istCoachOderAdmin]);

  // Echte <video>-Wiedergabe direkt mit Play/Pause/PlaybackRate synchronisieren
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !aktiveQuelle?.streamUrl) return;
    videoEl.playbackRate = tempo;
    if (laeuft) {
      const zielSek = Math.max(0, (playStartMs + effektiverOffset + letzteMsRef.current) / 1000);
      if (videoEl.readyState >= 1 && Math.abs(videoEl.currentTime - zielSek) > 0.25) {
        videoEl.currentTime = zielSek;
      }
      videoEl.play().catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setVideoFehler(err instanceof Error ? err.message : 'Videowiedergabe blockiert.');
        setLaeuft(false);
      });
    } else {
      videoEl.pause();
    }
  }, [laeuft, tempo, aktiveQuelle?.streamUrl, aktivesPlay?.id, aktiverWinkel]);

  // Quantisierter 25-fps-Tracking-Loop (liest reale Video-Zeit oder fällt ohne streamUrl auf Timer zurück)
  useEffect(() => {
    if (!laeuft) return;
    let timerId: number;
    let letzterTick = performance.now();

    const tick = () => {
      const jetzt = performance.now();
      const deltaMs = (jetzt - letzterTick) * tempo;
      letzterTick = jetzt;

      const videoEl = videoRef.current;
      const hatEchtesVideo = Boolean(aktiveQuelle?.streamUrl) && !videoFehler;

      setAktuelleMs((alt) => {
        let naechsteRoh: number;
        if (hatEchtesVideo && videoEl) {
          if (videoEl.readyState < 2 || videoEl.paused) {
            return alt;
          }
          naechsteRoh = Math.max(0, videoEl.currentTime * 1000 - playStartMs - effektiverOffset);
        } else {
          naechsteRoh = alt + deltaMs;
        }

        if (autoStop) {
          const trefferFrame = findeUeberfahrenenAutoStopFrame(
            letzteMsRef.current,
            naechsteRoh,
            autoStopZielFrames
          );
          if (trefferFrame !== null) {
            const stopMs = frameIndexZuMs(trefferFrame);
            letzteMsRef.current = stopMs;
            setLaeuft(false);
            if (videoEl) {
              videoEl.pause();
              if (videoEl.readyState >= 1) {
                videoEl.currentTime = Math.max(0, (playStartMs + effektiverOffset + stopMs) / 1000);
              }
            }
            return stopMs;
          }
        }

        if (naechsteRoh >= effektiveDauerMs || (hatEchtesVideo && videoEl?.ended)) {
          setLaeuft(false);
          letzteMsRef.current = 0;
          if (videoEl) {
            videoEl.pause();
            if (videoEl.readyState >= 1) {
              videoEl.currentTime = Math.max(0, (playStartMs + effektiverOffset) / 1000);
            }
          }
          return 0;
        }
        letzteMsRef.current = naechsteRoh;
        return naechsteRoh;
      });
      timerId = window.setTimeout(tick, FRAME_MS);
    };

    timerId = window.setTimeout(tick, FRAME_MS);
    return () => window.clearTimeout(timerId);
  }, [
    laeuft,
    tempo,
    autoStop,
    autoStopZielFrames,
    playStartMs,
    effektiveDauerMs,
    effektiverOffset,
    aktiveQuelle?.streamUrl,
    videoFehler,
  ]);

  const springeZuMs = (zielMs: number) => {
    const dauer = Math.max(FRAME_MS, effektiveDauerMs);
    const geclampt = Math.max(0, Math.min(dauer, Math.round(zielMs / FRAME_MS) * FRAME_MS));
    letzteMsRef.current = geclampt;
    setAktuelleMs(geclampt);
    if (videoRef.current && videoRef.current.readyState >= 1) {
      videoRef.current.currentTime = Math.max(
        0,
        (playStartMs + effektiverOffset + geclampt) / 1000
      );
    }
  };

  const handlePlayWechsel = (playId: string) => {
    setLaeuft(false);
    if (videoRef.current) videoRef.current.pause();
    setAktivesPlayId(playId);
    setAktuelleMs(0);
    letzteMsRef.current = 0;
    setSelectedElId(null);
  };

  const handleWinkelWechsel = (winkel: WinkelCode) => {
    setAktiverWinkel(winkel);
    setSelectedElId(null);
    if (videoRef.current && videoRef.current.readyState >= 1) {
      const zielQuelle = aktivesPlay?.sources[winkel];
      const neuerStart = zielQuelle?.startMs ?? 0;
      const neuerOffset = zielQuelle?.offsetMs ?? 0;
      videoRef.current.currentTime = Math.max(0, (neuerStart + neuerOffset + aktuelleMs) / 1000);
    }
  };

  const toggleVollbild = async () => {
    if (!stageRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      setIstVollbild(false);
    } else {
      await stageRef.current.requestFullscreen().catch(() => undefined);
      setIstVollbild(true);
    }
  };

  // Konfigurierbare Hotkeys
  useEffect(() => {
    const hotkeys = userPrefs?.hotkeys ?? STANDARD_HOTKEYS;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      const taste = normalisiereTaste(e.code || e.key);
      if (taste === hotkeys.playPause) {
        e.preventDefault();
        setLaeuft((v) => !v);
      } else if (taste === hotkeys.stepBack) {
        e.preventDefault();
        setLaeuft(false);
        springeZuMs(aktuelleMs - FRAME_MS);
      } else if (taste === hotkeys.stepForward) {
        e.preventDefault();
        setLaeuft(false);
        springeZuMs(aktuelleMs + FRAME_MS);
      } else if (taste === hotkeys.prevPlay && aktivesPlay) {
        e.preventDefault();
        const idx = sichtbarePlays.findIndex((p) => p.id === aktivesPlay.id);
        if (idx > 0) handlePlayWechsel(sichtbarePlays[idx - 1].id);
      } else if (taste === hotkeys.nextPlay && aktivesPlay) {
        e.preventDefault();
        const idx = sichtbarePlays.findIndex((p) => p.id === aktivesPlay.id);
        if (idx >= 0 && idx < sichtbarePlays.length - 1) {
          handlePlayWechsel(sichtbarePlays[idx + 1].id);
        }
      } else if (taste === hotkeys.toggleFullscreen) {
        e.preventDefault();
        toggleVollbild();
      } else if (taste === hotkeys.toggleDraw && istCoachOderAdmin) {
        e.preventDefault();
        setZeichenBarSichtbar((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!aktivesReel || !aktivesPlay) {
    return (
      <div className="rounded-xl border border-[#232933] bg-[#13171D] p-10 text-center text-sm text-[#8B949E]">
        {t('filmRoomEmpty')}
      </div>
    );
  }

  const speichereZeichnung = async (elements: TelestrationElement[]) => {
    if (!istCoachOderAdmin) return;
    const frameIndex = aktuellerFrame;
    aktualisiereTelestrationsLokal((alt) => {
      const ohne = alt.filter(
        (x) =>
          !(
            x.playId === aktivesPlay.id &&
            x.angleCode === aktiverWinkel &&
            x.frameIndex === frameIndex
          )
      );
      return [
        ...ohne,
        {
          id: `tel-${aktivesPlay.id}-${frameIndex}`,
          reelId: aktivesReel.id,
          playId: aktivesPlay.id,
          angleCode: aktiverWinkel,
          frameIndex,
          elements,
          updatedAt: new Date().toISOString(),
        },
      ];
    });
    await videoApi.speichereTelestration(ctx.team.id, aktivesPlay.id, {
      reelId: aktivesReel.id,
      angleCode: aktiverWinkel,
      frameIndex,
      elements,
    });
  };

  const handleNotizAnlegen = async () => {
    if (!notizEntwurfText.trim() || !istCoachOderAdmin) return;
    const res = await videoApi.erstelleNotiz(ctx.team.id, aktivesPlay.id, {
      reelId: aktivesReel.id,
      playId: aktivesPlay.id,
      angleCode: aktiverWinkel,
      frameIndex: aktuellerFrame,
      text: notizEntwurfText.trim(),
      status: 'PUBLISHED',
      cornerPosition: userPrefs?.defaultCorner ?? 'top-right',
    });
    aktualisiereNotizenLokal((alt) => [
      ...alt,
      {
        id: res.id,
        reelId: aktivesReel.id,
        playId: aktivesPlay.id,
        angleCode: aktiverWinkel,
        frameIndex: aktuellerFrame,
        text: notizEntwurfText.trim(),
        status: 'PUBLISHED',
        cornerPosition: userPrefs?.defaultCorner ?? 'top-right',
        authorUuid: ctx.benutzer.uuid,
        authorName: ctx.benutzer.vollerName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    setNotizEntwurfText('');
  };

  const handleNotizUpdate = async (
    note: CoachNotiz,
    patch: Partial<Pick<CoachNotiz, 'text' | 'status' | 'cornerPosition'>>
  ) => {
    aktualisiereNotizenLokal((alt) =>
      alt.map((n) => (n.id === note.id ? { ...n, ...patch } : n))
    );
    await videoApi.aktualisiereNotiz(ctx.team.id, note.id, patch);
  };

  const handleNotizLoeschen = async (noteId: string) => {
    aktualisiereNotizenLokal((alt) => alt.filter((n) => n.id !== noteId));
    await videoApi.loescheNotiz(ctx.team.id, noteId);
  };

  const schema = teamSchema ?? erstelleStandardTeamSchema(ctx.team.id);

  return (
    <section className="space-y-5">
      {/* Kopfzeile: Reel-Info, Winkel-Umschalter & Playlist-Hinweis */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h1 className="text-lg font-bold text-white">{aktivesReel.title}</h1>
          <div className="flex items-center gap-2 text-xs text-[#8B949E] video-tabular">
            <span>Play #{aktivesPlay.playNumber}</span>
            <span aria-hidden="true">·</span>
            <span>Frame {aktuellerFrame}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{formatiereFrameTimecode(aktuelleMs)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {aktiverPlaylistFilterIds && (
            <button
              type="button"
              onClick={() => setAktiverPlaylistFilterIds(null)}
              className="rounded-md border border-[#F59E0B]/50 px-3 py-1.5 text-xs text-[#F59E0B] hover:bg-[#F59E0B]/10"
            >
              Playlist-Filter aufheben ({sichtbarePlays.length})
            </button>
          )}
          <div className="flex items-center gap-1 rounded-lg border border-[#232933] bg-[#13171D] p-1">
            {aktivesReel.angles.map((angle) => {
              const verfuegbar = Boolean(aktivesPlay.sources[angle]);
              return (
                <button
                  key={angle}
                  type="button"
                  disabled={!verfuegbar}
                  onClick={() => handleWinkelWechsel(angle)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    aktiverWinkel === angle
                      ? 'bg-[#F59E0B] text-[#0B0E11]'
                      : verfuegbar
                        ? 'text-[#E6EDF3] hover:bg-[#232933]'
                        : 'cursor-not-allowed text-[#6E7681] opacity-40'
                  }`}
                >
                  {angle}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Video-Bühne inkl. Telestration, Ecken-Overlay & Vollbild-Zeichenleiste */}
      <div
        ref={stageRef}
        className="overflow-hidden rounded-xl border border-[#232933] bg-[#0B0E11]"
      >
        <div className="relative aspect-video w-full bg-[#07090C]">
          {aktiveQuelle?.streamUrl && !videoFehler ? (
            <video
              key={`${aktivesPlay.id}-${aktiverWinkel}-${aktiveQuelle.streamUrl}`}
              ref={videoRef}
              src={aktiveQuelle.streamUrl}
              preload="auto"
              playsInline
              muted
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (Number.isFinite(v.duration) && v.duration > 0) {
                  setRealeClipDauerMs(Math.round(v.duration * 1000));
                }
                const startSek = Math.max(
                  0,
                  (playStartMs + effektiverOffset + letzteMsRef.current) / 1000
                );
                if (startSek > 0) {
                  v.currentTime = startSek;
                }
                if (laeuft && v.paused) {
                  v.playbackRate = tempo;
                  v.play().catch((err: unknown) => {
                    if (err instanceof DOMException && err.name === 'AbortError') return;
                    setVideoFehler(err instanceof Error ? err.message : 'Videowiedergabe blockiert.');
                    setLaeuft(false);
                  });
                }
              }}
              onError={() =>
                setVideoFehler('Videodatei konnte vom S3-Stream nicht geladen werden.')
              }
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center bg-[radial-gradient(circle_at_center,#18202B_0%,#07090C_75%)] text-center px-4">
              <div className="font-mono text-2xl font-semibold text-white video-tabular">
                PLAY #{aktivesPlay.playNumber} · {aktiverWinkel}
              </div>
              <div className="mt-1 font-mono text-xs text-[#8B949E] video-tabular">
                {videoFehler ??
                  `${aktiveQuelle?.fileName ?? 'Kein Video-Asset hinterlegt'} · ${formatiereFrameTimecode(aktuelleMs)} (25 fps)`}
              </div>
            </div>
          )}

          {/* Vektor-Canvas exakt auf Frame + Winkel */}
          <TelestrationCanvas
            elements={frameTelestration?.elements ?? []}
            werkzeug={istCoachOderAdmin ? werkzeug : 'select'}
            farbe={farbe}
            readOnly={!istCoachOderAdmin}
            selectedId={selectedElId}
            onSelect={setSelectedElId}
            onChange={speichereZeichnung}
          />

          {/* Kommentar-Overlay in frei wählbarer Bildecke */}
          {frameNotizen.map((notiz) => (
            <div
              key={notiz.id}
              className={`absolute z-20 w-72 rounded-lg border border-[#232933] bg-[#0B0E11]/90 p-3 backdrop-blur-sm ${ECKEN_KLASSEN[notiz.cornerPosition]}`}
            >
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-[#8B949E]">
                <span className="truncate font-medium text-[#F59E0B]">
                  {notiz.authorName} · {notiz.status === 'DRAFT' ? 'Entwurf' : 'Veröffentlicht'}
                </span>
                {istCoachOderAdmin && (
                  <div className="flex items-center gap-1">
                    <select
                      aria-label="Overlay-Ecke wählen"
                      value={notiz.cornerPosition}
                      onChange={(e) =>
                        handleNotizUpdate(notiz, { cornerPosition: e.target.value as EckPosition })
                      }
                      className="rounded border border-[#232933] bg-[#13171D] px-1 py-0.5 text-[10px] text-[#E6EDF3]"
                    >
                      <option value="top-left">Oben L</option>
                      <option value="top-right">Oben R</option>
                      <option value="bottom-left">Unten L</option>
                      <option value="bottom-right">Unten R</option>
                    </select>
                    <button
                      type="button"
                      title="Notiz löschen"
                      onClick={() => handleNotizLoeschen(notiz.id)}
                      className="rounded p-0.5 text-[#8B949E] hover:text-red-300"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>

              {editNotizId === notiz.id && istCoachOderAdmin ? (
                <div className="space-y-1.5">
                  <textarea
                    rows={2}
                    value={notiz.text}
                    onChange={(e) =>
                      aktualisiereNotizenLokal((alt) =>
                        alt.map((n) => (n.id === notiz.id ? { ...n, text: e.target.value } : n))
                      )
                    }
                    className="w-full rounded border border-[#F59E0B] bg-[#13171D] p-1.5 text-xs text-white focus:outline-none"
                  />
                  <div className="flex items-center justify-between">
                    <select
                      value={notiz.status}
                      onChange={(e) =>
                        handleNotizUpdate(notiz, { status: e.target.value as NotizStatus })
                      }
                      className="rounded border border-[#232933] bg-[#13171D] px-1.5 py-0.5 text-[11px] text-[#E6EDF3]"
                    >
                      <option value="DRAFT">Entwurf</option>
                      <option value="PUBLISHED">Veröffentlicht</option>
                    </select>
                    <button
                      type="button"
                      onClick={async () => {
                        await handleNotizUpdate(notiz, { text: notiz.text });
                        setEditNotizId(null);
                      }}
                      className="rounded bg-[#F59E0B] px-2 py-0.5 text-[11px] font-semibold text-[#0B0E11]"
                    >
                      Fertig
                    </button>
                  </div>
                </div>
              ) : (
                <p
                  onClick={() => istCoachOderAdmin && setEditNotizId(notiz.id)}
                  className={`text-xs leading-relaxed text-[#E6EDF3] ${
                    istCoachOderAdmin ? 'cursor-text' : ''
                  }`}
                >
                  {notiz.text}
                </p>
              )}
            </div>
          ))}

          {/* Eingeblendete Zeichenleiste am unteren Videorand (auch im Vollbild) */}
          {istCoachOderAdmin && zeichenBarSichtbar && (
            <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-[#232933] bg-[#0B0E11]/90 px-2 py-1.5 backdrop-blur-sm">
              {(
                [
                  { id: 'select', icon: MousePointer, title: 'Auswählen / Verschieben' },
                  { id: 'freehand', icon: Pencil, title: 'Freihand' },
                  { id: 'arrow', icon: ArrowUpRight, title: 'Pfeil' },
                  { id: 'circle', icon: Circle, title: 'Kreis / Zone' },
                  { id: 'spotlight', icon: Highlighter, title: 'Spotlight' },
                  { id: 'text', icon: Type, title: 'Text' },
                ] as const
              ).map((tool) => {
                const Icon = tool.icon;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    title={tool.title}
                    onClick={() => setWerkzeug(tool.id)}
                    className={`rounded-md p-1.5 transition-colors ${
                      werkzeug === tool.id
                        ? 'bg-[#F59E0B] text-[#0B0E11]'
                        : 'text-[#E6EDF3] hover:bg-[#232933]'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                );
              })}

              <span className="mx-1 h-4 w-px bg-[#232933]" aria-hidden="true" />

              {FARBEN.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Farbe ${c}`}
                  onClick={() => setFarbe(c)}
                  className={`h-4 w-4 rounded-full border ${
                    farbe === c ? 'border-white scale-110' : 'border-[#232933]'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}

              <span className="mx-1 h-4 w-px bg-[#232933]" aria-hidden="true" />

              <button
                type="button"
                title="Letztes Element entfernen"
                onClick={() => {
                  const aktuell = frameTelestration?.elements ?? [];
                  if (aktuell.length > 0) speichereZeichnung(aktuell.slice(0, -1));
                }}
                className="rounded-md p-1.5 text-[#8B949E] hover:bg-[#232933] hover:text-white"
              >
                <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                title="Frame-Zeichnungen leeren"
                onClick={() => speichereZeichnung([])}
                className="rounded-md p-1.5 text-[#8B949E] hover:bg-red-950/50 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        {/* Transportleiste */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#232933] bg-[#13171D] px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              title="Vorheriger Spielzug"
              onClick={() => {
                const idx = sichtbarePlays.findIndex((p) => p.id === aktivesPlay.id);
                if (idx > 0) handlePlayWechsel(sichtbarePlays[idx - 1].id);
              }}
              className="rounded-md p-1.5 text-[#E6EDF3] hover:bg-[#232933]"
            >
              <SkipBack className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              title="-1 Frame (40 ms)"
              onClick={() => {
                setLaeuft(false);
                springeZuMs(aktuelleMs - FRAME_MS);
              }}
              className="rounded-md p-1.5 text-[#E6EDF3] hover:bg-[#232933]"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setLaeuft((v) => !v)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#F59E0B] text-[#0B0E11] hover:bg-[#FBBF24]"
            >
              {laeuft ? (
                <Pause className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              title="+1 Frame (40 ms)"
              onClick={() => {
                setLaeuft(false);
                springeZuMs(aktuelleMs + FRAME_MS);
              }}
              className="rounded-md p-1.5 text-[#E6EDF3] hover:bg-[#232933]"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              title="Nächster Spielzug"
              onClick={() => {
                const idx = sichtbarePlays.findIndex((p) => p.id === aktivesPlay.id);
                if (idx >= 0 && idx < sichtbarePlays.length - 1) {
                  handlePlayWechsel(sichtbarePlays[idx + 1].id);
                }
              }}
              className="rounded-md p-1.5 text-[#E6EDF3] hover:bg-[#232933]"
            >
              <SkipForward className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(FRAME_MS, effektiveDauerMs)}
            step={FRAME_MS}
            value={Math.min(aktuelleMs, Math.max(FRAME_MS, effektiveDauerMs))}
            onChange={(e) => {
              setLaeuft(false);
              springeZuMs(Number(e.target.value));
            }}
            className="h-1.5 flex-1 min-w-[160px] accent-[#F59E0B]"
          />

          <div className="flex items-center gap-2 text-xs">
            <select
              aria-label="Wiedergabetempo"
              value={tempo}
              onChange={(e) => setTempo(Number(e.target.value))}
              className="rounded border border-[#232933] bg-[#0B0E11] px-2 py-1 text-xs text-[#E6EDF3] video-tabular"
            >
              <option value={0.25}>0.25x</option>
              <option value={0.5}>0.5x</option>
              <option value={1}>1.0x</option>
              <option value={1.5}>1.5x</option>
              <option value={2}>2.0x</option>
            </select>
            <label className="inline-flex items-center gap-1.5 text-[#E6EDF3] whitespace-nowrap">
              <input
                type="checkbox"
                checked={autoStop}
                onChange={(e) => setAutoStop(e.target.checked)}
                className="accent-[#F59E0B]"
              />
              {t('autoStop')}
            </label>
            <button
              type="button"
              onClick={toggleVollbild}
              title={istVollbild ? t('exitFullscreen') : t('fullscreen')}
              className="rounded-md p-1.5 text-[#E6EDF3] hover:bg-[#232933]"
            >
              {istVollbild ? (
                <Minimize2 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Schnelle Coach-Notiz am aktuellen Frame */}
      {istCoachOderAdmin && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#232933] bg-[#13171D] p-3">
          <MessageSquarePlus className="h-4 w-4 text-[#F59E0B]" aria-hidden="true" />
          <input
            type="text"
            value={notizEntwurfText}
            onChange={(e) => setNotizEntwurfText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleNotizAnlegen()}
            placeholder={`Coach-Notiz exakt an Frame ${aktuellerFrame} (${formatiereFrameTimecode(aktuelleMs)}) heften...`}
            className="flex-1 min-w-[220px] bg-transparent text-xs text-white placeholder:text-[#6E7681] focus:outline-none"
          />
          <button
            type="button"
            onClick={handleNotizAnlegen}
            className="rounded-md bg-[#232933] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#36404F] whitespace-nowrap shrink-0"
          >
            Notiz anheften
          </button>
        </div>
      )}

      {/* Hudl Breakdown Grid */}
      <BreakdownGrid
        plays={sichtbarePlays}
        aktivesPlayId={aktivesPlay.id}
        schema={schema}
        teamRolle={ctx.aktiveTeamAnsicht}
        erlaubteSpalten={aktivesReel.allowedFields}
        onSelectPlay={handlePlayWechsel}
        onUpdatePlay={async (playId, breakdown: PlayBreakdownDaten) => {
          aktualisierePlaysLokal((alt) =>
            alt.map((p) => (p.id === playId ? { ...p, breakdown } : p))
          );
          await videoApi.aktualisierePlay(ctx.team.id, playId, { breakdown });
        }}
        onAddPlay={
          istCoachOderAdmin
            ? async () => {
                const nr =
                  aktivePlays.reduce((max, p) => Math.max(max, p.playNumber), 0) + 1;
                const res = await videoApi.erstellePlay(ctx.team.id, aktivesReel.id, {
                  playNumber: nr,
                  breakdown: { odk: 'O', play_number: nr },
                });
                aktualisierePlaysLokal((alt) => [
                  ...alt,
                  {
                    id: res.id,
                    reelId: aktivesReel.id,
                    playNumber: nr,
                    sortOrder: nr,
                    breakdown: { odk: 'O', play_number: nr },
                    sources: {},
                  },
                ]);
              }
            : undefined
        }
        onDeletePlay={
          istCoachOderAdmin
            ? async (playId) => {
                aktualisierePlaysLokal((alt) => alt.filter((p) => p.id !== playId));
                await videoApi.loeschePlay(ctx.team.id, playId);
              }
            : undefined
        }
        onSchemaLearn={async (nextSchema) => {
          setTeamSchema(nextSchema);
          await videoApi.speichereSchema(ctx.team.id, nextSchema);
        }}
      />
    </section>
  );
}
