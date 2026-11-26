import { useEffect, useState } from 'react';
import type { PluginLaufzeitKontext } from '@sidelineos/plugin-sdk';
import { createPluginTranslator } from '@sidelineos/plugin-sdk';
import { Copy, ExternalLink, Link2, Trash2, Users, X } from 'lucide-react';
import { useVideoAnalysis } from '../context/VideoAnalysisContext';
import { VIDEO_WOERTERBUCH } from '../i18n/woerterbuch';
import { videoApi } from '../services/apiClient';
import { erstelleStandardTeamSchema } from '../services/taggingEngine';
import type { PublicShareLinkInfo, VideoReelEintrag } from '../types/video';

export function TeamShareModal({
  ctx,
  reel,
  onSchliessen,
}: {
  ctx: PluginLaufzeitKontext;
  reel: VideoReelEintrag;
  onSchliessen: () => void;
}) {
  const t = createPluginTranslator(VIDEO_WOERTERBUCH, ctx.locale);
  const { teamSchema } = useVideoAnalysis();
  const schema = teamSchema ?? erstelleStandardTeamSchema(ctx.team.id);
  const alleFelder = schema.fields.filter((f) => f.aktiv);

  const [ausgewaehlteFelder, setAusgewaehlteFelder] = useState<string[]>(
    alleFelder.map((f) => f.key)
  );
  const [targetTeamId, setTargetTeamId] = useState('');
  const [linkLabel, setLinkLabel] = useState('Scouting-Austausch');
  const [laufzeitTage, setLaufzeitTage] = useState(7);
  const [links, setLinks] = useState<PublicShareLinkInfo[]>([]);
  const [neuerToken, setNeuerToken] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);

  useEffect(() => {
    videoApi
      .holeShareLinks(ctx.team.id, reel.id)
      .then((res) => setLinks(res.links))
      .catch(() => undefined);
  }, [ctx.team.id, reel.id]);

  const toggleFeld = (key: string) => {
    setAusgewaehlteFelder((alt) =>
      alt.includes(key) ? alt.filter((k) => k !== key) : [...alt, key]
    );
  };

  const handleTeamShare = async () => {
    if (!targetTeamId.trim()) return;
    await videoApi.teileAnTeam(ctx.team.id, reel.id, {
      targetTeamId: targetTeamId.trim(),
      allowedFields: ausgewaehlteFelder,
    });
    setHinweis(`Reel an Team "${targetTeamId.trim()}" geteilt (Coach-Notizen & Zeichnungen bleiben privat).`);
    setTargetTeamId('');
  };

  const handleLinkErstellen = async () => {
    const res = await videoApi.erstelleShareLink(ctx.team.id, reel.id, {
      label: linkLabel,
      allowedFields: ausgewaehlteFelder,
      expiresInDays: laufzeitTage,
    });
    setLinks((alt) => [res.link, ...alt]);
    if (res.link.token) {
      setNeuerToken(res.link.token);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={t('shareModalTitle')}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-sl-border bg-sl-surface p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-sl-border pb-4">
          <div>
            <h2 className="text-lg font-semibold text-sl-heading">{t('shareModalTitle')}</h2>
            <p className="text-xs text-sl-muted">{reel.title}</p>
          </div>
          <button
            type="button"
            onClick={onSchliessen}
            className="rounded-md p-1.5 text-sl-muted hover:bg-sl-elevated hover:text-sl-heading"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Granulare Spaltenauswahl */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-sl-heading">
              Freigegebene Breakdown-Spalten (Coach-Notizen &amp; Zeichnungen bleiben immer privat)
            </span>
            <button
              type="button"
              onClick={() =>
                setAusgewaehlteFelder(
                  ausgewaehlteFelder.length === alleFelder.length
                    ? []
                    : alleFelder.map((f) => f.key)
                )
              }
              className="text-sl-accent hover:underline"
            >
              Alle umschalten
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-sl-border bg-sl-canvas p-3 sm:grid-cols-4">
            {alleFelder.map((feld) => (
              <label key={feld.key} className="inline-flex items-center gap-1.5 text-xs text-sl-primary">
                <input
                  type="checkbox"
                  checked={ausgewaehlteFelder.includes(feld.key)}
                  onChange={() => toggleFeld(feld.key)}
                  className="accent-sl-accent"
                />
                <span className="truncate">{feld.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Team-zu-Team-Austausch */}
        <div className="space-y-2 rounded-lg border border-sl-border bg-sl-canvas p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-sl-heading">
            <Users className="h-4 w-4 text-sl-accent" aria-hidden="true" />
            Team-zu-Team Austausch
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={targetTeamId}
              onChange={(e) => setTargetTeamId(e.target.value)}
              placeholder="Ziel-Team-ID oder Federation-Target..."
              className="flex-1 rounded-md border border-sl-border bg-sl-surface px-3 py-1.5 text-xs text-sl-heading focus:border-sl-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={handleTeamShare}
              className="rounded-md bg-sl-elevated px-3 py-1.5 text-xs font-medium text-sl-heading hover:bg-sl-border-strong"
            >
              An Team teilen
            </button>
          </div>
        </div>

        {/* Öffentlicher /share/<token>-Link */}
        <div className="space-y-3 rounded-lg border border-sl-border bg-sl-canvas p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-sl-heading">
            <Link2 className="h-4 w-4 text-sl-accent" aria-hidden="true" />
            Öffentlicher Download-Link (/share/&lt;token&gt;)
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={linkLabel}
              onChange={(e) => setLinkLabel(e.target.value)}
              className="flex-1 min-w-[160px] rounded-md border border-sl-border bg-sl-surface px-3 py-1.5 text-xs text-sl-heading"
            />
            <select
              value={laufzeitTage}
              onChange={(e) => setLaufzeitTage(Number(e.target.value))}
              className="rounded-md border border-sl-border bg-sl-surface px-2.5 py-1.5 text-xs text-sl-heading"
            >
              <option value={1}>1 Tag</option>
              <option value={7}>7 Tage</option>
              <option value={30}>30 Tage</option>
            </select>
            <button
              type="button"
              onClick={handleLinkErstellen}
              className="rounded-md bg-sl-accent px-3 py-1.5 text-xs font-semibold text-sl-accent-contrast hover:bg-sl-accent-hover"
            >
              Link erzeugen
            </button>
          </div>

          {neuerToken && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-sl-accent/50 bg-sl-surface px-3 py-2 text-xs">
              <code className="truncate font-mono text-sl-accent">/share/{neuerToken}</code>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    navigator.clipboard?.writeText(`${window.location.origin}/share/${neuerToken}`)
                  }
                  className="inline-flex items-center gap-1 rounded bg-sl-elevated px-2 py-1 text-sl-heading"
                >
                  <Copy className="h-3 w-3" aria-hidden="true" /> Kopieren
                </button>
                {ctx.onPublicShareOeffnen && (
                  <button
                    type="button"
                    onClick={() => ctx.onPublicShareOeffnen?.(neuerToken)}
                    className="inline-flex items-center gap-1 rounded bg-sl-elevated px-2 py-1 text-sl-heading"
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden="true" /> Vorschau
                  </button>
                )}
              </div>
            </div>
          )}

          {links.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {links.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between text-xs text-sl-muted"
                >
                  <span>
                    {l.label} · läuft ab {l.expiresAt.slice(0, 10)}{' '}
                    {l.revokedAt ? '(widerrufen)' : ''}
                  </span>
                  {!l.revokedAt && (
                    <button
                      type="button"
                      onClick={async () => {
                        await videoApi.widerrufeShareLink(ctx.team.id, l.id);
                        setLinks((alt) =>
                          alt.map((x) =>
                            x.id === l.id ? { ...x, revokedAt: new Date().toISOString() } : x
                          )
                        );
                      }}
                      className="inline-flex items-center gap-1 text-sl-danger-text hover:underline"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" /> Widerrufen
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {hinweis && <p className="text-xs text-sl-accent">{hinweis}</p>}
      </div>
    </div>
  );
}
