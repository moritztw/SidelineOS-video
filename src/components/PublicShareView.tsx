import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  Download,
  FileJson,
  FileSpreadsheet,
  Film,
  Video,
} from 'lucide-react';
import { erstelleVideoTranslator } from '../i18n/woerterbuch';
import { holeOeffentlichenShare } from '../services/apiClient';
import {
  konvertierePlaysZuCsv,
  konvertiereReelZuSidelineBundle,
} from '../services/bundleSchema';
import { erzeugeZipBlob, type ZipDateiEintrag } from '../services/zipBuilder';
import type { PlayWinkelQuelle, PublicShareAnsichtDaten } from '../types/video';

function slugifyName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sideline-video';
}

function dateiEndung(fileName: string): string {
  const match = fileName.match(/(\.[a-z0-9]{2,5})$/i);
  return match ? match[1].toLowerCase() : '.mp4';
}

export function PublicShareView({
  token,
  locale,
  onSchliessen,
}: {
  token: string;
  locale?: string;
  onSchliessen?: () => void;
}) {
  const t = erstelleVideoTranslator(locale);
  const [status, setStatus] = useState<number>(200);
  const [laedt, setLaedt] = useState(true);
  const [daten, setDaten] = useState<PublicShareAnsichtDaten | null>(null);
  const [aktivesPlayIdx, setAktivesPlayIdx] = useState(0);
  const [aktiverWinkel, setAktiverWinkel] = useState('SIDELINE');
  const [zipStatus, setZipStatus] = useState<string | null>(null);
  const [zipLaeuft, setZipLaeuft] = useState(false);
  const [downloadFehler, setDownloadFehler] = useState<string | null>(null);

  useEffect(() => {
    setLaedt(true);
    setDownloadFehler(null);
    holeOeffentlichenShare(token)
      .then((res) => {
        setStatus(res.status);
        setDaten(res.data ?? null);
        if (res.data?.reel.angles[0]) {
          setAktiverWinkel(res.data.reel.angles[0]);
        }
      })
      .finally(() => setLaedt(false));
  }, [token]);

  const alleDownloadQuellen = useMemo(() => {
    if (!daten) return [];
    const liste: Array<{
      key: string;
      playNumber: number;
      angleCode: string;
      quelle: PlayWinkelQuelle;
      downloadName: string;
    }> = [];
    const gesehenUrl = new Set<string>();
    for (const play of daten.plays) {
      for (const [angleCode, src] of Object.entries(play.sources)) {
        const nr = String(play.playNumber).padStart(2, '0');
        const ext = dateiEndung(src.fileName);
        const downloadName = `Play_${nr}_${angleCode}${ext}`;
        const dedupeKey = src.streamUrl ? `${angleCode}:${src.streamUrl}` : `${play.id}:${angleCode}`;
        // Bei durchgehendem Tape (identische URL) nur einmal im ZIP-Archiv bündeln
        const istDuplikatUrl = Boolean(src.streamUrl && gesehenUrl.has(dedupeKey));
        if (src.streamUrl) gesehenUrl.add(dedupeKey);
        if (!istDuplikatUrl) {
          liste.push({
            key: `${play.id}-${angleCode}`,
            playNumber: play.playNumber,
            angleCode,
            quelle: src,
            downloadName,
          });
        }
      }
    }
    return liste;
  }, [daten]);

  if (laedt) {
    return (
      <div className="sideline-video-root mx-auto max-w-4xl rounded-xl border border-sl-border bg-sl-surface p-8 text-center text-sm text-sl-muted">
        Lade Freigabe-Ansicht...
      </div>
    );
  }

  if (status === 410 || status === 404 || !daten) {
    return (
      <div className="sideline-video-root mx-auto max-w-xl rounded-xl border border-sl-border bg-sl-surface p-8 text-center space-y-4">
        <Film className="mx-auto h-8 w-8 text-sl-subtle" aria-hidden="true" />
        <h1 className="text-lg font-bold text-sl-heading">
          {status === 410 ? '410 — Link abgelaufen' : '404 — Nicht gefunden'}
        </h1>
        <p className="text-sm text-sl-muted">
          {status === 410 ? t('publicShareExpired') : t('publicShareNotFound')}
        </p>
        {onSchliessen && (
          <button
            type="button"
            onClick={onSchliessen}
            className="inline-flex items-center gap-2 rounded-lg border border-sl-border px-4 py-2 text-xs text-sl-heading hover:bg-sl-elevated"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Zurück
          </button>
        )}
      </div>
    );
  }

  const aktivesPlay = daten.plays[aktivesPlayIdx];
  const quelle =
    aktivesPlay?.sources[aktiverWinkel] ??
    (aktivesPlay ? Object.values(aktivesPlay.sources)[0] : undefined);
  const metadatenAktiv = daten.includeMetadata !== false && daten.allowedFields.length > 0;
  const verfuegbareVideoDownloads = alleDownloadQuellen.filter((e) => Boolean(e.quelle.streamUrl));
  const basisDateiname = slugifyName(daten.reel.title);

  const ladeJsonHerunter = () => {
    const bundle = konvertiereReelZuSidelineBundle(
      {
        title: daten.reel.title,
        category: daten.reel.category,
        eventDate: daten.reel.eventDate,
        visibility: 'STAFF_ONLY',
        angles: daten.reel.angles,
      },
      daten.plays,
      { allowedFields: daten.allowedFields, includeVisibility: false }
    );
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${basisDateiname}.sideline-bundle.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const ladeCsvHerunter = () => {
    const csv = konvertierePlaysZuCsv(daten.plays, daten.allowedFields);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${basisDateiname}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const ladeEinzelVideoHerunter = async (src: PlayWinkelQuelle, downloadName: string) => {
    if (!src.streamUrl) return;
    setDownloadFehler(null);
    try {
      const res = await fetch(src.streamUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = downloadName;
      a.click();
      URL.revokeObjectURL(objUrl);
    } catch {
      // Fallback: direkter Link-Download falls S3-CORS keinen fetch-Blob erlaubt
      const a = document.createElement('a');
      a.href = src.streamUrl;
      a.download = downloadName;
      a.rel = 'noopener noreferrer';
      a.click();
    }
  };

  const ladeKomplettZipHerunter = async () => {
    setDownloadFehler(null);
    setZipLaeuft(true);
    try {
      const zipDateien: ZipDateiEintrag[] = [];
      let geladen = 0;

      for (const item of verfuegbareVideoDownloads) {
        geladen += 1;
        setZipStatus(`Lade Video ${geladen} / ${verfuegbareVideoDownloads.length}...`);
        const res = await fetch(item.quelle.streamUrl!);
        if (!res.ok) {
          throw new Error(`Video ${item.downloadName} konnte nicht geladen werden (HTTP ${res.status}).`);
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        zipDateien.push({ name: `videos/${item.downloadName}`, data: buf });
      }

      if (metadatenAktiv) {
        setZipStatus('Füge Breakdown-Metadaten hinzu...');
        const csv = konvertierePlaysZuCsv(daten.plays, daten.allowedFields);
        const bundle = konvertiereReelZuSidelineBundle(
          {
            title: daten.reel.title,
            category: daten.reel.category,
            eventDate: daten.reel.eventDate,
            visibility: 'STAFF_ONLY',
            angles: daten.reel.angles,
          },
          daten.plays,
          { allowedFields: daten.allowedFields, includeVisibility: false }
        );
        zipDateien.push({ name: `${basisDateiname}.csv`, data: csv });
        zipDateien.push({
          name: `${basisDateiname}.sideline-bundle.json`,
          data: JSON.stringify(bundle, null, 2),
        });
      }

      if (zipDateien.length === 0) {
        setDownloadFehler('Keine herunterladbaren Dateien für diesen Link verfügbar.');
        return;
      }

      setZipStatus('Erzeuge ZIP-Archiv...');
      const blob = erzeugeZipBlob(zipDateien);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${basisDateiname}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setZipStatus(null);
    } catch (err) {
      setDownloadFehler(
        err instanceof Error
          ? err.message
          : 'ZIP-Download fehlgeschlagen (prüfe S3-CORS-Einstellungen).'
      );
      setZipStatus(null);
    } finally {
      setZipLaeuft(false);
    }
  };

  return (
    <section className="sideline-video-root mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-sl-border bg-sl-surface p-5">
        <div className="space-y-1">
          <div className="text-xs font-medium text-sl-accent">{t('publicShareTitle')}</div>
          <h1 className="text-xl font-bold text-sl-heading">{daten.reel.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-sl-muted video-tabular">
            <span>{daten.reel.eventDate}</span>
            <span aria-hidden="true">·</span>
            <span>{daten.plays.length} Spielzüge</span>
            <span aria-hidden="true">·</span>
            <span>{daten.reel.angles.join(' / ')}</span>
            <span aria-hidden="true">·</span>
            <span>Gültig bis {daten.expiresAt.slice(0, 10)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={zipLaeuft || (verfuegbareVideoDownloads.length === 0 && !metadatenAktiv)}
            onClick={ladeKomplettZipHerunter}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sl-accent px-3.5 py-2 text-xs font-semibold text-sl-accent-contrast hover:bg-sl-accent-hover disabled:opacity-40 whitespace-nowrap"
          >
            <Archive className="h-3.5 w-3.5" aria-hidden="true" />
            {zipLaeuft
              ? zipStatus ?? 'Erstelle ZIP...'
              : verfuegbareVideoDownloads.length > 0
                ? metadatenAktiv
                  ? 'Alles als ZIP (Videos + Daten)'
                  : 'Videos als ZIP'
                : 'Metadaten als ZIP'}
          </button>

          {metadatenAktiv && (
            <>
              <button
                type="button"
                onClick={ladeJsonHerunter}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sl-border bg-sl-canvas px-3 py-2 text-xs text-sl-heading hover:border-sl-accent whitespace-nowrap"
              >
                <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
                JSON
              </button>
              <button
                type="button"
                onClick={ladeCsvHerunter}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sl-border bg-sl-canvas px-3 py-2 text-xs text-sl-heading hover:border-sl-accent whitespace-nowrap"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                CSV
              </button>
            </>
          )}

          {onSchliessen && (
            <button
              type="button"
              onClick={onSchliessen}
              className="rounded-lg bg-sl-elevated px-3 py-2 text-xs font-medium text-sl-heading hover:bg-sl-border-strong whitespace-nowrap"
            >
              Schließen
            </button>
          )}
        </div>
      </header>

      {verfuegbareVideoDownloads.length === 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-sl-border bg-sl-surface px-4 py-3 text-xs text-sl-muted">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-sl-accent" aria-hidden="true" />
          <div>
            <span className="font-semibold text-sl-heading">
              Für diesen Share-Link liegen derzeit keine signierten Video-Streams vor.
            </span>{' '}
            Prüfe die Storage-Konfiguration im Verein oder lade die freigegebenen Breakdown-Daten
            direkt als JSON/CSV herunter.
          </div>
        </div>
      )}

      {downloadFehler && (
        <div className="rounded-xl border border-sl-danger/40 bg-sl-danger/10 px-4 py-3 text-xs text-sl-danger-text">
          {downloadFehler}
        </div>
      )}

      {/* Multi-Angle-Vorschau + direkter Clip-Download */}
      <div className="rounded-xl border border-sl-border bg-sl-surface p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-sl-heading video-tabular">
            Play #{aktivesPlay?.playNumber ?? 1} · {aktiverWinkel}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              {daten.reel.angles.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAktiverWinkel(a)}
                  className={`rounded px-2.5 py-1 text-xs ${
                    aktiverWinkel === a
                      ? 'bg-sl-accent font-semibold text-sl-accent-contrast'
                      : 'bg-sl-canvas text-sl-muted hover:text-sl-heading'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
            {quelle?.streamUrl && (
              <button
                type="button"
                onClick={() =>
                  ladeEinzelVideoHerunter(
                    quelle,
                    `Play_${String(aktivesPlay?.playNumber ?? 1).padStart(2, '0')}_${aktiverWinkel}${dateiEndung(quelle.fileName)}`
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-md border border-sl-border bg-sl-canvas px-2.5 py-1 text-xs text-sl-heading hover:border-sl-accent whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Clip herunterladen
              </button>
            )}
          </div>
        </div>
        <div className="flex aspect-video items-center justify-center rounded-lg bg-[#07090C] font-mono text-xs text-[#8B949E]">
          {quelle?.streamUrl ? (
            <video src={quelle.streamUrl} controls className="h-full w-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-2 px-4 text-center">
              <Video className="h-6 w-6 text-sl-subtle" aria-hidden="true" />
              <span>{quelle?.fileName ?? 'Kein Video-Stream verfügbar'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Play-Download-Liste & optional freigegebene Breakdown-Spalten */}
      <div className="overflow-x-auto rounded-xl border border-sl-border bg-sl-surface">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-sl-border bg-sl-canvas font-mono text-[11px] text-sl-muted">
              <th className="px-3 py-2.5">Play #</th>
              <th className="px-3 py-2.5">Video-Downloads</th>
              {metadatenAktiv &&
                daten.allowedFields.map((f) => (
                  <th key={f} className="whitespace-nowrap px-3 py-2.5">
                    {f}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {daten.plays.map((p, idx) => (
              <tr
                key={p.id}
                onClick={() => setAktivesPlayIdx(idx)}
                className={`cursor-pointer border-b border-sl-border/60 ${
                  idx === aktivesPlayIdx ? 'bg-sl-accent/10 text-sl-heading' : 'text-sl-primary hover:bg-sl-elevated/50'
                }`}
              >
                <td className="px-3 py-2 font-mono video-tabular">{p.playNumber}</td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {Object.entries(p.sources).map(([angleCode, src]) => (
                      <button
                        key={angleCode}
                        type="button"
                        disabled={!src.streamUrl}
                        onClick={() =>
                          ladeEinzelVideoHerunter(
                            src,
                            `Play_${String(p.playNumber).padStart(2, '0')}_${angleCode}${dateiEndung(src.fileName)}`
                          )
                        }
                        title={
                          src.streamUrl
                            ? `${angleCode} (${src.fileName}) herunterladen`
                            : 'Stream-URL benötigt Core-Update'
                        }
                        className="inline-flex items-center gap-1 rounded border border-sl-border bg-sl-canvas px-2 py-0.5 text-[11px] text-sl-heading hover:border-sl-accent disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
                      >
                        <Download className="h-3 w-3" aria-hidden="true" />
                        {angleCode}
                      </button>
                    ))}
                  </div>
                </td>
                {metadatenAktiv &&
                  daten.allowedFields.map((f) => (
                    <td key={f} className="whitespace-nowrap px-3 py-2">
                      {String(p.breakdown[f] ?? '—')}
                    </td>
                  ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
