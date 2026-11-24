import { useEffect, useState } from 'react';
import { createPluginTranslator } from '@sidelineos/plugin-sdk';
import { ArrowLeft, Download, FileSpreadsheet, Film } from 'lucide-react';
import { VIDEO_WOERTERBUCH } from '../i18n/woerterbuch';
import { videoApi } from '../services/apiClient';
import {
  konvertierePlaysZuCsv,
  konvertiereReelZuSidelineBundle,
} from '../services/bundleSchema';
import type { PublicShareAnsichtDaten } from '../types/video';

export function PublicShareView({
  token,
  locale,
  onSchliessen,
}: {
  token: string;
  locale?: string;
  onSchliessen: () => void;
}) {
  const t = createPluginTranslator(VIDEO_WOERTERBUCH, locale);
  const [status, setStatus] = useState<number>(200);
  const [laedt, setLaedt] = useState(true);
  const [daten, setDaten] = useState<PublicShareAnsichtDaten | null>(null);
  const [aktivesPlayIdx, setAktivesPlayIdx] = useState(0);
  const [aktiverWinkel, setAktiverWinkel] = useState('SIDELINE');

  useEffect(() => {
    setLaedt(true);
    videoApi
      .holeOeffentlichenShare(token)
      .then((res) => {
        setStatus(res.status);
        setDaten(res.data ?? null);
        if (res.data?.reel.angles[0]) {
          setAktiverWinkel(res.data.reel.angles[0]);
        }
      })
      .finally(() => setLaedt(false));
  }, [token]);

  if (laedt) {
    return (
      <div className="mx-auto max-w-4xl rounded-xl border border-[#232933] bg-[#13171D] p-8 text-center text-sm text-[#8B949E]">
        Lade Freigabe-Ansicht...
      </div>
    );
  }

  if (status === 410 || status === 404 || !daten) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-[#232933] bg-[#13171D] p-8 text-center space-y-4">
        <Film className="mx-auto h-8 w-8 text-[#6E7681]" aria-hidden="true" />
        <h1 className="text-lg font-bold text-white">
          {status === 410 ? '410 — Link abgelaufen' : '404 — Nicht gefunden'}
        </h1>
        <p className="text-sm text-[#8B949E]">
          {status === 410 ? t('publicShareExpired') : t('publicShareNotFound')}
        </p>
        <button
          type="button"
          onClick={onSchliessen}
          className="inline-flex items-center gap-2 rounded-lg border border-[#232933] px-4 py-2 text-xs text-white hover:bg-[#232933]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Zurück
        </button>
      </div>
    );
  }

  const aktivesPlay = daten.plays[aktivesPlayIdx];
  const quelle = aktivesPlay?.sources[aktiverWinkel] ??
    (aktivesPlay ? Object.values(aktivesPlay.sources)[0] : undefined);

  const ladeJsonHerunter = () => {
    const bundle = konvertiereReelZuSidelineBundle(
      {
        title: daten.reel.title,
        category: daten.reel.category,
        eventDate: daten.reel.eventDate,
        visibility: 'COACHES_ONLY',
        angles: daten.reel.angles,
      },
      daten.plays,
      { allowedFields: daten.allowedFields, includeVisibility: false }
    );
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${daten.reel.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const ladeCsvHerunter = () => {
    const csv = konvertierePlaysZuCsv(daten.plays, daten.allowedFields);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${daten.reel.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#232933] bg-[#13171D] p-5">
        <div className="space-y-1">
          <div className="text-xs text-[#F59E0B]">{t('publicShareTitle')}</div>
          <h1 className="text-xl font-bold text-white">{daten.reel.title}</h1>
          <div className="text-xs text-[#8B949E] video-tabular">
            {daten.reel.eventDate} · {daten.plays.length} Spielzüge · Gültig bis{' '}
            {daten.expiresAt.slice(0, 10)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={ladeJsonHerunter}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#232933] bg-[#0B0E11] px-3 py-2 text-xs text-white hover:border-[#F59E0B]"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            JSON
          </button>
          <button
            type="button"
            onClick={ladeCsvHerunter}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#232933] bg-[#0B0E11] px-3 py-2 text-xs text-white hover:border-[#F59E0B]"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
            CSV
          </button>
          <button
            type="button"
            onClick={onSchliessen}
            className="rounded-lg bg-[#232933] px-3 py-2 text-xs font-medium text-white hover:bg-[#36404F]"
          >
            Schließen
          </button>
        </div>
      </header>

      {/* Multi-Angle-Vorschau (ohne Coach-Notizen oder Telestrationen) */}
      <div className="rounded-xl border border-[#232933] bg-[#13171D] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-white video-tabular">
            Play #{aktivesPlay?.playNumber ?? 1} · {aktiverWinkel}
          </span>
          <div className="flex items-center gap-1">
            {daten.reel.angles.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAktiverWinkel(a)}
                className={`rounded px-2.5 py-1 text-xs ${
                  aktiverWinkel === a
                    ? 'bg-[#F59E0B] font-semibold text-[#0B0E11]'
                    : 'bg-[#0B0E11] text-[#8B949E]'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="flex aspect-video items-center justify-center rounded-lg bg-[#07090C] font-mono text-xs text-[#8B949E]">
          {quelle?.streamUrl ? (
            <video src={quelle.streamUrl} controls className="h-full w-full object-contain" />
          ) : (
            <span>{quelle?.fileName ?? 'Vorschau-Clip'}</span>
          )}
        </div>
      </div>

      {/* Ausschließlich freigegebene Breakdown-Spalten */}
      <div className="overflow-x-auto rounded-xl border border-[#232933] bg-[#13171D]">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[#232933] bg-[#0B0E11] font-mono text-[11px] text-[#8B949E]">
              <th className="px-3 py-2.5">PLAY #</th>
              {daten.allowedFields.map((f) => (
                <th key={f} className="whitespace-nowrap px-3 py-2.5 uppercase">
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
                className={`cursor-pointer border-b border-[#232933]/60 ${
                  idx === aktivesPlayIdx ? 'bg-[#F59E0B]/10 text-white' : 'text-[#E6EDF3]'
                }`}
              >
                <td className="px-3 py-2 font-mono video-tabular">{p.playNumber}</td>
                {daten.allowedFields.map((f) => (
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
