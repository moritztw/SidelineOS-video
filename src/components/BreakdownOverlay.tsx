import { useMemo, useRef } from 'react';
import type { TeamRolle } from '@sidelineos/plugin-sdk';
import { SlidersHorizontal, X } from 'lucide-react';
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

interface BreakdownOverlayProps {
  play: PlayEintrag;
  vorherigesPlay?: PlayEintrag;
  schema: TeamTaggingSchema;
  teamRolle: TeamRolle;
  erlaubteSpalten?: string[] | null;
  hotkeyLabel: string;
  onClose: () => void;
  onUpdatePlay: (playId: string, breakdown: PlayBreakdownDaten) => Promise<void>;
  onSchemaLearn: (nextSchema: TeamTaggingSchema) => Promise<void>;
}

/**
 * Schmale, vertikale Seitenleiste direkt über dem Video (normal & Vollbild) zur schnellen
 * Bearbeitung aller aktiven Hudl-Breakdown-Felder per Hotkey (#6).
 */
export function BreakdownOverlay({
  play,
  vorherigesPlay,
  schema,
  teamRolle,
  erlaubteSpalten,
  hotkeyLabel,
  onClose,
  onUpdatePlay,
  onSchemaLearn,
}: BreakdownOverlayProps) {
  const istCoachOderAdmin = teamRolle === 'COACH' || teamRolle === 'TEAM_ADMIN';
  const feldRefs = useRef<Array<HTMLInputElement | HTMLSelectElement | null>>([]);

  const spalten = useMemo(
    () =>
      ermittleSichtbareSpalten(schema, erlaubteSpalten).filter(
        (s) => s.key !== 'play_number'
      ),
    [schema, erlaubteSpalten]
  );

  const handleFeldAenderung = async (key: string, rohWert: string) => {
    const naechstesBreakdown: PlayBreakdownDaten = { ...play.breakdown };
    const feldKonfig = spalten.find((s) => s.key === key);

    if (feldKonfig?.typ === 'number') {
      naechstesBreakdown[key] = rohWert.trim() === '' ? undefined : Number(rohWert);
    } else {
      naechstesBreakdown[key] = rohWert;
    }

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

    if (feldKonfig?.typ === 'text' && rohWert.trim().length > 1) {
      const gelernt = ergaenzeTeamWoerterbuch(schema, key, rohWert);
      if (gelernt !== schema) {
        await onSchemaLearn(gelernt);
      }
    }
  };

  return (
    <aside
      data-breakdown-overlay="true"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      aria-label={`Breakdown-Overlay für Spielzug ${play.playNumber}`}
      className="pointer-events-auto absolute top-0 right-0 bottom-0 z-30 flex w-[296px] max-w-[85%] flex-col border-l border-sl-border bg-sl-canvas/94 backdrop-blur-md shadow-xl"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-sl-border px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-sl-accent" aria-hidden="true" />
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-sl-heading video-tabular">
              Breakdown · Play #{play.playNumber}
            </div>
            <div className="text-[10px] text-sl-muted">
              {hotkeyLabel} oder Esc zum Schließen
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Overlay schließen (Esc)"
          className="rounded-md p-1 text-sl-muted hover:bg-sl-elevated hover:text-sl-heading"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3.5 py-3">
        {spalten.map((spalte, idx) => {
          const rawVal = play.breakdown[spalte.key];
          const strVal = rawVal === undefined || rawVal === null ? '' : String(rawVal);
          const vorschlaege = schema.dictionary[spalte.key] ?? [];
          const listId = `overlay-dict-${spalte.key}`;

          if (!istCoachOderAdmin) {
            return (
              <div
                key={spalte.key}
                className="flex items-center justify-between gap-3 border-b border-sl-border/50 pb-1.5 text-xs"
              >
                <span className="text-sl-muted">{spalte.label}</span>
                <span
                  className={`font-medium text-sl-heading ${
                    spalte.typ === 'number' ? 'font-mono video-tabular' : ''
                  }`}
                >
                  {strVal || '—'}
                </span>
              </div>
            );
          }

          return (
            <label
              key={spalte.key}
              className="grid grid-cols-[110px_1fr] items-center gap-2 text-xs"
            >
              <span className="truncate text-[11px] text-sl-muted" title={spalte.label}>
                {spalte.label}
              </span>
              {spalte.typ === 'select' ? (
                <select
                  ref={(node) => {
                    feldRefs.current[idx] = node;
                  }}
                  value={strVal}
                  onChange={(e) => handleFeldAenderung(spalte.key, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      feldRefs.current[idx + 1]?.focus();
                    }
                  }}
                  className="h-7 w-full rounded border border-sl-border bg-sl-surface px-2 text-xs text-sl-heading focus:border-sl-accent focus:outline-none"
                >
                  <option value="">—</option>
                  {(spalte.optionen ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    ref={(node) => {
                      feldRefs.current[idx] = node;
                    }}
                    type={spalte.typ === 'number' ? 'number' : 'text'}
                    list={vorschlaege.length > 0 ? listId : undefined}
                    value={strVal}
                    onChange={(e) => handleFeldAenderung(spalte.key, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        feldRefs.current[idx + 1]?.focus();
                      }
                    }}
                    placeholder="—"
                    className={`h-7 w-full rounded border border-sl-border bg-sl-surface px-2 text-xs text-sl-heading placeholder:text-sl-subtle focus:border-sl-accent focus:outline-none ${
                      spalte.typ === 'number' ? 'font-mono video-tabular' : ''
                    }`}
                  />
                  {vorschlaege.length > 0 && (
                    <datalist id={listId}>
                      {vorschlaege.map((eintrag) => (
                        <option key={eintrag} value={eintrag} />
                      ))}
                    </datalist>
                  )}
                </>
              )}
            </label>
          );
        })}
      </div>
    </aside>
  );
}
