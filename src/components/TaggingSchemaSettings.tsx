import { useState } from 'react';
import type { TeamRolle } from '@sidelineos/plugin-sdk';
import { Plus, Trash2 } from 'lucide-react';
import { entferneWoerterbuchEintrag } from '../services/taggingEngine';
import type { TeamTaggingSchema } from '../types/video';

export function TaggingSchemaSettings({
  schema,
  teamRolle,
  onSave,
}: {
  schema: TeamTaggingSchema;
  teamRolle: TeamRolle | null;
  onSave: (next: TeamTaggingSchema) => Promise<void>;
}) {
  const [customLabel, setCustomLabel] = useState('');
  const [customTyp, setCustomTyp] = useState<'text' | 'number'>('text');
  const [fehler, setFehler] = useState<string | null>(null);
  const istTeamAdmin = teamRolle === 'TEAM_ADMIN';

  const handleToggleFeld = async (key: string) => {
    const next: TeamTaggingSchema = {
      ...schema,
      fields: schema.fields.map((f) => (f.key === key ? { ...f, aktiv: !f.aktiv } : f)),
      updatedAt: new Date().toISOString(),
    };
    await onSave(next);
  };

  const handleCustomHinzufuegen = async () => {
    const label = customLabel.trim();
    if (!label) return;
    const key = `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    if (schema.fields.some((f) => f.key === key)) {
      setFehler('Dieses Custom-Feld existiert bereits.');
      return;
    }
    setFehler(null);
    const next: TeamTaggingSchema = {
      ...schema,
      fields: [
        ...schema.fields,
        { key, label: label.toUpperCase(), gruppe: 'CUSTOM', typ: customTyp, aktiv: true, custom: true },
      ],
      updatedAt: new Date().toISOString(),
    };
    setCustomLabel('');
    await onSave(next);
  };

  const handleWortLoeschen = async (feldKey: string, wert: string) => {
    const res = entferneWoerterbuchEintrag(schema, feldKey, wert, teamRolle ?? 'PLAYER');
    if (!res.ok) {
      setFehler(res.fehler ?? 'Keine Berechtigung.');
      return;
    }
    setFehler(null);
    await onSave(res.schema);
  };

  return (
    <div className="space-y-6">
      {/* Spalten aktivieren/deaktivieren */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-white">Aktive Breakdown-Felder</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {schema.fields.map((feld) => (
            <label
              key={feld.key}
              className="flex items-center justify-between gap-2 rounded-lg border border-[#232933] bg-[#0B0E11] px-3 py-2 text-xs text-[#E6EDF3]"
            >
              <span className="truncate font-mono">{feld.label}</span>
              <input
                type="checkbox"
                checked={feld.aktiv}
                disabled={!istTeamAdmin}
                onChange={() => handleToggleFeld(feld.key)}
                className="accent-[#F59E0B]"
              />
            </label>
          ))}
        </div>
      </div>

      {/* Custom-Felder anlegen */}
      {istTeamAdmin && (
        <div className="space-y-2 rounded-lg border border-[#232933] bg-[#0B0E11] p-4">
          <h3 className="text-xs font-semibold text-white">Eigenes Custom-Feld anlegen</h3>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="z. B. HASH, TEMPO, COVERAGE"
              className="flex-1 min-w-[180px] rounded-md border border-[#232933] bg-[#13171D] px-3 py-1.5 text-xs text-white"
            />
            <select
              value={customTyp}
              onChange={(e) => setCustomTyp(e.target.value as 'text' | 'number')}
              className="rounded-md border border-[#232933] bg-[#13171D] px-2.5 py-1.5 text-xs text-white"
            >
              <option value="text">Text</option>
              <option value="number">Zahl</option>
            </select>
            <button
              type="button"
              onClick={handleCustomHinzufuegen}
              className="inline-flex items-center gap-1 rounded-md bg-[#F59E0B] px-3 py-1.5 text-xs font-semibold text-[#0B0E11]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Hinzufügen
            </button>
          </div>
        </div>
      )}

      {/* Lernendes Team-Wörterbuch (Löschen nur durch TEAM_ADMIN) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Lernendes Team-Wörterbuch</h3>
          {!istTeamAdmin && (
            <span className="text-xs text-[#8B949E]">Löschen nur durch Team Admin</span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Object.entries(schema.dictionary).map(([feldKey, werte]) => (
            <div
              key={feldKey}
              className="rounded-lg border border-[#232933] bg-[#0B0E11] p-3 space-y-2"
            >
              <div className="font-mono text-xs font-semibold text-[#F59E0B]">
                {feldKey.toUpperCase()}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {werte.map((wert) => (
                  <span
                    key={wert}
                    className="inline-flex items-center gap-1 rounded border border-[#232933] bg-[#13171D] px-2 py-0.5 text-xs text-[#E6EDF3]"
                  >
                    {wert}
                    {istTeamAdmin && (
                      <button
                        type="button"
                        onClick={() => handleWortLoeschen(feldKey, wert)}
                        title={`"${wert}" entfernen`}
                        className="text-[#6E7681] hover:text-red-300"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {fehler && <p className="text-xs text-red-300">{fehler}</p>}
    </div>
  );
}
