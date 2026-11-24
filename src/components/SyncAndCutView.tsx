import { useEffect, useMemo, useRef, useState } from 'react';
import type { PluginLaufzeitKontext } from '@sidelineos/plugin-sdk';
import { createPluginTranslator } from '@sidelineos/plugin-sdk';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Scissors,
  SlidersHorizontal,
  Undo2,
} from 'lucide-react';
import { useVideoAnalysis } from '../context/VideoAnalysisContext';
import { VIDEO_WOERTERBUCH } from '../i18n/woerterbuch';
import { videoApi } from '../services/apiClient';
import {
  FRAME_MS,
  berechneRestclipZeit,
  bereinigeHotkeyBelegung,
  formatiereFrameTimecode,
  formatiereHotkeyAnzeige,
  normalisiereTaste,
} from '../services/frameAndHotkeys';
import { analysierePlaySyncStatus } from '../services/smartPlaylistEngine';

interface SessionSchnittEintrag {
  playId: string;
  playNumber: number;
  winkel: string;
  startMs: number;
  endMs: number;
  warInitialPlatzhalter?: boolean;
  vorherEndMs?: number;
}

export function SyncAndCutView({ ctx }: { ctx: PluginLaufzeitKontext }) {
  const t = createPluginTranslator(VIDEO_WOERTERBUCH, ctx.locale);
  const { aktivesReel, aktivePlays, userPrefs, aktualisierePlaysLokal } = useVideoAnalysis();

  const masterVideoRef = useRef<HTMLVideoElement | null>(null);
  const slaveVideoRef = useRef<HTMLVideoElement | null>(null);
  const fastCutVideoRef = useRef<HTMLVideoElement | null>(null);
  const syncStageRef = useRef<HTMLDivElement | null>(null);
  const fastCutStageRef = useRef<HTMLDivElement | null>(null);

  const [modus, setModus] = useState<'SYNC' | 'FAST_CUT'>('SYNC');
  const [istVollbild, setIstVollbild] = useState(false);
  const [aktivesPlayId, setAktivesPlayId] = useState<string | null>(
    aktivePlays[0]?.id ?? null
  );
  const [sekundaerWinkel, setSekundaerWinkel] = useState<string>('ENDZONE');

  // Sync-Playback-State
  const [syncLaeuft, setSyncLaeuft] = useState(false);
  const [syncPosMs, setSyncPosMs] = useState(0);
  const [syncDauerMs, setSyncDauerMs] = useState(15000);

  // Fast-Cut-State (Ein-Punkt-Schnitt ab cutStartMs bis Videoende)
  const [fastCutWinkel, setFastCutWinkel] = useState<string>('SIDELINE');
  const [cutStartMs, setCutStartMs] = useState(0);
  const [tapePosMs, setTapePosMs] = useState(0);
  const [tapeDauerMs, setTapeDauerMs] = useState(120000);
  const [tapeSpeed, setTapeSpeed] = useState<number>(0); // -4, -2, 0, 1, 2, 4 (J/K/L)
  const [sessionCuts, setSessionCuts] = useState<SessionSchnittEintrag[]>([]);
  const [statusHinweis, setStatusHinweis] = useState<string | null>(null);

  const hotkeys = useMemo(
    () => bereinigeHotkeyBelegung(userPrefs?.hotkeys),
    [userPrefs?.hotkeys]
  );

  const aktivesPlay = useMemo(
    () => aktivePlays.find((p) => p.id === aktivesPlayId) ?? aktivePlays[0] ?? null,
    [aktivePlays, aktivesPlayId]
  );

  const syncAnalyse = useMemo(() => {
    if (!aktivesReel) return [];
    return analysierePlaySyncStatus(aktivePlays, aktivesReel.angles);
  }, [aktivesReel, aktivePlays]);

  const masterQuelle =
    aktivesPlay?.sources.SIDELINE ??
    (aktivesPlay ? Object.values(aktivesPlay.sources)[0] : undefined);
  const slaveQuelle = aktivesPlay?.sources[sekundaerWinkel];
  const aktuellerOffset = slaveQuelle?.offsetMs ?? 0;

  // Quelle für Fast-Cut (bevorzugt ersten Play mit gewähltem Winkel)
  const fastCutQuelle = useMemo(() => {
    const direkter = aktivesPlay?.sources[fastCutWinkel];
    if (direkter) return direkter;
    for (const p of aktivePlays) {
      if (p.sources[fastCutWinkel]) return p.sources[fastCutWinkel];
    }
    return masterQuelle;
  }, [aktivesPlay, aktivePlays, fastCutWinkel, masterQuelle]);

  useEffect(() => {
    if (aktivePlays.length > 0 && !aktivePlays.some((p) => p.id === aktivesPlayId)) {
      setAktivesPlayId(aktivePlays[0].id);
    }
  }, [aktivePlays, aktivesPlayId]);

  useEffect(() => {
    if (masterQuelle) {
      setSyncDauerMs(Math.max(FRAME_MS, masterQuelle.endMs - masterQuelle.startMs || 15000));
    }
    setSyncLaeuft(false);
    setSyncPosMs(0);
  }, [aktivesPlay?.id, masterQuelle?.streamUrl]);

  // Bei Reel- oder Winkel-Wechsel im Fast-Cut sauber auf Restclip zurücksetzen
  useEffect(() => {
    setSessionCuts([]);
    setTapeSpeed(0);
    // Wenn bereits mehrere Time-Slices für diesen Winkel existieren, beim letzten Schnitt fortsetzen
    const vorhandeneSlices = aktivePlays
      .map((p) => p.sources[fastCutWinkel])
      .filter((s) => s && s.sourceMode === 'TIME_SLICE');
    if (vorhandeneSlices.length > 1) {
      const maxEnd = Math.max(...vorhandeneSlices.map((s) => s?.endMs ?? 0));
      setCutStartMs(maxEnd);
      setTapePosMs(maxEnd);
    } else {
      setCutStartMs(0);
      setTapePosMs(0);
    }
  }, [aktivesReel?.id, fastCutWinkel]);

  useEffect(() => {
    const onFsChange = () => {
      const target = modus === 'SYNC' ? syncStageRef.current : fastCutStageRef.current;
      setIstVollbild(Boolean(target && document.fullscreenElement === target));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [modus]);

  const toggleVollbild = async () => {
    const target = modus === 'SYNC' ? syncStageRef.current : fastCutStageRef.current;
    if (!target) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
    } else {
      await target.requestFullscreen().catch(() => undefined);
    }
  };

  // Echte Sync-Video-Wiedergabe (Master + Sekundär parallel)
  useEffect(() => {
    if (modus !== 'SYNC') return;
    const masterEl = masterVideoRef.current;
    const slaveEl = slaveVideoRef.current;

    if (syncLaeuft) {
      if (masterEl && masterQuelle?.streamUrl) {
        masterEl.playbackRate = 1;
        masterEl.play().catch(() => undefined);
      }
      if (slaveEl && slaveQuelle?.streamUrl) {
        slaveEl.playbackRate = 1;
        slaveEl.play().catch(() => undefined);
      }
    } else {
      masterEl?.pause();
      slaveEl?.pause();
    }
  }, [
    modus,
    syncLaeuft,
    aktivesPlay?.id,
    sekundaerWinkel,
    masterQuelle?.streamUrl,
    slaveQuelle?.streamUrl,
  ]);

  useEffect(() => {
    if (modus !== 'SYNC' || !syncLaeuft) return;
    const id = window.setInterval(() => {
      const masterEl = masterVideoRef.current;
      setSyncPosMs((alt) => {
        const naechste =
          masterEl && masterEl.readyState >= 2 && !masterEl.paused
            ? Math.max(0, masterEl.currentTime * 1000 - (masterQuelle?.startMs ?? 0))
            : alt + FRAME_MS;
        if (naechste >= syncDauerMs || masterEl?.ended) {
          setSyncLaeuft(false);
          return 0;
        }
        return naechste;
      });
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, [modus, syncLaeuft, syncDauerMs, masterQuelle?.startMs]);

  const springeSyncMs = (zielMs: number) => {
    const geclampt = Math.max(0, Math.min(syncDauerMs, Math.round(zielMs / FRAME_MS) * FRAME_MS));
    setSyncPosMs(geclampt);
    if (masterVideoRef.current && masterVideoRef.current.readyState >= 1) {
      masterVideoRef.current.currentTime = Math.max(
        0,
        ((masterQuelle?.startMs ?? 0) + geclampt) / 1000
      );
    }
    if (slaveVideoRef.current && slaveVideoRef.current.readyState >= 1) {
      slaveVideoRef.current.currentTime = Math.max(
        0,
        ((slaveQuelle?.startMs ?? 0) + aktuellerOffset + geclampt) / 1000
      );
    }
  };

  // Echte Fast-Cut-Videosteuerung (J / K / L) begrenzt auf Restclip ab cutStartMs
  useEffect(() => {
    if (modus !== 'FAST_CUT') return;
    const videoEl = fastCutVideoRef.current;
    if (!videoEl || !fastCutQuelle?.streamUrl) return;

    if (tapeSpeed > 0) {
      if (videoEl.readyState >= 1 && videoEl.currentTime * 1000 < cutStartMs) {
        videoEl.currentTime = cutStartMs / 1000;
      }
      videoEl.playbackRate = tapeSpeed;
      videoEl.play().catch(() => undefined);
    } else {
      videoEl.pause();
    }
  }, [modus, tapeSpeed, cutStartMs, fastCutQuelle?.streamUrl]);

  useEffect(() => {
    if (modus !== 'FAST_CUT' || tapeSpeed === 0) return;
    const id = window.setInterval(() => {
      const videoEl = fastCutVideoRef.current;
      if (tapeSpeed > 0 && videoEl && fastCutQuelle?.streamUrl) {
        if (videoEl.readyState >= 2 && !videoEl.paused) {
          const ms = Math.max(cutStartMs, Math.round(videoEl.currentTime * 1000));
          setTapePosMs(ms);
        }
        if (videoEl.ended) {
          setTapeSpeed(0);
        }
      } else {
        setTapePosMs((alt) => {
          const next = Math.max(
            cutStartMs,
            Math.min(tapeDauerMs, alt + tapeSpeed * FRAME_MS * 2)
          );
          if (videoEl && videoEl.readyState >= 1) {
            videoEl.currentTime = next / 1000;
          }
          if (next <= cutStartMs && tapeSpeed < 0) {
            setTapeSpeed(0);
          }
          return next;
        });
      }
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, [modus, tapeSpeed, cutStartMs, fastCutQuelle?.streamUrl, tapeDauerMs]);

  const springeFastCutMs = (zielMs: number) => {
    const rest = berechneRestclipZeit(zielMs, cutStartMs, tapeDauerMs);
    setTapePosMs(rest.geclamptAbsMs);
    if (fastCutVideoRef.current && fastCutVideoRef.current.readyState >= 1) {
      fastCutVideoRef.current.currentTime = rest.geclamptAbsMs / 1000;
    }
  };

  const setzeEinPunktSchnitt = async () => {
    if (!aktivesReel) return;
    const zielEndMs = Math.round(tapePosMs / FRAME_MS) * FRAME_MS;
    if (zielEndMs <= cutStartMs + FRAME_MS) {
      setStatusHinweis('Schnitt-Position muss hinter dem aktuellen Clip-Beginn liegen.');
      return;
    }
    const basisSrc = fastCutQuelle ?? masterQuelle;
    const zielWinkel = basisSrc?.angleCode ?? fastCutWinkel;

    // Prüfen, ob Play #1 noch der ungeschnittene Upload-Platzhalter [0 .. volle Länge] ist
    const ersterPlay = aktivePlays[0];
    const ersterSrc = ersterPlay?.sources[zielWinkel];
    const istInitialPlatzhalter =
      aktivePlays.length === 1 &&
      sessionCuts.length === 0 &&
      cutStartMs === 0 &&
      ersterSrc?.sourceMode === 'TIME_SLICE' &&
      ersterSrc.startMs === 0;

    if (istInitialPlatzhalter && ersterPlay && ersterSrc) {
      const vorherEndMs = ersterSrc.endMs;
      await videoApi.aktualisierePlay(ctx.team.id, ersterPlay.id, {
        angleOffsets: {
          [zielWinkel]: {
            startMs: 0,
            endMs: zielEndMs,
            offsetMs: null,
          },
        },
      });
      aktualisierePlaysLokal((alt) =>
        alt.map((p) =>
          p.id === ersterPlay.id
            ? {
                ...p,
                sources: {
                  ...p.sources,
                  [zielWinkel]: { ...ersterSrc, startMs: 0, endMs: zielEndMs },
                },
              }
            : p
        )
      );
      setSessionCuts((alt) => [
        ...alt,
        {
          playId: ersterPlay.id,
          playNumber: ersterPlay.playNumber,
          winkel: zielWinkel,
          startMs: 0,
          endMs: zielEndMs,
          warInitialPlatzhalter: true,
          vorherEndMs,
        },
      ]);
      setCutStartMs(zielEndMs);
      setTapePosMs(zielEndMs);
      setStatusHinweis(
        `Spielzug #${ersterPlay.playNumber} (${formatiereFrameTimecode(0)} – ${formatiereFrameTimecode(zielEndMs)}) geschnitten.`
      );
      return;
    }

    const nextNr = aktivePlays.reduce((m, p) => Math.max(m, p.playNumber), 0) + 1;
    const res = await videoApi.erstellePlay(ctx.team.id, aktivesReel.id, {
      playNumber: nextNr,
      breakdown: { odk: 'O', play_number: nextNr },
      sources: basisSrc
        ? {
            [zielWinkel]: {
              fileName: basisSrc.fileName,
              s3Key: basisSrc.s3Key,
              sourceMode: 'TIME_SLICE',
              startMs: cutStartMs,
              endMs: zielEndMs,
            },
          }
        : undefined,
    });
    aktualisierePlaysLokal((alt) => [
      ...alt,
      {
        id: res.id,
        reelId: aktivesReel.id,
        playNumber: nextNr,
        sortOrder: nextNr,
        breakdown: { odk: 'O', play_number: nextNr },
        sources: basisSrc
          ? {
              [zielWinkel]: {
                ...basisSrc,
                id: `ang-${Date.now()}`,
                sourceMode: 'TIME_SLICE',
                startMs: cutStartMs,
                endMs: zielEndMs,
                offsetMs: null,
              },
            }
          : {},
      },
    ]);
    setSessionCuts((alt) => [
      ...alt,
      {
        playId: res.id,
        playNumber: nextNr,
        winkel: zielWinkel,
        startMs: cutStartMs,
        endMs: zielEndMs,
      },
    ]);
    setCutStartMs(zielEndMs);
    setTapePosMs(zielEndMs);
    setStatusHinweis(
      `Spielzug #${nextNr} (${formatiereFrameTimecode(cutStartMs)} – ${formatiereFrameTimecode(zielEndMs)}) übernommen.`
    );
  };

  const letztenSchnittRueckgaengig = async () => {
    const letzter = sessionCuts[sessionCuts.length - 1];
    if (!letzter) return;

    setTapeSpeed(0);
    if (letzter.warInitialPlatzhalter) {
      const resetEnd = letzter.vorherEndMs ?? tapeDauerMs;
      await videoApi.aktualisierePlay(ctx.team.id, letzter.playId, {
        angleOffsets: {
          [letzter.winkel]: { startMs: 0, endMs: resetEnd, offsetMs: null },
        },
      });
      aktualisierePlaysLokal((alt) =>
        alt.map((p) => {
          if (p.id !== letzter.playId) return p;
          const src = p.sources[letzter.winkel];
          if (!src) return p;
          return {
            ...p,
            sources: {
              ...p.sources,
              [letzter.winkel]: { ...src, startMs: 0, endMs: resetEnd },
            },
          };
        })
      );
    } else {
      await videoApi.loeschePlay(ctx.team.id, letzter.playId);
      aktualisierePlaysLokal((alt) => alt.filter((p) => p.id !== letzter.playId));
    }

    setSessionCuts((alt) => alt.slice(0, -1));
    setCutStartMs(letzter.startMs);
    setTapePosMs(letzter.startMs);
    if (fastCutVideoRef.current && fastCutVideoRef.current.readyState >= 1) {
      fastCutVideoRef.current.currentTime = letzter.startMs / 1000;
    }
    setStatusHinweis(`Schnitt #${letzter.playNumber} rückgängig gemacht.`);
  };

  // Tastenkürzel für SYNC und FAST_CUT inkl. Vollbild-Hotkey
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const taste = normalisiereTaste(e.code || e.key);

      if (taste === hotkeys.toggleFullscreen) {
        e.preventDefault();
        toggleVollbild();
        return;
      }

      if (modus === 'SYNC') {
        if (taste === hotkeys.playPause) {
          e.preventDefault();
          setSyncLaeuft((v) => !v);
        } else if (taste === hotkeys.stepBack) {
          e.preventDefault();
          setSyncLaeuft(false);
          springeSyncMs(syncPosMs - FRAME_MS);
        } else if (taste === hotkeys.stepForward) {
          e.preventDefault();
          setSyncLaeuft(false);
          springeSyncMs(syncPosMs + FRAME_MS);
        }
        return;
      }

      if (taste === hotkeys.fastCutReverse) {
        e.preventDefault();
        setTapeSpeed((s) => (s <= -2 ? -4 : -2));
      } else if (taste === hotkeys.fastCutPause || taste === hotkeys.playPause) {
        e.preventDefault();
        setTapeSpeed((s) => (taste === hotkeys.playPause && s === 0 ? 1 : 0));
      } else if (taste === hotkeys.fastCutForward) {
        e.preventDefault();
        setTapeSpeed((s) => (s >= 2 ? 4 : s >= 1 ? 2 : 1));
      } else if (taste === hotkeys.stepBack) {
        e.preventDefault();
        setTapeSpeed(0);
        springeFastCutMs(tapePosMs - FRAME_MS);
      } else if (taste === hotkeys.stepForward) {
        e.preventDefault();
        setTapeSpeed(0);
        springeFastCutMs(tapePosMs + FRAME_MS);
      } else if (taste === hotkeys.markCut) {
        e.preventDefault();
        setzeEinPunktSchnitt();
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

  const speichereOffset = async (neuerOffsetMs: number) => {
    if (!slaveQuelle) return;
    aktualisierePlaysLokal((alt) =>
      alt.map((p) =>
        p.id === aktivesPlay.id
          ? {
              ...p,
              sources: {
                ...p.sources,
                [sekundaerWinkel]: { ...slaveQuelle, offsetMs: neuerOffsetMs },
              },
            }
          : p
      )
    );
    if (slaveVideoRef.current && slaveVideoRef.current.readyState >= 1) {
      slaveVideoRef.current.currentTime = Math.max(
        0,
        ((slaveQuelle.startMs ?? 0) + neuerOffsetMs + syncPosMs) / 1000
      );
    }
    await videoApi.aktualisierePlay(ctx.team.id, aktivesPlay.id, {
      angleOffsets: { [sekundaerWinkel]: { offsetMs: neuerOffsetMs } },
    });
    setStatusHinweis(`Offset für ${sekundaerWinkel} auf ${neuerOffsetMs} ms gespeichert.`);
  };

  const restClip = berechneRestclipZeit(tapePosMs, cutStartMs, tapeDauerMs);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white">{t('syncTitle')}</h1>
          <p className="text-xs text-[#8B949E]">
            {aktivesReel.title} · Dual-Viewport-Abgleich (optionaler Offset) &amp; Ein-Punkt-Fast-Cut
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-[#232933] bg-[#13171D] p-1">
          <button
            type="button"
            onClick={() => {
              setTapeSpeed(0);
              setModus('SYNC');
            }}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
              modus === 'SYNC' ? 'bg-[#F59E0B] text-[#0B0E11]' : 'text-[#8B949E] hover:text-white'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            Multi-Angle Sync
          </button>
          <button
            type="button"
            onClick={() => {
              setSyncLaeuft(false);
              setModus('FAST_CUT');
            }}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
              modus === 'FAST_CUT'
                ? 'bg-[#F59E0B] text-[#0B0E11]'
                : 'text-[#8B949E] hover:text-white'
            }`}
          >
            <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
            Fast-Cut ({formatiereHotkeyAnzeige(hotkeys.markCut)} / J-K-L)
          </button>
        </div>
      </header>

      {statusHinweis && (
        <div className="flex items-center gap-2 rounded-lg border border-[#232933] bg-[#13171D] px-4 py-2.5 text-xs text-[#F59E0B]">
          <Check className="h-4 w-4" aria-hidden="true" />
          {statusHinweis}
        </div>
      )}

      {modus === 'SYNC' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div
            ref={syncStageRef}
            className={
              istVollbild
                ? 'flex h-screen w-screen flex-col gap-3 overflow-hidden bg-[#0B0E11] p-4'
                : 'space-y-4 lg:col-span-8'
            }
          >
            {istVollbild && (
              <div className="flex shrink-0 items-center justify-between rounded-lg border border-[#232933] bg-[#13171D] px-4 py-2 text-xs">
                <span className="font-semibold text-white">
                  {aktivesReel.title} · Play #{aktivesPlay.playNumber}
                </span>
                <span className="font-mono text-[#F59E0B] video-tabular">
                  {formatiereFrameTimecode(syncPosMs)} · Offset {aktuellerOffset} ms
                </span>
              </div>
            )}

            <div
              className={
                istVollbild
                  ? 'grid flex-1 min-h-0 grid-cols-1 gap-4 md:grid-cols-2'
                  : 'grid grid-cols-1 gap-4 md:grid-cols-2'
              }
            >
              {/* Master-Viewport */}
              <div
                className={`rounded-xl border border-[#232933] bg-[#13171D] p-3 ${
                  istVollbild ? 'flex min-h-0 flex-col gap-2' : 'space-y-2'
                }`}
              >
                <div className="flex shrink-0 items-center justify-between text-xs">
                  <span className="font-semibold text-white">
                    Master: {masterQuelle?.angleCode ?? 'SIDELINE'}
                  </span>
                  <span className="font-mono text-[#8B949E] video-tabular">0 ms Basis</span>
                </div>
                <div
                  className={`flex items-center justify-center overflow-hidden rounded-lg bg-[#07090C] font-mono text-xs text-[#8B949E] ${
                    istVollbild ? 'flex-1 min-h-0' : 'aspect-video'
                  }`}
                >
                  {masterQuelle?.streamUrl ? (
                    <video
                      key={`sync-master-${aktivesPlay.id}-${masterQuelle.streamUrl}`}
                      ref={masterVideoRef}
                      src={masterQuelle.streamUrl}
                      preload="auto"
                      playsInline
                      muted
                      onLoadedMetadata={(e) => {
                        const v = e.currentTarget;
                        if (
                          masterQuelle.sourceMode === 'CLIP_FILE' &&
                          Number.isFinite(v.duration) &&
                          v.duration > 0
                        ) {
                          setSyncDauerMs(Math.round(v.duration * 1000));
                        }
                        const startSek = Math.max(0, (masterQuelle.startMs + syncPosMs) / 1000);
                        if (startSek > 0) {
                          v.currentTime = startSek;
                        }
                        if (syncLaeuft && v.paused) {
                          v.playbackRate = 1;
                          v.play().catch(() => undefined);
                        }
                      }}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <span>{masterQuelle?.fileName ?? 'Kein Master-Clip'}</span>
                  )}
                </div>
              </div>

              {/* Sekundärer Viewport */}
              <div
                className={`rounded-xl border border-[#232933] bg-[#13171D] p-3 ${
                  istVollbild ? 'flex min-h-0 flex-col gap-2' : 'space-y-2'
                }`}
              >
                <div className="flex shrink-0 items-center justify-between text-xs">
                  <select
                    value={sekundaerWinkel}
                    onChange={(e) => setSekundaerWinkel(e.target.value)}
                    className="rounded border border-[#232933] bg-[#0B0E11] px-2 py-0.5 text-xs font-semibold text-white"
                  >
                    {aktivesReel.angles
                      .filter((a) => a !== (masterQuelle?.angleCode ?? 'SIDELINE'))
                      .concat(['ENDZONE', 'TIGHT'])
                      .filter((v, idx, arr) => arr.indexOf(v) === idx)
                      .map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                  </select>
                  <span className="font-mono text-[#F59E0B] video-tabular">
                    Offset: {aktuellerOffset} ms
                  </span>
                </div>
                <div
                  className={`flex items-center justify-center overflow-hidden rounded-lg bg-[#07090C] font-mono text-xs text-[#8B949E] ${
                    istVollbild ? 'flex-1 min-h-0' : 'aspect-video'
                  }`}
                >
                  {slaveQuelle?.streamUrl ? (
                    <video
                      key={`sync-slave-${aktivesPlay.id}-${sekundaerWinkel}-${slaveQuelle.streamUrl}`}
                      ref={slaveVideoRef}
                      src={slaveQuelle.streamUrl}
                      preload="auto"
                      playsInline
                      muted
                      onLoadedMetadata={(e) => {
                        const v = e.currentTarget;
                        v.currentTime = Math.max(
                          0,
                          ((slaveQuelle.startMs ?? 0) + aktuellerOffset + syncPosMs) / 1000
                        );
                        if (syncLaeuft && v.paused) {
                          v.playbackRate = 1;
                          v.play().catch(() => undefined);
                        }
                      }}
                      className="h-full w-full object-contain"
                    />
                  ) : slaveQuelle ? (
                    <span>{slaveQuelle.fileName}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-amber-300">
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                      Fehlender Winkel (Lücke)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Synchronisierte Kontrollleiste + Offset + Hotkeys (im Vollbild immer unten sichtbar) */}
            <div className="shrink-0 overflow-hidden rounded-xl border border-[#232933] bg-[#13171D]">
              <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title={`-1 Frame (${formatiereHotkeyAnzeige(hotkeys.stepBack)})`}
                    onClick={() => {
                      setSyncLaeuft(false);
                      springeSyncMs(syncPosMs - FRAME_MS);
                    }}
                    className="rounded-md p-1.5 text-[#E6EDF3] hover:bg-[#232933]"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    title={`Play / Pause (${formatiereHotkeyAnzeige(hotkeys.playPause)})`}
                    onClick={() => setSyncLaeuft((v) => !v)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#F59E0B] text-[#0B0E11] hover:bg-[#FBBF24]"
                  >
                    {syncLaeuft ? (
                      <Pause className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Play className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    title={`+1 Frame (${formatiereHotkeyAnzeige(hotkeys.stepForward)})`}
                    onClick={() => {
                      setSyncLaeuft(false);
                      springeSyncMs(syncPosMs + FRAME_MS);
                    }}
                    className="rounded-md p-1.5 text-[#E6EDF3] hover:bg-[#232933]"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(FRAME_MS, syncDauerMs)}
                  step={FRAME_MS}
                  value={Math.min(syncPosMs, Math.max(FRAME_MS, syncDauerMs))}
                  onChange={(e) => {
                    setSyncLaeuft(false);
                    springeSyncMs(Number(e.target.value));
                  }}
                  className="h-1.5 flex-1 min-w-[140px] accent-[#F59E0B]"
                />
                <span className="font-mono text-xs text-[#8B949E] video-tabular">
                  {formatiereFrameTimecode(syncPosMs)}
                </span>
                <button
                  type="button"
                  onClick={toggleVollbild}
                  title={`${istVollbild ? t('exitFullscreen') : t('fullscreen')} (${formatiereHotkeyAnzeige(hotkeys.toggleFullscreen)})`}
                  className="rounded-md p-1.5 text-[#E6EDF3] hover:bg-[#232933]"
                >
                  {istVollbild ? (
                    <Minimize2 className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Maximize2 className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>

              {slaveQuelle && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#232933] px-4 py-2.5">
                  <div className="text-xs text-[#8B949E]">
                    Play #{aktivesPlay.playNumber} · Frame-Feinabgleich
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[-200, -40, 40, 200].map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        onClick={() => speichereOffset(aktuellerOffset + delta)}
                        className="rounded-md border border-[#232933] bg-[#0B0E11] px-2.5 py-1 font-mono text-xs text-[#E6EDF3] hover:border-[#F59E0B] video-tabular"
                      >
                        {delta > 0 ? `+${delta}` : delta} ms
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => speichereOffset(0)}
                      className="rounded-md bg-[#232933] px-3 py-1 text-xs font-medium text-white hover:bg-[#36404F]"
                    >
                      Offset zurücksetzen (0)
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#232933]/70 bg-[#0B0E11]/70 px-4 py-1.5 text-[11px] text-[#8B949E]">
                {[
                  { key: hotkeys.playPause, label: 'Play/Pause' },
                  { key: hotkeys.stepBack, label: '-1 Frame' },
                  { key: hotkeys.stepForward, label: '+1 Frame' },
                  { key: hotkeys.toggleFullscreen, label: 'Vollbild' },
                ].map((item) => (
                  <span key={item.label} className="inline-flex items-center gap-1 whitespace-nowrap">
                    <kbd className="rounded border border-[#232933] bg-[#13171D] px-1.5 py-0.5 font-mono text-[10px] text-white">
                      {formatiereHotkeyAnzeige(item.key)}
                    </kbd>
                    <span>{item.label}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Play-Lücken- & Offset-Übersicht */}
          <div className="rounded-xl border border-[#232933] bg-[#13171D] p-4 space-y-3 lg:col-span-4">
            <h2 className="text-sm font-semibold text-white">Play-Abgleich &amp; Lücken</h2>
            <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
              {syncAnalyse.map((item) => (
                <button
                  key={item.playId}
                  type="button"
                  onClick={() => setAktivesPlayId(item.playId)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    item.playId === aktivesPlay.id
                      ? 'border-[#F59E0B] bg-[#F59E0B]/10 text-white'
                      : 'border-[#232933] bg-[#0B0E11] text-[#E6EDF3] hover:border-[#36404F]'
                  }`}
                >
                  <span className="font-mono font-semibold video-tabular">
                    Play #{item.playNumber}
                  </span>
                  <span className="text-[#8B949E]">
                    {item.fehlendeWinkel.length > 0
                      ? `Fehlt: ${item.fehlendeWinkel.join(', ')}`
                      : item.hatOffset
                        ? 'Synchronisiert (Offset)'
                        : 'Vollständig'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div
          ref={fastCutStageRef}
          className={
            istVollbild
              ? 'flex h-screen w-screen flex-col gap-3 overflow-hidden bg-[#0B0E11] p-4'
              : 'space-y-4 rounded-xl border border-[#232933] bg-[#13171D] p-5'
          }
        >
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-white">
                  Ein-Punkt Fast-Cut-Timeline
                </h2>
                {cutStartMs > 0 && (
                  <span className="rounded border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-2 py-0.5 font-mono text-[11px] text-[#F59E0B] video-tabular">
                    Restclip ab {formatiereFrameTimecode(cutStartMs)}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#8B949E]">
                Schnittbereich zählt automatisch ab{' '}
                <span className="font-mono text-white">
                  {cutStartMs === 0 ? 'Videobeginn' : formatiereFrameTimecode(cutStartMs)}
                </span>{' '}
                bis zur gesetzten Markierung.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <select
                aria-label="Kamerawinkel für Fast-Cut"
                value={fastCutWinkel}
                onChange={(e) => {
                  setTapeSpeed(0);
                  setFastCutWinkel(e.target.value);
                }}
                className="rounded-md border border-[#232933] bg-[#0B0E11] px-2.5 py-1 text-xs text-white"
              >
                {aktivesReel.angles.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <div className="font-mono text-sm text-[#F59E0B] video-tabular">
                {formatiereFrameTimecode(restClip.relativMs)} / {formatiereFrameTimecode(restClip.dauerMs)} ({tapeSpeed}x)
              </div>
              <button
                type="button"
                onClick={toggleVollbild}
                title={`${istVollbild ? t('exitFullscreen') : t('fullscreen')} (${formatiereHotkeyAnzeige(hotkeys.toggleFullscreen)})`}
                className="rounded-md border border-[#232933] bg-[#0B0E11] p-1.5 text-[#E6EDF3] hover:border-[#F59E0B]"
              >
                {istVollbild ? (
                  <Minimize2 className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Maximize2 className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {/* Fast-Cut Video-Viewport */}
          <div
            className={`flex items-center justify-center overflow-hidden rounded-lg border border-[#232933] bg-[#07090C] ${
              istVollbild ? 'flex-1 min-h-0 w-full' : 'aspect-video w-full'
            }`}
          >
            {fastCutQuelle?.streamUrl ? (
              <video
                key={`fastcut-${fastCutWinkel}-${fastCutQuelle.streamUrl}`}
                ref={fastCutVideoRef}
                src={fastCutQuelle.streamUrl}
                preload="auto"
                playsInline
                muted
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (Number.isFinite(v.duration) && v.duration > 0) {
                    setTapeDauerMs(Math.round(v.duration * 1000));
                  }
                  const zielMs = Math.max(cutStartMs, tapePosMs);
                  if (zielMs > 0) {
                    v.currentTime = zielMs / 1000;
                  }
                  if (tapeSpeed > 0 && v.paused) {
                    v.playbackRate = tapeSpeed;
                    v.play().catch(() => undefined);
                  }
                }}
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="font-mono text-xs text-[#8B949E]">
                {fastCutQuelle?.fileName ?? 'Keine Videodatei für Fast-Cut geladen'}
              </span>
            )}
          </div>

          {/* Kontrollleiste + Schnitt-Markierung + Hotkeys (im Vollbild immer unten sichtbar) */}
          <div className="shrink-0 space-y-3 rounded-xl border border-[#232933] bg-[#13171D] p-3">
            <input
              type="range"
              min={restClip.startMs}
              max={Math.max(restClip.startMs + FRAME_MS, tapeDauerMs)}
              step={FRAME_MS}
              value={restClip.geclamptAbsMs}
              onChange={(e) => {
                setTapeSpeed(0);
                springeFastCutMs(Number(e.target.value));
              }}
              className="w-full accent-[#F59E0B]"
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTapeSpeed((s) => (s <= -2 ? -4 : -2))}
                  className="rounded-md border border-[#232933] bg-[#0B0E11] px-3 py-1.5 text-xs text-white hover:border-[#F59E0B]"
                >
                  {formatiereHotkeyAnzeige(hotkeys.fastCutReverse)} (-2x)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTapeSpeed(0);
                    springeFastCutMs(tapePosMs - FRAME_MS);
                  }}
                  title={`-1 Frame (${formatiereHotkeyAnzeige(hotkeys.stepBack)})`}
                  className="rounded-md border border-[#232933] bg-[#0B0E11] p-1.5 text-[#E6EDF3] hover:border-[#F59E0B]"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setTapeSpeed(0)}
                  className="inline-flex items-center gap-1 rounded-md border border-[#232933] bg-[#0B0E11] px-3 py-1.5 text-xs text-white hover:border-[#F59E0B]"
                >
                  <Pause className="h-3.5 w-3.5" aria-hidden="true" />{' '}
                  {formatiereHotkeyAnzeige(hotkeys.fastCutPause)}
                </button>
                <button
                  type="button"
                  onClick={() => setTapeSpeed(1)}
                  className="inline-flex items-center gap-1 rounded-md border border-[#232933] bg-[#0B0E11] px-3 py-1.5 text-xs text-white hover:border-[#F59E0B]"
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />{' '}
                  {formatiereHotkeyAnzeige(hotkeys.fastCutForward)} (1x)
                </button>
                <button
                  type="button"
                  onClick={() => setTapeSpeed(2)}
                  className="rounded-md border border-[#232933] bg-[#0B0E11] px-3 py-1.5 text-xs text-white hover:border-[#F59E0B]"
                >
                  {formatiereHotkeyAnzeige(hotkeys.fastCutForward)} (+2x)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTapeSpeed(0);
                    springeFastCutMs(tapePosMs + FRAME_MS);
                  }}
                  title={`+1 Frame (${formatiereHotkeyAnzeige(hotkeys.stepForward)})`}
                  className="rounded-md border border-[#232933] bg-[#0B0E11] p-1.5 text-[#E6EDF3] hover:border-[#F59E0B]"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                {sessionCuts.length > 0 && (
                  <button
                    type="button"
                    onClick={letztenSchnittRueckgaengig}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#232933] bg-[#0B0E11] px-3 py-1.5 text-xs text-[#E6EDF3] hover:border-[#F59E0B]"
                  >
                    <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Letzten Schnitt rückgängig
                  </button>
                )}
                <button
                  type="button"
                  onClick={setzeEinPunktSchnitt}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#F59E0B] px-4 py-1.5 text-xs font-semibold text-[#0B0E11] hover:bg-[#FBBF24] video-tabular"
                >
                  <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
                  Schnitt setzen ({formatiereHotkeyAnzeige(hotkeys.markCut)}) · +{formatiereFrameTimecode(restClip.relativMs)}
                </button>
              </div>
            </div>

            {sessionCuts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-[#232933]/70 pt-2 text-[11px]">
                <span className="text-[#8B949E]">Geschnitten:</span>
                {sessionCuts.map((c) => (
                  <span
                    key={c.playId}
                    className="rounded border border-[#232933] bg-[#0B0E11] px-2 py-0.5 font-mono text-[#E6EDF3] video-tabular"
                  >
                    #{c.playNumber} ({formatiereFrameTimecode(c.startMs)}–{formatiereFrameTimecode(c.endMs)})
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#232933]/70 pt-2 text-[11px] text-[#8B949E]">
              {[
                { key: hotkeys.fastCutReverse, label: 'Rückwärts' },
                { key: hotkeys.fastCutPause, label: 'Pause' },
                { key: hotkeys.fastCutForward, label: 'Vorwärts (1x/2x/4x)' },
                { key: hotkeys.stepBack, label: '-1 Frame' },
                { key: hotkeys.stepForward, label: '+1 Frame' },
                { key: hotkeys.markCut, label: 'Schnitt setzen' },
                { key: hotkeys.toggleFullscreen, label: 'Vollbild' },
              ].map((item) => (
                <span key={item.label} className="inline-flex items-center gap-1 whitespace-nowrap">
                  <kbd className="rounded border border-[#232933] bg-[#0B0E11] px-1.5 py-0.5 font-mono text-[10px] text-white">
                    {formatiereHotkeyAnzeige(item.key)}
                  </kbd>
                  <span>{item.label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
