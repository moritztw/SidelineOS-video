import { useMemo, useState } from 'react';
import type { PluginLaufzeitKontext } from '@sidelineos/plugin-sdk';
import { createPluginTranslator, filtereNachSaison } from '@sidelineos/plugin-sdk';
import {
  Download,
  Film,
  Play,
  Plus,
  Search,
  Share2,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { useVideoAnalysis } from '../context/VideoAnalysisContext';
import { VIDEO_WOERTERBUCH } from '../i18n/woerterbuch';
import { videoApi } from '../services/apiClient';
import { konvertiereReelZuSidelineBundle } from '../services/bundleSchema';
import type { SichtbarkeitsStufe, VideoKategorie, VideoReelEintrag } from '../types/video';
import { TeamShareModal } from './TeamShareModal';

const KATEGORIEN: Array<{ id: 'ALL' | VideoKategorie; labelKey: string }> = [
  { id: 'ALL', labelKey: 'allCategories' },
  { id: 'GAME', labelKey: 'catGame' },
  { id: 'PRACTICE', labelKey: 'catPractice' },
  { id: 'SCOUTING', labelKey: 'catScouting' },
  { id: 'SELF_SCOUT', labelKey: 'catSelfScout' },
];

const SICHTBARKEIT_OPTIONEN: Array<{ id: SichtbarkeitsStufe; labelKey: string }> = [
  { id: 'COACHES_ONLY', labelKey: 'visCoachesOnly' },
  { id: 'ALL_PLAYERS', labelKey: 'visAllPlayers' },
  { id: 'UNIT_OFFENSE', labelKey: 'visUnitOffense' },
  { id: 'UNIT_DEFENSE', labelKey: 'visUnitDefense' },
  { id: 'UNIT_SPECIAL_TEAMS', labelKey: 'visUnitSpecial' },
];

export function DashboardView({ ctx }: { ctx: PluginLaufzeitKontext }) {
  const t = createPluginTranslator(VIDEO_WOERTERBUCH, ctx.locale);
  const {
    reels,
    laedtReels,
    fehler,
    setFehler,
    oeffneReel,
    setUploadModalOffen,
    setReels,
    setAktiverPlaylistFilterIds,
  } = useVideoAnalysis();

  const [suche, setSuche] = useState('');
  const [kategorie, setKategorie] = useState<'ALL' | VideoKategorie>('ALL');
  const [shareReel, setShareReel] = useState<VideoReelEintrag | null>(null);

  const istCoachOderAdmin =
    ctx.aktiveTeamAnsicht === 'COACH' || ctx.aktiveTeamAnsicht === 'TEAM_ADMIN';

  const sichtbareReels = useMemo(() => {
    const nachSaison = filtereNachSaison(reels, ctx.gewaehlteSaison);
    const begriff = suche.trim().toLowerCase();

    return nachSaison.filter((reel) => {
      if (!istCoachOderAdmin && reel.visibility === 'COACHES_ONLY') {
        return false;
      }
      if (kategorie !== 'ALL' && reel.category !== kategorie) {
        return false;
      }
      if (begriff) {
        const text = `${reel.title} ${reel.eventDate} ${reel.sharedFromTeamName ?? ''}`.toLowerCase();
        if (!text.includes(begriff)) return false;
      }
      return true;
    });
  }, [reels, ctx.gewaehlteSaison, suche, kategorie, istCoachOderAdmin]);

  const handleSichtbarkeitWechseln = async (reel: VideoReelEintrag, vis: SichtbarkeitsStufe) => {
    try {
      await videoApi.aktualisiereReel(ctx.team.id, reel.id, { visibility: vis });
      setReels((alt) => alt.map((r) => (r.id === reel.id ? { ...r, visibility: vis } : r)));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Sichtbarkeit konnte nicht gespeichert werden.');
    }
  };

  const handleLoeschen = async (reel: VideoReelEintrag) => {
    try {
      await videoApi.loescheReel(ctx.team.id, reel.id);
      setReels((alt) => alt.filter((r) => r.id !== reel.id));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Reel konnte nicht entfernt werden.');
    }
  };

  const handleBundleExport = async (reel: VideoReelEintrag) => {
    try {
      const detail = await videoApi.holeReelDetails(ctx.team.id, reel.id);
      const bundle = konvertiereReelZuSidelineBundle(detail.reel, detail.plays);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${reel.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.sideline-bundle.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Export fehlgeschlagen.');
    }
  };

  const kategorieLabel = (kat: VideoKategorie): string => {
    switch (kat) {
      case 'GAME':
        return t('catGame');
      case 'PRACTICE':
        return t('catPractice');
      case 'SCOUTING':
        return t('catScouting');
      case 'SELF_SCOUT':
        return t('catSelfScout');
      default:
        return t('catCustom');
    }
  };

  const sichtbarkeitLabel = (vis: SichtbarkeitsStufe): string => {
    const gefunden = SICHTBARKEIT_OPTIONEN.find((o) => o.id === vis);
    return gefunden ? t(gefunden.labelKey) : vis;
  };

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-sl-heading">{t('libraryTitle')}</h1>
          <p className="text-sm text-sl-muted">{t('librarySubtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sl-subtle"
              aria-hidden="true"
            />
            <input
              type="search"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="h-9 w-64 rounded-lg border border-sl-border bg-sl-surface pl-9 pr-3 text-sm text-sl-primary placeholder:text-sl-subtle focus:border-sl-accent focus:outline-none"
            />
          </div>
          {istCoachOderAdmin && (
            <button
              type="button"
              onClick={() => setUploadModalOffen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-sl-accent px-4 text-xs font-semibold text-sl-accent-contrast transition-colors hover:bg-sl-accent-hover whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('importAction')}
            </button>
          )}
        </div>
      </header>

      {/* Kategorie-Filterleiste */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sl-border pb-3">
        <div className="flex items-center gap-1 rounded-lg border border-sl-border bg-sl-surface p-1">
          {KATEGORIEN.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setKategorie(item.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                kategorie === item.id
                  ? 'bg-sl-elevated text-sl-heading'
                  : 'text-sl-muted hover:text-sl-primary'
              }`}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </div>
        <div className="text-xs text-sl-muted video-tabular">
          {ctx.team.name} · Saison {ctx.gewaehlteSaison === 'ALL' ? 'Alle' : ctx.gewaehlteSaison} ·{' '}
          {sichtbareReels.length} Reels
        </div>
      </div>

      {fehler && (
        <div className="rounded-lg border border-sl-danger/40 bg-sl-danger/10 px-4 py-3 text-sm text-sl-danger-text">
          {fehler}
        </div>
      )}

      {laedtReels ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="h-44 animate-pulse rounded-xl border border-sl-border bg-sl-surface"
            />
          ))}
        </div>
      ) : sichtbareReels.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-sl-border bg-sl-surface px-6 py-14 text-center">
          <Film className="h-8 w-8 text-sl-subtle" aria-hidden="true" />
          <h2 className="mt-4 text-base font-semibold text-sl-heading">{t('emptyLibraryTitle')}</h2>
          <p className="mt-1 max-w-md text-sm text-sl-muted">{t('emptyLibraryBody')}</p>
          {istCoachOderAdmin && (
            <button
              type="button"
              onClick={() => setUploadModalOffen(true)}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-sl-accent px-4 py-2 text-xs font-semibold text-sl-accent-contrast hover:bg-sl-accent-hover whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('importAction')}
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sichtbareReels.map((reel) => (
            <article
              key={reel.accessId}
              className="flex flex-col justify-between rounded-xl border border-sl-border bg-sl-surface p-5 transition-colors hover:border-sl-border-strong"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h2 className="truncate text-base font-semibold text-sl-heading">{reel.title}</h2>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-sl-muted video-tabular">
                      <span>{kategorieLabel(reel.category)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{reel.eventDate}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {reel.playCount} {t('playsSuffix')}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{reel.angles.join(' / ')}</span>
                    </div>
                  </div>
                </div>

                {reel.sharedFromTeamName && (
                  <p className="text-xs text-sl-accent">
                    Geteilt von {reel.sharedFromTeamName}
                  </p>
                )}

                <div className="flex items-center justify-between gap-2 pt-1 text-xs">
                  <span className="text-sl-muted">Sichtbarkeit</span>
                  {istCoachOderAdmin ? (
                    <select
                      aria-label={`Sichtbarkeit für ${reel.title}`}
                      value={reel.visibility}
                      onChange={(e) =>
                        handleSichtbarkeitWechseln(reel, e.target.value as SichtbarkeitsStufe)
                      }
                      className="rounded-md border border-sl-border bg-sl-canvas px-2.5 py-1 text-xs text-sl-primary focus:border-sl-accent focus:outline-none"
                    >
                      {SICHTBARKEIT_OPTIONEN.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {t(opt.labelKey)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-sl-primary">{sichtbarkeitLabel(reel.visibility)}</span>
                  )}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-sl-border pt-4">
                <button
                  type="button"
                  onClick={async () => {
                    setAktiverPlaylistFilterIds(null);
                    await oeffneReel(ctx.team.id, reel.id);
                    ctx.onTabWechseln('film-room');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sl-accent px-3 py-1.5 text-xs font-semibold text-sl-accent-contrast transition-colors hover:bg-sl-accent-hover whitespace-nowrap shrink-0"
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('openFilmRoom')}
                </button>

                <div className="flex items-center gap-1">
                  {istCoachOderAdmin && (
                    <button
                      type="button"
                      title={t('openSyncCut')}
                      onClick={async () => {
                        await oeffneReel(ctx.team.id, reel.id);
                        ctx.onTabWechseln('sync-cut');
                      }}
                      className="rounded-md p-2 text-sl-muted transition-colors hover:bg-sl-elevated hover:text-sl-heading"
                    >
                      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                  {istCoachOderAdmin && (
                    <button
                      type="button"
                      title={t('shareReel')}
                      onClick={() => setShareReel(reel)}
                      className="rounded-md p-2 text-sl-muted transition-colors hover:bg-sl-elevated hover:text-sl-heading"
                    >
                      <Share2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    title={t('exportBundle')}
                    onClick={() => handleBundleExport(reel)}
                    className="rounded-md p-2 text-sl-muted transition-colors hover:bg-sl-elevated hover:text-sl-heading"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                  </button>
                  {istCoachOderAdmin && (
                    <button
                      type="button"
                      title={t('deleteReel')}
                      onClick={() => handleLoeschen(reel)}
                      className="rounded-md p-2 text-sl-muted transition-colors hover:bg-sl-danger/15 hover:text-sl-danger-text"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {shareReel && (
        <TeamShareModal
          ctx={ctx}
          reel={shareReel}
          onSchliessen={() => setShareReel(null)}
        />
      )}
    </section>
  );
}
