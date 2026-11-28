import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PluginLaufzeitKontext } from '@sidelineos/plugin-sdk';
import {
  Building2,
  Film,
  HardDrive,
  RefreshCw,
  Search,
  Share2,
  Trash2,
} from 'lucide-react';
import { useVideoAnalysis } from '../context/VideoAnalysisContext';
import { erstelleVideoTranslator } from '../i18n/woerterbuch';
import type {
  ClubReelUebersicht,
  ReelShareScope,
  VideoReelEintrag,
} from '../types/video';
import { TeamShareModal } from './TeamShareModal';

function formatiereBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const einheiten = ['B', 'KB', 'MB', 'GB', 'TB'];
  let wert = bytes;
  let idx = 0;
  while (wert >= 1024 && idx < einheiten.length - 1) {
    wert /= 1024;
    idx += 1;
  }
  return `${wert.toFixed(idx >= 2 ? 1 : 0)} ${einheiten[idx]}`;
}

export function ClubVideoManagementView({ ctx }: { ctx: PluginLaufzeitKontext }) {
  const t = erstelleVideoTranslator(ctx.locale);
  const { api } = useVideoAnalysis();

  const [reels, setReels] = useState<ClubReelUebersicht[]>([]);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [suche, setSuche] = useState('');
  const [teamFilter, setTeamFilter] = useState<string>('ALL');
  const [saisonFilter, setSaisonFilter] = useState<string>('ALL');
  const [scopeFilter, setScopeFilter] = useState<'ALL' | ReelShareScope>('ALL');
  const [shareZiel, setShareZiel] = useState<ClubReelUebersicht | null>(null);

  const ladeClubDaten = useCallback(async () => {
    setLaedt(true);
    setFehler(null);
    try {
      const res = await api.holeClubReels();
      setReels(res.reels);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Vereins-Videos konnten nicht geladen werden.');
    } finally {
      setLaedt(false);
    }
  }, [api]);

  useEffect(() => {
    void ladeClubDaten();
  }, [ladeClubDaten]);

  const alleTeams = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of reels) {
      if (r.ownerTeamId) {
        map.set(r.ownerTeamId, r.ownerTeamName || r.ownerTeamId);
      }
      for (const sh of r.sharedTeams) {
        map.set(sh.teamId, sh.teamName || sh.teamId);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [reels]);

  const alleSaisons = useMemo(() => {
    const set = new Set<string>();
    for (const r of reels) {
      if (r.season) set.add(r.season);
    }
    return Array.from(set).sort().reverse();
  }, [reels]);

  const gefilterteReels = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return reels.filter((r) => {
      if (teamFilter !== 'ALL' && r.ownerTeamId !== teamFilter) return false;
      if (saisonFilter !== 'ALL' && r.season !== saisonFilter) return false;
      if (scopeFilter !== 'ALL' && r.shareScope !== scopeFilter) return false;
      if (q) {
        const text = `${r.title} ${r.ownerTeamName} ${r.eventDate} ${r.season}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [reels, suche, teamFilter, saisonFilter, scopeFilter]);

  const gesamtBytes = useMemo(
    () => reels.reduce((sum, r) => sum + (r.totalSizeBytes || 0), 0),
    [reels]
  );

  const speicherQuota = ctx.club?.speicher;
  const quotaBelegt = speicherQuota?.usedBytes ?? gesamtBytes;
  const quotaLimit = speicherQuota?.quotaBytes ?? null;
  const quotaProzent =
    quotaLimit && quotaLimit > 0 ? Math.min(100, Math.round((quotaBelegt / quotaLimit) * 100)) : null;

  const scopeLabel = (reel: ClubReelUebersicht): string => {
    switch (reel.shareScope) {
      case 'PRIVATE_ADMIN':
        return t('scopePrivateAdmin');
      case 'CLUB_WIDE':
        return `${t('scopeClubWide')} (${
          reel.clubWideAccessMode === 'OWN_BREAKDOWN'
            ? t('accessModeOwnBreakdown')
            : t('accessModeReadOnly')
        })`;
      case 'SELECTED_TEAMS':
        return `${t('scopeSelectedTeams')} (${reel.sharedTeams.length})`;
      default:
        return t('scopeTeamOnly');
    }
  };

  const handleLoeschen = async (reel: ClubReelUebersicht) => {
    setFehler(null);
    try {
      await api.loescheClubReel(reel.reelId);
      setReels((alt) => alt.filter((r) => r.reelId !== reel.reelId));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Reel konnte nicht gelöscht werden.');
    }
  };

  const alsVideoReelEintrag = (clubReel: ClubReelUebersicht): VideoReelEintrag => ({
    id: clubReel.reelId,
    accessId: `club-${clubReel.reelId}`,
    teamId: clubReel.ownerTeamId,
    clubId: clubReel.ownerClubId,
    saison: clubReel.season,
    title: clubReel.title,
    category: clubReel.category,
    eventDate: clubReel.eventDate,
    visibility: clubReel.visibility,
    angles: clubReel.angles,
    playCount: clubReel.playCount,
    shareScope: clubReel.shareScope,
    clubWideAccessMode: clubReel.clubWideAccessMode,
    sharedFromTeamName: clubReel.ownerTeamName,
    totalSizeBytes: clubReel.totalSizeBytes,
    refCount: clubReel.refCount,
    sharedTeams: clubReel.sharedTeams,
    createdBy: clubReel.createdBy || ctx.user.uuid,
    createdAt: clubReel.createdAt,
    updatedAt: clubReel.updatedAt,
  });

  if (ctx.clubRolle !== 'CLUB_ADMIN') {
    return (
      <div className="rounded-xl border border-sl-border bg-sl-surface p-8 text-center text-sm text-sl-muted">
        Die vereinsweite Videoverwaltung ist ausschließlich für Club-Administratoren verfügbar.
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-sl-accent">
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{ctx.club?.name ?? 'Verein'}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-sl-heading">
            {t('clubLibraryTitle')}
          </h1>
          <p className="text-sm text-sl-muted">{t('clubLibrarySubtitle')}</p>
        </div>

        <button
          type="button"
          onClick={() => void ladeClubDaten()}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-sl-border bg-sl-surface px-3.5 text-xs font-medium text-sl-heading hover:border-sl-accent whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${laedt ? 'animate-spin' : ''}`} aria-hidden="true" />
          Aktualisieren
        </button>
      </header>

      {/* Vereinsspeicher & Kennzahlen */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-sl-border bg-sl-surface p-4 space-y-2 md:col-span-2">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-2 font-semibold text-sl-heading">
              <HardDrive className="h-4 w-4 text-sl-accent" aria-hidden="true" />
              Vereinsspeicher (Zero-Copy dedupliziert)
            </span>
            <span className="font-mono text-sl-primary video-tabular">
              {formatiereBytes(quotaBelegt)}
              {quotaLimit ? ` / ${formatiereBytes(quotaLimit)}` : ''}
              {quotaProzent !== null ? ` (${quotaProzent}%)` : ''}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-sl-canvas">
            <div
              className="h-full bg-sl-accent transition-all"
              style={{ width: `${quotaProzent ?? Math.min(100, reels.length > 0 ? 15 : 0)}%` }}
            />
          </div>
          <div className="text-[11px] text-sl-muted video-tabular">
            Videoanalyse-Reels: {formatiereBytes(gesamtBytes)} über {reels.length} Medien-Reels
            (Team-Freigaben teilen dieselben Storage-Objekte per Referenzzähler).
          </div>
        </div>

        <div className="rounded-xl border border-sl-border bg-sl-surface p-4 flex flex-col justify-between">
          <span className="text-xs text-sl-muted">Freigabe-Verteilung</span>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs video-tabular">
            <div>
              <div className="font-mono text-lg font-bold text-sl-heading">
                {reels.filter((r) => r.shareScope === 'CLUB_WIDE').length}
              </div>
              <div className="text-[11px] text-sl-muted">Vereinsweit</div>
            </div>
            <div>
              <div className="font-mono text-lg font-bold text-sl-heading">
                {reels.filter((r) => r.shareScope === 'SELECTED_TEAMS').length}
              </div>
              <div className="text-[11px] text-sl-muted">Team-Freigaben</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filterleiste */}
      <div className="flex flex-wrap items-center gap-3 border-b border-sl-border pb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sl-subtle"
            aria-hidden="true"
          />
          <input
            type="search"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-9 w-full rounded-lg border border-sl-border bg-sl-surface pl-9 pr-3 text-xs text-sl-primary placeholder:text-sl-subtle focus:border-sl-accent focus:outline-none"
          />
        </div>

        <select
          aria-label="Nach Quell-Team filtern"
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className="h-9 rounded-lg border border-sl-border bg-sl-surface px-3 text-xs text-sl-heading focus:border-sl-accent focus:outline-none"
        >
          <option value="ALL">Alle Teams</option>
          {alleTeams.map((tm) => (
            <option key={tm.id} value={tm.id}>
              {tm.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Nach Saison filtern"
          value={saisonFilter}
          onChange={(e) => setSaisonFilter(e.target.value)}
          className="h-9 rounded-lg border border-sl-border bg-sl-surface px-3 text-xs text-sl-heading focus:border-sl-accent focus:outline-none"
        >
          <option value="ALL">Alle Saisons</option>
          {alleSaisons.map((s) => (
            <option key={s} value={s}>
              Saison {s}
            </option>
          ))}
        </select>

        <select
          aria-label="Nach Freigabe-Status filtern"
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value as 'ALL' | ReelShareScope)}
          className="h-9 rounded-lg border border-sl-border bg-sl-surface px-3 text-xs text-sl-heading focus:border-sl-accent focus:outline-none"
        >
          <option value="ALL">Alle Freigaben</option>
          <option value="PRIVATE_ADMIN">{t('scopePrivateAdmin')}</option>
          <option value="TEAM_ONLY">{t('scopeTeamOnly')}</option>
          <option value="CLUB_WIDE">{t('scopeClubWide')}</option>
          <option value="SELECTED_TEAMS">{t('scopeSelectedTeams')}</option>
        </select>
      </div>

      {fehler && (
        <div className="rounded-lg border border-sl-danger/40 bg-sl-danger/10 px-4 py-3 text-xs text-sl-danger-text">
          {fehler}
        </div>
      )}

      {laedt ? (
        <div className="space-y-2">
          {[1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="h-14 animate-pulse rounded-lg border border-sl-border bg-sl-surface"
            />
          ))}
        </div>
      ) : gefilterteReels.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-sl-border bg-sl-surface px-6 py-14 text-center">
          <Film className="h-8 w-8 text-sl-subtle" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold text-sl-heading">
            Keine Vereins-Videos gefunden
          </h2>
          <p className="mt-1 text-xs text-sl-muted">
            Sobald Teams Spiel- oder Trainingsvideos hochladen, erscheinen sie hier zur zentralen
            Freigabe- und Speicherverwaltung.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-sl-border bg-sl-surface">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-sl-border bg-sl-canvas font-mono text-[11px] text-sl-muted">
                <th className="px-4 py-2.5">Reel &amp; Datum</th>
                <th className="px-4 py-2.5">Quell-Team</th>
                <th className="px-4 py-2.5">Saison</th>
                <th className="px-4 py-2.5">Freigabe-Status</th>
                <th className="px-4 py-2.5 text-right">Plays / Refs</th>
                <th className="px-4 py-2.5 text-right">Größe</th>
                <th className="px-4 py-2.5 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {gefilterteReels.map((reel) => (
                <tr
                  key={reel.reelId}
                  className="border-b border-sl-border/60 last:border-0 hover:bg-sl-elevated/40"
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold text-sl-heading">{reel.title}</div>
                    <div className="text-[11px] text-sl-muted video-tabular">
                      {reel.eventDate} · {reel.angles.join(' / ')}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sl-primary">{reel.ownerTeamName}</td>
                  <td className="px-4 py-3 font-mono text-sl-muted video-tabular">
                    {reel.season}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-sl-heading">{scopeLabel(reel)}</div>
                    {reel.sharedTeams.length > 0 && (
                      <div className="text-[11px] text-sl-muted">
                        {reel.sharedTeams
                          .map(
                            (s) =>
                              `${s.teamName} (${
                                s.accessMode === 'OWN_BREAKDOWN' ? 'Breakdown' : 'Lesen'
                              })`
                          )
                          .join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sl-primary video-tabular">
                    {reel.playCount} · {reel.refCount}×
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sl-muted video-tabular">
                    {formatiereBytes(reel.totalSizeBytes)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShareZiel(reel)}
                        className="inline-flex items-center gap-1 rounded-md border border-sl-border bg-sl-canvas px-2.5 py-1 text-xs font-medium text-sl-heading hover:border-sl-accent whitespace-nowrap"
                      >
                        <Share2 className="h-3 w-3" aria-hidden="true" />
                        Freigaben
                      </button>
                      <button
                        type="button"
                        title="Vereinsweit löschen"
                        onClick={() => void handleLoeschen(reel)}
                        className="rounded-md p-1.5 text-sl-muted hover:bg-sl-danger/15 hover:text-sl-danger-text"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {shareZiel && (
        <TeamShareModal
          ctx={ctx}
          reel={alsVideoReelEintrag(shareZiel)}
          clubScopeMode
          onSchliessen={() => setShareZiel(null)}
          onAktualisiert={ladeClubDaten}
        />
      )}
    </section>
  );
}
