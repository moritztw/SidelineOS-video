import { useEffect, useMemo, useState } from 'react';
import type { PluginLaufzeitKontext } from '@sidelineos/plugin-sdk';
import { createPluginTranslator } from '@sidelineos/plugin-sdk';
import { AlertTriangle, Check, Pause, Play, Scissors, SlidersHorizontal } from 'lucide-react';
import { useVideoAnalysis } from '../context/VideoAnalysisContext';
import { VIDEO_WOERTERBUCH } from '../i18n/woerterbuch';
import { videoApi } from '../services/apiClient';
import { FRAME_MS, STANDARD_HOTKEYS, formatiereFrameTimecode, normalisiereTaste } from '../services/frameAndHotkeys';
import { analysierePlaySyncStatus } from '../services/smartPlaylistEngine';

export function SyncAndCutView({ ctx }: { ctx: PluginLaufzeitKontext }) {
  const t = createPluginTranslator(VIDEO_WOERTERBUCH, ctx.locale);
  const { aktivesReel, aktivePlays, userPrefs, aktualisierePlaysLokal } = useVideoAnalysis();

  const [modus, setModus] = useState<'SYNC' | 'FAST_CUT'>('SYNC');
  const [aktivesPlayId, setAktivesPlayId] = useState<string | null>(
    aktivePlays[0]?.id ?? null
  );
  const [sekundaerWinkel, setSekundaerWinkel] = useState<string>('ENDZONE');
  const [tapePosMs, setTapePosMs] = useState(0);
  const [tapeSpeed, setTapeSpeed] = useState<number>(0); // -2, 0, 1, 2 (J/K/L)
  const [inMs, setInMs] = useState<number | null>(null);
  const [outMs, setOutMs] = useState<number | null>(null);
  const [statusHinweis, setStatusHinweis] = useState<string | null>(null);

  const aktivesPlay = useMemo(
    () => aktivePlays.find((p) => p.id === aktivesPlayId) ?? aktivePlays[0] ?? null,
    [aktivePlays, aktivesPlayId]
  );

  const syncAnalyse = useMemo(() => {
    if (!aktivesReel) return [];
    return analysierePlaySyncStatus(aktivePlays, aktivesReel.angles);
  }, [aktivesReel, aktivePlays]);

  // Fast-Cut Transport-Loop (J / K / L)
  useEffect(() => {
    if (modus !== 'FAST_CUT' || tapeSpeed === 0) return;
    const id = window.setInterval(() => {
      setTapePosMs((alt) => Math.max(0, alt + tapeSpeed * FRAME_MS * 2));
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, [modus, tapeSpeed]);

  // Fast-Cut Tastenkürzel (I / O / J-K-L)
  useEffect(() => {
    if (modus !== 'FAST_CUT') return;
    const hotkeys = userPrefs?.hotkeys ?? STANDARD_HOTKEYS;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const taste = normalisiereTaste(e.code || e.key);
      if (taste === hotkeys.fastCutReverse) {
        e.preventDefault();
        setTapeSpeed((s) => (s <= -2 ? -4 : -2));
      } else if (taste === hotkeys.fastCutPause) {
        e.preventDefault();
        setTapeSpeed(0);
      } else if (taste === hotkeys.fastCutForward) {
        e.preventDefault();
        setTapeSpeed((s) => (s >= 2 ? 4 : 2));
      } else if (taste === hotkeys.markIn) {
        e.preventDefault();
        setInMs(tapePosMs);
      } else if (taste === hotkeys.markOut) {
        e.preventDefault();
        setOutMs(tapePosMs);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modus, tapePosMs, userPrefs?.hotkeys]);

  if (!aktivesReel || !aktivesPlay) {
    return (
      <div className="rounded-xl border border-[#232933] bg-[#13171D] p-10 text-center text-sm text-[#8B949E]">
        {t('filmRoomEmpty')}
      </div>
    );
  }

  const masterQuelle = aktivesPlay.sources.SIDELINE ?? Object.values(aktivesPlay.sources)[0];
  const slaveQuelle = aktivesPlay.sources[sekundaerWinkel];
  const aktuellerOffset = slaveQuelle?.offsetMs ?? 0;

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
    await videoApi.aktualisierePlay(ctx.team.id, aktivesPlay.id, {
      angleOffsets: { [sekundaerWinkel]: { offsetMs: neuerOffsetMs } },
    });
    setStatusHinweis(`Offset für ${sekundaerWinkel} auf ${neuerOffsetMs} ms gespeichert.`);
  };

  const erstelleFastCutPlay = async () => {
    if (inMs === null || outMs === null || outMs <= inMs) {
      setStatusHinweis('Out-Punkt (O) muss nach dem In-Punkt (I) liegen.');
      return;
    }
    const nextNr = aktivePlays.reduce((m, p) => Math.max(m, p.playNumber), 0) + 1;
    const basisSrc = masterQuelle;
    const res = await videoApi.erstellePlay(ctx.team.id, aktivesReel.id, {
      playNumber: nextNr,
      breakdown: { odk: 'O', play_number: nextNr },
      sources: basisSrc
        ? {
            [basisSrc.angleCode]: {
              fileName: basisSrc.fileName,
              s3Key: basisSrc.s3Key,
              sourceMode: 'TIME_SLICE',
              startMs: inMs,
              endMs: outMs,
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
              [basisSrc.angleCode]: {
                ...basisSrc,
                id: `ang-${Date.now()}`,
                sourceMode: 'TIME_SLICE',
                startMs: inMs,
                endMs: outMs,
                offsetMs: null,
              },
            }
          : {},
      },
    ]);
    setInMs(outMs);
    setOutMs(null);
    setStatusHinweis(`Spielzug #${nextNr} aus Time-Slice erstellt.`);
  };

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white">{t('syncTitle')}</h1>
          <p className="text-xs text-[#8B949E]">
            {aktivesReel.title} · Dual-Viewport-Abgleich (optionaler Offset) &amp; Fast-Cut
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-[#232933] bg-[#13171D] p-1">
          <button
            type="button"
            onClick={() => setModus('SYNC')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
              modus === 'SYNC' ? 'bg-[#F59E0B] text-[#0B0E11]' : 'text-[#8B949E] hover:text-white'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            Multi-Angle Sync
          </button>
          <button
            type="button"
            onClick={() => setModus('FAST_CUT')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
              modus === 'FAST_CUT'
                ? 'bg-[#F59E0B] text-[#0B0E11]'
                : 'text-[#8B949E] hover:text-white'
            }`}
          >
            <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
            Fast-Cut (I / O / J-K-L)
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
          <div className="space-y-4 lg:col-span-8">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Master-Viewport */}
              <div className="rounded-xl border border-[#232933] bg-[#13171D] p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white">
                    Master: {masterQuelle?.angleCode ?? 'SIDELINE'}
                  </span>
                  <span className="font-mono text-[#8B949E] video-tabular">0 ms Basis</span>
                </div>
                <div className="flex aspect-video items-center justify-center rounded-lg bg-[#07090C] font-mono text-xs text-[#8B949E]">
                  {masterQuelle?.fileName ?? 'Kein Master-Clip'}
                </div>
              </div>

              {/* Sekundärer Viewport */}
              <div className="rounded-xl border border-[#232933] bg-[#13171D] p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
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
                <div className="flex aspect-video items-center justify-center rounded-lg bg-[#07090C] font-mono text-xs text-[#8B949E]">
                  {slaveQuelle ? (
                    slaveQuelle.fileName
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-amber-300">
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                      Fehlender Winkel (Lücke)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {slaveQuelle && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#232933] bg-[#13171D] p-4">
                <div className="text-xs text-[#8B949E]">
                  Play #{aktivesPlay.playNumber} · Snap-Sync &amp; Frame-Feinabgleich
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[-200, -40, 40, 200].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() => speichereOffset(aktuellerOffset + delta)}
                      className="rounded-md border border-[#232933] bg-[#0B0E11] px-2.5 py-1.5 font-mono text-xs text-[#E6EDF3] hover:border-[#F59E0B] video-tabular"
                    >
                      {delta > 0 ? `+${delta}` : delta} ms
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => speichereOffset(0)}
                    className="rounded-md bg-[#232933] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#36404F]"
                  >
                    Offset zurücksetzen (0)
                  </button>
                </div>
              </div>
            )}
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
        <div className="space-y-4 rounded-xl border border-[#232933] bg-[#13171D] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <h2 className="text-sm font-semibold text-white">
                Einzeldatei Fast-Cut-Timeline
              </h2>
              <p className="text-xs text-[#8B949E]">
                Tasten: <span className="font-mono text-white">J/K/L</span> Transport ·{' '}
                <span className="font-mono text-white">I</span> In-Punkt ·{' '}
                <span className="font-mono text-white">O</span> Out-Punkt
              </p>
            </div>
            <div className="font-mono text-sm text-[#F59E0B] video-tabular">
              {formatiereFrameTimecode(tapePosMs)} ({tapeSpeed}x)
            </div>
          </div>

          <input
            type="range"
            min={0}
            max={600000}
            step={FRAME_MS}
            value={tapePosMs}
            onChange={(e) => setTapePosMs(Number(e.target.value))}
            className="w-full accent-[#F59E0B]"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTapeSpeed(-2)}
                className="rounded-md border border-[#232933] bg-[#0B0E11] px-3 py-1.5 text-xs text-white"
              >
                J (-2x)
              </button>
              <button
                type="button"
                onClick={() => setTapeSpeed(0)}
                className="inline-flex items-center gap-1 rounded-md border border-[#232933] bg-[#0B0E11] px-3 py-1.5 text-xs text-white"
              >
                <Pause className="h-3.5 w-3.5" aria-hidden="true" /> K
              </button>
              <button
                type="button"
                onClick={() => setTapeSpeed(2)}
                className="inline-flex items-center gap-1 rounded-md border border-[#232933] bg-[#0B0E11] px-3 py-1.5 text-xs text-white"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" /> L (+2x)
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setInMs(tapePosMs)}
                className="rounded-md border border-[#232933] bg-[#0B0E11] px-3 py-1.5 font-mono text-white video-tabular"
              >
                In (I): {inMs === null ? '—' : formatiereFrameTimecode(inMs)}
              </button>
              <button
                type="button"
                onClick={() => setOutMs(tapePosMs)}
                className="rounded-md border border-[#232933] bg-[#0B0E11] px-3 py-1.5 font-mono text-white video-tabular"
              >
                Out (O): {outMs === null ? '—' : formatiereFrameTimecode(outMs)}
              </button>
              <button
                type="button"
                onClick={erstelleFastCutPlay}
                className="rounded-md bg-[#F59E0B] px-4 py-1.5 text-xs font-semibold text-[#0B0E11] hover:bg-[#FBBF24]"
              >
                Slice als Spielzug übernehmen
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
