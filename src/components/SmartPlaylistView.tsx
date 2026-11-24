import { useMemo, useState } from 'react';
import type { PluginLaufzeitKontext } from '@sidelineos/plugin-sdk';
import { createPluginTranslator } from '@sidelineos/plugin-sdk';
import { ListFilter, Play, Plus, Save, Trash2 } from 'lucide-react';
import { useVideoAnalysis } from '../context/VideoAnalysisContext';
import { VIDEO_WOERTERBUCH } from '../i18n/woerterbuch';
import { videoApi } from '../services/apiClient';
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
  const t = createPluginTranslator(VIDEO_WOERTERBUCH, ctx.locale);
  const {
    aktivesReel,
    aktivePlays,
    teamSchema,
    playlists,
    setPlaylists,
    setAktiverPlaylistFilterIds,
  } = useVideoAnalysis();

  const schema = teamSchema ?? erstelleStandardTeamSchema(ctx.team.id);
  const aktiveFelder = schema.fields.filter((f) => f.aktiv);

  const [name, setName] = useState('');
  const [matchMode, setMatchMode] = useState<'ALL' | 'ANY'>('ALL');
  const [regeln, setRegeln] = useState<PlaylistFilterRegel[]>([
    { id: 'r-1', fieldKey: 'down', operator: 'equals', value: '3' },
  ]);

  const trefferPlays = useMemo(
    () => filterePlaysNachRegeln(aktivePlays, regeln, matchMode),
    [aktivePlays, regeln, matchMode]
  );

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

  const handlePlaylistSpeichern = async () => {
    if (!name.trim()) return;
    const res = await videoApi.erstellePlaylist(ctx.team.id, {
      name: name.trim(),
      description: `${regeln.length} Filterregeln (${matchMode})`,
      season: ctx.gewaehlteSaison === 'ALL' ? ctx.team.aktiveSaison : ctx.gewaehlteSaison,
      matchMode,
      rules: regeln,
      playIds: trefferPlays.map((p) => p.id),
    });
    const neu: SmartPlaylist = {
      id: res.id,
      teamId: ctx.team.id,
      name: name.trim(),
      description: `${regeln.length} Filterregeln (${matchMode})`,
      season: ctx.gewaehlteSaison === 'ALL' ? ctx.team.aktiveSaison : ctx.gewaehlteSaison,
      matchMode,
      rules: regeln,
      playIds: trefferPlays.map((p) => p.id),
      createdBy: ctx.benutzer.uuid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setPlaylists([neu, ...playlists]);
    setName('');
  };

  const handleImFilmRoomStarten = (ids: string[]) => {
    setAktiverPlaylistFilterIds(ids);
    ctx.onTabWechseln('film-room');
  };

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white">{t('playlistsTitle')}</h1>
          <p className="text-xs text-[#8B949E]">
            Typsicheres Filter-Grid über Standard- und Custom-Breakdown-Spalten.
          </p>
        </div>
        {aktivesReel && (
          <button
            type="button"
            disabled={trefferPlays.length === 0}
            onClick={() => handleImFilmRoomStarten(trefferPlays.map((p) => p.id))}
            className="inline-flex items-center gap-2 rounded-lg bg-[#F59E0B] px-4 py-2 text-xs font-semibold text-[#0B0E11] hover:bg-[#FBBF24] disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            {trefferPlays.length} Treffer im Film Room öffnen
          </button>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Regel-Editor */}
        <div className="space-y-4 rounded-xl border border-[#232933] bg-[#13171D] p-5 lg:col-span-7">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ListFilter className="h-4 w-4 text-[#F59E0B]" aria-hidden="true" />
              Filterregeln
            </div>
            <select
              value={matchMode}
              onChange={(e) => setMatchMode(e.target.value as 'ALL' | 'ANY')}
              className="rounded-md border border-[#232933] bg-[#0B0E11] px-2.5 py-1 text-xs text-[#E6EDF3]"
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
                  className="rounded-md border border-[#232933] bg-[#0B0E11] px-2.5 py-1.5 text-xs text-white"
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
                  className="rounded-md border border-[#232933] bg-[#0B0E11] px-2.5 py-1.5 text-xs text-white"
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
                    className="flex-1 min-w-[120px] rounded-md border border-[#232933] bg-[#0B0E11] px-2.5 py-1.5 text-xs text-white focus:border-[#F59E0B] focus:outline-none"
                  />
                )}

                <button
                  type="button"
                  onClick={() => setRegeln((alt) => alt.filter((r) => r.id !== regel.id))}
                  className="rounded-md p-1.5 text-[#8B949E] hover:bg-red-950/50 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#232933] pt-3">
            <button
              type="button"
              onClick={handleRegelHinzufuegen}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#232933] bg-[#0B0E11] px-3 py-1.5 text-xs text-[#E6EDF3] hover:border-[#F59E0B]"
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
                className="rounded-md border border-[#232933] bg-[#0B0E11] px-3 py-1.5 text-xs text-white focus:border-[#F59E0B] focus:outline-none"
              />
              <button
                type="button"
                onClick={handlePlaylistSpeichern}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#232933] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#36404F]"
              >
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                Speichern
              </button>
            </div>
          </div>
        </div>

        {/* Gespeicherte Cutups */}
        <div className="space-y-3 rounded-xl border border-[#232933] bg-[#13171D] p-5 lg:col-span-5">
          <h2 className="text-sm font-semibold text-white">Gespeicherte Cutups</h2>
          {playlists.length === 0 ? (
            <p className="text-xs text-[#8B949E]">
              Noch keine gespeicherten Smart Playlists für diese Saison.
            </p>
          ) : (
            <div className="space-y-2">
              {playlists.map((pl) => (
                <div
                  key={pl.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[#232933] bg-[#0B0E11] px-3 py-2.5"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setRegeln(pl.rules);
                      setMatchMode(pl.matchMode);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-xs font-semibold text-white">{pl.name}</div>
                    <div className="text-[11px] text-[#8B949E] video-tabular">
                      {pl.rules.length} Regeln · {pl.playIds.length} Spielzüge
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await videoApi.loeschePlaylist(ctx.team.id, pl.id);
                      setPlaylists(playlists.filter((p) => p.id !== pl.id));
                    }}
                    className="rounded p-1.5 text-[#8B949E] hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
