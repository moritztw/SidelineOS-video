import { useMemo, useState } from 'react';
import type { TeamRolle } from '@sidelineos/plugin-sdk';
import { Plus, Trash2 } from 'lucide-react';
import {
  berechneGainLoss,
  berechneNeueFeldposition,
  ergaenzeTeamWoerterbuch,
  ermittleSichtbareSpalten,
} from '../services/taggingEngine';
import type {
  PlayBreakdownDaten,
  PlayEintrag,
  TeamTaggingSchema,
} from '../types/video';

interface BreakdownGridProps {
  plays: PlayEintrag[];
  aktivesPlayId: string | null;
  schema: TeamTaggingSchema;
  teamRolle: TeamRolle;
  erlaubteSpalten?: string[] | null;
  onSelectPlay: (playId: string) => void;
  onUpdatePlay: (playId: string, breakdown: PlayBreakdownDaten) => Promise<void>;
  onAddPlay?: () => Promise<void>;
  onDeletePlay?: (playId: string) => Promise<void>;
  onSchemaLearn: (nextSchema: TeamTaggingSchema) => Promise<void>;
}

export function BreakdownGrid({
  plays,
  aktivesPlayId,
  schema,
  teamRolle,
  erlaubteSpalten,
  onSelectPlay,
  onUpdatePlay,
  onAddPlay,
  onDeletePlay,
  onSchemaLearn,
}: BreakdownGridProps) {
  const istCoachOderAdmin = teamRolle === 'COACH' || teamRolle === 'TEAM_ADMIN';
  const [fokusFeld, setFokusFeld] = useState<string | null>(null);

  const spalten = useMemo(
    () => ermittleSichtbareSpalten(schema, erlaubteSpalten),
    [schema, erlaubteSpalten]
  );

  const handleFeldAenderung = async (
    play: PlayEintrag,
    index: number,
    key: string,
    rohWert: string
  ) => {
    const naechstesBreakdown: PlayBreakdownDaten = { ...play.breakdown };
    const feldKonfig = spalten.find((s) => s.key === key);

    if (feldKonfig?.typ === 'number') {
      naechstesBreakdown[key] = rohWert.trim() === '' ? undefined : Number(rohWert);
    } else {
      naechstesBreakdown[key] = rohWert;
    }

    const vorherigesPlay = index > 0 ? plays[index - 1] : undefined;
    const vorherYardLn =
      typeof vorherigesPlay?.breakdown.yard_line === 'number'
        ? vorherigesPlay.breakdown.yard_line
        : undefined;

    if (key === 'yard_line') {
      const neueYardLn =
        typeof naechstesBreakdown.yard_line === 'number'
          ? naechstesBreakdown.yard_line
          : undefined;
      const berechneterGain = berechneGainLoss(
        vorherYardLn,
        neueYardLn,
        String(naechstesBreakdown.result ?? '')
      );
      if (berechneterGain !== undefined) {
        naechstesBreakdown.gn_ls = berechneterGain;
      }
    }

    if (key === 'gn_ls') {
      const startYard =
        typeof naechstesBreakdown.yard_line === 'number'
          ? naechstesBreakdown.yard_line
          : vorherYardLn;
      const neuerGain =
        typeof naechstesBreakdown.gn_ls === 'number' ? naechstesBreakdown.gn_ls : undefined;
      if (startYard !== undefined && neuerGain !== undefined) {
        const zielYard = berechneNeueFeldposition(
          startYard,
          neuerGain,
          String(naechstesBreakdown.result ?? '')
        );
        if (zielYard !== undefined && naechstesBreakdown.yard_line === undefined) {
          naechstesBreakdown.yard_line = zielYard;
        }
      }
    }

    await onUpdatePlay(play.id, naechstesBreakdown);

    if (
      feldKonfig?.typ === 'text' &&
      rohWert.trim().length > 1
    ) {
      const gelernt = ergaenzeTeamWoerterbuch(schema, key, rohWert);
      if (gelernt !== schema) {
        await onSchemaLearn(gelernt);
      }
    }
  };

  return (
    <div className="rounded-xl border border-[#232933] bg-[#13171D]">
      <div className="flex items-center justify-between border-b border-[#232933] px-4 py-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-white">Hudl-Breakdown</h3>
          <span className="text-xs text-[#8B949E] video-tabular">{plays.length} Spielzüge</span>
        </div>
        {istCoachOderAdmin && onAddPlay && (
          <button
            type="button"
            onClick={onAddPlay}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#232933] bg-[#0B0E11] px-3 py-1.5 text-xs font-medium text-[#E6EDF3] hover:border-[#F59E0B] hover:text-white whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Spielzug
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[#232933] bg-[#0B0E11] text-[11px] font-semibold text-[#8B949E]">
              {spalten.map((spalte) => (
                <th
                  key={spalte.key}
                  className="whitespace-nowrap px-2.5 py-2.5 font-mono"
                >
                  {spalte.label}
                </th>
              ))}
              {istCoachOderAdmin && onDeletePlay && (
                <th className="w-10 px-2 py-2.5 text-right" />
              )}
            </tr>
          </thead>
          <tbody>
            {plays.map((play, idx) => {
              const aktiv = play.id === aktivesPlayId;
              return (
                <tr
                  key={play.id}
                  onClick={() => onSelectPlay(play.id)}
                  className={`h-9 cursor-pointer border-b border-[#232933]/60 transition-colors ${
                    aktiv
                      ? 'bg-[#F59E0B]/10 text-white'
                      : 'text-[#E6EDF3] hover:bg-[#1A2029]'
                  }`}
                >
                  {spalten.map((spalte) => {
                    const rawVal =
                      spalte.key === 'play_number'
                        ? play.playNumber
                        : play.breakdown[spalte.key];
                    const strVal = rawVal === undefined || rawVal === null ? '' : String(rawVal);
                    const vorschlaege = schema.dictionary[spalte.key] ?? [];
                    const listId = `dict-${spalte.key}`;

                    if (!istCoachOderAdmin) {
                      return (
                        <td
                          key={spalte.key}
                          className={`whitespace-nowrap px-2.5 py-1.5 ${
                            spalte.typ === 'number' ? 'font-mono video-tabular' : ''
                          }`}
                        >
                          {strVal || '—'}
                        </td>
                      );
                    }

                    return (
                      <td key={spalte.key} className="px-1.5 py-1">
                        {spalte.typ === 'select' ? (
                          <select
                            value={strVal}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              handleFeldAenderung(play, idx, spalte.key, e.target.value)
                            }
                            className="h-7 min-w-[68px] rounded border border-transparent bg-transparent px-1.5 text-xs text-inherit hover:border-[#232933] focus:border-[#F59E0B] focus:bg-[#0B0E11] focus:outline-none"
                          >
                            <option value="" className="bg-[#0B0E11]">
                              —
                            </option>
                            {(spalte.optionen ?? []).map((opt) => (
                              <option key={opt} value={opt} className="bg-[#0B0E11]">
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <>
                            <input
                              type={spalte.typ === 'number' ? 'number' : 'text'}
                              list={vorschlaege.length > 0 ? listId : undefined}
                              value={strVal}
                              onClick={(e) => e.stopPropagation()}
                              onFocus={() => setFokusFeld(spalte.key)}
                              onChange={(e) =>
                                handleFeldAenderung(play, idx, spalte.key, e.target.value)
                              }
                              className={`h-7 rounded border border-transparent bg-transparent px-1.5 text-xs text-inherit hover:border-[#232933] focus:border-[#F59E0B] focus:bg-[#0B0E11] focus:outline-none ${
                                spalte.typ === 'number'
                                  ? 'w-16 font-mono video-tabular'
                                  : 'w-28'
                              }`}
                            />
                            {fokusFeld === spalte.key && vorschlaege.length > 0 && (
                              <datalist id={listId}>
                                {vorschlaege.map((eintrag) => (
                                  <option key={eintrag} value={eintrag} />
                                ))}
                              </datalist>
                            )}
                          </>
                        )}
                      </td>
                    );
                  })}

                  {istCoachOderAdmin && onDeletePlay && (
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeletePlay(play.id);
                        }}
                        title="Spielzug löschen"
                        className="rounded p-1 text-[#6E7681] hover:bg-red-950/50 hover:text-red-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
