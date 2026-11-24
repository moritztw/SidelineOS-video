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
              endMs: 12000,
              fileSizeBytes: sl.size,
            },
          };

          const ez = endzoneFiles[i];
          if (ez) {
            const ezPath = `reels/${Date.now()}/ez_${i + 1}_${ez.name}`;
            const ezUploaded = await videoApi.ladeDateiZuS3(ctx.team.id, ez, ezPath);
            sources.ENDZONE = {
              fileName: ez.name,
              s3Key: ezUploaded.key,
              sourceMode: 'CLIP_FILE',
              startMs: 0,
              endMs: 12000,
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
                  endMs: 25000,
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
      <div className="w-full max-w-2xl rounded-xl border border-[#232933] bg-[#13171D] p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-[#232933] pb-4">
          <h2 className="text-lg font-semibold text-white">{t('uploadTitle')}</h2>
          <button
            type="button"
            onClick={() => setUploadModalOffen(false)}
            className="rounded-md p-1.5 text-[#8B949E] hover:bg-[#232933] hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Modus-Umschalter */}
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-[#232933] bg-[#0B0E11] p-1">
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
                  ? 'bg-[#232933] text-white'
                  : 'text-[#8B949E] hover:text-[#E6EDF3]'
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
                <span className="text-[#8B949E]">Titel</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="z. B. Week 4 vs. Berlin Rebels"
                  className="w-full rounded-lg border border-[#232933] bg-[#0B0E11] px-3 py-2 text-sm text-white focus:border-[#F59E0B] focus:outline-none"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-[#8B949E]">Datum</span>
                <input
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full rounded-lg border border-[#232933] bg-[#0B0E11] px-3 py-2 text-sm text-white focus:border-[#F59E0B] focus:outline-none"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-[#8B949E]">Kategorie</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as VideoKategorie)}
                  className="w-full rounded-lg border border-[#232933] bg-[#0B0E11] px-3 py-2 text-sm text-white focus:border-[#F59E0B] focus:outline-none"
                >
                  <option value="GAME">{t('catGame')}</option>
                  <option value="PRACTICE">{t('catPractice')}</option>
                  <option value="SCOUTING">{t('catScouting')}</option>
                  <option value="SELF_SCOUT">{t('catSelfScout')}</option>
                </select>
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-[#8B949E]">Sichtbarkeit</span>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as SichtbarkeitsStufe)}
                  className="w-full rounded-lg border border-[#232933] bg-[#0B0E11] px-3 py-2 text-sm text-white focus:border-[#F59E0B] focus:outline-none"
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
              <div className="space-y-3 rounded-lg border border-[#232933] bg-[#0B0E11] p-4">
                <label className="block space-y-1 text-xs">
                  <span className="text-[#E6EDF3]">Sideline-Clips (Pflicht)</span>
                  <input
                    type="file"
                    multiple
                    accept="video/*"
                    onChange={(e) => setSidelineFiles(Array.from(e.target.files ?? []))}
                    className="block w-full text-xs text-[#8B949E] file:mr-3 file:rounded-md file:border-0 file:bg-[#232933] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
                  />
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block space-y-1 text-xs">
                    <span className="text-[#E6EDF3]">Endzone-Clips (Optional)</span>
                    <input
                      type="file"
                      multiple
                      accept="video/*"
                      onChange={(e) => setEndzoneFiles(Array.from(e.target.files ?? []))}
                      className="block w-full text-xs text-[#8B949E] file:mr-3 file:rounded-md file:border-0 file:bg-[#232933] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
                    />
                  </label>
                  <label className="block space-y-1 text-xs">
                    <span className="text-[#8B949E]">Optionaler Offset (ms, kein Sync-Zwang)</span>
                    <input
                      type="number"
                      value={endzoneOffsetMs}
                      onChange={(e) => setEndzoneOffsetMs(e.target.value)}
                      placeholder="leer = kein Offset"
                      className="w-full rounded-lg border border-[#232933] bg-[#13171D] px-3 py-1.5 text-sm text-white video-tabular focus:border-[#F59E0B] focus:outline-none"
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-[#232933] bg-[#0B0E11] p-4">
                <label className="block space-y-1.5 text-xs">
                  <span className="text-[#E6EDF3]">
                    Durchgehende Videodatei (Segmente im Sync & Fast-Cut Editor zuschneiden)
                  </span>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => setSingleTapeFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-xs text-[#8B949E] file:mr-3 file:rounded-md file:border-0 file:bg-[#232933] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
                  />
                </label>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <label className="flex items-center justify-between rounded-lg border border-dashed border-[#36404F] bg-[#0B0E11] px-4 py-3 text-xs text-[#8B949E]">
              <span className="inline-flex items-center gap-2 text-[#E6EDF3]">
                <FileJson className="h-4 w-4 text-[#F59E0B]" aria-hidden="true" />
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
              className="w-full rounded-lg border border-[#232933] bg-[#0B0E11] p-3 font-mono text-xs text-[#E6EDF3] focus:border-[#F59E0B] focus:outline-none"
            />
          </div>
        )}

        {fortschritt !== null && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-[#8B949E] video-tabular">
              <span>S3 Upload</span>
              <span>{fortschritt}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#0B0E11]">
              <div
                className="h-full bg-[#F59E0B] transition-all"
                style={{ width: `${fortschritt}%` }}
              />
            </div>
          </div>
        )}

        {fehler && (
          <div className="rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs text-red-200">
            {fehler}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-[#232933] pt-4">
          <button
            type="button"
            onClick={() => setUploadModalOffen(false)}
            className="rounded-lg border border-[#232933] px-4 py-2 text-xs font-medium text-[#E6EDF3] hover:bg-[#232933]"
          >
            Abbrechen
          </button>
          <button
            type="button"
            disabled={laedt}
            onClick={handleImport}
            className="inline-flex items-center gap-2 rounded-lg bg-[#F59E0B] px-4 py-2 text-xs font-semibold text-[#0B0E11] hover:bg-[#FBBF24] disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {laedt ? 'Importiere...' : 'Import starten'}
          </button>
        </div>
      </div>
    </div>
  );
}
