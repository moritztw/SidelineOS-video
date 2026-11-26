import { useEffect, useState } from 'react';
import type { PluginLaufzeitKontext } from '@sidelineos/plugin-sdk';
import { createPluginTranslator } from '@sidelineos/plugin-sdk';
import { Camera, Check, Save, SlidersHorizontal, Upload, X } from 'lucide-react';
import { useVideoAnalysis } from '../context/VideoAnalysisContext';
import { VIDEO_WOERTERBUCH } from '../i18n/woerterbuch';
import { videoApi } from '../services/apiClient';
import type {
  PlayEintrag,
  SichtbarkeitsStufe,
  VideoKategorie,
  VideoReelEintrag,
} from '../types/video';

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
      const dauer =
        Number.isFinite(video.duration) && video.duration > 0
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

interface ClipZuordnung {
  file: File;
  targetPlayId: string; // Play-ID oder "__NEW__"
}

export function ReelEditModal({
  ctx,
  reel,
  onSchliessen,
  onGespeichert,
}: {
  ctx: PluginLaufzeitKontext;
  reel: VideoReelEintrag;
  onSchliessen: () => void;
  onGespeichert: () => Promise<void>;
}) {
  const t = createPluginTranslator(VIDEO_WOERTERBUCH, ctx.locale);
  const { oeffneReel } = useVideoAnalysis();

  const [tab, setTab] = useState<'META' | 'ANGLE'>('META');

  // Metadaten-State
  const [title, setTitle] = useState(reel.title);
  const [category, setCategory] = useState<VideoKategorie>(reel.category);
  const [eventDate, setEventDate] = useState(reel.eventDate);
  const [season, setSeason] = useState(reel.saison);
  const [visibility, setVisibility] = useState<SichtbarkeitsStufe>(reel.visibility);

  // Bestehende Plays für Angle-Zuordnung
  const [reelPlays, setReelPlays] = useState<PlayEintrag[]>([]);
  const [laedtPlays, setLaedtPlays] = useState(false);

  // Angle-Upload-State
  const [anglePreset, setAnglePreset] = useState<string>(
    reel.angles.includes('ENDZONE') ? 'TIGHT' : 'ENDZONE'
  );
  const [customAngle, setCustomAngle] = useState('');
  const [angleModus, setAngleModus] = useState<'CLIPS' | 'FULL_TAPE'>('CLIPS');
  const [clipZuordnungen, setClipZuordnungen] = useState<ClipZuordnung[]>([]);
  const [tapeFile, setTapeFile] = useState<File | null>(null);
  const [offsetMsText, setOffsetMsText] = useState('');

  const [speichert, setSpeichert] = useState(false);
  const [fortschritt, setFortschritt] = useState<number | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState<string | null>(null);
  const [kannInSyncOeffnen, setKannInSyncOeffnen] = useState(false);

  useEffect(() => {
    setLaedtPlays(true);
    videoApi
      .holeReelDetails(ctx.team.id, reel.id)
      .then((detail) => setReelPlays(detail.plays))
      .catch(() => undefined)
      .finally(() => setLaedtPlays(false));
  }, [ctx.team.id, reel.id]);

  const gewaehlterAngleCode = (
    anglePreset === 'CUSTOM' ? customAngle : anglePreset
  )
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_');

  const handleMetaSpeichern = async () => {
    if (!title.trim()) {
      setFehler('Titel darf nicht leer sein.');
      return;
    }
    setFehler(null);
    setErfolg(null);
    setSpeichert(true);
    try {
      await videoApi.aktualisiereReel(ctx.team.id, reel.id, {
        title: title.trim(),
        category,
        eventDate,
        season: season.trim() || eventDate.slice(0, 4),
        visibility,
      });
      await onGespeichert();
      setErfolg('Metadaten gespeichert.');
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setSpeichert(false);
    }
  };

  const handleClipsAusgewaehlt = (files: File[]) => {
    const sortiert = [...files].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
    const zugeordnet: ClipZuordnung[] = sortiert.map((file, idx) => ({
      file,
      targetPlayId: reelPlays[idx]?.id ?? '__NEW__',
    }));
    setClipZuordnungen(zugeordnet);
  };

  const handleAngleHochladen = async () => {
    if (!gewaehlterAngleCode) {
      setFehler('Bitte einen gültigen Winkel-Namen (z. B. ENDZONE) angeben.');
      return;
    }
    setFehler(null);
    setErfolg(null);
    setSpeichert(true);
    setFortschritt(0);

    try {
      const offsetVal = offsetMsText.trim() ? Number(offsetMsText) : null;

      if (angleModus === 'FULL_TAPE') {
        if (!tapeFile) {
          throw new Error('Bitte eine durchgehende Videodatei auswählen.');
        }
        const dauerMs = await ermittleVideoDauerMs(tapeFile, 25000);
        const path = `reels/${reel.id}/angles/${gewaehlterAngleCode}_${Date.now()}_${tapeFile.name}`;
        const uploaded = await videoApi.ladeDateiZuS3(
          ctx.team.id,
          tapeFile,
          path,
          setFortschritt
        );
        await videoApi.fuegeAngleHinzu(ctx.team.id, reel.id, {
          angleCode: gewaehlterAngleCode,
          mode: 'FULL_TAPE',
          tape: {
            fileName: tapeFile.name,
            s3Key: uploaded.key,
            startMs: 0,
            endMs: dauerMs,
            offsetMs: offsetVal,
            fileSizeBytes: tapeFile.size,
          },
        });
        setErfolg(
          `Winkel "${gewaehlterAngleCode}" als durchgehendes Tape hinzugefügt. Du kannst ihn jetzt in Sync & Fast-Cut zuschneiden.`
        );
        setKannInSyncOeffnen(true);
        setTapeFile(null);
      } else {
        if (clipZuordnungen.length === 0) {
          throw new Error('Bitte mindestens einen Videoclip auswählen.');
        }
        const assignments = [];
        for (let i = 0; i < clipZuordnungen.length; i += 1) {
          const item = clipZuordnungen[i];
          const dauerMs = await ermittleVideoDauerMs(item.file, 12000);
          const path = `reels/${reel.id}/angles/${gewaehlterAngleCode}_${Date.now()}_${i + 1}_${item.file.name}`;
          const uploaded = await videoApi.ladeDateiZuS3(ctx.team.id, item.file, path, (p) =>
            setFortschritt(Math.round(((i + p / 100) / clipZuordnungen.length) * 100))
          );
          assignments.push({
            playId: item.targetPlayId === '__NEW__' ? undefined : item.targetPlayId,
            createNewPlay: item.targetPlayId === '__NEW__',
            fileName: item.file.name,
            s3Key: uploaded.key,
            startMs: 0,
            endMs: dauerMs,
            offsetMs: offsetVal,
            fileSizeBytes: item.file.size,
          });
        }
        const res = await videoApi.fuegeAngleHinzu(ctx.team.id, reel.id, {
          angleCode: gewaehlterAngleCode,
          mode: 'CLIPS',
          assignments,
        });
        setErfolg(
          `Winkel "${res.angleCode}" mit ${res.assignedCount} Clips erfolgreich zugeordnet.`
        );
        setKannInSyncOeffnen(true);
        setClipZuordnungen([]);
      }

      await onGespeichert();
      const aktualisiert = await videoApi.holeReelDetails(ctx.team.id, reel.id);
      setReelPlays(aktualisiert.plays);
      setFortschritt(null);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Angle-Upload fehlgeschlagen.');
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={t('editReel')}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-sl-border bg-sl-surface p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-sl-border pb-4">
          <div>
            <h2 className="text-lg font-semibold text-sl-heading">{t('editReel')}</h2>
            <p className="text-xs text-sl-muted">
              {reel.title} · Aktuelle Winkel: {reel.angles.join(', ')}
            </p>
          </div>
          <button
            type="button"
            onClick={onSchliessen}
            className="rounded-md p-1.5 text-sl-muted hover:bg-sl-elevated hover:text-sl-heading"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Bereichs-Umschalter */}
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-sl-border bg-sl-canvas p-1">
          <button
            type="button"
            onClick={() => {
              setFehler(null);
              setErfolg(null);
              setTab('META');
            }}
            className={`rounded-md px-3 py-2 text-xs font-medium transition-colors ${
              tab === 'META' ? 'bg-sl-elevated text-sl-heading' : 'text-sl-muted hover:text-sl-primary'
            }`}
          >
            Metadaten bearbeiten
          </button>
          <button
            type="button"
            onClick={() => {
              setFehler(null);
              setErfolg(null);
              setTab('ANGLE');
            }}
            className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
              tab === 'ANGLE' ? 'bg-sl-elevated text-sl-heading' : 'text-sl-muted hover:text-sl-primary'
            }`}
          >
            <Camera className="h-3.5 w-3.5" aria-hidden="true" />
            Weiteren Angle hinzufügen
          </button>
        </div>

        {tab === 'META' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs sm:col-span-2">
                <span className="text-sl-muted">Titel</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
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
                <span className="text-sl-muted">Saison</span>
                <input
                  type="text"
                  value={season}
                  onChange={(e) => setSeason(e.target.value)}
                  placeholder="z. B. 2026"
                  className="w-full rounded-lg border border-sl-border bg-sl-canvas px-3 py-2 text-sm text-sl-heading video-tabular focus:border-sl-accent focus:outline-none"
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
                  <option value="CUSTOM">{t('catCustom')}</option>
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
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="text-sl-muted">Kamera-Winkel</span>
                <select
                  value={anglePreset}
                  onChange={(e) => setAnglePreset(e.target.value)}
                  className="w-full rounded-lg border border-sl-border bg-sl-canvas px-3 py-2 text-xs text-sl-heading"
                >
                  <option value="ENDZONE">ENDZONE</option>
                  <option value="TIGHT">TIGHT</option>
                  <option value="WIDE">WIDE</option>
                  <option value="SIDELINE">SIDELINE</option>
                  <option value="CUSTOM">Eigener Winkel-Name...</option>
                </select>
              </label>

              {anglePreset === 'CUSTOM' ? (
                <label className="space-y-1 text-xs">
                  <span className="text-sl-muted">Eigener Code (z. B. PRESSBOX)</span>
                  <input
                    type="text"
                    value={customAngle}
                    onChange={(e) => setCustomAngle(e.target.value)}
                    placeholder="PRESSBOX"
                    className="w-full rounded-lg border border-sl-border bg-sl-canvas px-3 py-2 text-xs uppercase text-sl-heading focus:border-sl-accent focus:outline-none"
                  />
                </label>
              ) : (
                <label className="space-y-1 text-xs">
                  <span className="text-sl-muted">Optionaler Offset (ms)</span>
                  <input
                    type="number"
                    value={offsetMsText}
                    onChange={(e) => setOffsetMsText(e.target.value)}
                    placeholder="leer = 0 ms"
                    className="w-full rounded-lg border border-sl-border bg-sl-canvas px-3 py-2 text-xs text-sl-heading video-tabular focus:border-sl-accent focus:outline-none"
                  />
                </label>
              )}
            </div>

            <div className="grid grid-cols-2 gap-1 rounded-lg border border-sl-border bg-sl-canvas p-1">
              <button
                type="button"
                onClick={() => setAngleModus('CLIPS')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  angleModus === 'CLIPS'
                    ? 'bg-sl-elevated text-sl-heading'
                    : 'text-sl-muted hover:text-sl-primary'
                }`}
              >
                Einzelclips ({reelPlays.length} Plays)
              </button>
              <button
                type="button"
                onClick={() => setAngleModus('FULL_TAPE')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  angleModus === 'FULL_TAPE'
                    ? 'bg-sl-elevated text-sl-heading'
                    : 'text-sl-muted hover:text-sl-primary'
                }`}
              >
                Langes Tape (Sync &amp; Fast-Cut)
              </button>
            </div>

            {angleModus === 'CLIPS' ? (
              <div className="space-y-3 rounded-lg border border-sl-border bg-sl-canvas p-4">
                <label className="block space-y-1.5 text-xs">
                  <span className="text-sl-primary">
                    Einzelclips für {gewaehlterAngleCode || 'neuen Winkel'} auswählen
                  </span>
                  <input
                    type="file"
                    multiple
                    accept="video/*"
                    disabled={laedtPlays}
                    onChange={(e) => handleClipsAusgewaehlt(Array.from(e.target.files ?? []))}
                    className="block w-full text-xs text-sl-muted file:mr-3 file:rounded-md file:border-0 file:bg-sl-elevated file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-sl-heading"
                  />
                </label>

                {clipZuordnungen.length > 0 && (
                  <div className="max-h-52 space-y-1.5 overflow-y-auto border-t border-sl-border pt-3">
                    <div className="text-[11px] font-medium text-sl-muted">
                      Zuordnung zu bestehenden Spielzügen (anpassbar):
                    </div>
                    {clipZuordnungen.map((item, idx) => (
                      <div
                        key={`${item.file.name}-${idx}`}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="truncate font-mono text-[11px] text-sl-primary">
                          {item.file.name}
                        </span>
                        <select
                          value={item.targetPlayId}
                          onChange={(e) =>
                            setClipZuordnungen((alt) =>
                              alt.map((x, i) =>
                                i === idx ? { ...x, targetPlayId: e.target.value } : x
                              )
                            )
                          }
                          className="rounded border border-sl-border bg-sl-surface px-2 py-1 text-xs text-sl-heading"
                        >
                          {reelPlays.map((p) => (
                            <option key={p.id} value={p.id}>
                              Play #{p.playNumber}
                            </option>
                          ))}
                          <option value="__NEW__">+ Neuen Spielzug anlegen</option>
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-sl-border bg-sl-canvas p-4 space-y-2">
                <label className="block space-y-1.5 text-xs">
                  <span className="text-sl-primary">
                    Durchgehende Videodatei für {gewaehlterAngleCode || 'neuen Winkel'}
                  </span>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => setTapeFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-xs text-sl-muted file:mr-3 file:rounded-md file:border-0 file:bg-sl-elevated file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-sl-heading"
                  />
                </label>
                <p className="text-[11px] text-sl-muted">
                  Nach dem Upload steht der Winkel sofort im Sync &amp; Fast-Cut Editor bereit, um
                  die Schnitte den bestehenden Plays zuzuordnen oder zeitlich abzugleichen.
                </p>
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
          </div>
        )}

        {fehler && (
          <div className="rounded-lg border border-sl-danger/40 bg-sl-danger/10 px-3 py-2 text-xs text-sl-danger-text">
            {fehler}
          </div>
        )}
        {erfolg && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sl-border bg-sl-canvas px-3 py-2 text-xs text-sl-accent">
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {erfolg}
            </span>
            {kannInSyncOeffnen && (
              <button
                type="button"
                onClick={async () => {
                  await oeffneReel(ctx.team.id, reel.id);
                  onSchliessen();
                  ctx.onTabWechseln('sync-cut');
                }}
                className="inline-flex items-center gap-1 rounded bg-sl-elevated px-2.5 py-1 text-xs font-medium text-sl-heading hover:bg-sl-border-strong whitespace-nowrap"
              >
                <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                In Sync &amp; Fast-Cut öffnen
              </button>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-sl-border pt-4">
          <button
            type="button"
            onClick={onSchliessen}
            className="rounded-lg border border-sl-border px-4 py-2 text-xs font-medium text-sl-primary hover:bg-sl-elevated"
          >
            Schließen
          </button>
          {tab === 'META' ? (
            <button
              type="button"
              disabled={speichert}
              onClick={handleMetaSpeichern}
              className="inline-flex items-center gap-2 rounded-lg bg-sl-accent px-4 py-2 text-xs font-semibold text-sl-accent-contrast hover:bg-sl-accent-hover disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              {speichert ? 'Speichere...' : 'Metadaten speichern'}
            </button>
          ) : (
            <button
              type="button"
              disabled={speichert}
              onClick={handleAngleHochladen}
              className="inline-flex items-center gap-2 rounded-lg bg-sl-accent px-4 py-2 text-xs font-semibold text-sl-accent-contrast hover:bg-sl-accent-hover disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              {speichert ? 'Lade hoch...' : 'Angle hinzufügen'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
