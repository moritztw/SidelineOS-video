import { useMemo, useState } from 'react';
import type { PluginLaufzeitKontext } from '@sidelineos/plugin-sdk';
import { ListFilter, MessageSquare, Pencil, Play, Plus, Save, Trash2 } from 'lucide-react';
import { useVideoAnalysis } from '../context/VideoAnalysisContext';
import { erstelleVideoTranslator } from '../i18n/woerterbuch';
import {
  bereinigeAnmerkungsKonfig,
  filtereTelestrationElementeFuerBenutzer,
  istAnmerkungFuerBenutzerSichtbar,
  istStaffOderAdminRolle,
  sammlePlayAnmerkungsZaehler,
} from '../services/annotationVisibility';
import { filterePlaysNachRegeln } from '../services/smartPlaylistEngine';
import { erstelleStandardTeamSchema } from '../services/taggingEngine';
import type { PlaylistFilterOperator, PlaylistFilterRegel, SmartPlaylist } from '../types/video';

const OPERATOREN: Array<{ id: PlaylistFilterOperator; label: string }> = [
  { id: 'equals', label: 'gleich (=)' },
  { id: 'not_equals', label: 'ungleich (≠)' },
  { id: 'contains', label: 'enthält' },
  { id: 'gt', label: 'größer (>)' },
  { id: 'gte', label: 'min. (≥)' },
  { id: 'lt', label: 'kleiner (<)' },
  { id: 'lte', label: 'max. (≤)' },
  { id: 'not_empty', label: 'ausgefüllt' },
];

export function SmartPlaylistView({ ctx }: { ctx: PluginLaufzeitKontext }) {
  const t = erstelleVideoTranslator(ctx.locale);
  const {
    api,
    aktivesReel,
    aktivePlays,
    telestrations,
    notizen,
    teamSchema,
    playlists,
    seasons,
    gewaehlteSaison,
    setPlaylists,
    setAktiverPlaylistFilterIds,
  } = useVideoAnalysis();

  const teamId = ctx.team?.id ?? 'team';
  const istStaffOderAdmin = istStaffOderAdminRolle(ctx.effektiveTeamRolle);
  const schema = teamSchema ?? erstelleStandardTeamSchema(teamId);
  const aktiveFelder = schema.fields.filter((f) => f.aktiv);
  const sharingKonfig = useMemo(
    () => bereinigeAnmerkungsKonfig(schema.annotationSharing),
    [schema.annotationSharing]
  );

  const [name, setName] = useState('');
  const [matchMode, setMatchMode] = useState<'ALL' | 'ANY'>('ALL');
  const [regeln, setRegeln] = useState<PlaylistFilterRegel[]>([
    { id: 'r-1', fieldKey: 'down', operator: 'equals', value: '3' },
  ]);

  const trefferPlays = useMemo(
    () => filterePlaysNachRegeln(aktivePlays, regeln, matchMode),
    [aktivePlays, regeln, matchMode]
  );

  const anmerkungenProPlay = useMemo(() => {
    const sichtbareTel = telestrations
      .map((tel) => ({
        ...tel,
        elements: filtereTelestrationElementeFuerBenutzer(
          tel.elements,
          ctx.effektiveTeamRolle,
          ctx.userGroups,
          sharingKonfig.enabled
        ),
      }))
      .filter((tel) => tel.elements.length > 0);
    const sichtbareNotizen = notizen.filter(
      (n) =>
        (istStaffOderAdmin || n.status === 'PUBLISHED') &&
        istAnmerkungFuerBenutzerSichtbar(
          n.visibility,
          ctx.effektiveTeamRolle,
          ctx.userGroups,
          sharingKonfig.enabled
        )
    );
    return sammlePlayAnmerkungsZaehler(sichtbareTel, sichtbareNotizen);
  }, [telestrations, notizen, ctx.effektiveTeamRolle, ctx.userGroups, istStaffOderAdmin, sharingKonfig.enabled]);

  const handleRegelHinzufuegen = () => {
    setRegeln((alt) => [
      ...alt,
      {
        id: `r-${Date.now()}`,
        fieldKey: aktiveFelder[0]?.key ?? 'odk',
        operator: 'equals',
        value: '',
      },
    ]);
  };

  const aktiveSaisonName =
    gewaehlteSaison !== 'ALL'
      ? gewaehlteSaison
      : seasons.find((s) => s.isActive)?.name ?? new Date().toISOString().slice(0, 4);

  const handlePlaylistSpeichern = async () => {
    if (!name.trim() || ctx.isReadOnly) return;
    const res = await api.erstellePlaylist({
      name: name.trim(),
      description: `${regeln.length} Filterregeln (${matchMode})`,
      season: aktiveSaisonName,
      matchMode,
      rules: regeln,
      playIds: trefferPlays.map((p) => p.id),
    });
    const neu: SmartPlaylist = {
      id: res.id,
      teamId,
      name: name.trim(),
      description: `${regeln.length} Filterregeln (${matchMode})`,
      season: aktiveSaisonName,
      matchMode,
      rules: regeln,
      playIds: trefferPlays.map((p) => p.id),
      createdBy: ctx.user.uuid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setPlaylists([neu, ...playlists]);
    setName('');
  };

  const handleImFilmRoomStarten = (ids: string[]) => {
    setAktiverPlaylistFilterIds(ids);
    ctx.navigateToView('film-room');
  };

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-sl-heading">{t('playlistsTitle')}</h1>
          <p className="text-xs text-sl-muted">
            Typsicheres Filter-Grid über Standard- und Custom-Breakdown-Spalten.
          </p>
        </div>
        {aktivesReel && (
          <button
            type="button"
            disabled={trefferPlays.length === 0}
            onClick={() => handleImFilmRoomStarten(trefferPlays.map((p) => p.id))}
            className="inline-flex items-center gap-2 rounded-lg bg-sl-accent px-4 py-2 text-xs font-semibold text-sl-accent-contrast hover:bg-sl-accent-hover disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            {trefferPlays.length} Treffer im Film Room öffnen
          </button>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Regel-Editor */}
        <div className="space-y-4 rounded-xl border border-sl-border bg-sl-surface p-5 lg:col-span-7">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-sl-heading">
              <ListFilter className="h-4 w-4 text-sl-accent" aria-hidden="true" />
              Filterregeln
            </div>
            <select
              value={matchMode}
              onChange={(e) => setMatchMode(e.target.value as 'ALL' | 'ANY')}
              className="rounded-md border border-sl-border bg-sl-canvas px-2.5 py-1 text-xs text-sl-primary"
            >
              <option value="ALL">Alle Bedingungen (UND)</option>
              <option value="ANY">Mindestens eine (ODER)</option>
            </select>
          </div>

          <div className="space-y-2">
            {regeln.map((regel) => (
              <div key={regel.id} className="flex flex-wrap items-center gap-2">
                <select
                  value={regel.fieldKey}
                  onChange={(e) =>
                    setRegeln((alt) =>
                      alt.map((r) =>
                        r.id === regel.id ? { ...r, fieldKey: e.target.value } : r
                      )
                    )
                  }
                  className="rounded-md border border-sl-border bg-sl-canvas px-2.5 py-1.5 text-xs text-sl-heading"
                >
                  {aktiveFelder.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>

                <select
                  value={regel.operator}
                  onChange={(e) =>
                    setRegeln((alt) =>
                      alt.map((r) =>
                        r.id === regel.id
                          ? { ...r, operator: e.target.value as PlaylistFilterOperator }
                          : r
                      )
                    )
                  }
                  className="rounded-md border border-sl-border bg-sl-canvas px-2.5 py-1.5 text-xs text-sl-heading"
                >
                  {OPERATOREN.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.label}
                    </option>
                  ))}
                </select>

                {regel.operator !== 'not_empty' && (
                  <input
                    type="text"
                    value={regel.value}
                    onChange={(e) =>
                      setRegeln((alt) =>
                        alt.map((r) =>
                          r.id === regel.id ? { ...r, value: e.target.value } : r
                        )
                      )
                    }
                    placeholder="Wert..."
                    className="flex-1 min-w-[120px] rounded-md border border-sl-border bg-sl-canvas px-2.5 py-1.5 text-xs text-sl-heading focus:border-sl-accent focus:outline-none"
                  />
                )}

                <button
                  type="button"
                  onClick={() => setRegeln((alt) => alt.filter((r) => r.id !== regel.id))}
                  className="rounded-md p-1.5 text-sl-muted hover:bg-sl-danger/15 hover:text-sl-danger-text"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sl-border pt-3">
            <button
              type="button"
              onClick={handleRegelHinzufuegen}
              className="inline-flex items-center gap-1.5 rounded-md border border-sl-border bg-sl-canvas px-3 py-1.5 text-xs text-sl-primary hover:border-sl-accent"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Regel hinzufügen
            </button>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Cutup-Name..."
                className="rounded-md border border-sl-border bg-sl-canvas px-3 py-1.5 text-xs text-sl-heading focus:border-sl-accent focus:outline-none"
              />
              <button
                type="button"
                disabled={ctx.isReadOnly}
                onClick={handlePlaylistSpeichern}
                className="inline-flex items-center gap-1.5 rounded-md bg-sl-elevated px-3 py-1.5 text-xs font-medium text-sl-heading hover:bg-sl-border-strong disabled:opacity-45"
              >
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                Speichern
              </button>
            </div>
          </div>
        </div>

        {/* Gespeicherte Cutups */}
        <div className="space-y-3 rounded-xl border border-sl-border bg-sl-surface p-5 lg:col-span-5">
          <h2 className="text-sm font-semibold text-sl-heading">Gespeicherte Cutups</h2>
          {playlists.length === 0 ? (
            <p className="text-xs text-sl-muted">
              Noch keine gespeicherten Smart Playlists für diese Saison.
            </p>
          ) : (
            <div className="space-y-2">
              {playlists.map((pl) => (
                <div
                  key={pl.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-sl-border bg-sl-canvas px-3 py-2.5"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setRegeln(pl.rules);
                      setMatchMode(pl.matchMode);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-xs font-semibold text-sl-heading">{pl.name}</div>
                    <div className="text-[11px] text-sl-muted video-tabular">
                      {pl.rules.length} Regeln · {pl.playIds.length} Spielzüge
                    </div>
                  </button>
                  {!ctx.isReadOnly && (
                    <button
                      type="button"
                      onClick={async () => {
                        await api.loeschePlaylist(pl.id);
                        setPlaylists(playlists.filter((p) => p.id !== pl.id));
                      }}
                      className="rounded p-1.5 text-sl-muted hover:text-sl-danger-text"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {aktivesReel && trefferPlays.length > 0 && (
        <div className="rounded-xl border border-sl-border bg-sl-surface p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <h2 className="font-semibold text-sl-heading">
              Treffer-Vorschau ({trefferPlays.length} Spielzüge)
            </h2>
            <span className="text-sl-muted">
              Mit Markierungs-Symbolen für annotierte Clips
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {trefferPlays.slice(0, 16).map((play) => {
              const zaehler = anmerkungenProPlay[play.id];
              const hatZeichnung = (zaehler?.drawingFrames ?? 0) > 0;
              const hatNotiz = (zaehler?.noteCount ?? 0) > 0;
              return (
                <button
                  key={play.id}
                  type="button"
                  onClick={() => handleImFilmRoomStarten([play.id])}
                  className="flex items-center justify-between gap-2 rounded-lg border border-sl-border bg-sl-canvas px-3 py-2 text-left text-xs transition-colors hover:border-sl-accent"
                >
                  <div className="min-w-0">
                    <div className="font-mono font-semibold text-sl-heading video-tabular">
                      Play #{play.playNumber}
                    </div>
                    <div className="truncate text-[11px] text-sl-muted">
                      {[
                        play.breakdown.odk,
                        play.breakdown.down ? `D${play.breakdown.down}` : null,
                        play.breakdown.dist ? `&${play.breakdown.dist}` : null,
                        play.breakdown.off_form,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Ohne Tags'}
                    </div>
                  </div>
                  {(hatZeichnung || hatNotiz) && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] text-sl-accent video-tabular">
                      {hatZeichnung && (
                        <span
                          className="inline-flex items-center gap-0.5"
                          title={`${zaehler!.drawingFrames} Zeichnungs-Frame(s)`}
                        >
                          <Pencil className="h-3 w-3" aria-hidden="true" />
                          {zaehler!.drawingFrames}
                        </span>
                      )}
                      {hatNotiz && (
                        <span
                          className="inline-flex items-center gap-0.5 text-sl-primary"
                          title={`${zaehler!.noteCount} Coach-Notiz(en)`}
                        >
                          <MessageSquare className="h-3 w-3" aria-hidden="true" />
                          {zaehler!.noteCount}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
