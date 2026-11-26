import { useState, type ChangeEvent } from 'react';
import type { PluginLaufzeitKontext } from '@sidelineos/plugin-sdk';
import { createPluginTranslator } from '@sidelineos/plugin-sdk';
import { FileJson, Upload, X } from 'lucide-react';
import { useVideoAnalysis } from '../context/VideoAnalysisContext';
import { VIDEO_WOERTERBUCH } from '../i18n/woerterbuch';
import { videoApi } from '../services/apiClient';
import { validiereSidelineBundle } from '../services/bundleSchema';
import type { SichtbarkeitsStufe, VideoKategorie } from '../types/video';

type ImportModus = 'CLIP_FILE' | 'TIME_SLICE' | 'BUNDLE';

async function ermittleVideoDauerMs(file: File, fallbackMs: number): Promise<number> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return fallbackMs;
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(url);
      resolve(fallbackMs);
    }, 3000);
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const dauer = Number.isFinite(video.duration) && video.duration > 0
        ? Math.round(video.duration * 1000)
        : fallbackMs;
      URL.revokeObjectURL(url);
      resolve(dauer);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(fallbackMs);
    };
    video.src = url;
  });
}

export function UploadPanel({ ctx }: { ctx: PluginLaufzeitKontext }) {
  const t = createPluginTranslator(VIDEO_WOERTERBUCH, ctx.locale);
  const { uploadModalOffen, setUploadModalOffen, ladeBasisDaten } = useVideoAnalysis();

  const [modus, setModus] = useState<ImportModus>('CLIP_FILE');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<VideoKategorie>('GAME');
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [visibility, setVisibility] = useState<SichtbarkeitsStufe>('COACHES_ONLY');
  const [sidelineFiles, setSidelineFiles] = useState<File[]>([]);
  const [endzoneFiles, setEndzoneFiles] = useState<File[]>([]);
  const [endzoneOffsetMs, setEndzoneOffsetMs] = useState<string>('');
  const [singleTapeFile, setSingleTapeFile] = useState<File | null>(null);
  const [bundleText, setBundleText] = useState('');
  const [fortschritt, setFortschritt] = useState<number | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);

  if (!uploadModalOffen) return null;

  const handleBundleDatei = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setBundleText(text);
  };

  const handleImport = async () => {
    setFehler(null);
    setLaedt(true);
    try {
      if (modus === 'BUNDLE') {
        let parsed: unknown;
        try {
          parsed = JSON.parse(bundleText);
        } catch {
          throw new Error('Ungültiges JSON in sideline-bundle.json.');
        }
        const check = validiereSidelineBundle(parsed);
        if (!check.ok) {
          throw new Error(check.fehler.join(' '));
        }
        await videoApi.erstelleReel(ctx.team.id, { bundle: check.bundle });
      } else if (modus === 'CLIP_FILE') {
        if (!title.trim()) throw new Error('Titel des Reels ist erforderlich.');
        if (sidelineFiles.length === 0) {
          throw new Error('Mindestens ein Sideline-Clip wird benötigt.');
        }
        const offsetVal = endzoneOffsetMs.trim() ? Number(endzoneOffsetMs) : null;
        const plays = [];
        for (let i = 0; i < sidelineFiles.length; i += 1) {
          const sl = sidelineFiles[i];
          const slDauerMs = await ermittleVideoDauerMs(sl, 12000);
          const slPath = `reels/${Date.now()}/sl_${i + 1}_${sl.name}`;
          const slUploaded = await videoApi.ladeDateiZuS3(ctx.team.id, sl, slPath, (p) =>
            setFortschritt(Math.round(((i + p / 100) / sidelineFiles.length) * 100))
          );
          const sources: Record<
            string,
            {
              fileName: string;
              s3Key: string;
              sourceMode: 'CLIP_FILE';
              startMs: number;
              endMs: number;
              offsetMs?: number | null;
              fileSizeBytes?: number;
            }
          > = {
            SIDELINE: {
              fileName: sl.name,
              s3Key: slUploaded.key,
              sourceMode: 'CLIP_FILE',
              startMs: 0,
              endMs: slDauerMs,
              fileSizeBytes: sl.size,
            },
          };

          const ez = endzoneFiles[i];
          if (ez) {
            const ezDauerMs = await ermittleVideoDauerMs(ez, slDauerMs);
            const ezPath = `reels/${Date.now()}/ez_${i + 1}_${ez.name}`;
            const ezUploaded = await videoApi.ladeDateiZuS3(ctx.team.id, ez, ezPath);
            sources.ENDZONE = {
              fileName: ez.name,
              s3Key: ezUploaded.key,
              sourceMode: 'CLIP_FILE',
              startMs: 0,
              endMs: ezDauerMs,
              offsetMs: offsetVal,
              fileSizeBytes: ez.size,
            };
          }

          plays.push({
            playNumber: i + 1,
            breakdown: { odk: 'O', play_number: i + 1 },
            sources,
          });
        }

        await videoApi.erstelleReel(ctx.team.id, {
          title: title.trim(),
          category,
          eventDate,
          season: ctx.gewaehlteSaison === 'ALL' ? eventDate.slice(0, 4) : ctx.gewaehlteSaison,
          visibility,
          plays,
        });
      } else {
        if (!title.trim()) throw new Error('Titel des Reels ist erforderlich.');
        if (!singleTapeFile) throw new Error('Bitte eine Videodatei auswählen.');
        const tapeDauerMs = await ermittleVideoDauerMs(singleTapeFile, 25000);
        const path = `reels/${Date.now()}/${singleTapeFile.name}`;
        const uploaded = await videoApi.ladeDateiZuS3(
          ctx.team.id,
          singleTapeFile,
          path,
          setFortschritt
        );
        await videoApi.erstelleReel(ctx.team.id, {
          title: title.trim(),
          category,
          eventDate,
          season: ctx.gewaehlteSaison === 'ALL' ? eventDate.slice(0, 4) : ctx.gewaehlteSaison,
          visibility,
          plays: [
            {
              playNumber: 1,
              breakdown: { odk: 'O', play_number: 1 },
              sources: {
                SIDELINE: {
                  fileName: singleTapeFile.name,
                  s3Key: uploaded.key,
                  sourceMode: 'TIME_SLICE',
                  startMs: 0,
                  endMs: tapeDauerMs,
                  fileSizeBytes: singleTapeFile.size,
                },
              },
            },
          ],
        });
      }

      await ladeBasisDaten(ctx.team.id, ctx.gewaehlteSaison, ctx.benutzer.uuid);
      setUploadModalOffen(false);
      setTitle('');
      setBundleText('');
      setFortschritt(null);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Import fehlgeschlagen.');
    } finally {
      setLaedt(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={t('uploadTitle')}
    >
      <div className="w-full max-w-2xl rounded-xl border border-sl-border bg-sl-surface p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-sl-border pb-4">
          <h2 className="text-lg font-semibold text-sl-heading">{t('uploadTitle')}</h2>
          <button
            type="button"
            onClick={() => setUploadModalOffen(false)}
            className="rounded-md p-1.5 text-sl-muted hover:bg-sl-elevated hover:text-sl-heading"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Modus-Umschalter */}
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-sl-border bg-sl-canvas p-1">
          {(
            [
              { id: 'CLIP_FILE', label: t('uploadModeClips') },
              { id: 'TIME_SLICE', label: t('uploadModeSlice') },
              { id: 'BUNDLE', label: t('uploadModeBundle') },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setModus(item.id)}
              className={`rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                modus === item.id
                  ? 'bg-sl-elevated text-sl-heading'
                  : 'text-sl-muted hover:text-sl-primary'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {modus !== 'BUNDLE' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="text-sl-muted">Titel</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="z. B. Week 4 vs. Berlin Rebels"
                  className="w-full rounded-lg border border-sl-border bg-sl-canvas px-3 py-2 text-sm text-sl-heading focus:border-sl-accent focus:outline-none"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-sl-muted">Datum</span>
                <input
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full rounded-lg border border-sl-border bg-sl-canvas px-3 py-2 text-sm text-sl-heading focus:border-sl-accent focus:outline-none"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-sl-muted">Kategorie</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as VideoKategorie)}
                  className="w-full rounded-lg border border-sl-border bg-sl-canvas px-3 py-2 text-sm text-sl-heading focus:border-sl-accent focus:outline-none"
                >
                  <option value="GAME">{t('catGame')}</option>
                  <option value="PRACTICE">{t('catPractice')}</option>
                  <option value="SCOUTING">{t('catScouting')}</option>
                  <option value="SELF_SCOUT">{t('catSelfScout')}</option>
                </select>
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-sl-muted">Sichtbarkeit</span>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as SichtbarkeitsStufe)}
                  className="w-full rounded-lg border border-sl-border bg-sl-canvas px-3 py-2 text-sm text-sl-heading focus:border-sl-accent focus:outline-none"
                >
                  <option value="COACHES_ONLY">{t('visCoachesOnly')}</option>
                  <option value="ALL_PLAYERS">{t('visAllPlayers')}</option>
                  <option value="UNIT_OFFENSE">{t('visUnitOffense')}</option>
                  <option value="UNIT_DEFENSE">{t('visUnitDefense')}</option>
                  <option value="UNIT_SPECIAL_TEAMS">{t('visUnitSpecial')}</option>
                </select>
              </label>
            </div>

            {modus === 'CLIP_FILE' ? (
              <div className="space-y-3 rounded-lg border border-sl-border bg-sl-canvas p-4">
                <label className="block space-y-1 text-xs">
                  <span className="text-sl-primary">Sideline-Clips (Pflicht)</span>
                  <input
                    type="file"
                    multiple
                    accept="video/*"
                    onChange={(e) => setSidelineFiles(Array.from(e.target.files ?? []))}
                    className="block w-full text-xs text-sl-muted file:mr-3 file:rounded-md file:border-0 file:bg-sl-elevated file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-sl-heading"
                  />
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block space-y-1 text-xs">
                    <span className="text-sl-primary">Endzone-Clips (Optional)</span>
                    <input
                      type="file"
                      multiple
                      accept="video/*"
                      onChange={(e) => setEndzoneFiles(Array.from(e.target.files ?? []))}
                      className="block w-full text-xs text-sl-muted file:mr-3 file:rounded-md file:border-0 file:bg-sl-elevated file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-sl-heading"
                    />
                  </label>
                  <label className="block space-y-1 text-xs">
                    <span className="text-sl-muted">Optionaler Offset (ms, kein Sync-Zwang)</span>
                    <input
                      type="number"
                      value={endzoneOffsetMs}
                      onChange={(e) => setEndzoneOffsetMs(e.target.value)}
                      placeholder="leer = kein Offset"
                      className="w-full rounded-lg border border-sl-border bg-sl-surface px-3 py-1.5 text-sm text-sl-heading video-tabular focus:border-sl-accent focus:outline-none"
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-sl-border bg-sl-canvas p-4">
                <label className="block space-y-1.5 text-xs">
                  <span className="text-sl-primary">
                    Durchgehende Videodatei (Segmente im Sync & Fast-Cut Editor zuschneiden)
                  </span>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => setSingleTapeFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-xs text-sl-muted file:mr-3 file:rounded-md file:border-0 file:bg-sl-elevated file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-sl-heading"
                  />
                </label>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <label className="flex items-center justify-between rounded-lg border border-dashed border-sl-border-strong bg-sl-canvas px-4 py-3 text-xs text-sl-muted">
              <span className="inline-flex items-center gap-2 text-sl-primary">
                <FileJson className="h-4 w-4 text-sl-accent" aria-hidden="true" />
                sideline-bundle.json (v1.0) auswählen
              </span>
              <input
                type="file"
                accept="application/json,.json"
                onChange={handleBundleDatei}
                className="text-xs"
              />
            </label>
            <textarea
              rows={7}
              value={bundleText}
              onChange={(e) => setBundleText(e.target.value)}
              placeholder='{"schema_version":"1.0","reel":{...},"angles":["SIDELINE"],"plays":[...]}'
              className="w-full rounded-lg border border-sl-border bg-sl-canvas p-3 font-mono text-xs text-sl-primary focus:border-sl-accent focus:outline-none"
            />
          </div>
        )}

        {fortschritt !== null && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-sl-muted video-tabular">
              <span>S3 Upload</span>
              <span>{fortschritt}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-sl-canvas">
              <div
                className="h-full bg-sl-accent transition-all"
                style={{ width: `${fortschritt}%` }}
              />
            </div>
          </div>
        )}

        {fehler && (
          <div className="rounded-lg border border-sl-danger/40 bg-sl-danger/10 px-3 py-2 text-xs text-sl-danger-text">
            {fehler}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-sl-border pt-4">
          <button
            type="button"
            onClick={() => setUploadModalOffen(false)}
            className="rounded-lg border border-sl-border px-4 py-2 text-xs font-medium text-sl-primary hover:bg-sl-elevated"
          >
            Abbrechen
          </button>
          <button
            type="button"
            disabled={laedt}
            onClick={handleImport}
            className="inline-flex items-center gap-2 rounded-lg bg-sl-accent px-4 py-2 text-xs font-semibold text-sl-accent-contrast hover:bg-sl-accent-hover disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {laedt ? 'Importiere...' : 'Import starten'}
          </button>
        </div>
      </div>
    </div>
  );
}
