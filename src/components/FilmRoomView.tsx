import { useEffect, useMemo, useRef, useState } from 'react';
import type { PluginLaufzeitKontext } from '@sidelineos/plugin-sdk';
import { createPluginTranslator } from '@sidelineos/plugin-sdk';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Circle,
  Eraser,
  Highlighter,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Minus,
  MousePointer,
  Pause,
  Pencil,
  Play,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { useVideoAnalysis } from '../context/VideoAnalysisContext';
import { VIDEO_WOERTERBUCH } from '../i18n/woerterbuch';
import {
  ANMERKUNGS_ZIELGRUPPEN,
  bereinigeAnmerkungsKonfig,
  filtereTelestrationElementeFuerBenutzer,
  findeZielgruppeZuFarbe,
  istAnmerkungFuerBenutzerSichtbar,
  sammleFrameAnmerkungsMarker,
  sammlePlayAnmerkungsZaehler,
} from '../services/annotationVisibility';
import { videoApi } from '../services/apiClient';
import {
  FRAME_MS,
  berechnePrevPlayOderClipStart,
  bereinigeHotkeyBelegung,
  findeUeberfahrenenAutoStopFrame,
  formatiereFrameTimecode,
  formatiereHotkeyAnzeige,
  frameIndexZuMs,
  hatExaktenFrameTreffer,
  matchesHotkeyEvent,
  msZuFrameIndex,
} from '../services/frameAndHotkeys';
import { erstelleStandardTeamSchema } from '../services/taggingEngine';
import type {
  CoachNotiz,
  EckPosition,
  NotizStatus,
  PlayBreakdownDaten,
  SichtbarkeitsStufe,
  TelestrationElement,
  TelestrationWerkzeug,
  WinkelCode,
} from '../types/video';
import { BreakdownGrid } from './BreakdownGrid';
import { BreakdownOverlay } from './BreakdownOverlay';
import { TelestrationCanvas } from './TelestrationCanvas';

const KLASSISCHE_FARBEN = ['#F59E0B', '#EF4444', '#38BDF8', '#22C55E', '#FFFFFF'];

const ECKEN_KLASSEN: Record<EckPosition, string> = {
  'top-left': 'top-3 left-3',
  'top-right': 'top-3 right-3',
  'bottom-left': 'bottom-16 left-3',
  'bottom-right': 'bottom-16 right-3',
};

function BlockLineIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <line x1="2.5" y1="13" x2="11.5" y2="4" />
      <line x1="8.5" y1="1.5" x2="14.5" y2="7.5" />
    </svg>
  );
}

function DashedLineIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="2.5 2.5" aria-hidden="true">
      <line x1="2.5" y1="13" x2="13.5" y2="2.5" />
    </svg>
  );
}

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
  const notizInputRef = useRef<HTMLInputElement | null>(null);
  const letzteMsRef = useRef(0);

  const istCoachOderAdmin =
    ctx.aktiveTeamAnsicht === 'COACH' || ctx.aktiveTeamAnsicht === 'TEAM_ADMIN';

  const schema = teamSchema ?? erstelleStandardTeamSchema(ctx.team.id);
  const sharingKonfig = useMemo(
    () => bereinigeAnmerkungsKonfig(schema.annotationSharing),
    [schema.annotationSharing]
  );
  const hotkeys = useMemo(
    () => bereinigeHotkeyBelegung(userPrefs?.hotkeys),
    [userPrefs?.hotkeys]
  );

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
  const [aktiveZielgruppe, setAktiveZielgruppe] = useState<SichtbarkeitsStufe>('ALL_PLAYERS');
  const [farbe, setFarbe] = useState<string>(sharingKonfig.colorMap.ALL_PLAYERS);
  const [selectedElId, setSelectedElId] = useState<string | null>(null);
  const [zeichenBarSichtbar, setZeichenBarSichtbar] = useState(true);
  const [breakdownOverlayOffen, setBreakdownOverlayOffen] = useState(false);
  const [coachFilterGruppe, setCoachFilterGruppe] = useState<'ALL' | SichtbarkeitsStufe>('ALL');
  const [notizEntwurfText, setNotizEntwurfText] = useState('');
  const [notizZielgruppe, setNotizZielgruppe] = useState<SichtbarkeitsStufe>('ALL_PLAYERS');
  const [editNotizId, setEditNotizId] = useState<string | null>(null);

  // Farbe synchron halten, wenn Admin Farbschema ändert und Farb-Sharing aktiv ist
  useEffect(() => {
    if (sharingKonfig.enabled) {
      setFarbe(sharingKonfig.colorMap[aktiveZielgruppe]);
    }
  }, [sharingKonfig.enabled, sharingKonfig.colorMap, aktiveZielgruppe]);

  const aktivesPlay = useMemo(
    () => sichtbarePlays.find((p) => p.id === aktivesPlayId) ?? sichtbarePlays[0] ?? null,
    [sichtbarePlays, aktivesPlayId]
  );

  const aktivesPlayIndex = useMemo(
    () => (aktivesPlay ? sichtbarePlays.findIndex((p) => p.id === aktivesPlay.id) : -1),
    [sichtbarePlays, aktivesPlay]
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
  const effektiverOffset = aktiveQuelle?.offsetMs ?? 0;
  const aktuellerFrame = msZuFrameIndex(aktuelleMs);

  // Video-Quelle gewechselt -> Metadaten-Dauer & Fehler zurücksetzen
  useEffect(() => {
    setRealeClipDauerMs(null);
    setVideoFehler(null);
  }, [aktiveQuelle?.streamUrl, aktivesPlay?.id, aktiverWinkel]);

  // Rollen-, Unit- und optionaler Coach-Vorschau-Filter (#2)
  const sichtbareTelestrations = useMemo(() => {
    return telestrations
      .map((tel) => {
        let filtered = filtereTelestrationElementeFuerBenutzer(
          tel.elements,
          ctx.aktiveTeamAnsicht,
          ctx.userUnits,
          sharingKonfig.enabled
        );
        if (istCoachOderAdmin && sharingKonfig.enabled && coachFilterGruppe !== 'ALL') {
          filtered = filtered.filter(
            (el) => (el.visibility ?? findeZielgruppeZuFarbe(sharingKonfig, el.color)) === coachFilterGruppe
          );
        }
        return { ...tel, elements: filtered };
      })
      .filter((tel) => tel.elements.length > 0);
  }, [
    telestrations,
    ctx.aktiveTeamAnsicht,
    ctx.userUnits,
    sharingKonfig,
    istCoachOderAdmin,
    coachFilterGruppe,
  ]);

  const sichtbareNotizen = useMemo(() => {
    return notizen.filter((n) => {
      if (!istCoachOderAdmin && n.status !== 'PUBLISHED') return false;
      if (
        !istAnmerkungFuerBenutzerSichtbar(
          n.visibility,
          ctx.aktiveTeamAnsicht,
          ctx.userUnits,
          sharingKonfig.enabled
        )
      ) {
        return false;
      }
      if (istCoachOderAdmin && sharingKonfig.enabled && coachFilterGruppe !== 'ALL') {
        return (n.visibility ?? 'ALL_PLAYERS') === coachFilterGruppe;
      }
      return true;
    });
  }, [
    notizen,
    istCoachOderAdmin,
    ctx.aktiveTeamAnsicht,
    ctx.userUnits,
    sharingKonfig.enabled,
    coachFilterGruppe,
  ]);

  // Roh-Eintrag (inkl. ggf. vom Coach-Filter ausgeblendeter Elemente zum sicheren Speichern)
  const roheFrameTelestration = useMemo(
    () =>
      telestrations.find(
        (tel) =>
          tel.playId === aktivesPlay?.id &&
          tel.angleCode === aktiverWinkel &&
          hatExaktenFrameTreffer(aktuelleMs, tel.frameIndex)
      ),
    [telestrations, aktivesPlay?.id, aktiverWinkel, aktuelleMs]
  );

  // Exakte Frame-Zuordnung für Zeichnungen & Coach-Notizen (kein Vorab-Aufblitzen!)
  const frameTelestration = useMemo(
    () =>
      sichtbareTelestrations.find(
        (tel) =>
          tel.playId === aktivesPlay?.id &&
          tel.angleCode === aktiverWinkel &&
          hatExaktenFrameTreffer(aktuelleMs, tel.frameIndex)
      ),
    [sichtbareTelestrations, aktivesPlay?.id, aktiverWinkel, aktuelleMs]
  );

  const frameNotizen = useMemo(
    () =>
      sichtbareNotizen.filter(
        (n) =>
          n.playId === aktivesPlay?.id &&
          n.angleCode === aktiverWinkel &&
          hatExaktenFrameTreffer(aktuelleMs, n.frameIndex)
      ),
    [sichtbareNotizen, aktivesPlay?.id, aktiverWinkel, aktuelleMs]
  );

  // Zeitleisten-Marker & Play-Zähler (#1)
  const timelineMarker = useMemo(() => {
    if (!aktivesPlay) return [];
    return sammleFrameAnmerkungsMarker(
      sichtbareTelestrations,
      sichtbareNotizen,
      aktivesPlay.id,
      aktiverWinkel
    );
  }, [sichtbareTelestrations, sichtbareNotizen, aktivesPlay, aktiverWinkel]);

  const playAnmerkungen = useMemo(
    () => sammlePlayAnmerkungsZaehler(sichtbareTelestrations, sichtbareNotizen),
    [sichtbareTelestrations, sichtbareNotizen]
  );

  // Autoren-Badge am aktuellen Frame (auch bei reinen Zeichnungen ohne Textnotiz) (#1)
  const frameZeichnungsAutoren = useMemo(() => {
    if (!frameTelestration || frameTelestration.elements.length === 0) return [];
    const namen = new Set<string>();
    if (frameTelestration.authorName) namen.add(frameTelestration.authorName);
    for (const el of frameTelestration.elements) {
      if (el.authorName) namen.add(el.authorName);
    }
    return Array.from(namen);
  }, [frameTelestration]);

  const freieAutorenEcke: EckPosition = useMemo(() => {
    const belegt = new Set(frameNotizen.map((n) => n.cornerPosition));
    const praeferenz: EckPosition[] = ['top-left', 'bottom-left', 'top-right', 'bottom-right'];
    return praeferenz.find((ecke) => !belegt.has(ecke)) ?? 'top-left';
  }, [frameNotizen]);

  const autoStopZielFrames = useMemo(
    () => timelineMarker.map((m) => m.frameIndex),
    [timelineMarker]
  );

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

  // Quantisierter 25-fps-Tracking-Loop
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

  const handlePrevPlayOderClipStart = () => {
    if (!aktivesPlay) return;
    const aktion = berechnePrevPlayOderClipStart(aktuelleMs, aktivesPlayIndex);
    if (aktion.aktion === 'clipStart') {
      setLaeuft(false);
      videoRef.current?.pause();
      springeZuMs(0);
    } else if (sichtbarePlays[aktion.zielIndex]) {
      handlePlayWechsel(sichtbarePlays[aktion.zielIndex].id);
    }
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

  const toggleBreakdownOverlay = () => {
    setBreakdownOverlayOffen((offen) => {
      const naechster = !offen;
      if (naechster) {
        // Auto-Pause beim Öffnen des Overlays (#6)
        setLaeuft(false);
        videoRef.current?.pause();
      }
      return naechster;
    });
  };

  useEffect(() => {
    const onFsChange = () => {
      setIstVollbild(document.fullscreenElement === stageRef.current);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleVollbild = async () => {
    if (!stageRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
    } else {
      await stageRef.current.requestFullscreen().catch(() => undefined);
    }
  };

  const speichereZeichnung = async (sichtbareElemente: TelestrationElement[]) => {
    if (!istCoachOderAdmin || !aktivesReel || !aktivesPlay) return;
    const frameIndex = aktuellerFrame;

    // Falls ein Coach-Vorschau-Filter aktiv ist, ausgeblendete Elemente bewahren
    let gesamtElemente = sichtbareElemente;
    if (sharingKonfig.enabled && coachFilterGruppe !== 'ALL' && roheFrameTelestration) {
      const ausgeblendete = roheFrameTelestration.elements.filter(
        (el) => (el.visibility ?? findeZielgruppeZuFarbe(sharingKonfig, el.color)) !== coachFilterGruppe
      );
      gesamtElemente = [...ausgeblendete, ...sichtbareElemente];
    }

    aktualisiereTelestrationsLokal((alt) => {
      const ohne = alt.filter(
        (x) =>
          !(
            x.playId === aktivesPlay.id &&
            x.angleCode === aktiverWinkel &&
            x.frameIndex === frameIndex
          )
      );
      if (gesamtElemente.length === 0) return ohne;
      return [
        ...ohne,
        {
          id: `tel-${aktivesPlay.id}-${frameIndex}`,
          reelId: aktivesReel.id,
          playId: aktivesPlay.id,
          angleCode: aktiverWinkel,
          frameIndex,
          elements: gesamtElemente,
          authorUuid: ctx.benutzer.uuid,
          authorName: ctx.benutzer.vollerName,
          updatedAt: new Date().toISOString(),
        },
      ];
    });
    await videoApi.speichereTelestration(ctx.team.id, aktivesPlay.id, {
      reelId: aktivesReel.id,
      angleCode: aktiverWinkel,
      frameIndex,
      elements: gesamtElemente,
    });
  };

  const loescheAusgewaehlteZeichnung = () => {
    if (!istCoachOderAdmin || !selectedElId) return;
    const aktuell = frameTelestration?.elements ?? [];
    if (!aktuell.some((el) => el.id === selectedElId)) return;
    const verbleibend = aktuell.filter((el) => el.id !== selectedElId);
    setSelectedElId(null);
    void speichereZeichnung(verbleibend);
  };

  // Konfigurierbare Hotkeys inkl. Modifier-Support (#3, #5, #6)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (matchesHotkeyEvent(e, hotkeys.playPause)) {
        e.preventDefault();
        setLaeuft((v) => !v);
      } else if (matchesHotkeyEvent(e, hotkeys.stepBack)) {
        e.preventDefault();
        setLaeuft(false);
        springeZuMs(aktuelleMs - FRAME_MS);
      } else if (matchesHotkeyEvent(e, hotkeys.stepForward)) {
        e.preventDefault();
        setLaeuft(false);
        springeZuMs(aktuelleMs + FRAME_MS);
      } else if (matchesHotkeyEvent(e, hotkeys.prevPlay) && aktivesPlay) {
        e.preventDefault();
        handlePrevPlayOderClipStart();
      } else if (matchesHotkeyEvent(e, hotkeys.nextPlay) && aktivesPlay) {
        e.preventDefault();
        if (aktivesPlayIndex >= 0 && aktivesPlayIndex < sichtbarePlays.length - 1) {
          handlePlayWechsel(sichtbarePlays[aktivesPlayIndex + 1].id);
        }
      } else if (matchesHotkeyEvent(e, hotkeys.toggleFullscreen)) {
        e.preventDefault();
        toggleVollbild();
      } else if (matchesHotkeyEvent(e, hotkeys.toggleBreakdownOverlay)) {
        e.preventDefault();
        toggleBreakdownOverlay();
      } else if (matchesHotkeyEvent(e, hotkeys.toggleDraw) && istCoachOderAdmin) {
        e.preventDefault();
        setZeichenBarSichtbar((v) => !v);
      } else if (matchesHotkeyEvent(e, hotkeys.addNote) && istCoachOderAdmin) {
        e.preventDefault();
        setLaeuft(false);
        notizInputRef.current?.focus();
      } else if (
        istCoachOderAdmin &&
        selectedElId &&
        (matchesHotkeyEvent(e, hotkeys.deleteAnnotation) ||
          (!e.ctrlKey && !e.altKey && !e.metaKey && e.code === 'Backspace'))
      ) {
        e.preventDefault();
        loescheAusgewaehlteZeichnung();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!aktivesReel || !aktivesPlay) {
    return (
      <div className="rounded-xl border border-sl-border bg-sl-surface p-10 text-center text-sm text-sl-muted">
        {t('filmRoomEmpty')}
      </div>
    );
  }

  const handleNotizAnlegen = async () => {
    if (!notizEntwurfText.trim() || !istCoachOderAdmin) return;
    const zielVis: SichtbarkeitsStufe = sharingKonfig.enabled ? notizZielgruppe : 'ALL_PLAYERS';
    const notizFarbe = sharingKonfig.enabled ? sharingKonfig.colorMap[zielVis] : farbe;
    const res = await videoApi.erstelleNotiz(ctx.team.id, aktivesPlay.id, {
      reelId: aktivesReel.id,
      playId: aktivesPlay.id,
      angleCode: aktiverWinkel,
      frameIndex: aktuellerFrame,
      text: notizEntwurfText.trim(),
      status: 'PUBLISHED',
      cornerPosition: userPrefs?.defaultCorner ?? 'top-right',
      visibility: zielVis,
      color: notizFarbe,
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
        visibility: zielVis,
        color: notizFarbe,
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
    patch: Partial<Pick<CoachNotiz, 'text' | 'status' | 'cornerPosition' | 'visibility' | 'color'>>
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

  const handlePlayUpdate = async (playId: string, breakdown: PlayBreakdownDaten) => {
    aktualisierePlaysLokal((alt) =>
      alt.map((p) => (p.id === playId ? { ...p, breakdown } : p))
    );
    await videoApi.aktualisierePlay(ctx.team.id, playId, { breakdown });
  };

  const handleSchemaLearn = async (nextSchema: typeof schema) => {
    setTeamSchema(nextSchema);
    await videoApi.speichereSchema(ctx.team.id, nextSchema);
  };

  const gruppenLabel = (vis?: SichtbarkeitsStufe): string => {
    const gefunden = ANMERKUNGS_ZIELGRUPPEN.find((g) => g.id === (vis ?? 'ALL_PLAYERS'));
    return gefunden ? (ctx.locale === 'en' ? gefunden.kurzEn : gefunden.kurzDe) : 'Alle';
  };

  const vorherigesPlay =
    aktivesPlayIndex > 0 ? sichtbarePlays[aktivesPlayIndex - 1] : undefined;

  return (
    <section className="space-y-5">
      {/* Kopfzeile: Reel-Info, Coach-Zielgruppen-Filter & Winkel-Umschalter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h1 className="text-lg font-bold text-sl-heading">{aktivesReel.title}</h1>
          <div className="flex items-center gap-2 text-xs text-sl-muted video-tabular">
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
              className="rounded-md border border-sl-accent/50 px-3 py-1.5 text-xs text-sl-accent hover:bg-sl-accent/10 whitespace-nowrap"
            >
              Playlist-Filter aufheben ({sichtbarePlays.length})
            </button>
          )}
          {istCoachOderAdmin && sharingKonfig.enabled && (
            <select
              aria-label="Anmerkungen nach Zielgruppe filtern"
              value={coachFilterGruppe}
              onChange={(e) => setCoachFilterGruppe(e.target.value as 'ALL' | SichtbarkeitsStufe)}
              className="rounded-lg border border-sl-border bg-sl-surface px-2.5 py-1.5 text-xs text-sl-primary focus:border-sl-accent focus:outline-none"
            >
              <option value="ALL">Anmerkungen: Alle Gruppen</option>
              {ANMERKUNGS_ZIELGRUPPEN.map((g) => (
                <option key={g.id} value={g.id}>
                  Nur {g.labelDe}
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-1 rounded-lg border border-sl-border bg-sl-surface p-1">
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
                      ? 'bg-sl-accent text-sl-accent-contrast'
                      : verfuegbar
                        ? 'text-sl-primary hover:bg-sl-elevated'
                        : 'cursor-not-allowed text-sl-subtle opacity-40'
                  }`}
                >
                  {angle}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Video-Bühne inkl. Telestration, Coach-Badge, Ecken-Overlay, Breakdown-Overlay & Zeichenleiste */}
      <div
        ref={stageRef}
        className={
          istVollbild
            ? 'flex h-screen w-screen flex-col overflow-hidden bg-sl-canvas'
            : 'overflow-hidden rounded-xl border border-sl-border bg-sl-canvas'
        }
      >
        {istVollbild && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-sl-border bg-sl-surface px-4 py-2 text-xs">
            <div className="flex items-center gap-2 text-sl-primary video-tabular">
              <span className="font-semibold text-sl-heading">{aktivesReel.title}</span>
              <span aria-hidden="true">·</span>
              <span>Play #{aktivesPlay.playNumber}</span>
              <span aria-hidden="true">·</span>
              <span>Frame {aktuellerFrame}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-sl-accent">{formatiereFrameTimecode(aktuelleMs)}</span>
            </div>
            <div className="flex items-center gap-1">
              {aktivesReel.angles.map((angle) => {
                const verfuegbar = Boolean(aktivesPlay.sources[angle]);
                return (
                  <button
                    key={angle}
                    type="button"
                    disabled={!verfuegbar}
                    onClick={() => handleWinkelWechsel(angle)}
                    className={`rounded px-2.5 py-1 text-xs font-medium ${
                      aktiverWinkel === angle
                        ? 'bg-sl-accent text-sl-accent-contrast'
                        : verfuegbar
                          ? 'text-sl-primary hover:bg-sl-elevated'
                          : 'cursor-not-allowed text-sl-subtle opacity-40'
                    }`}
                  >
                    {angle}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div
          className={
            istVollbild
              ? 'flex flex-1 min-h-0 w-full items-center justify-center overflow-hidden bg-[#07090C]'
              : 'w-full bg-[#07090C]'
          }
          style={istVollbild ? { containerType: 'size' } : undefined}
        >
          <div
            className="relative aspect-video w-full bg-[#07090C]"
            style={
              istVollbild
                ? { width: 'min(100cqw, calc(100cqh * 16 / 9))' }
                : undefined
            }
          >
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
              visibility={sharingKonfig.enabled ? aktiveZielgruppe : 'ALL_PLAYERS'}
              authorUuid={ctx.benutzer.uuid}
              authorName={ctx.benutzer.vollerName}
              readOnly={!istCoachOderAdmin}
              selectedId={selectedElId}
              onSelect={setSelectedElId}
              onChange={speichereZeichnung}
            />

            {/* Coach-Autoren-Badge in freier Bildecke für Zeichnungen (#1) */}
            {frameTelestration && frameTelestration.elements.length > 0 && (
              <div
                className={`pointer-events-none absolute z-20 inline-flex items-center gap-1.5 rounded-md border border-sl-border bg-sl-canvas/85 px-2.5 py-1 text-[11px] text-sl-primary backdrop-blur-xs ${ECKEN_KLASSEN[freieAutorenEcke]}`}
              >
                <Pencil className="h-3 w-3 text-sl-accent" aria-hidden="true" />
                <span className="font-medium text-sl-heading">
                  {frameZeichnungsAutoren.length > 0
                    ? frameZeichnungsAutoren.join(', ')
                    : 'Coach-Zeichnung'}
                </span>
                <span className="text-sl-muted video-tabular">
                  · {frameTelestration.elements.length}
                </span>
              </div>
            )}

            {/* Kommentar-Overlay in frei wählbarer Bildecke */}
            {frameNotizen.map((notiz) => {
              const notizFarbe =
                notiz.color ??
                (sharingKonfig.enabled
                  ? sharingKonfig.colorMap[notiz.visibility ?? 'ALL_PLAYERS']
                  : undefined);
              return (
                <div
                  key={notiz.id}
                  className={`absolute z-20 w-72 rounded-lg border border-sl-border bg-sl-canvas/90 p-3 backdrop-blur-sm ${ECKEN_KLASSEN[notiz.cornerPosition]}`}
                  style={notizFarbe ? { borderColor: `${notizFarbe}88` } : undefined}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-sl-muted">
                    <span className="inline-flex min-w-0 items-center gap-1.5 truncate font-medium text-sl-accent">
                      {notizFarbe && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: notizFarbe }}
                          aria-hidden="true"
                        />
                      )}
                      <span className="truncate">{notiz.authorName}</span>
                      {sharingKonfig.enabled && (
                        <span className="text-[10px] text-sl-muted">
                          · {gruppenLabel(notiz.visibility)}
                        </span>
                      )}
                      {notiz.status === 'DRAFT' && (
                        <span className="text-[10px] text-sl-muted">· Entwurf</span>
                      )}
                    </span>
                    {istCoachOderAdmin && (
                      <div className="flex items-center gap-1 shrink-0">
                        <select
                          aria-label="Overlay-Ecke wählen"
                          value={notiz.cornerPosition}
                          onChange={(e) =>
                            handleNotizUpdate(notiz, { cornerPosition: e.target.value as EckPosition })
                          }
                          className="rounded border border-sl-border bg-sl-surface px-1 py-0.5 text-[10px] text-sl-primary"
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
                          className="rounded p-0.5 text-sl-muted hover:text-sl-danger-text"
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
                        className="w-full rounded border border-sl-accent bg-sl-surface p-1.5 text-xs text-sl-heading focus:outline-none"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1">
                          <select
                            value={notiz.status}
                            onChange={(e) =>
                              handleNotizUpdate(notiz, { status: e.target.value as NotizStatus })
                            }
                            className="rounded border border-sl-border bg-sl-surface px-1.5 py-0.5 text-[11px] text-sl-primary"
                          >
                            <option value="DRAFT">Entwurf</option>
                            <option value="PUBLISHED">Veröffentlicht</option>
                          </select>
                          {sharingKonfig.enabled && (
                            <select
                              value={notiz.visibility ?? 'ALL_PLAYERS'}
                              onChange={(e) => {
                                const vis = e.target.value as SichtbarkeitsStufe;
                                handleNotizUpdate(notiz, {
                                  visibility: vis,
                                  color: sharingKonfig.colorMap[vis],
                                });
                              }}
                              className="rounded border border-sl-border bg-sl-surface px-1.5 py-0.5 text-[11px] text-sl-primary"
                            >
                              {ANMERKUNGS_ZIELGRUPPEN.map((g) => (
                                <option key={g.id} value={g.id}>
                                  {g.kurzDe}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            await handleNotizUpdate(notiz, { text: notiz.text });
                            setEditNotizId(null);
                          }}
                          className="rounded bg-sl-accent px-2 py-0.5 text-[11px] font-semibold text-sl-accent-contrast hover:bg-sl-accent-hover"
                        >
                          Fertig
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p
                      onClick={() => istCoachOderAdmin && setEditNotizId(notiz.id)}
                      className={`text-xs leading-relaxed text-sl-primary ${
                        istCoachOderAdmin ? 'cursor-text' : ''
                      }`}
                    >
                      {notiz.text}
                    </p>
                  )}
                </div>
              );
            })}

            {/* Vertikales Breakdown-Overlay über dem Video (#6, normal & Vollbild) */}
            {breakdownOverlayOffen && (
              <BreakdownOverlay
                play={aktivesPlay}
                vorherigesPlay={vorherigesPlay}
                schema={schema}
                teamRolle={ctx.aktiveTeamAnsicht}
                erlaubteSpalten={aktivesReel.allowedFields}
                hotkeyLabel={formatiereHotkeyAnzeige(hotkeys.toggleBreakdownOverlay)}
                onClose={() => setBreakdownOverlayOffen(false)}
                onUpdatePlay={handlePlayUpdate}
                onSchemaLearn={handleSchemaLearn}
              />
            )}

            {/* Eingeblendete Zeichenleiste am unteren Videorand (auch im Vollbild) */}
            {istCoachOderAdmin && zeichenBarSichtbar && (
              <div className="absolute bottom-3 left-1/2 z-20 flex max-w-[96%] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-lg border border-sl-border bg-sl-canvas/92 px-2 py-1.5 backdrop-blur-sm">
                {(
                  [
                    { id: 'select', icon: MousePointer, title: 'Auswählen / Verschieben' },
                    { id: 'freehand', icon: Pencil, title: 'Freihand' },
                    { id: 'arrow', icon: ArrowUpRight, title: 'Pfeil' },
                    { id: 'line', icon: Minus, title: 'Linie' },
                    { id: 'block_line', icon: BlockLineIcon, title: 'Block-Linie (T-Ende)' },
                    { id: 'dashed_line', icon: DashedLineIcon, title: 'Gestrichelte Linie' },
                    { id: 'circle', icon: Circle, title: 'Kreis / Zone' },
                    { id: 'spotlight', icon: Highlighter, title: 'Spotlight' },
                    { id: 'text', icon: Type, title: 'Textbox' },
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
                          ? 'bg-sl-accent text-sl-accent-contrast'
                          : 'text-sl-primary hover:bg-sl-elevated'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  );
                })}

                <span className="mx-1 h-4 w-px bg-sl-border" aria-hidden="true" />

                {sharingKonfig.enabled
                  ? ANMERKUNGS_ZIELGRUPPEN.map((gruppe) => {
                      const hex = sharingKonfig.colorMap[gruppe.id];
                      const aktiv = aktiveZielgruppe === gruppe.id;
                      return (
                        <button
                          key={gruppe.id}
                          type="button"
                          title={`Zielgruppe: ${gruppe.labelDe} (${hex})`}
                          onClick={() => {
                            setAktiveZielgruppe(gruppe.id);
                            setNotizZielgruppe(gruppe.id);
                            setFarbe(hex);
                          }}
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors whitespace-nowrap ${
                            aktiv
                              ? 'bg-sl-elevated text-sl-heading ring-1 ring-sl-accent/70'
                              : 'text-sl-muted hover:bg-sl-elevated/60 hover:text-sl-primary'
                          }`}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full border border-black/30 shrink-0"
                            style={{ backgroundColor: hex }}
                            aria-hidden="true"
                          />
                          <span>{gruppe.kurzDe}</span>
                        </button>
                      );
                    })
                  : KLASSISCHE_FARBEN.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Farbe ${c}`}
                        onClick={() => setFarbe(c)}
                        className={`h-4 w-4 rounded-full border ${
                          farbe === c ? 'border-sl-heading scale-110' : 'border-sl-border'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}

                <span className="mx-1 h-4 w-px bg-sl-border" aria-hidden="true" />

                <button
                  type="button"
                  disabled={!selectedElId}
                  title={`Ausgewählte Einzeichnung löschen (${formatiereHotkeyAnzeige(hotkeys.deleteAnnotation)})`}
                  onClick={loescheAusgewaehlteZeichnung}
                  className="rounded-md p-1.5 text-sl-muted hover:bg-sl-danger/15 hover:text-sl-danger-text disabled:opacity-35"
                >
                  <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  title="Letztes Element entfernen"
                  onClick={() => {
                    const aktuell = frameTelestration?.elements ?? [];
                    if (aktuell.length > 0) void speichereZeichnung(aktuell.slice(0, -1));
                  }}
                  className="rounded-md p-1.5 text-sl-muted hover:bg-sl-elevated hover:text-sl-heading"
                >
                  <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  title="Alle Frame-Zeichnungen leeren"
                  onClick={() => {
                    setSelectedElId(null);
                    void speichereZeichnung([]);
                  }}
                  className="rounded-md p-1.5 text-sl-muted hover:bg-sl-danger/15 hover:text-sl-danger-text"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Transportleiste & Hotkey-Leiste (auch im Vollbild immer sichtbar) */}
        <div className="shrink-0 border-t border-sl-border bg-sl-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                title={`Clip-Beginn / Vorheriger Spielzug (${formatiereHotkeyAnzeige(hotkeys.prevPlay)})`}
                onClick={handlePrevPlayOderClipStart}
                className="rounded-md p-1.5 text-sl-primary hover:bg-sl-elevated"
              >
                <SkipBack className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                title={`-1 Frame (${formatiereHotkeyAnzeige(hotkeys.stepBack)})`}
                onClick={() => {
                  setLaeuft(false);
                  springeZuMs(aktuelleMs - FRAME_MS);
                }}
                className="rounded-md p-1.5 text-sl-primary hover:bg-sl-elevated"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                title={`Wiedergabe / Pause (${formatiereHotkeyAnzeige(hotkeys.playPause)})`}
                onClick={() => setLaeuft((v) => !v)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-sl-accent text-sl-accent-contrast hover:bg-sl-accent-hover"
              >
                {laeuft ? (
                  <Pause className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Play className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                title={`+1 Frame (${formatiereHotkeyAnzeige(hotkeys.stepForward)})`}
                onClick={() => {
                  setLaeuft(false);
                  springeZuMs(aktuelleMs + FRAME_MS);
                }}
                className="rounded-md p-1.5 text-sl-primary hover:bg-sl-elevated"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                title={`Nächster Spielzug (${formatiereHotkeyAnzeige(hotkeys.nextPlay)})`}
                onClick={() => {
                  if (aktivesPlayIndex >= 0 && aktivesPlayIndex < sichtbarePlays.length - 1) {
                    handlePlayWechsel(sichtbarePlays[aktivesPlayIndex + 1].id);
                  }
                }}
                className="rounded-md p-1.5 text-sl-primary hover:bg-sl-elevated"
              >
                <SkipForward className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Scrubber inkl. klickbarer Anmerkungs-Marker (#1) */}
            <div className="relative flex flex-1 min-w-[160px] items-center py-2">
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
                className="relative z-10 h-1.5 w-full accent-sl-accent"
              />
              {timelineMarker.map((marker) => {
                const ms = frameIndexZuMs(marker.frameIndex);
                const prozent = Math.min(
                  99,
                  Math.max(1, (ms / Math.max(FRAME_MS, effektiveDauerMs)) * 100)
                );
                const art = [
                  marker.hasDrawing ? 'Zeichnung' : null,
                  marker.hasNote ? 'Notiz' : null,
                ]
                  .filter(Boolean)
                  .join(' & ');
                const autorText = marker.authors.length > 0 ? ` · ${marker.authors.join(', ')}` : '';
                return (
                  <button
                    key={marker.frameIndex}
                    type="button"
                    title={`Frame ${marker.frameIndex} (${formatiereFrameTimecode(ms)}) · ${art}${autorText}`}
                    onClick={() => {
                      setLaeuft(false);
                      videoRef.current?.pause();
                      springeZuMs(ms);
                    }}
                    className="absolute top-0.5 z-20 h-3 w-2 -translate-x-1/2 rounded-xs border border-sl-canvas transition-transform hover:scale-125"
                    style={{
                      left: `${prozent}%`,
                      backgroundColor: marker.primaryColor,
                    }}
                    aria-label={`Zu Anmerkung bei Frame ${marker.frameIndex} springen`}
                  />
                );
              })}
            </div>

            <div className="flex items-center gap-2 text-xs">
              <select
                aria-label="Wiedergabetempo"
                value={tempo}
                onChange={(e) => setTempo(Number(e.target.value))}
                className="rounded border border-sl-border bg-sl-canvas px-2 py-1 text-xs text-sl-primary video-tabular"
              >
                <option value={0.25}>0.25x</option>
                <option value={0.5}>0.5x</option>
                <option value={1}>1.0x</option>
                <option value={1.5}>1.5x</option>
                <option value={2}>2.0x</option>
              </select>
              <label className="inline-flex items-center gap-1.5 text-sl-primary whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={autoStop}
                  onChange={(e) => setAutoStop(e.target.checked)}
                  className="accent-sl-accent"
                />
                {t('autoStop')}
              </label>
              <button
                type="button"
                onClick={toggleBreakdownOverlay}
                title={`${t('breakdownOverlayTitle')} (${formatiereHotkeyAnzeige(hotkeys.toggleBreakdownOverlay)})`}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap ${
                  breakdownOverlayOffen
                    ? 'bg-sl-accent text-sl-accent-contrast'
                    : 'text-sl-primary hover:bg-sl-elevated'
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Breakdown</span>
              </button>
              <button
                type="button"
                onClick={toggleVollbild}
                title={`${istVollbild ? t('exitFullscreen') : t('fullscreen')} (${formatiereHotkeyAnzeige(hotkeys.toggleFullscreen)})`}
                className="rounded-md p-1.5 text-sl-primary hover:bg-sl-elevated"
              >
                {istVollbild ? (
                  <Minimize2 className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Maximize2 className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {/* Hotkey-Leiste (immer sichtbar für schnelle Tastaturbedienung, besonders im Vollbild) */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-sl-border/70 bg-sl-canvas/70 px-4 py-1.5 text-[11px] text-sl-muted">
            {[
              { key: hotkeys.playPause, label: 'Play/Pause' },
              { key: hotkeys.stepBack, label: '-1 Frame' },
              { key: hotkeys.stepForward, label: '+1 Frame' },
              { key: hotkeys.prevPlay, label: 'Clip-Start / Vorheriger' },
              { key: hotkeys.nextPlay, label: 'Nächster Play' },
              { key: hotkeys.toggleBreakdownOverlay, label: 'Breakdown' },
              ...(istCoachOderAdmin
                ? [
                    { key: hotkeys.toggleDraw, label: 'Zeichnen' },
                    { key: hotkeys.deleteAnnotation, label: 'Auswahl löschen' },
                  ]
                : []),
              { key: hotkeys.toggleFullscreen, label: 'Vollbild' },
            ].map((item) => (
              <span key={item.label} className="inline-flex items-center gap-1 whitespace-nowrap">
                <kbd className="rounded border border-sl-border bg-sl-surface px-1.5 py-0.5 font-mono text-[10px] text-sl-heading">
                  {formatiereHotkeyAnzeige(item.key)}
                </kbd>
                <span>{item.label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Schnelle Coach-Notiz am aktuellen Frame */}
      {istCoachOderAdmin && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sl-border bg-sl-surface p-3">
          <MessageSquarePlus className="h-4 w-4 shrink-0 text-sl-accent" aria-hidden="true" />
          {sharingKonfig.enabled && (
            <div className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: sharingKonfig.colorMap[notizZielgruppe] }}
                aria-hidden="true"
              />
              <select
                aria-label="Zielgruppe der Coach-Notiz"
                value={notizZielgruppe}
                onChange={(e) => setNotizZielgruppe(e.target.value as SichtbarkeitsStufe)}
                className="rounded-md border border-sl-border bg-sl-canvas px-2 py-1 text-xs text-sl-heading focus:border-sl-accent focus:outline-none"
              >
                {ANMERKUNGS_ZIELGRUPPEN.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.labelDe}
                  </option>
                ))}
              </select>
            </div>
          )}
          <input
            ref={notizInputRef}
            type="text"
            value={notizEntwurfText}
            onChange={(e) => setNotizEntwurfText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleNotizAnlegen()}
            placeholder={`Coach-Notiz exakt an Frame ${aktuellerFrame} (${formatiereFrameTimecode(aktuelleMs)}) heften...`}
            className="flex-1 min-w-[220px] bg-transparent text-xs text-sl-heading placeholder:text-sl-subtle focus:outline-none"
          />
          <button
            type="button"
            onClick={handleNotizAnlegen}
            className="rounded-md bg-sl-elevated px-3 py-1.5 text-xs font-medium text-sl-heading hover:bg-sl-border-strong whitespace-nowrap shrink-0"
          >
            Notiz anheften
          </button>
        </div>
      )}

      {/* Hudl Breakdown Grid inkl. Anmerkungs-Symbolen (#1) */}
      <BreakdownGrid
        plays={sichtbarePlays}
        aktivesPlayId={aktivesPlay.id}
        schema={schema}
        teamRolle={ctx.aktiveTeamAnsicht}
        erlaubteSpalten={aktivesReel.allowedFields}
        anmerkungenProPlay={playAnmerkungen}
        onSelectPlay={handlePlayWechsel}
        onUpdatePlay={handlePlayUpdate}
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
        onSchemaLearn={handleSchemaLearn}
      />
    </section>
  );
}
