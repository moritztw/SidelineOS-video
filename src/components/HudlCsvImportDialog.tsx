import { useMemo, useState, type ChangeEvent } from 'react';
import { Check, FileSpreadsheet, Info, Upload, X } from 'lucide-react';
import { erstelleVideoTranslator } from '../i18n/woerterbuch';
import {
  berechneZeilenZuordnungen,
  erstelleHudlCsvVorschau,
  wendeHudlCsvMappingAn,
} from '../services/hudlCsvImporter';
import type {
  HudlCsvImportErgebnis,
  HudlCsvImportVorschau,
  HudlCsvSpaltenMapping,
  PlayBreakdownDaten,
  TeamTaggingSchema,
} from '../types/video';

export type HudlCsvImportModus = 'merge_empty' | 'overwrite';

export interface HudlCsvZielPlay {
  id: string;
  playNumber: number;
  breakdown?: PlayBreakdownDaten;
}

interface HudlCsvImportDialogProps {
  locale?: string;
  schema: TeamTaggingSchema;
  zielPlays: HudlCsvZielPlay[];
  /** `inline` rendert eingebettet im UploadPanel; `modal` rendert als Dialog-Overlay. */
  variant?: 'inline' | 'modal';
  /** Im UploadPanel werden die gemappten Daten beim Ändern direkt an den Eltern-State gemeldet. */
  onErgebnisChange?: (
    ergebnis: HudlCsvImportErgebnis | null,
    dateiName: string | null,
    modus?: HudlCsvImportModus
  ) => void;
  /** Im nachträglichen Import (ReelEditModal / BreakdownGrid) wird der Import aktiv bestätigt. */
  onImportBestaetigen?: (ergebnis: HudlCsvImportErgebnis, modus: HudlCsvImportModus) => Promise<void>;
  onSchliessen?: () => void;
}

export function HudlCsvImportDialog({
  locale,
  schema,
  zielPlays,
  variant = 'modal',
  onErgebnisChange,
  onImportBestaetigen,
  onSchliessen,
}: HudlCsvImportDialogProps) {
  const t = erstelleVideoTranslator(locale);
  const [dateiName, setDateiName] = useState<string | null>(null);
  const [vorschau, setVorschau] = useState<HudlCsvImportVorschau | null>(null);
  const [mappings, setMappings] = useState<HudlCsvSpaltenMapping[]>([]);
  const [modus, setModus] = useState<HudlCsvImportModus>('merge_empty');
  const [fehler, setFehler] = useState<string | null>(null);
  const [importiert, setImportiert] = useState(false);

  const aktiveZielFelder = useMemo(
    () => schema.fields.filter((f) => f.key !== 'play_number'),
    [schema.fields]
  );

  const normalisierteZielPlays = useMemo(
    () =>
      zielPlays.map((p) => ({
        id: p.id,
        playNumber: p.playNumber,
        breakdown: p.breakdown ?? {},
      })),
    [zielPlays]
  );

  const effektivePlayNrSpalte = useMemo(() => {
    const gemappt = mappings.find(
      (m) => m.action === 'map_existing' && m.targetFieldKey === 'play_number'
    );
    return gemappt ? gemappt.columnIndex : vorschau?.playNumberColumnIndex ?? null;
  }, [mappings, vorschau]);

  const zuordnungen = useMemo(() => {
    if (!vorschau) return [];
    return berechneZeilenZuordnungen(vorschau.rows, effektivePlayNrSpalte, normalisierteZielPlays);
  }, [vorschau, effektivePlayNrSpalte, normalisierteZielPlays]);

  const anwendungsErgebnis = useMemo<HudlCsvImportErgebnis | null>(() => {
    if (!vorschau || mappings.length === 0) return null;
    const vorschauMitMappings: HudlCsvImportVorschau = {
      ...vorschau,
      columns: mappings,
      playNumberColumnIndex: effektivePlayNrSpalte,
    };
    return wendeHudlCsvMappingAn(vorschauMitMappings, schema, normalisierteZielPlays, modus);
  }, [vorschau, mappings, effektivePlayNrSpalte, schema, normalisierteZielPlays, modus]);

  const meldeInline = (
    nextVorschau: HudlCsvImportVorschau | null,
    nextMappings: HudlCsvSpaltenMapping[],
    nextModus: HudlCsvImportModus,
    nextDateiName: string | null
  ) => {
    if (!onErgebnisChange) return;
    if (!nextVorschau || nextMappings.length === 0) {
      onErgebnisChange(null, null, nextModus);
      return;
    }
    const playNrCol =
      nextMappings.find((m) => m.action === 'map_existing' && m.targetFieldKey === 'play_number')
        ?.columnIndex ?? nextVorschau.playNumberColumnIndex;
    const res = wendeHudlCsvMappingAn(
      { ...nextVorschau, columns: nextMappings, playNumberColumnIndex: playNrCol },
      schema,
      normalisierteZielPlays,
      nextModus
    );
    onErgebnisChange(res, nextDateiName, nextModus);
  };

  const handleDateiGewaehlt = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFehler(null);
    try {
      const text = await file.text();
      const parsed = erstelleHudlCsvVorschau(text, schema, normalisierteZielPlays);
      if (parsed.columns.length === 0 || parsed.rows.length === 0) {
        setFehler('Die CSV-Datei enthält keine erkennbaren Datenzeilen.');
        setVorschau(null);
        setMappings([]);
        setDateiName(null);
        onErgebnisChange?.(null, null, modus);
        return;
      }
      setDateiName(file.name);
      setVorschau(parsed);
      setMappings(parsed.columns);
      meldeInline(parsed, parsed.columns, modus, file.name);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'CSV konnte nicht gelesen werden.');
    }
  };

  const handleMappingUpdate = (
    columnIndex: number,
    patch: Partial<HudlCsvSpaltenMapping>
  ) => {
    const next = mappings.map((m) => (m.columnIndex === columnIndex ? { ...m, ...patch } : m));
    setMappings(next);
    meldeInline(vorschau, next, modus, dateiName);
  };

  const handleModusWechsel = (nextModus: HudlCsvImportModus) => {
    setModus(nextModus);
    meldeInline(vorschau, mappings, nextModus, dateiName);
  };

  const handleZuruecksetzen = () => {
    setDateiName(null);
    setVorschau(null);
    setMappings([]);
    setFehler(null);
    onErgebnisChange?.(null, null, modus);
  };

  const handleBestaetigen = async () => {
    if (!anwendungsErgebnis || !onImportBestaetigen) return;
    setFehler(null);
    setImportiert(true);
    try {
      await onImportBestaetigen(anwendungsErgebnis, modus);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'CSV-Import fehlgeschlagen.');
    } finally {
      setImportiert(false);
    }
  };

  const zugeordneteAnzahl = zuordnungen.filter((z) => z.matchedPlayNumber !== null).length;
  const neueCustomAnzahl = mappings.filter((m) => m.action === 'create_custom').length;
  const gemappteSpaltenAnzahl = mappings.filter((m) => m.action !== 'ignore').length;

  const inhalt = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-sl-border-strong bg-sl-canvas px-4 py-3">
        <label className="flex flex-1 cursor-pointer items-center gap-2.5 text-xs text-sl-primary">
          <FileSpreadsheet className="h-4 w-4 shrink-0 text-sl-accent" aria-hidden="true" />
          <div className="min-w-0">
            <div className="truncate font-medium text-sl-heading">
              {dateiName ?? t('hudlCsvDropHint')}
            </div>
            <div className="text-[11px] text-sl-muted">
              Komma, Semikolon oder Tab werden automatisch erkannt (UTF-8 / Hudl-Export)
            </div>
          </div>
          <input
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            onChange={handleDateiGewaehlt}
            className="sr-only"
          />
        </label>
        {dateiName && (
          <button
            type="button"
            onClick={handleZuruecksetzen}
            className="rounded-md border border-sl-border bg-sl-surface px-2.5 py-1 text-xs text-sl-muted hover:text-sl-heading"
          >
            Entfernen
          </button>
        )}
      </div>

      {fehler && (
        <div className="rounded-lg border border-sl-danger/40 bg-sl-danger/10 px-3 py-2 text-xs text-sl-danger-text">
          {fehler}
        </div>
      )}

      {vorschau && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sl-border bg-sl-canvas px-3.5 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-3 text-sl-primary video-tabular">
              <span>
                <strong className="text-sl-heading">{vorschau.rows.length}</strong> CSV-Zeilen
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <strong className="text-sl-accent">{zugeordneteAnzahl}</strong> von{' '}
                <strong className="text-sl-heading">{zielPlays.length}</strong> Spielzügen
                zugeordnet
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <strong className="text-sl-heading">{gemappteSpaltenAnzahl}</strong> Spalten aktiv
                {neueCustomAnzahl > 0 ? ` (+${neueCustomAnzahl} neu)` : ''}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-sl-muted">Modus:</span>
              <select
                aria-label="Import-Modus wählen"
                value={modus}
                onChange={(e) => handleModusWechsel(e.target.value as HudlCsvImportModus)}
                className="rounded border border-sl-border bg-sl-surface px-2 py-1 text-xs text-sl-heading focus:border-sl-accent focus:outline-none"
              >
                <option value="merge_empty">{t('hudlCsvModeMerge')}</option>
                <option value="overwrite">{t('hudlCsvModeOverwrite')}</option>
              </select>
            </div>
          </div>

          {zielPlays.length === 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-sl-border bg-sl-canvas px-3 py-2 text-xs text-sl-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sl-accent" aria-hidden="true" />
              <span>
                Wähle zuerst die Videoclips aus – die CSV-Zeilen werden dann automatisch per
                Play-Nummer bzw. Reihenfolge zugeordnet.
              </span>
            </div>
          )}

          <div className="max-h-64 overflow-y-auto rounded-lg border border-sl-border bg-sl-canvas">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-sl-surface text-[11px] text-sl-muted">
                <tr className="border-b border-sl-border">
                  <th className="px-3 py-2 font-mono">CSV-Spalte</th>
                  <th className="px-3 py-2">Beispiele</th>
                  <th className="px-3 py-2">Aktion</th>
                  <th className="px-3 py-2">Ziel-Feld</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.columnIndex} className="border-b border-sl-border/50 last:border-0">
                    <td className="px-3 py-2 font-mono text-sl-heading">
                      {m.csvHeader}
                      {effektivePlayNrSpalte === m.columnIndex && (
                        <span className="ml-1.5 text-[10px] text-sl-accent">(Play #)</span>
                      )}
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-2 text-[11px] text-sl-muted">
                      {m.sampleValues.length > 0 ? m.sampleValues.join(', ') : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        aria-label={`Aktion für Spalte ${m.csvHeader}`}
                        value={m.action}
                        onChange={(e) => {
                          const action = e.target.value as HudlCsvSpaltenMapping['action'];
                          handleMappingUpdate(m.columnIndex, {
                            action,
                            targetFieldKey:
                              action === 'map_existing'
                                ? m.targetFieldKey ?? aktiveZielFelder[0]?.key
                                : undefined,
                            customFieldLabel:
                              action === 'create_custom'
                                ? m.customFieldLabel || m.csvHeader.toUpperCase()
                                : m.customFieldLabel,
                            customFieldType:
                              action === 'create_custom' ? m.customFieldType ?? 'text' : m.customFieldType,
                          });
                        }}
                        className="rounded border border-sl-border bg-sl-surface px-2 py-1 text-xs text-sl-heading focus:border-sl-accent focus:outline-none"
                      >
                        <option value="map_existing">{t('hudlCsvActionMap')}</option>
                        <option value="create_custom">{t('hudlCsvActionCreate')}</option>
                        <option value="ignore">{t('hudlCsvActionIgnore')}</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {m.action === 'map_existing' ? (
                        <select
                          aria-label={`Ziel-Feld für ${m.csvHeader}`}
                          value={m.targetFieldKey ?? ''}
                          onChange={(e) =>
                            handleMappingUpdate(m.columnIndex, { targetFieldKey: e.target.value })
                          }
                          className="w-full rounded border border-sl-border bg-sl-surface px-2 py-1 text-xs text-sl-heading focus:border-sl-accent focus:outline-none"
                        >
                          <option value="play_number">PLAY # (Zuordnung)</option>
                          {aktiveZielFelder.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label} ({f.typ === 'number' ? 'Zahl' : 'Text'})
                            </option>
                          ))}
                        </select>
                      ) : m.action === 'create_custom' ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={m.customFieldLabel || m.csvHeader.toUpperCase()}
                            onChange={(e) =>
                              handleMappingUpdate(m.columnIndex, {
                                customFieldLabel: e.target.value,
                              })
                            }
                            className="w-28 rounded border border-sl-border bg-sl-surface px-2 py-1 text-xs uppercase text-sl-heading focus:border-sl-accent focus:outline-none"
                          />
                          <select
                            value={m.customFieldType ?? 'text'}
                            onChange={(e) =>
                              handleMappingUpdate(m.columnIndex, {
                                customFieldType: e.target.value as 'text' | 'number',
                              })
                            }
                            className="rounded border border-sl-border bg-sl-surface px-1.5 py-1 text-xs text-sl-heading"
                          >
                            <option value="text">Text</option>
                            <option value="number">Zahl</option>
                          </select>
                        </div>
                      ) : (
                        <span className="text-[11px] text-sl-subtle">Wird übersprungen</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {zuordnungen.length > 0 && zielPlays.length > 0 && (
            <div className="rounded-lg border border-sl-border bg-sl-canvas px-3.5 py-2.5 space-y-1.5">
              <div className="text-[11px] font-medium text-sl-muted">
                Vorschau Play-Zuordnung (erste {Math.min(5, zuordnungen.length)} Zeilen)
              </div>
              <div className="space-y-1 text-xs video-tabular">
                {zuordnungen.slice(0, 5).map((z) => (
                  <div
                    key={z.rowIndex}
                    className="flex items-center justify-between gap-2 text-[11px]"
                  >
                    <span className="text-sl-muted">
                      CSV-Zeile {z.rowIndex + 1}
                      {z.csvPlayNumber !== null ? ` (Play #${z.csvPlayNumber})` : ''}
                    </span>
                    <span
                      className={
                        z.matchedPlayNumber !== null ? 'text-sl-heading font-mono' : 'text-sl-subtle'
                      }
                    >
                      {z.matchedPlayNumber !== null
                        ? `→ Play #${z.matchedPlayNumber} (${z.matchReason === 'play_number' ? 'Play-Nr.' : 'Reihenfolge'})`
                        : 'Kein passender Spielzug'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {variant === 'modal' && (
        <div className="flex items-center justify-end gap-2 border-t border-sl-border pt-4">
          {onSchliessen && (
            <button
              type="button"
              onClick={onSchliessen}
              className="rounded-lg border border-sl-border px-4 py-2 text-xs font-medium text-sl-primary hover:bg-sl-elevated"
            >
              Abbrechen
            </button>
          )}
          <button
            type="button"
            disabled={
              importiert ||
              !anwendungsErgebnis ||
              anwendungsErgebnis.playPatches.length === 0
            }
            onClick={handleBestaetigen}
            className="inline-flex items-center gap-2 rounded-lg bg-sl-accent px-4 py-2 text-xs font-semibold text-sl-accent-contrast hover:bg-sl-accent-hover disabled:opacity-45"
          >
            {importiert ? (
              <Upload className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
            ) : (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {importiert
              ? 'Importiere...'
              : `${anwendungsErgebnis?.playPatches.length ?? 0} Spielzüge importieren`}
          </button>
        </div>
      )}
    </div>
  );

  if (variant === 'inline') {
    return inhalt;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={t('hudlCsvTitle')}
    >
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-sl-border bg-sl-surface p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-sl-border pb-3">
          <div>
            <h2 className="text-base font-semibold text-sl-heading">{t('hudlCsvTitle')}</h2>
            <p className="text-xs text-sl-muted">{t('hudlCsvSubtitle')}</p>
          </div>
          {onSchliessen && (
            <button
              type="button"
              onClick={onSchliessen}
              className="rounded-md p-1.5 text-sl-muted hover:bg-sl-elevated hover:text-sl-heading"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {inhalt}
      </div>
    </div>
  );
}
